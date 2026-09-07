# deed-poll infrastructure — target state

Started 2026-09-06. **This is a decisions-and-target-state document, not a Ralphex plan.** The Ralphex
plan(s) get written from it once the open questions at the bottom are closed — see
["Turning this into Ralphex plans"](#turning-this-into-ralphex-plans), because it cannot be a single run.

Companion to [`DEED_POLL_API_PLAN.md`](DEED_POLL_API_PLAN.md) (why the backend is shaped as it is) and
[`MIGRATION_PLAN.md`](MIGRATION_PLAN.md) (Track A/B). Deployment gates are tracked in
[`PROGRESS.md`](PROGRESS.md); this file supersedes its Phase 6 assumptions about GitHub Actions.

## Why this exists

`deed-poll-admin/infrastructure/` held both the **product-shared** resources (resource group, Key Vault)
and **admin's own** component resources, because when it was written admin was the only component. It no
longer is. `deed-poll-web` and `deed-poll-api` both exist, and `deed-poll-web/infrastructure/` was
independently creating a Postgres flexible server with **the same Azure name** and writing **the same
secret names** into the same vault — so whichever root applied last would silently repoint the other
service's database and telemetry.

`hmcts/deed-poll-infra` was created on 2026-09-06 to hold what all three components share.

**Nothing has ever been applied in any environment.** There is no state to migrate, no `terraform state
mv`, no import, and no risk of orphaning a live resource. That window closes on the first successful
apply, which is the reason to finish this now rather than after the credentials land.

## Four repos

| Repo | Role | Deploys |
|---|---|---|
| `deed-poll-infra` | product-shared Terraform | Jenkins, `withInfraPipeline` |
| `deed-poll-admin` | internal staff app (caseworkers) | Jenkins, `withPipeline` |
| `deed-poll-web` | citizen service, anonymous in release 1 | Jenkins, `withPipeline` |
| `deed-poll-api` | Spring Boot backend, owns the domain schema | Jenkins, `withPipeline` |

**All four default to `master`** as of 2026-09-06. `deed-poll-api` and `deed-poll-infra` were on `main` and
were renamed with the GitHub rename API, which moves the default pointer and retargets open PRs. Done
before Jenkins onboarding deliberately: HMCTS Jenkins conventions assume `master` in places, and the
rename was free while `deed-poll-infra` had one commit and no pipeline.

---

## Decision 1 — Jenkins CNP for all four repos

**Steve's call, 2026-09-06.** All four use the Jenkins CNP pipeline (`Jenkinsfile_CNP`,
`@Library("Infrastructure")`, cnp-jenkins-config onboarding, Flux) rather than
`cnp-githubactions-library`.

"The CNP pipeline" is ambiguous in this estate and the two options were:

| | What | Who was on it before this decision |
|---|---|---|
| **Jenkins CNP** | `Jenkinsfile_CNP`, `withPipeline` / `withInfraPipeline`, Flux | All 85 HMCTS `*-shared-infrastructure` repos. The CNP docs assume it |
| `cnp-githubactions-library` | `terraform-deploy`, `helm-deploy`, `container-build-push` | `deed-poll-admin` and `deed-poll-web` |

`deed-poll-api` already carried a `Jenkinsfile_CNP`, but it is **unedited template boilerplate** —
`product = "rpe"`, `component = "demo"`, empty `withPipeline` body. It has never been configured.

### What this decision buys and costs

**It takes the longest-running blocker off the critical path.** `PROGRESS.md` records four missing Azure
secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CREDENTIALS_CFT_PREVIEW`,
`AZURE_CREDENTIALS_CFT_AAT`) and
[`azure-github-federation-config#99`](https://github.com/hmcts/azure-github-federation-config/pull/99),
open and unreviewed since 2026-09-03. **Those are GitHub Actions-specific.** Jenkins authenticates as
its own managed identity, so:

- the four repository secrets are no longer needed,
- PR #99 is no longer a gate, and should be **closed** — see below,
- the `job.terraform.yml:95` `_PREVIEW`/`_AAT` trap recorded in `PROGRESS.md` becomes moot.

**The new external dependency is cnp-jenkins-config onboarding, four entries.** That trades one
external wait for another, but for a well-trodden path rather than a queue.

