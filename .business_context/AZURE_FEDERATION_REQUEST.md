# Azure federated credentials — PR raised

**[PR #99 on `hmcts/azure-github-federation-config`](https://github.com/hmcts/azure-github-federation-config/pull/99), raised 2026-09-03.** Awaiting their review; their
terraform pipeline creates the app registration, service principal, federated credentials and role
assignments on merge.

**Why this was the highest-value item.** The repository has **no repository-level Actions secrets**
(`total_count: 0`) and **no Azure ones at organisation level either** — the 28 org secrets available to it
include `SONAR_TOKEN` and `REGISTRY_*`, but nothing matching `AZURE_CLIENT_ID` or `AZURE_TENANT_ID`. So
four of the six failing
checks on [PR #47](https://github.com/hmcts/deed-poll-admin/pull/47) fail at `azure/login` with *"Not
all values are present. Ensure 'client-id' and 'tenant-id' are supplied"*. This produces those two
values.

## What was submitted

A new **`DTS Shared GitHub Actions ACR Publisher 2`** entry:

```yaml
- name: DTS Shared GitHub Actions ACR Publisher 2
  subjects:
    - 'repo:hmcts/deed-poll-admin:ref:refs/heads/master'
    - 'repo:hmcts/deed-poll-admin:pull_request'
  permissions:
    - role_definition_name: 'AcrPush'
      scopes:
        - /subscriptions/8999dec3-0104-4a27-94ee-6588559729d1/resourceGroups/rpe-acr-prod-rg # DCD-CNP-Prod
        - /subscriptions/bf308a5c-0624-4334-8ff8-8dca9fd43783/resourceGroups/cnp-acr-rg # DCD-CFT-Sandbox
    - role_definition_name: 'AcrPull'
      scopes:
        - /subscriptions/8999dec3-0104-4a27-94ee-6588559729d1/resourceGroups/rpe-acr-prod-rg # DCD-CNP-Prod
        - /subscriptions/bf308a5c-0624-4334-8ff8-8dca9fd43783/resourceGroups/cnp-acr-rg # DCD-CFT-Sandbox
```

**Nothing here was guessed.** The scopes are copied from `DTS Shared GitHub Actions ACR Publisher 1`,
which is the entry holding `expressjs-monorepo-template` and `cath-service` — and the template uses
`REGISTRY_NAME: hmctsprod` with the same `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` secrets, verified by
reading its `job.build-and-publish-images.yml`. The two subjects come from this repo's real triggers:
`workflow.main.yml` on `push` to `master`, `workflow.preview.yml` on `pull_request`.

**A new entry rather than adding to Publisher 1**, because Publisher 1 already carries **exactly 20
subjects** — the hard cap of 20 federated credentials per app registration. The `Publisher 1` →
`Publisher 2` naming follows what `DTS Platform Operations` and `DTS Developers` already do, but the PR
says plainly that the grouping may be theirs to decide.

## Two corrections to the first draft of this request

Both came from reading the actual `app-registrations.yaml` instead of the how-to's examples.

1. **The draft asked for `Contributor` on `DCD-CNP-DEV` for terraform. That was wrong and was
   removed.** `job.terraform.yml` passes `AZURE_CREDENTIALS: ${{ secrets.AZURE_CREDENTIALS_CFT_PREVIEW }}`
   — a service-principal JSON secret — to the library's `terraform-deploy`. Terraform's authentication
   does not come from federated credentials at all, so requesting a subscription-scoped `Contributor`
   role would have been both unnecessary and an over-grant on a shared repository. No existing ACR
   Publisher entry grants anything subscription-scoped.
2. **The draft left the scopes as `TBD`**, on the grounds that only subscription *names* appear in this
   repo. They did not need looking up: the real config states them, with the subscription names as
   trailing comments.

## What this does and does not fix

**Fixes on merge:** `Build & Publish` × 4 (api, web, crons, postgres), and `helm-publish` behind them.

**Does not fix:**

| Still failing | Needs |
|---|---|
| `Infrastructure / Terraform / Terraform Plan` | `AZURE_CREDENTIALS_CFT_PREVIEW` / `_AAT` — service-principal JSON, a different mechanism. **And it will then fail again** on `main.tf:15` / `keyvault.tf:4`, which read a resource group and key vault that do not exist until `deed-poll-shared-infrastructure` does |
| `SonarCloud Code Analysis` | **nothing — this was wrong.** `SONAR_TOKEN` is an organisation secret and the project exists. It was the quality gate failing; fixed separately |
| `Security Scan / osv-scan` | **nothing — fixed.** It uploaded SARIF, which needs Code Security; that is now off (`upload-sarif: false`) and the advisories it then reported are fixed or justified. Passing |

**`DATABASE_URL` is not needed.** The lint failure it looked like it would fix was an empty-string
default, fixed in [#48](https://github.com/hmcts/deed-poll-admin/pull/48). Do not add that secret.

**Worth doing separately:** `cnp-githubactions-library` ships `terraform-deploy-openid` and
`helm-deploy-openid`, which authenticate by OIDC and need no stored credentials. Switching to them would
remove `AZURE_CREDENTIALS_CFT_AAT` and `_PREVIEW` entirely — and those two cover the most privileged
operations here, `terraform apply` and `helm upgrade` into AKS. It cannot be tested without Azure
access, so it wants its own change against a real environment.
