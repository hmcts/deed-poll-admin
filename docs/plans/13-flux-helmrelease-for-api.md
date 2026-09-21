# Plan: Give deed-poll-api a Flux HelmRelease, so admin's readiness can go green

> ## Correction, 2026-09-21 — the HelmRelease does NOT create the `.internal` record. Read this first.
>
> The diagnosis below is right and the HelmRelease is still needed. **Its attribution of the DNS record is
> wrong**, and acting on it as written would land a HelmRelease and leave admin's readiness still failing.
>
> **What actually creates `<product>-<component>-<env>.service.core-compute-<env>.internal`:** a two-line
> entry in `environments/<env>/backend_lb_config.yaml` in
> [`hmcts/azure-platform-terraform`](https://github.com/hmcts/azure-platform-terraform). Merging it generates
> the record through the `cftapps_private_dns` component, pointing at the internal **application gateway** —
> and the record must not be added by hand. Documented at
> `cft-workspace/docs/how-to/path-to-live/private-dns.md`.
>
> **The evidence, since this plan reasoned from `pcs-api` and reached the opposite conclusion:**
>
> - `pcs-api-aat` is a **plain `A` record at 10.10.161.101**, with **no companion external-dns `TXT`
>   ownership record** — so nothing driven by an ingress created it. Read off the live zone.
> - **10.10.161.101 is the `private_ip_address` of the second AAT gateway block in that very file**, which
>   also contains `- product: pcs` / `component: api`. The record is the gateway.
> - **AAT is `stg`** in `azure-platform-terraform`. An earlier search for `environments/aat/…` found nothing
>   and was misread as "no request exists" for the right reason by luck, not by method.
>
> **What the HelmRelease is genuinely for**, and what to keep from this plan: the deployment itself, with
> `ingressHost` set to the same hostname the gateway sends to, and the traefik TLS router left **disabled**
> (`disableTraefikTls: true`, the chart default) — the gateway terminates TLS and speaks plain HTTP on port 80
> to the backend, so a TLS-only ingress leaves both its requests and its probe unmatched and every backend
> reports unhealthy. `deed-poll` having no HelmRelease at all while `apps/pcs/` has ten is still a real gap.
>
> **Status:** the `backend_lb_config.yaml` request is **raised** as
> [`azure-platform-terraform#3163`](https://github.com/hmcts/azure-platform-terraform/pull/3163) — AAT only,
> no `ssl_enabled`, since nothing reaches api by its `platform.hmcts.net` name. **Sequence the HelmRelease
> after it merges**, so that a failing readiness probe afterwards means something new.

## Overview

**This repo's AAT deploy fails, and the cause is in another repo.** Admin's pod starts, then dies:

```
10:28:03Z  Warning  Unhealthy  deed-poll-admin-staging-nodejs-85bd68d54b-sgjn6
                               Readiness probe failed: HTTP probe failed with statuscode: 503
10:30:38Z  Normal   Killing    ... Stopping container deed-poll-admin-staging-nodejs
```

`deedPollApiStatus()` is on readiness deliberately (see `docs/PIPELINES.md`), and it calls the host in
`charts/deed-poll-admin/values.yaml`:

```yaml
DEED_POLL_API_URL: http://deed-poll-api-{{ .Values.global.environment }}.service.core-compute-{{ .Values.global.environment }}.internal
```

In AAT that is `deed-poll-api-aat.service.core-compute-aat.internal`. **That DNS record does not exist.**
Verified 2026-09-17: the `service.core-compute-aat.internal` zone holds 905 records, including
`pcs-api-aat`, and **no `deed-poll` record of any type**.

**Why it does not exist.** `pcs-api` has records in *two* zones, created by *two* systems:

| Host | Created by | Evidence |
|---|---|---|
| `pcs-api-staging.aat.platform.hmcts.net` | Jenkins, `registerDns` writing `${SERVICE_FQDN}` | traefik IP `10.10.159.250` |
| `pcs-api-aat.service.core-compute-aat.internal` | the **Flux** HelmRelease, release name `pcs-api` | live ingress `pcs-api-java`, label `app.kubernetes.io/instance=pcs-api`, 219d old |

`deed-poll` has **no Flux HelmRelease at all** — `apps/deed-poll/` in `cnp-flux-config` holds only
kustomizations, where `apps/pcs/` holds ten HelmReleases. So the `.internal` host is never created, and
admin's readiness can never pass.

**This is step 9 of the migration running order** ("HelmReleases"), pulled forward because it is now the
only thing between admin and a green deploy.

### The ordering that makes this tractable — and why it is not circular

`withPipeline` runs `sectionDeployToAKS` (line 214) **before** `helmPublish` (line 225) on `master`. A chart
is therefore only published *after* a successful AAT deploy. That is why `helm/deed-poll-api` exists at
**0.0.18** (api has deployed) and `helm/deed-poll-admin` does not exist at all (admin never has).

So admin cannot get its own Flux release yet — but it does not need one. It needs **api's**:

> Deploy api via Flux → the `.internal` host exists → admin's readiness passes → admin's Jenkins deploy
> succeeds → admin's chart publishes → admin can have its own Flux release in a later plan.

**Scope is therefore api only, AAT only.** Do not add HelmReleases for `admin` or `web` in this plan.
`web` already deploys via Jenkins and adding it changes a working thing; `admin` is impossible as shown above.

### Source material — read these, do not re-derive them

| What | Where |
|---|---|
| **The authoritative procedure** | `../platops/cnp-flux-config/docs/app-deployment-v2.md` — follow this, it is the repo's own doc |
| The pattern to copy | `../platops/cnp-flux-config/apps/pcs/pcs-api/` (`pcs-api.yaml`, `image-repo.yaml`, `image-policy.yaml`) |
| Where it gets wired in | `../platops/cnp-flux-config/apps/pcs/aat/base/kustomization.yaml` and `apps/pcs/automation/kustomization.yaml` |
| Current deed-poll state | `../platops/cnp-flux-config/apps/deed-poll/` — three kustomizations, no HelmRelease |
| The chart being deployed | `oci://hmctsprod.azurecr.io/helm/deed-poll-api:0.0.18` — inspect with `helm show values` after `az acr login --name hmctsprod` |
| Why admin's URL is what it is | `charts/deed-poll-admin/values.yaml`, and `docs/PIPELINES.md` blocker 6 |

### Decisions already taken — implement these, do not revisit

1. **Chart source is the OCI registry, not the `hmcts-charts` git repo.** Use `hmctsprod-oci`
   (`oci://hmctsprod.azurecr.io/helm`), which is registered as a `HelmRepository` in `flux-system` on
   `cft-aat-01-aks` — verified. `deed-poll-api:0.0.18` is present there — verified. pcs uses
   `chart: ./stable/pcs-api` from the `hmcts-charts` GitRepository instead; **do not copy that**, because it
   could not be verified from this workspace (cloning `hmcts-charts` was denied) and an unverified source is
   how a plan asserts something false.
2. **Pin the chart version to `0.0.18`.** An OCI `HelmRelease` needs an explicit `version:`. Renovate does
   not manage it, so it is a deliberate pin to be raised by hand.
3. **Do not set `ingressHost` in the HelmRelease.** The published chart already defaults it to
   `deed-poll-api-{{ .Values.global.environment }}.service.core-compute-{{ .Values.global.environment }}.internal`
   — confirmed by `helm show values`. Restating it is the drift this whole plan exists to fix. The chart's
   own comment already names admin as the consumer.
4. **AAT only.** Wire the HelmRelease into `apps/deed-poll/aat/base/kustomization.yaml`, *not*
   `apps/deed-poll/base/kustomization.yaml` — the latter would deploy it to preview as well, and preview
   uses per-PR Jenkins deploys. This follows "Add application to only one environment" in the platops doc.
5. **This is a PR to a repo we do not own, and it needs two sets of reviewers.** `CODEOWNERS:178` assigns
   `apps/deed-poll/` to `@hmcts/reform-adoption` (us), but the broader `apps/ @hmcts/platform-operations`
   rule means **the `apps/flux-system/automation/` edit in Task 3 requires a platops review**. Expect the PR
   to sit until platops look at it; that is normal, not a defect in the change. Commit on a branch and push;
   **do not merge**, and do not expect to. The plan finishes at "PR raised".
6. **Never `git add` the clone from the workspace root.** `platops/cnp-flux-config` is an independently
   cloned repo, gitignored by `cft-workspace`. All git operations for the manifests run **inside**
   `platops/cnp-flux-config`. The plan document itself is committed to `deed-poll-admin`.
7. **Change nothing in this repo's charts.** Admin's `DEED_POLL_API_URL` is *correct* — it follows the
   estate convention of pointing at the stable Flux host. The bug is the absent host, not the URL. An
   earlier reading of this recommended editing admin's `values.aat.template.yaml`; that was wrong and is
   recorded here so it is not re-proposed.

### The open question this plan must answer before it writes anything

**Nobody has established what actually creates a `.internal` A record.** The evidence is genuinely
contradictory, and it matters because if the record is not created by deploying, this plan does not fix the
503:

- The `.internal` records point at an **Application Gateway** — `10.10.161.101` is commented `aks01-aat-agw`
  in `azure-private-dns/environments/staging/aat-platform-hmcts-net.yml:48`. Traefik in `cft-aat-01-aks` is
  `10.10.159.250`, a **different** IP.
- Jenkins' `registerDns` writes the *traefik* IP, so Jenkins is not what creates them.
- `pcs-api` appears **nowhere** in `azure-private-dns` — so it is not statically declared either.
- The 295 `-aat` records cluster on a handful of IPs (98 on `10.10.161.100`, 50 on `10.10.161.101`),
  which looks like shared gateway front-ends rather than per-service registration.
- There is **no `external-dns` deployment** in either AAT cluster.

Task 1 exists to settle this. **If it cannot be settled from the repos, stop and report — do not invent a
mechanism, and do not write the manifests on an assumption.** A false premise faithfully implemented is the
most expensive failure this process produces.

## Validation Commands

Run from the `deed-poll-admin` repo root. All four are green **now**, before any task runs — verified
2026-09-17.

```bash
# The flux manifests still build, for every deed-poll overlay.
kubectl kustomize --load-restrictor LoadRestrictionsNone ../platops/cnp-flux-config/apps/deed-poll/base
kubectl kustomize --load-restrictor LoadRestrictionsNone ../platops/cnp-flux-config/apps/deed-poll/aat/base
kubectl kustomize --load-restrictor LoadRestrictionsNone ../platops/cnp-flux-config/apps/deed-poll/preview/base

# Every deed-poll YAML file parses.
find ../platops/cnp-flux-config/apps/deed-poll -name '*.yaml' -exec yq eval 'true' {} \; > /dev/null
```

Notes on tooling, so no task wastes time rediscovering it:

- **`kubectl kustomize` is the kustomize.** Standalone `kustomize` is not installed here, and
  `kubectl kustomize` is equivalent for this purpose. `--load-restrictor LoadRestrictionsNone` is
  **required** — the overlays reference `../../../rbac/nonprod-role.yaml`, outside the build root, and
  without the flag it fails with a `security; file ... is not in or below` error. The platops doc specifies
  the same flag.
- **Do not add `cnp-flux-config`'s own `tests/lint-yaml.sh` to the validation commands.** It needs
  `yamllint`, which is **not installed** here, so it would start red and fail every task from the first one.
  `yq` covers YAML validity. Same for `tests/dry-run-kustomize.sh`, which needs `kubeconform` and network
  schema downloads.
- `yq` is at `/usr/local/bin/yq`. `az` and `kubectl` are present and authenticated; `az acr login --name
  hmctsprod` is needed once before any `helm show`/`helm pull` against the OCI registry.

---

### Task 1: Establish how a `.internal` A record is created, and stop if it cannot be established

**Do not write any manifest in this task.** The only output is a finding, recorded in this plan file.

Answer: *what creates `<service>-aat.service.core-compute-aat.internal` for a Flux-deployed service?*

Gather evidence, and prefer reading source over inference:

1. `grep -rn "pcs-api" ../platops/azure-private-dns/` — expected absent, confirming the record is not
   statically declared. Confirm rather than assume.
2. Inspect the deployed pcs-api ingress and any DNS-related annotations:
   `kubectl --context cft-aat-01-aks get ingress pcs-api-java -n pcs -o yaml`. Look for annotations naming
   a DNS controller, an Application Gateway, or a private-DNS integration.
3. Check whether the AGW ingress controller is what reconciles it:
   `kubectl --context cft-aat-01-aks get pods -A | grep -iE "appgw|agic|ingress"`.
4. Check the chart's own templates for anything that registers DNS —
   `helm template` the `deed-poll-api` chart, or read the `java` library chart it depends on.
5. Read `../platops/cnp-flux-config/docs/app-deployment-v2.md` again for any DNS step. It is silent on DNS,
   which is itself evidence that it is automatic — but do not treat silence as proof.

Record the answer in this file under a new `## Finding: how .internal records are created` heading, citing
the file or command that proves it.

**Contingency, and this is the important half of the task:** if the evidence does not settle it, **write
what you found, mark this plan BLOCKED at the top, and stop.** Do not proceed to Task 2. The right next
step in that case is a `/platops` request in `#platops-help`, which is a human action, not a task. It is far
cheaper to stop here than to raise a PR to another team's repo that does not fix the problem.

- [ ] Task 1 complete

### Task 2: Add the HelmRelease, ImageRepository and ImagePolicy for deed-poll-api

Work inside `../platops/cnp-flux-config`, on a new branch `deed-poll-api-helmrelease`.

Create `apps/deed-poll/deed-poll-api/deed-poll-api.yaml`, following
`apps/pcs/pcs-api/pcs-api.yaml` for shape and `docs/app-deployment-v2.md` for the rules:

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: deed-poll-api
spec:
  releaseName: deed-poll-api
  values:
    java:
      image: hmctsprod.azurecr.io/deed-poll/api:<latest prod- tag> #{"$imagepolicy": "flux-system:deed-poll-api"}
  chart:
    spec:
      chart: deed-poll-api
      version: 0.0.18
      sourceRef:
        kind: HelmRepository
        name: hmctsprod-oci
        namespace: flux-system
```

Rules that apply, each with its reason:

- **`metadata.name`, `releaseName`, the directory name and the file name must all be `deed-poll-api`.**
  The platops doc states file and folder names must match the release name. It is also what makes the
  ingress host `deed-poll-api-aat...` rather than `deed-poll-api-staging...`.
- **Find the real image tag** with
  `az acr repository show-tags --name hmctsprod --repository deed-poll/api --orderby time_desc --top 20`.
  Use a **`prod-`** tag, not `staging-`: the platops doc says image automation is configured for `prod-*` on
  all environments and that breaking it on `aat` is not allowed. As of 2026-09-17 the newest is
  **`prod-fb25a4a-20260917105255`** — verified present. Re-check rather than pasting this one, since api is
  building; but if the newest `prod-` tag is *older* than this, something has been purged and that is a
  finding worth reporting.
- **Keep the `$imagepolicy` comment exactly as shown.** Flux rewrites the image line through it; a
  reformatted or moved comment silently disables automation.
- **Do not add `ingressHost`, `keyVaults` or `environment` overrides.** The published chart already carries
  all of them (decision 3). Verify with
  `helm show values oci://hmctsprod.azurecr.io/helm/deed-poll-api --version 0.0.18` after `az acr login`.

Then create `apps/deed-poll/deed-poll-api/image-repo.yaml` and `image-policy.yaml`, copying
`apps/pcs/pcs-frontend/image-repo.yaml` and `image-policy.yaml`. Note the `hmctsprod` registry annotation —
pcs has `hmcts.github.com/image-registry: hmctsprod`, and deed-poll's images are in `hmctsprod` too, so it
is required. The doc's `add-image-policies.sh` script can generate these; it needs `yq`, which is
installed. Either way, the result must match the pcs shape.

- [ ] Task 2 complete

### Task 3: Wire it into the AAT overlay and the automation kustomizations

Three edits, all in `../platops/cnp-flux-config`.

1. `apps/deed-poll/aat/base/kustomization.yaml` — add the HelmRelease to `resources`. The path is relative
   to that file, so it is `../../deed-poll-api/deed-poll-api.yaml` (compare
   `apps/pcs/aat/base/kustomization.yaml`, which uses exactly this form). **AAT only** — do not touch
   `apps/deed-poll/base/kustomization.yaml` (decision 4).

2. `apps/deed-poll/automation/kustomization.yaml` — this file **does not exist yet** and must be created,
   listing the two image manifests. Copy `apps/pcs/automation/kustomization.yaml` for shape:

   ```yaml
   apiVersion: kustomize.config.k8s.io/v1beta1
   kind: Kustomization
   resources:
     - ../deed-poll-api/image-repo.yaml
     - ../deed-poll-api/image-policy.yaml
   ```

3. `apps/flux-system/automation/kustomization.yaml` — **add `- ../../deed-poll/automation` to `resources`.**
   This is a required edit, not a contingency: the file is an explicit list of 62 per-team automation
   directories, `pcs/automation` is line 59, and `deed-poll` is **absent** — verified 2026-09-17. Without
   this entry Flux never reads the ImageRepository or ImagePolicy, so image automation silently does
   nothing. The list is alphabetical; insert it in order.

After all three edits, the validation commands must pass, and the AAT build must now contain the
HelmRelease. Prove it with `yq`, which selects by `kind` rather than matching text:

```bash
# Must print exactly: deed-poll-api
kubectl kustomize --load-restrictor LoadRestrictionsNone \
  ../platops/cnp-flux-config/apps/deed-poll/aat/base \
  | yq eval 'select(.kind == "HelmRelease") | .metadata.name' -

# Must print nothing — preview stays on per-PR Jenkins deploys (decision 4)
kubectl kustomize --load-restrictor LoadRestrictionsNone \
  ../platops/cnp-flux-config/apps/deed-poll/preview/base \
  | yq eval 'select(.kind == "HelmRelease") | .metadata.name' -
```

**Do not use `grep -c "kind: HelmRelease"` for this.** It reports `1` on the *current, unmodified* tree —
the namespace's `Alert` resource lists `- kind: HelmRelease` under `spec.eventSources`, so the grep matches
a field value and would show the task as already done before any edit. Verified 2026-09-17. The `yq` form
above returns 0 now and correctly finds both releases when run against `apps/pcs/aat/base`, which is the
control worth running once to confirm the command itself works.

- [ ] Task 3 complete

### Task 4: Commit, push and raise the PR — then stop

Inside `../platops/cnp-flux-config`:

- Commit the six files on `deed-poll-api-helmrelease`: three new manifests under
  `apps/deed-poll/deed-poll-api/`, the new `apps/deed-poll/automation/kustomization.yaml`, and the two
  edited kustomizations (`apps/deed-poll/aat/base/` and `apps/flux-system/automation/`).
- Push and raise a PR against `hmcts/cnp-flux-config`. **Do not merge** (decision 5).
- The PR body must state: what breaks without it (admin's readiness 503, with the event log), that scope is
  api/AAT only and why, the chart source and pinned version, and Task 1's finding about DNS.

**If `gh` fails with a 404 or shows `rate_limit: 60`, the token is expired** — that is a known trap here.
`git push` still works, because it uses a different credential helper. In that case push the branch and
report the PR as needing to be raised by hand, with the body text ready to paste. Do not treat it as a
failure of the plan.

Finally, in **this** repo (`deed-poll-admin`), commit the plan with Task 1's finding recorded. Do not move
it to `docs/plans/completed/` — this plan is not complete until the PR merges and the `.internal` record
exists, neither of which is ours to do.

- [ ] Task 4 complete

## How to know it worked

Not by the PR merging — by the record existing and the probe passing. After the PR merges and Flux
reconciles (a few minutes):

```bash
# The record that admin needs. Currently returns nothing.
az network private-dns record-set a list -g core-infra-intsvc-rg \
  -z service.core-compute-aat.internal --subscription DTS-CFTPTL-INTSVC \
  --query "[?contains(name,'deed-poll')].{n:name,ip:aRecords[0].ipv4Address}" -o table

# The pod behind it.
kubectl --context cft-aat-01-aks get pods,ingress -n deed-poll
```

Then re-run admin's Jenkins build. Readiness should report `deedPollApi: UP`, and the deploy should get past
the point it died at 10:28.

**One thing this plan does not fix, and is not supposed to.** Admin's smoke test also asserts
`redis: UP`, and Redis in AAT comes from `hmcts/deed-poll-infra`. If readiness still fails after api is
reachable, read the readiness body before assuming this plan was wrong — `deedPollApi` and `redis` are
reported separately for exactly this reason.