**The IDAM registration PR in `hmcts/idam-access-config` is unaffected** and remains a wait. IDAM client
registration is independent of which pipeline builds the service. Do not close that one alongside #99.

### PR #99 should be closed

[`azure-github-federation-config#99`](https://github.com/hmcts/azure-github-federation-config/pull/99)
adds `hmcts/deed-poll-admin` to a `DTS Shared GitHub Actions ACR Publisher 2` entry with `AcrPush` /
`AcrPull`, so that **GitHub Actions** can push images to `hmctsprod.azurecr.io` using
`secrets.AZURE_CLIENT_ID` / `AZURE_TENANT_ID` from `job.build-and-publish-images.yml`.

Its two federated subjects are `workflow.main.yml` (push to `master`) and `workflow.preview.yml`
(`pull_request`) — **both deleted by Decision 1**, so the grant would be for triggers that can never
fire. Close it with a comment rather than leaving a reviewer to work through a request that is no longer
wanted, or having it merged into standing ACR access nothing uses. Reopening is trivial if Decision 1 is
ever revisited.

### The cost: all of GitHub Actions, in all four repos

**Steve's call, 2026-09-06: delete `.github/workflows/` entirely, everywhere.** Not just the deploy-side
workflows. The reasoning is divergence and cognitive load — one pipeline to understand rather than a
split where the boundary has to be remembered, and the rest of the estate is on Jenkins.

The CNP Jenkins pipeline covers build, test, Sonar and dependency/container scanning, so lint, test,
`osv-scanner` and SonarCloud are replaced rather than lost.

**One thing is genuinely lost: CodeQL.** `deed-poll-api/.github/workflows/codeql.yml` is a GitHub-native
scanner with no Jenkins equivalent. Accepted as part of this decision.

**Renovate survives** — it is configured by `.github/renovate.json`, which is config rather than a
workflow, so it is unaffected. Note the three Renovate config defects already fixed in admin and recorded
in `PROGRESS.md`; that work is not wasted.

Admin's GitHub Actions CI was green (lint, test, `osv-scan`, SonarCloud, `Terraform Format`) and is being
discarded deliberately.

### Consequences to carry into the plan

- Terraform state and the backend are configured by the pipeline. The GHA action's quirks recorded
  elsewhere in `.business_context/` **no longer apply**: the `{repository}/{env}/terraform.tfstate` state
  key derivation, the ignored `working-directory`, and `terraform_version_file` being silently discarded
  are all `cnp-githubactions-library` behaviours.
- `git::https://` module sources were required *because* GitHub Actions runners have no deploy key for
  hmcts repos. Jenkins agents do, and the estate convention is `git@github.com:`. **Keep `git::https://`
  anyway** — it works under both and there is no reason to churn it.
- `.terraform-version` is not used by either pipeline. Delete rather than maintain a decorative file.
- Deployment moves to Flux, so the open "which repo declares the `deed-poll` namespace" question in
  `PROGRESS.md` becomes a concrete `cnp-flux-config` change per component rather than a question.

---

## Decision 2 — the shared / component split

Taken from what comparable products actually do, both cloned in this workspace, rather than from
judgement. **They agree.**

| | `*-shared-infrastructure` holds | Component repos hold |
|---|---|---|
| `apps/pt` | `app-insights.tf`, `key-vault.tf`, `redis.tf`, `main.tf`, `provider.tf`, `variables.tf` | `pt-api`, `pt-frontend` — **no `infrastructure/` at all** |
| `apps/pcs` | the same, plus `hmc-servicebus.tf` and per-env tfvars | `pcs-api` — `database.tf` only. `pcs-frontend` — **nothing** |

So **App Insights and Redis are shared, not per-component**, and a frontend normally owns no Terraform
whatsoever. Applied to deed-poll:

| Repo | Terraform it owns | Why |
|---|---|---|
| `deed-poll-infra` | resource group, Key Vault + managed identity, App Insights, Redis, **Postgres** | Product-level. One App Insights also means traces correlate across web → api → admin. Postgres: see [Decision 3](#decision-3--postgres-is-shared-and-admins-sessions-move-to-redis) |
| `deed-poll-api` | **none** | Consumes the shared Postgres; owns its *schema*, not the server |
| `deed-poll-web` | **none** | Frontend. Reads `redis-url` from the shared vault. Has no database at all |
| `deed-poll-admin` | **none** | Frontend. Reads `postgres-url` — sessions and, until the cutover, case data. No Redis |

Each repo still owns its own **Helm chart and values**, its own `Jenkinsfile_CNP`, and its own build/test
config. Those are per-component by nature and are not what "shared infrastructure" means.

### Two earlier claims this corrected

Recorded so they are not reintroduced:

- **Redis does not have to be web-specific.** Both pt and pcs put it in the shared repo.
- **App Insights is not an open decision.** The estate has settled it: shared. That reduces the
  `ExpressJsAppInsightsConnectionString` collision from a design question to a rename.

---

## Decision 3 — Postgres is shared, and admin's sessions stay in Postgres in their own schema

**Steve's calls, 2026-09-06.** The Postgres flexible server lives in `deed-poll-infra`, and
`deed-poll-admin` **keeps `@hmcts-cft/express-session-postgres`** — moving the session table into its own
schema rather than moving the store to Redis.

**This reverses an earlier recommendation in this document.** Redis was proposed to keep the session table
out of the `public` schema that api's Flyway will own. Steve's challenge — admin is low-volume, so why add
Redis — was right, and checking the library settled it: `PostgresStore` already takes a **`schemaName`**
option (defaulting to `"public"`) alongside `tableName`, and creates its own table with
`CREATE TABLE IF NOT EXISTS %I.%I`. So the isolation Redis was buying costs **one config value**.

| | Move to Redis | Keep Postgres, own schema |
|---|---|---|
| Work in admin | port `libs/express-session-redis` from the template, swap the store, update tests, re-point readiness, add a key prefix | pass `schemaName`, add a migration creating the schema |
| Solves the Flyway ownership problem | yes | yes |
| New infrastructure | none — Redis exists anyway for web | none |
| New secret for admin | `redis-url` | none |

Redis is still provisioned in `deed-poll-infra`, because **`deed-poll-web` needs it** — it already uses
`@hmcts-cft/express-session-redis`. Admin simply does not consume it.

### The one thing to get right

`CREATE TABLE IF NOT EXISTS session.session` **does not create the schema.** `PostgresStore` only issues
the `CREATE TABLE`, so something else must `CREATE SCHEMA IF NOT EXISTS` first or startup fails.

Do it in an admin Prisma migration. It survives the api cutover untouched, because api's Flyway owns
`public` and `ccd` and has no reason to look at this one.

Worth raising upstream separately: the library exposes `schemaName` but cannot actually use a schema that
does not already exist. That is a template gap, and per convention it gets fixed in
`hmcts/expressjs-monorepo-template` rather than patched in place here.

### Who actually shares the database

**Not web.** `deed-poll-web` has no database: it already uses `@hmcts-cft/express-session-redis`, and its
only Prisma is the template's `libs/onboarding` demo, which is being dropped. Its `postgres.tf` was
template cruft creating a second server with the *same Azure name* as admin's — the collision that
prompted this whole exercise.

So it is **admin and api** during transition, and **api alone** afterwards.

### Schema ownership is a handover, never shared

| Schema / table | Today | After the api cutover |
|---|---|---|
| `public` — domain tables | admin's Prisma, `apps/postgres/prisma/migrations/` | **api's Flyway** |
| `ccd` — `case_data`, `case_event`, `message_queue_candidates`, `es_queue` | admin's vendored `apps/postgres/ccd-runtime/` (25 SQL files) | **api, via the SDK's Flyway.** The vendored files are deleted |
| `session` schema — the session table | **admin's `pg.Pool`**, in its own schema | unchanged — still admin's |

`DEED_POLL_API_PLAN.md:229` rejected two migration tools against one Postgres and that still holds — the
cutover *moves* ownership rather than sharing it. **Giving the session table its own schema is what keeps
that true**: every schema has exactly one owner, and Flyway never meets a table it did not create.

This supersedes `DEED_POLL_API_PLAN.md:159`, which puts the session table in `public`. Admin therefore
keeps `postgres-url` permanently rather than only until the cutover.

### Why the server is shared infrastructure even though api ends up its only consumer

This departs from `pcs-api`, which owns its own `database.tf` — and the reason is that `pcs-api` is its
database's **sole** consumer, which is not true here:

- Admin will be deployable long before api is (api is at task 12 of 17). If the server lived in api's
  root, admin could not deploy until api's pipeline had run.
- `DEED_POLL_API_PLAN.md:159` already commits to **one server, one database** shared by api and admin.
- The *server* is shared infrastructure with a stable owner; *schema* ownership is an application concern
  that changes hands from Prisma to Flyway. Terraform should not have to move repos when it does.

### Implementation consequences

- **The database is named `deed-poll`**, not `deed-poll-admin`. It is one shared database, and pcs names
  theirs after the product. `postgres-url` hardcodes the name, so it changes with it.
- **Admin keeps `postgres-url` and needs no `redis-url`.** Web is the only Redis consumer.
- Admin's readiness check `deedPollDatabaseChecks` still needs re-pointing at the api cutover: it probes
  the case tables today, and afterwards should probe what the app actually depends on — the session schema.
  That is cutover work, not part of this.

---

## Decision 4 — vault secret naming

**Steve's call, 2026-09-06.** Prefix per component **only what is unsafe to share**. Leave the rest
unprefixed, because the vault is already `deed-poll-{env}` and each of those resources genuinely is one
shared thing.

| Today | Target | Why |
|---|---|---|
| `session-secret` | **`admin-session-secret`**, **`web-session-secret`** | Two frontends. One signing key across a caseworker service and a public one means a forged cookie is portable between them |
| `idam-client-secret` | **`admin-idam-client-secret`** | Admin's caseworker client. Web is anonymous in release 1 and needs none; api is a resource server and needs `IDAM_API_AUDIENCES`, not a client secret |
| `ExpressJsAppInsightsConnectionString` | **`app-insights-connection-string`** | All three read it; the current name is the expressjs template's and api is Spring Boot |
| `postgres-host` / `-user` / `-password` / `-port` / `-url` | **unchanged** | One server, one database, genuinely shared. pcs prefixes per component because each of theirs owns its own database — ours does not |
| `redis-host` / `-port` / `-access-key` / `-url` | **unchanged** | One shared instance, both frontends connect to it |

### Two things that come with this

- **`idam-client-secret` must be renamed before IDAM replies.** That value is added to the vault by hand,
  so renaming afterwards means someone redoes the manual step.
- **Set distinct connect-redis key prefixes.** It defaults to `sess:`, so admin's and web's sessions would
  share one keyspace in the shared instance. It is safe — different signing secrets mean neither app
  validates the other's cookie — but a flush would hit both and debugging gets confusing.

The rename touches the `keyVaults:` list in admin's four `values.yaml` files and web's. Aliases
(`SESSION_SECRET`, `APPLICATION_INSIGHTS_CONNECTION_STRING`, …) stay the same, so no application code
changes.

---

## Decision 5 — S2S is deliberately out of the first apply

**Steve's call, 2026-09-06.** `deed-poll-api` will need S2S tokens for `ccd-data-store-api` and CDAM, but
none of it goes in yet.

Both reference products copy the microservice key out of the central S2S vault into their own, and both
register **the frontend as well as the API** (`microservicekey-pt-api` *and* `microservicekey-pt-frontend`;
same for pcs). So deed-poll may eventually need two or three keys, not one.

The shape, for when the keys exist:

```hcl
data "azurerm_key_vault" "s2s_vault" {
  name                = "s2s-${var.env}"
  resource_group_name = "rpe-service-auth-provider-${var.env}"
}

data "azurerm_key_vault_secret" "api_s2s_key_from_vault" {
  name         = "microservicekey-deed-poll-api"
  key_vault_id = data.azurerm_key_vault.s2s_vault.id
}

resource "azurerm_key_vault_secret" "api_s2s_secret" {
  name         = "api-s2s-secret"
  value        = data.azurerm_key_vault_secret.api_s2s_key_from_vault.value
  key_vault_id = module.key-vault.key_vault_id
}
```

**Adding this before the microservice is registered fails the apply** — the `data` source cannot resolve a
secret that does not exist. Since the whole reason for doing this work now is that the first apply is
free, that block waits. Same reasoning as `idam-client-secret`, which is already deliberately absent.

**The registration path is not confirmed.** Nothing in the cloned CNP docs (`platops/hmcts.github.io`)
covers S2S onboarding, and `platops/idam-access-config` is in `workspace.yaml` but not cloned. Treat
identifying it as an external task alongside the IDAM request.

---

## The file-by-file target state

Almost all of this is **moving files that already exist**. Only five files are genuinely new, and one of
those is a re-home of blocks that exist today.

### `deed-poll-infra`

Current contents are a verbatim copy of `deed-poll-admin/infrastructure/`, uncommitted, in a repo with no
commits and an empty remote.

| Target file | Source | Action |
|---|---|---|
| `main.tf` | existing `main.tf` | **Trim.** Keep the shared RG (`${product}-${env}`), delete `azurerm_resource_group.rg`, lift the provider blocks out. `pcs-shared-infrastructure/main.tf` is *only* that one resource group |
| `provider.tf` | provider blocks in `main.tf`, plus `state.tf` | **Re-home.** pcs puts `required_providers`, the provider, and `backend "azurerm" {}` all in this one file |
| `key-vault.tf` | existing `keyvault.tf` | **Move, rewire auth.** Hyphenated filename; `object_id` from `var.jenkins_AAD_objectId`; add `data "azurerm_user_assigned_identity" "jenkins"` (`jenkins-${env}-mi` in `managed-identities-${env}-rg`) for `jenkins_object_id`; `grant_preview_jenkins_access = var.env == "aat"`; tenant from `data.azurerm_client_config.current` |
| `app-insights.tf` | existing `appinsights.tf` | **Move.** Hyphenated filename; repoint `resource_group_name` at the shared RG (it currently references the component RG being deleted); rename the secret off `ExpressJsAppInsightsConnectionString` |
| `redis.tf` | **`deed-poll-web/infrastructure/redis.tf`** | **Move across repos.** Drop `${var.component}` from the instance name — it is product-level now |
| `postgres.tf` | existing `postgres.tf` | **Stays, modified.** Rename the database `deed-poll-admin` → `deed-poll` and fix the name hardcoded into `postgres-url`; `admin_user_object_id = var.jenkins_AAD_objectId`; drop `var.component` from the module call. The aliased `postgres_network` provider moves to `provider.tf` with the others |
| `variables.tf` | existing `variables.tf` | **Rewrite.** See below — the largest single change |
| `Jenkinsfile_CNP` | pt/pcs | **New.** Four lines: `@Library("Infrastructure@<ver>") _`, `def product = "deed-poll"`, `withInfraPipeline(product) {}` |
| `README.md`, `renovate.json`, `.gitignore` | — | **New.** Both reference repos carry a README and `renovate.json` |
| `state.tf` | — | **Delete.** The backend moves into `provider.tf`; neither reference repo has this file |
| `output.tf` | — | **Delete.** Neither reference repo has one; these outputs existed for the GitHub Actions job summary |
| `.terraform-version` | existing | **Keep, unchanged.** ⚠️ **Correction:** an earlier version of this document said to delete it because pt and pcs did not carry one. They both do — pcs pins `1.10.4`, pt pins `1.15.8` — and the earlier `ls` simply missed dotfiles. Ours pins `1.16.1`, which satisfies `state.tf`'s `required_version >= 1.14.0`. It was decorative under GitHub Actions; do not assume the same of Jenkins |
| `.terraform.lock.hcl` | — | **Gitignored rather than deleted.** Neither reference repo tracks one, and `terraform init` regenerates it, so deleting without ignoring just recreates the question on the next init |

### `deed-poll-api`

| Target file | Source | Action |
|---|---|---|
| `Jenkinsfile_CNP` | existing | **Fix.** `product = "rpe"` → `"deed-poll"`, `component = "demo"` → `"api"` |
| `infrastructure/` | — | **Delete the directory.** Per Decision 3 the Postgres server stays in `deed-poll-infra`, so api owns no Terraform — the `pt-frontend` / `pcs-frontend` shape rather than `pcs-api`'s. Nothing in it is used today: `main.tf` is a bare provider block, the tfvars are empty |

### `deed-poll-web`

| Target | Action |
|---|---|
| `infrastructure/` | **Delete the directory** once `redis.tf` has moved. `postgres.tf` goes entirely — web is a no-database service (`@hmcts-cft/express-session-redis`; only the template's `libs/onboarding` touches Prisma) |
| `Jenkinsfile_CNP` | **New** |
| `.github/workflows/` | **Delete the directory entirely** — see ["The cost"](#the-cost-all-of-github-actions-in-all-four-repos). `.github/renovate.json` stays |

### `deed-poll-admin`

| Target | Action |
|---|---|
| `infrastructure/` | Already deleted from the working tree; the deletion needs committing |
| `Jenkinsfile_CNP` | **New** |
| `.github/workflows/` | **Delete the directory entirely** — see ["The cost"](#the-cost-all-of-github-actions-in-all-four-repos). `.github/renovate.json` stays |

**Order matters here.** Admin's `detect-infra-changes` gates on `^infrastructure/`, and the commit that
deletes the directory *matches that pattern* — so on that commit the Terraform stage runs against a
directory that no longer exists and fails. Deleting the Terraform workflows in the same change avoids a
red run.

## The one thing that is not a move: `variables.tf`

**Corrected 2026-09-06 against `hmcts/cnp-jenkins-library` itself**, shallow-cloned and read rather than
inferred. An earlier version of this document said `withInfraPipeline` "passes none of them", deduced from
which variables `pcs-shared-infrastructure` happens to declare. **That was wrong**, and it would have sent
Ralphex to delete variables the pipeline does supply.

What the pipeline actually provides — `spinInfra.groovy` is the shared Terraform step, used by both
`withPipeline` and `withInfraPipeline`:

| Variable | How | Where |
|---|---|---|
| `product` | `-var product=` | `spinInfra.groovy:135` |
| `env` | `-var env=` | `spinInfra.groovy:135` |
| `common_tags` | `-var common_tags=` | `spinInfra.groovy:135` |
| `subscription` | `TF_VAR_subscription` | `spinInfra.groovy:123` |
| `component` | `TF_VAR_component` | `spinInfra.groovy:124` — **but see the warning below** |
| `aks_subscription_id` | `TF_VAR_aks_subscription_id`, when the environment has an AKS subscription | `spinInfra.groovy:129` |
| `jenkins_AAD_objectId` | `TF_VAR_jenkins_AAD_objectId` | `withSubscription.groovy:46` |
| per-environment overrides | `-var-file=${env}.tfvars`, **only if that file exists** | `spinInfra.groovy:136` |

So the rewrite is **smaller than described earlier**:

- **Keep** `product`, `env`, `common_tags`, `subscription`, `aks_subscription_id`
- **Add** `jenkins_AAD_objectId`
- **Drop** `ci_service_principal_object_id`, `builtFrom` and `tenant_id` — the tenant comes from
  `data.azurerm_client_config.current`
- **`location` and `product_group_name` need defaults**, since the pipeline supplies neither. `"UK South"`
  and a product group, following pt and pcs

### `component` is empty in an infra pipeline — do not rely on it

`withInfraPipeline(String product, String component = null, Closure body)`. Both pt and pcs call it as
`withInfraPipeline(product)`, so `component` is **null** and `TF_VAR_component` is empty. That is exactly
why neither of their `variables.tf` declares it.

`postgres.tf` currently passes `component = var.component` to the Postgres module. **Hardcode a literal
there instead** — an empty component would silently land in the server's tags and naming. Do not "fix" it
by giving the variable a default: an empty `TF_VAR_component` from the pipeline overrides a default, so the
default would not protect anything.

### Also verified, and it retires an open worry

The backend state key is `${productName}/${environmentDeploymentTarget}/terraform.tfstate`
(`spinInfra.groovy:115`) and the whole `terraform init -reconfigure` is built by the pipeline. So the
GitHub Actions state-key limitation recorded elsewhere in `.business_context/` is not merely inapplicable —
under Jenkins the backend is not this repo's concern at all, which is why `provider.tf` carries a bare
`backend "azurerm" {}` and nothing else.

Also inherited from the old file and needing attention: the `component` variable's comment opens "This
repo is `deed-poll-admin`", and `product_group_name` is hardcoded to `"DTS CFT Developers"` with a note to
narrow it once a "DTS Deed Poll" AAD group exists. pt uses `"DTS Property Tribunal"` and pcs `"DTS
Possession Claim Service"`, both as variable defaults rather than inline.

## Do not copy these from pcs

- **Feature-branch module refs.** `pcs-shared-infrastructure` pins `cnp-module-key-vault` to
  `?ref=DTSPO-31965/remove-jenkins-ptl-access` and pcs-api pins the Postgres module to
  `?ref=DTSPO-30107-additional-postgres-admins`. Use `master`.
- **`git@github.com:` sources.** See Decision 1 — keep `git::https://`.

## Execution plan

### Pre-flight — done 2026-09-06

1. ✅ **Terraform installed**, 1.16.1, at `~/.local/bin/terraform` (already on `PATH`). No elevation
   needed: `x86_64`, and `releases.hashicorp.com` is reachable. **It will not survive a devcontainer
   rebuild** — add it to `.devcontainer/` as a feature so the next rebuild does not silently lose it.
2. ✅ **Module fetching works.** Measured on the pre-rewrite tree:
   - `terraform fmt -check -recursive` — clean
   - `terraform init -backend=false` — installs azurerm 4.81.0, azuread 3.9.0, random 3.9.0, **and
     fetches all three `git::https://` modules**
   - `terraform validate` — *Success! The configuration is valid.*

   So both validation commands are available and **currently green**, which is the precondition a Ralphex
   plan needs. Note what `validate` does *not* do: it type-checks the configuration, so it will pass
   whether or not the pipeline actually supplies the variables the config declares. It is not a substitute
   for a plan against real credentials.
3. ✅ **First commit made** — `0a61b9c` on `main`, the eight files byte-for-byte as they were in
   `deed-poll-admin@45d8524`, plus a `.gitignore`. Deliberately unreshaped so the next commit's diff shows
   exactly what the Jenkins rewrite changed.

   `.gitignore` covers `.terraform/` — **360M once modules and providers are fetched.** Neither
   `pt-shared-infrastructure` nor `pcs-shared-infrastructure` ignores it; that is a gap in their
   `.gitignore`, not a convention worth copying.

Optional estate niceties both reference repos carry and this one does not: `.editorconfig`,
`.pre-commit-config.yaml`, `.github/stale.yml`, and a `LICENSE` in pcs. Note their `.github/` holds
**only** `stale.yml` — no workflows, consistent with Jenkins-only.

### Ordering

`deed-poll-infra` first — everything else reads the vault it creates. That ordering is also real at apply
time: a component cannot deploy until this root has applied once, and **nothing enforces it
mechanically.**

| Order | Repo | How |
|---|---|---|
| 1 | `deed-poll-infra` | **Ralphex.** Enough work to be worth a plan, and no in-flight work to collide with |
| 2 | `deed-poll-admin` | **Ralphex.** The session-store move is real application work with tests |
| 3 | `deed-poll-web` | **By hand.** See below |
| 4 | `deed-poll-api` | **By hand.** See below |

**Do not run Ralphex on web or api for this.** Both have work in flight — api has task 12 of 17
half-finished with uncommitted files, and web has 15 unpushed commits on `walking-skeleton` with plan 01's
review phases never run. A second concurrent branch in either would collide. Their infra tasks are also
small enough that a plan is overkill: web is "delete a directory, edit one `values.yaml`, add a
Jenkinsfile", api is "fix two lines and delete a directory".

### `deed-poll-infra`

1. `provider.tf` — new. Move the two provider blocks out of `main.tf` and `required_providers` + `backend "azurerm" {}` out of `state.tf`; delete `state.tf`
2. `main.tf` — trim to the single shared resource group; rename the resource `shared` → `rg` to match pt/pcs
3. `variables.tf` — add `jenkins_AAD_objectId`; drop only `ci_service_principal_object_id`, `tenant_id` and `builtFrom`; **keep** `product`, `env`, `common_tags`, `subscription` and `aks_subscription_id`, all of which the pipeline supplies; give `location` and `product_group_name` defaults. See the corrected table above — an earlier version of this plan had this task deleting variables the pipeline does provide
4. `key-vault.tf` — rename from `keyvault.tf`; `object_id = var.jenkins_AAD_objectId`; add the `jenkins-${env}-mi` data source for `jenkins_object_id`; `grant_preview_jenkins_access = var.env == "aat"`; tenant from `data.azurerm_client_config.current`; split `session_secret` into `admin-session-secret` and `web-session-secret`
5. `app-insights.tf` — rename from `appinsights.tf`; repoint `resource_group_name` at the shared RG; rename the secret to `app-insights-connection-string`
6. `postgres.tf` — database `deed-poll-admin` → `deed-poll`; fix the name hardcoded in `postgres-url`; `admin_user_object_id = var.jenkins_AAD_objectId`; drop `var.component`
7. `redis.tf` — bring in from `deed-poll-web/infrastructure/redis.tf`; drop `${var.component}` from the instance name
8. Delete `output.tf`. **Keep `.terraform-version`** — see the correction in the file table above
9. `Jenkinsfile_CNP` and `README.md`. `.gitignore` already landed in `0a61b9c`, and **`renovate.json`
   comes from merging `deed-poll-infra#1`** rather than being authored — Renovate onboarded the repo by
   itself, and its proposed file is byte-identical to `pt-shared-infrastructure`'s and this workspace's
   own. It extends the org shared config `local>hmcts/.github:renovate-config`, which is *not* what caused
   admin's automerge problem — that came from the expressjs template's hand-written
   `.github/renovate.json`

Validation, both verified green on the pre-rewrite tree at pre-flight:

```
terraform fmt -check -recursive
terraform init -backend=false && terraform validate
```

### `deed-poll-admin`

1. Pass `storeOptions: { schemaName: "session" }` to `expressSessionPostgres` in `apps/web/src/app.ts`; update tests
2. Add a Prisma migration creating the schema — `CREATE SCHEMA IF NOT EXISTS session`. Without it the store's `CREATE TABLE IF NOT EXISTS session.session` fails at startup
3. All four `values.yaml`: `ExpressJsAppInsightsConnectionString` → `app-insights-connection-string`, `session-secret` → `admin-session-secret`, `idam-client-secret` → `admin-idam-client-secret`
4. **One commit:** delete `infrastructure/` *and* `.github/workflows/` together — see the note under admin's file table for why splitting them turns CI red
5. `Jenkinsfile_CNP` — new

Validation: `yarn lint`, `yarn build`, `yarn test`, `yarn test:e2e`. All three of the first must run — see
`PROGRESS.md` on why `test` alone is not enough.

### `deed-poll-web`

1. Delete `infrastructure/` (after `redis.tf` has landed in `deed-poll-infra`)
2. `apps/web/helm/values.yaml`: rename the App Insights secret, drop `postgres-url`, add `web-session-secret`
3. Drop the vestigial `@hmcts/postgres-prisma` dependency from `apps/web` — already flagged in that repo's own `PROGRESS.md` as contradicting the no-database decision
4. Delete `.github/workflows/`; add `Jenkinsfile_CNP`

### `deed-poll-api`

1. `Jenkinsfile_CNP` — `product = "rpe"` → `"deed-poll"`, `component = "demo"` → `"api"`
2. Delete `infrastructure/`
3. Delete `.github/workflows/` — `ci.yml`, `codeql.yml` and `publish-openapi.yaml`. The OpenAPI publish has a Jenkins equivalent; CodeQL does not, and that is accepted
4. Helm values: `app-insights-connection-string` and `postgres-url`

### External, all parallel and none of it code

- **cnp-jenkins-config onboarding — four entries.** The new critical-path dependency
- **S2S microservice registration**, once the path is identified — Decision 5
- **IDAM** — already waiting; unchanged by any of this
- **`cnp-flux-config`** — the `deed-poll` namespace and a HelmRelease per component. This is what the open "which repo declares the namespace" question in `PROGRESS.md` becomes
- **A "DTS Deed Poll" AAD group**, to narrow `product_group_name` off the CFT-wide `"DTS CFT Developers"`

## Turning this into Ralphex plans

**This cannot be one Ralphex run.** Ralphex works within a single repo on a branch it creates, and this
change spans four — hence the per-repo split above, and hand-editing web and api.

Plan format, from `deed-poll-web/docs/plans/01-walking-skeleton.md` rather than from the Ralphex docs:
`### Task N:` headings, one global `## Validation Commands` section, `- [ ] Mark completed` per task. **The
validation commands must pass on a clean tree before the run starts** — which is what pre-flight 1 and 2
are about.
