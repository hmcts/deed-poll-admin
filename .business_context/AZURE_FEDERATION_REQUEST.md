# Azure federated credentials — PR to azure-github-federation-config

Drafted 2026-09-03. Self-service, per
[`docs/how-to/federated-credentials.md`](../../docs/how-to/federated-credentials.md) in the workspace:
add an entry to `app-registrations.yaml` in
[`hmcts/azure-github-federation-config`](https://github.com/hmcts/azure-github-federation-config) and
raise a PR. The terraform pipeline there creates the app registration, service principal, federated
credentials and role assignments on merge.

**Why this is the highest-value thing outstanding.** The repository has **no Actions secrets at all**
(`gh api repos/hmcts/deed-poll-admin/actions/secrets` → `total_count: 0`), and five of the six failing
checks on [PR #47](https://github.com/hmcts/deed-poll-admin/pull/47) fail at `azure/login` with
*"Not all values are present. Ensure 'client-id' and 'tenant-id' are supplied"*. This request produces
those two values.

**Raised by Steve, not from the devcontainer** — pushing to `hmcts` needs SAML SSO authorisation that is
not available here, the same constraint as the IDAM registration.

---

## The entry to add

Two values in `scopes` are marked `TBD`. They are subscription **IDs**, and only the subscription
**names** appear in this repo — `stage.infrastructure.yml:27-28`. Look them up with
`az account show --subscription "DCD-CNP-DEV" --query id -o tsv`, or ask Platform Operations. **Do not
guess them**; a wrong scope creates a role assignment somewhere unintended.

```yaml
- name: Deed Poll Admin GitHub Actions
  subjects:
    # workflow.main.yml — on: push: branches: [master]
    - 'repo:hmcts/deed-poll-admin:ref:refs/heads/master'
    # workflow.preview.yml — on: pull_request, branches: [master]
    - 'repo:hmcts/deed-poll-admin:pull_request'
  permissions:
    # Pushing images and Helm charts to hmctsprod.azurecr.io. Both ACR logins in the workflows pass
    # `allow-no-subscriptions: true`, so this needs no subscription-scoped role — only AcrPush on the
    # registry itself.
    - role_definition_name: AcrPush
      scopes:
        - TBD-hmctsprod-acr-resource-id
    # Terraform in infrastructure/ — subscription DCD-CNP-DEV per stage.infrastructure.yml:27.
    - role_definition_name: Contributor
      scopes:
        - /subscriptions/TBD-DCD-CNP-DEV-subscription-id
```

Only **2 subjects**, so the 20-federated-credential cap is not close.

## What each workflow needs, and which check it fixes

| Workflow / job | Needs | Failing check on #47 |
|---|---|---|
| `job.build-and-publish-images.yml:141-143` | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` → ACR push to `hmctsprod` | `Build & Publish` × 4 (api, web, crons, postgres) |
| `job.helm-publish.yml:32-39` | same, then `az acr login` | (not reached — gated behind the image builds) |
| `job.terraform.yml` | `azure/login` on the way to `terraform-deploy` | `Infrastructure / Terraform / Terraform Plan` |
| `job.helm-deploy.yml:86-90` | same for ACR, then AKS | (not reached) |

## Two things this request does **not** fix

1. **`AZURE_CREDENTIALS_CFT_AAT` and `AZURE_CREDENTIALS_CFT_PREVIEW` are a different mechanism.** They
   are service-principal JSON blobs passed to the library's `terraform-deploy` and `helm-deploy`
   (`job.terraform.yml:95`, `job.helm-deploy.yml:103,118`), and federated credentials do not produce
   them. **`cnp-githubactions-library` ships `terraform-deploy-openid` and `helm-deploy-openid`**, which
   authenticate by OIDC and need no stored credentials — switching to those would remove both secrets
   and cover the most privileged operations here, `terraform apply` and `helm upgrade` into AKS. Worth
   doing as its own change against a real environment rather than folded into this one; see the note
   under Phase 6 in [`PROGRESS.md`](PROGRESS.md).

2. **`terraform plan` will still fail after this, for a different reason.** `infrastructure/main.tf:15`
   and `keyvault.tf:4` are `data` blocks reading resource group and key vault `deed-poll-{env}`, and
   **`deed-poll-shared-infrastructure` does not exist yet**. Until today that was a prediction; the plan
   has never got past `azure/login` to prove it, so expect this to surface once credentials work rather
   than treating it as a regression.

## Still separately needed

- **`SONAR_TOKEN`** — a SonarCloud project for `hmcts.deed-poll-admin` plus its token, for the
  `SonarCloud Code Analysis` check.
- **GitHub Code Security enabled on the repository** — a repository setting, not a credential. Without
  it `Security Scan / osv-scan` fails with *"Code Security must be enabled for this repository to use
  code scanning"*.
- **`DATABASE_URL` is no longer needed.** The lint job's `prisma validate` failure was an empty-string
  default, fixed in [#48](https://github.com/hmcts/deed-poll-admin/pull/48) — so do not add that secret
  to make lint pass.
