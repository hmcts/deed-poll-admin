# What was submitted to hmcts/idam-access-config

The six files under `apps/` are the IDAM client registration for `deed-poll-admin`, as raised to
[`hmcts/idam-access-config`](https://github.com/hmcts/idam-access-config) on **2026-09-03**. The paths
here mirror the target repo, so `apps/deed-poll/base/services.yaml` in this directory is
`apps/deed-poll/base/services.yaml` there.

**This is a record, not a task, and not a live copy.** It exists because the only account of what was
asked for otherwise lived in `/tmp`, and a `/tmp` that survived one session is not a record. Read it to
answer "what did we actually request?" when IDAM's provisioning is compared against it. The rationale
behind each value is in [`../IDAM_REGISTRATION_REQUEST.md`](../IDAM_REGISTRATION_REQUEST.md); this
directory is the artefact, that document is the argument.

**It will not track the upstream repo.** If IDAM amend the config on merge, or a later change is made
there, this copy becomes a snapshot of the original request rather than current state — which is what it
is for. Do not edit these files expecting anything to happen; a change to the real registration is
another PR to `idam-access-config`.

> **That has now happened: #993 has moved on and this directory has not.** On **2026-09-10** three
> corrections were pushed to the PR branch, and the six files here are no longer what it carries:
>
> | | Here (as submitted 2026-09-03) | On #993 now |
> |---|---|---|
> | AAT host | `deed-poll-deed-poll-admin-staging-web.aat…` | `deed-poll-admin-staging.aat.platform.hmcts.net` |
> | Other environments | four folders, one per env | one `<<ENV>>` entry in `base`; `demo/`, `ithc/`, `perftest/` deleted |
> | `base` redirect URIs | `[]`, "production TBD" | `https://deed-poll-admin.<<ENV>>.platform.hmcts.net/oauth2/callback` |
> | Vault secret | `<<vault.idam-client-secret>>` | `<<vault.admin-idam-client-secret>>` |
>
> These files are **left as submitted on purpose** — that is what makes them a record. Read the current
> state from #993 itself, or from the YAML quoted in
> [`../IDAM_REGISTRATION_REQUEST.md`](../IDAM_REGISTRATION_REQUEST.md), which is kept in step with the PR.
> The rest of this README describes the snapshot, and the two "worth knowing" notes below are the reasoning
> that produced the corrections.

## What is in each file

| File | What |
|---|---|
| `apps/deed-poll/base/services.yaml` | the client: `authorization_code` + `refresh_token`, scopes `openid profile roles offline_access`, `HMCTS_ACCESS` frontend, `moj` SSO, MFA off, secret at `deed-poll-<<ENV>>/idam-client-secret` |
| `apps/deed-poll/base/roles.yaml` | the one privileged role, `caseworker-deedpoll-admin`, managed by `ccd-admin` |
| `apps/deed-poll/{aat,demo,ithc,perftest}/services.yaml` | per-environment `redirect_uris` and `post_logout_redirect_uris` — `localhost:3000` for local development plus that environment's hostname |

## Three things about the contents worth knowing before reading them

- **`redirect_uris` and `post_logout_redirect_uris` are empty in `base/` here, and that was wrong rather
  than pending.** The reasoning at the time was that they are production's and the production hostname was
  not settled. But `base/` reaches every environment, and the chart *does* state a host for all of them —
  `deed-poll-admin.{{ .Values.global.environment }}.platform.hmcts.net` — so the templated `<<ENV>>` form
  was available all along. **The gap it left bites silently:** IDAM refuses a `redirect_uri` it does not
  hold, and the refusal renders on IDAM's own page *after* a successful login, so no request reaches our
  logs and nothing in this repo fails. Filled in on #993 on 2026-09-10.

- **The doubled segment in the hostnames is wrong, and these files still carry it.** They are left as
  submitted, because this directory is the record of what was submitted — but
  `deed-poll-deed-poll-admin-staging-web.aat.platform.hmcts.net` does read like a mistake and is one. It came
  from `helm/deed-poll-admin/values.template.yaml`'s
  `${TEAM_NAME}-{{ .Release.Name }}-web.${ENVIRONMENT}…` on the assumption that `TEAM_NAME` was `deed-poll`
  from `annotations.team` and `ENVIRONMENT` was `aat`. Neither holds: `helmInstall` exports neither variable
  to a values template, so `envsubst` emptied `${ENVIRONMENT}` and left a doubled dot, and `TEAM_NAME` is
  `TeamConfig.getName(product)` — a team display name from `cnp-jenkins-config/team-config.yml` that falls
  back to the literal `pleaseTagMe` for a product it does not list, which `deed-poll` is.

  **The hosts to register instead**, settled 2026-09-10 by plan 03 task 4, which rewrote the chart to use
  `${SERVICE_FQDN}`:

  | File | Host |
  |---|---|
  | `base/services.yaml` | `https://deed-poll-admin.<<ENV>>.platform.hmcts.net/oauth2/callback` |
  | `aat/services.yaml` | `https://deed-poll-admin-staging.aat.platform.hmcts.net/oauth2/callback` and `http://localhost:3000/oauth2/callback` — **not** the base entry as well, because in AAT the chart serves only on `${SERVICE_FQDN}` |

  [`hmcts/idam-access-config#993`](https://github.com/hmcts/idam-access-config/pull/993) was still **open and
  unmerged**, so the correction went into that PR rather than into a second one — pushed to its branch on
  2026-09-10. Do not amend the YAML here to match: this directory stops being a record of the original
  request the moment you do, which is why the divergence is tabulated at the top instead. Full reasoning,
  including the separate `idam-client-secret` / `admin-idam-client-secret` mismatch, is in
  [`../IDAM_REGISTRATION_REQUEST.md`](../IDAM_REGISTRATION_REQUEST.md).

- **`demo`, `ithc` and `perftest` were speculative, and are now gone from the PR.** `Jenkinsfile_CNP`
  enables preview (per PR) and AAT only — it calls no `enableDemoDeployment()`, `enableITHCDeployment()` or
  `enablePerformanceDeployment()` — so those three hostnames had never been rendered from a real chart, let
  alone deployed. They were not deleted for being speculative, though: `<<ENV>>` substitutes inside a
  redirect URI, as `apps/pt` and `apps/pcs` show, and `base/` reaches every environment, so one templated
  entry in `base` covers all three and production too. Three near-identical folders were redundant, not
  wrong.

**Preview environments have no entry here, and that is a gap rather than a settled answer.** The claim that
AAT adds a `https://allow-pr-redirects` wildcard covering per-PR hostnames is unverified, and
`idam-access-config` registers nothing for `apps/pcs`'s preview environments either — so either IDAM permits
a pattern that repo does not show, or pcs preview sign-in does not work. `${SERVICE_FQDN}` differs per pull
request, so this needs an answer from IDAM; do not invent a wildcard.
