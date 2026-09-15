# Migration progress — handover

Last updated: 2026-09-10. Plan: [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md). Backend:
[`DEED_POLL_API_PLAN.md`](DEED_POLL_API_PLAN.md). **Infrastructure and pipeline:
[`DEED_POLL_INFRA_PLAN.md`](DEED_POLL_INFRA_PLAN.md).**

**Track A's application code is complete.** Phases 0–4 are done and Phase 5's login flow is built and
working. **Phase 6 has been redefined** — an earlier version of this file said nothing in it was code any
more, and as of 2026-09-06 that is no longer true. See below.

**Read newest-first, and read the two 2026-09-10 and 2026-09-09 sections before anything below them.** This
repo is now one deployable with no data access layer, so every passage further down that describes four apps,
an umbrella chart, or Postgres through Prisma — including all of "Phase 3 — the JSON API" and most of "Loose
ends" — is history. It is kept because the reasoning is still worth having, not because it is current.

## Pick up here (end of 2026-09-10 session)

### Four deployables collapsed to one

[`docs/plans/03-collapse-to-single-app.md`](../docs/plans/03-collapse-to-single-app.md) landed, six tasks on
`collapse-to-single-app`. It is authoritative over everything below it, including the 2026-09-09 section.

1. **The application is the root package.** `apps/web` was flattened to `src/` at the repository root, with
   one `Dockerfile`, one chart, one `Jenkinsfile_CNP` component. `apps/` is gone. `libs/` is still a Yarn
   workspace of seven packages, deliberately: four are template-provided and keeping them as packages is what
   makes a future re-scaffold tractable. `libs/express-session-postgres` stays on disk and stays a dependency
   for the same reason, and nothing imports it.
2. **Two mechanical consequences that cost time to rediscover.** Turbo will not run a root-package script
   unless the task is named `//#<task>`, and a root `//#build` would make `yarn build` invoke itself — hence
   `//#build:app`, `//#test:app`, `//#dev:app` and the orchestrating `turbo <x> <x>:app` scripts. And the
   app's tsconfig is `tsconfig.app.json`, because the root `tsconfig.json` is the only project covering the
   libraries' `*.test.ts` files: giving it an `include` made library tests resolve `@hmcts/*` to `dist` while
   their sources resolved to `src`, so `vi.mock` silently stopped applying. 44 failures, no error message.
3. **`apps/crons` is deleted**, not deferred. It was a component holding one `console.log` — no job was ever
   written, and a second Jenkins component that deploys nothing is a second thing to onboard.
   `libs/onboarding` went with plan 02.
4. **One chart at `charts/deed-poll-admin/`**, a single `nodejs` chart plus a `redis` subchart enabled in
   preview only. The umbrella chart and its `deed-poll-admin-{web,api,crons,postgres}` subcharts are gone,
   for a mechanical reason rather than a stylistic one: `az acr build … .` builds one image and `helmInstall`
   exposes exactly that one as `${IMAGE_NAME}`, where an umbrella needs one `${*_IMAGE}` per subchart and
   nothing sets those. `${WEB_IMAGE}` and friends do not exist.
5. **`${SERVICE_FQDN}` is the ingress host in AAT and preview, and `${TEAM_NAME}`/`${ENVIRONMENT}` must
   appear nowhere.** `helmInstall` exports exactly `NAMESPACE`, `SERVICE_NAME`, `IMAGE_NAME`, `SERVICE_FQDN`
   and `INGRESS_IP`. The hand-rolled host this replaced expanded `ENVIRONMENT` to the empty string and left a
   doubled dot, and `TEAM_NAME` is `TeamConfig.getName(product)` — a team *display* name, returning the
   constant `pleaseTagMe` for a product `team-config.yml` does not list. `deed-poll` is not listed.
6. **Preview gets an ephemeral `redis` subchart per pull request. This is decided, not pending.** It was the
   last of the four in-repo blockers. `hmcts/deed-poll-infra` applies on the `aat`, `demo`, `ithc`,
   `perftest` and `prod` branches and never in `preview`, so there is no `redis-url` to read, and
   `assertRedisUrl` refuses the loopback default outside development. **Pointing preview at AAT's
   `redis-url` was the alternative and was rejected**: every open PR would share one keyspace, so a
   collision or a flush in one is felt in the rest, and preview sessions would outlive the PR inside a store
   nothing here can clear. `deed-poll-web` settled it the same way, and HDPI-8155's 10s probe budget is
   copied with it — under Dynatrace instrumentation the chart-default 2s exec-probe budget leaves redis
   permanently Running-but-not-Ready. The symptom here is not `deed-poll-web`'s crashloop but `redis: DOWN`
   on readiness for ever, which keeps the pod out of its own Service.
   The vault list is re-declared in the preview template *minus* `redis-url`, because
   `getPropertiesVolumeSecrets` writes every mounted secret to `process.env` unconditionally on the
   mount-point path — a mounted `redis-url` would overwrite the subchart URL and point a PR at AAT's cache.
7. **`yarn test:smoke` and `yarn test:functional` now exist**, and the pipeline invokes six `yarn` scripts,
   failing the stage on any missing one. `test:functional` was the more urgent: `functionalTestEnvironments`
   includes `preview`, so it runs on every pull request. `src/pipeline.test.ts` and
   `src/deployment-chart.test.ts` pin the pipeline- and chart-shaped rules that otherwise fail only on a real
   Jenkins run.

**Test arithmetic, 2026-09-10.** 1,256 → **1,273** unit tests across 8 packages, and 17 → **18** e2e as
`yarn test:e2e` counts them. The path: −10 for `apps/crons`, +17 in task 4
(`src/deployment-chart.test.ts`), +10 in task 5 (`src/pipeline.test.ts`), +1 e2e for the `@smoke` spec. No
test was lost to the flattening itself. Note the generated dashboard below says **17** e2e, and both are
right: it counts `test(` in `*.spec.ts` statically, where Playwright also runs the `auth.setup.ts`
project. The
per-package split is 354 app, 443 `deed-poll`, 140 cloud-native-platform, 138 api-client, 127 govuk-starter,
41 simple-router, 23 express-session-postgres, 7 express-session-redis.

**What is left before a green deploy is entirely external**, and `docs/PIPELINES.md` enumerates each against
the library source. The one that bites first: `TeamConfig.setTeamConfigEnv` calls three getters that
`steps.error` outright when the product is missing from `cnp-jenkins-config/team-config.yml`, so **the
pipeline hard-fails before it builds anything** and no chart value is reached at all. Then the IDAM client
registration — `idam-access-config#993` states the right hosts and the right secret name as of 2026-09-10,
after three corrections were pushed to its branch (the AAT host, one templated `<<ENV>>` entry in `base`
replacing three redundant env folders, and `admin-idam-client-secret` for the vault key), **but it is still
open and unmerged**, so nothing is registered and sign-in fails on a deploy that otherwise worked. Preview
sign-in is an open question for IDAM, not something a values file can settle. And `deed-poll-api` is not deployed, which keeps the post-deploy smoke gate red on purpose, since
`test:smoke` asserts readiness and readiness names api.

**One stray was deliberately kept**: `power_app_nest/` is still on disk, gitignored, and plan 03 task 6's
checkbox to delete it was not followed. It is the 501M Nest prototype these domain functions were ported
from, it has no git repository of its own so nothing could restore it, `libs/deed-poll/src/index.ts` and
several documents here cite it, and `scripts/progress-dashboard.mjs` reads it to count the prototype's scope.
Deleting it would permanently degrade that figure to buy back disk. `lcov.info` (a `yarn test:coverage`
artefact, now gitignored) and an empty `data/` were deleted.

## Previous session (end of 2026-09-09 session)

### The data access layer is gone

[`docs/plans/completed/02-dal-cutover-to-api.md`](../docs/plans/completed/02-dal-cutover-to-api.md) landed, eight tasks on
`dal-cutover-to-api`. It is authoritative for this repo over everything below it. **This repo is now a
presentation layer with no data access layer at all.**

1. **Every read and write of case data goes to `deed-poll-api` over HTTP.** One adapter,
   `libs/deed-poll-api-client`, generated from api's published document (api commit `847933a`, recorded in
   `SPEC-PROVENANCE.md`). It returns `ApiResult<T>` and never throws; `libs/deed-poll/src/api/deed-poll-api.ts`
   is the only place that knows where api is, and it turns a classified failure into the domain errors
   `apps/web/src/errors.ts` already rendered. 13 caseworker operations, 14 adapter functions — the extra is
   the readiness probe's.
2. **Deleted: `apps/api` (261 route tests), `apps/postgres`, `libs/postgres-prisma`, the migrations, the pg
   pool, `reference-number.ts`, `file-storage.ts`, `computed.ts`, `health.ts` — and `libs/onboarding` with
   its eight pages**, which plan 03 asked for and plan 02 had to do first because its `queries.ts` was the
   last thing holding Prisma in the tree. **Plan 03's task 1 is therefore already done.**
3. **api owns reference numbers, the audit author and the admin flag.** Every service function takes a
   `Caller` — `{ accessToken }` and nothing else — because api derives the last two from the token, and a
   second allocator against the same counter is a correctness bug rather than duplication.
4. **Sessions stayed in Redis, locally, deliberately.** The reasoning is at the call site in
   `apps/web/src/app.ts` and must not be re-litigated as a consistency argument: a session is transport
   state, and serving it from api would invert authorisation.
5. **The readiness check names Redis and api, and no database.** `deedPollApiStatus()` replaced
   `deedPollDatabaseChecks()` with a fixed 2s timeout — deliberately not `DEED_POLL_API_TIMEOUT_MS`, because
   `runChecks` is a bare `Promise.all` and a probe that waited the application's patience out would report
   nothing at all and take the Redis result with it.
6. **The conformance harness split**: the structural layer is api's (`9db5fe3`), the four rule layers stayed
   here. `libs/deed-poll/src/conformance/README.md` is the record, and the A–R truncation caveat travelled
   with the half that moved.
7. **Charts and config, task 8.** `postgres-url`/`DATABASE_URL` is out of all four `values.yaml`;
   `DEED_POLL_API_URL` is in, resolving per environment to
   `deed-poll-api-{env}.service.core-compute-{env}.internal`, with preview pointed at AAT's api because api's
   preview deploys are per-PR hosts with no stable name — **so preview writes land in AAT's data.** The
   umbrella `Chart.yaml` lost three dependencies (`deed-poll-admin-postgres`, `deed-poll-admin-api`,
   `postgresql`): two pointed at deleted directories, and a `file://` dependency on a missing chart fails
   `helm dependency build`.

**There is no S2S credential to add, and adding one would be wrong.** api authenticates a *forwarded IDAM
access token* and nothing else — an OAuth2 resource server with no `ServiceAuthorization` filter, and
`bearerAuth` as the only security scheme in its spec. The caseworker's own token, from the session, is the
whole credential. If api ever gains S2S, the answer is a token provider minting one per call plus a
microservice name registered for *this app*, not a static secret in the vault.
`deed-poll-web/docs/external-dependencies.md` tracks the same requirement for the other frontend.

**Test arithmetic across the whole plan, so deliberate deletions are not read as regressions:** 1,608 unit
tests → **1,188**, and 21 e2e → **16**. The drops are `apps/api` (211 declarations), `apps/postgres` (15),
`libs/onboarding` (72), the onboarding pages (32), `health.test.ts` (14) and the conformance harness's
structural layer (78), less 7 added for `deedPollApiStatus` and 5 for note deletion.

The code review that followed took it to **1,229**, all additions and each one closing a gap the deletions
opened: the download route had no test at all (10), the multipart parser lost its twin's coverage when
`apps/api` went (13), the zoneless date-time conversion the deployed app depends on was exercised by nothing
(8), the note forms gained the api-rejection path they were missing (4), and the adapter gained the two
download-timeout rules and the forwarded security headers (6). e2e stays at **16**.

**What is outstanding, and none of it is code in this repo:** api is not deployed, so a deployed pod reports
readiness DOWN until api's own pipeline cutover lands — [`docs/PIPELINES.md`](../docs/PIPELINES.md) now lists
six blockers rather than four, and [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md#deed-poll-api) records what a
deploy needs from api. `yarn test:e2e` passes by hand against the mock and still runs in no pipeline.

## Pick up here (end of 2026-09-07 session)

### What changed on 2026-09-07 — `deed-poll-admin` only

[`docs/plans/completed/01-jenkins-and-session-schema.md`](../docs/plans/completed/01-jenkins-and-session-schema.md) landed, five
commits on `jenkins-and-session-schema`. It is authoritative for this repo over everything the 2026-09-06
notes below say about admin's pipeline and sessions.

1. **Sessions are in Redis, not a Postgres `session` schema.** This *reverses* item 3 of the 2026-09-06 list
   below. `PostgresStore` takes a `schemaName` it cannot create, and Redis was already provisioned for
   `deed-poll-web`, so admin using it added no infrastructure. No migration, no session table, no `session`
   schema — and `public` now has exactly one prospective owner, api's Flyway.
2. **The Jenkins migration is done for this repo.** `Jenkinsfile_CNP` added, `.github/workflows/` and
   `infrastructure/` both deleted in one commit each. `deed-poll-web` and `deed-poll-api` are still to do.
3. **The vault secret renames are done for this repo**, in all four charts, plus a new `redis-url`/`REDIS_URL`
   entry on `apps/web`.
4. **Four things still block a green deploy, and two are design decisions rather than renames.** Enumerated
   against the library source in [`docs/PIPELINES.md`](../docs/PIPELINES.md): the chart is at `helm/` where
   `helmInstall` reads `charts/`; the pipeline builds one image where the umbrella chart wants four; there is
   no `yarn test:smoke`; and preview has no Redis. **None of these is tracked in the tables below** — read
   `PIPELINES.md` for them. *(Updated 2026-09-09: the umbrella chart wants **two** images, not four, and the
   list is six items — platform onboarding and api not being deployed joined it. `PIPELINES.md` is current.)*
5. **The Playwright suite now runs in no pipeline.** `job.e2e-test.yml` went with `.github/workflows/` and
   `Jenkinsfile_CNP`'s body is empty. It is also the only thing that exercises a real `RedisStore` round trip,
   so wiring it into a stage is outstanding work rather than a nicety.

## What the 2026-09-06 session recorded



**Read [`DEED_POLL_INFRA_PLAN.md`](DEED_POLL_INFRA_PLAN.md) first.** Five decisions were taken on
2026-09-06 that supersede much of Phase 6 as this file describes it, and rewriting every affected passage
below would lose the reasoning that produced them. **Where this file and that one disagree, that one is
current.**

### What changed on 2026-09-06

1. **All four repos move to the Jenkins CNP pipeline.** `.github/workflows/` is deleted entirely from
   `deed-poll-admin`, `deed-poll-web` and `deed-poll-api` — not just the deploy-side workflows. The
   reasoning is divergence from the estate and cognitive load.
2. **`hmcts/deed-poll-infra` holds the shared infrastructure**, replacing this repo's `infrastructure/`
   directory. That directory is already deleted from the working tree here.
3. **The shared Postgres server lives in `deed-poll-infra`**, and ~~this repo's session table moves into its
   own `session` schema so that api's Flyway can own `public` without meeting a table it did not create.~~
   **Reversed on 2026-09-07 — sessions moved to Redis instead. See above.**
4. **Vault secrets are prefixed per component** where sharing them would be unsafe —
   `admin-session-secret`, `admin-idam-client-secret`, and `app-insights-connection-string` replacing
   `ExpressJsAppInsightsConnectionString`.
5. **S2S stays out of the first Terraform apply**, because the `data` lookup fails until the microservice
   is registered.

### The Azure-credential blocker is gone

**This is the most important consequence and it invalidates a lot of what follows.** The four missing
secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CREDENTIALS_CFT_PREVIEW`,
`AZURE_CREDENTIALS_CFT_AAT`) were **GitHub Actions-specific**. Jenkins authenticates as its own managed
identity, so none of them is needed.

- **[`azure-github-federation-config#99`](https://github.com/hmcts/azure-github-federation-config/pull/99)
  was closed on 2026-09-06**, with a comment explaining why. The branch was left in place so it can be
  reopened if the pipeline decision is ever revisited.
- The `job.terraform.yml:95` `_PREVIEW`/`_AAT` trap recorded further down this file **is moot** — that
  workflow is being deleted.
- **Every passage below that treats these secrets as a gate is stale.** They are struck through where
  practical and superseded wholesale where not.

**The new critical-path external dependency is `cnp-jenkins-config` onboarding — four entries.** That
trades an unreviewed queue for a well-trodden path.

### Where to pick up

Ordering, per [`DEED_POLL_INFRA_PLAN.md`](DEED_POLL_INFRA_PLAN.md)'s execution plan:

1. **Install Terraform in the devcontainer.** It is not installed, so a Ralphex run on a Terraform-only
   repo would start with validation commands that cannot execute.
2. **First commit in `deed-poll-infra`.** The repo has none, and Ralphex needs at least one before it will
   start.
3. **`deed-poll-infra`, then this repo** — both worth a Ralphex plan. **`deed-poll-web` and
   `deed-poll-api` by hand**, because both have work in flight that a second concurrent branch would
   collide with.
4. **Raise the four `cnp-jenkins-config` entries** in parallel with all of it.

Items 4 (Welsh) and 6 (api's default branch) from the 2026-09-05 list below are unaffected and still
stand. Items 1, 3, 5 and 7 are superseded.

## Pick up here (end of 2026-09-05 session) — largely superseded, see above

**The work has moved to a new repo.** `hmcts/deed-poll-api` now exists and holds a Spring Boot service
that will replace `apps/api`. **Its resume state is [`deed-poll-api/docs/RESUME.md`](../../deed-poll-api/docs/RESUME.md)
— read that before restarting Ralphex**, and [`DEED_POLL_API_PLAN.md`](DEED_POLL_API_PLAN.md) for why any
of it is shaped as it is.

**Four repos** as of 2026-09-06, and the naming matters because it was conflated once already:

| Repo | What | State |
|---|---|---|
| `deed-poll-admin` | **internal staff app** — `apps/web`, the caseworker UI | this repo; Phases 0–6 done |
| `deed-poll-api` | **the backend**, Spring Boot | tasks 0–11 of 17 built by Ralphex |
| `deed-poll-web` | **citizen service**, public and anonymous in release 1 | a separate Ralphex run was in progress |
| `deed-poll-infra` | **shared Terraform** — resource group, Key Vault, App Insights, Redis, Postgres | created 2026-09-06; no commits yet. See [`DEED_POLL_INFRA_PLAN.md`](DEED_POLL_INFRA_PLAN.md) |

Note the name is `deed-poll-infra`, **not** the HMCTS-conventional `-shared-infrastructure`.

### What happened on 2026-09-05

- **Ralphex built tasks 0–11 of the API foundation** — 112 Java files, 511 tests, 3 Flyway migrations,
  the whole domain ported from `libs/deed-poll` with the conformance harness. On branch
  `deed-poll-api-01-foundation`, pushed. **Task 12 is half-finished and its work is uncommitted**, on
  purpose.
- **PRs #67 and #68 merged**, so the plans, the Ralphex build plan and the pruned handover are all on
  master. Five stale local branches deleted, recorded in
  [`DELETED_BRANCHES.md`](DELETED_BRANCHES.md).
- **Nothing changed in *this* repo's deployability.** The four Azure secrets are still missing and the
  list below is unchanged.

### Where this repo picks up

**Nothing here is blocked on `deed-poll-api`, and vice versa.** The items below can all proceed in
parallel with the Ralphex work, and items 1–2 gate everything downstream.

## Pick up here — this repo (unchanged from 2026-09-04)

**Read [`WAYS_OF_WORKING.md`](WAYS_OF_WORKING.md) first.** It is the shortest useful thing in this
directory, and both of the decisions it carried are now settled — see them for what was decided and
why, because one of them explains why this file is shorter than it was.

**There is no migration branch any more.** `feat/deed-poll-migration` was merged as
[PR #47](https://github.com/hmcts/deed-poll-admin/pull/47) on 2026-09-04 at 06:14 (`953e1ac`), so
everything below describes master. `lint`, `build`, `test`, `test:e2e` (21) and
`yarn install --immutable` all pass — the last being the check that catches a lockfile disagreeing with
its manifests. Counts are in the generated dashboard below.

**CI is green on everything that does not touch Azure**: lint, test, `osv-scan`, SonarCloud and
`Terraform Format`. What remains red is only the Azure credentials, and the table below is more precise
about those than any earlier version of it — **four secrets are needed, not one, and none exists.**

### Tomorrow, in order

**Items 1, 3, 5 and 7 below are superseded by the 2026-09-06 decisions.** They are left in place because
each records a measurement or a trap that is still worth knowing, but do not work from them. Items 2, 4,
6 and 8 still stand.

1. ~~**Raise one consolidated credentials request, rather than chasing #99 alone.**~~ **Superseded
   2026-09-06 — no GitHub Actions credentials are needed at all.** #99 is closed. What follows is the
   measurement of what *would* have been needed, kept because it is the clearest record of how much the
   GitHub Actions path was actually asking for.
   [`azure-github-federation-config#99`](https://github.com/hmcts/azure-github-federation-config/pull/99)
   has not moved since 2026-09-03 18:27 — still `OPEN`, `MERGEABLE`, `REVIEW_REQUIRED`, with four other
   Renovate PRs unreviewed ahead of it. **It also covers only about a quarter of what is needed**: it
   creates the app registration, but the resulting client and tenant IDs still have to be set as
   repository secrets afterwards, and it does not touch either `AZURE_CREDENTIALS_CFT_*` secret. The
   table below is the full list to ask for in one go.
2. **Ask which repo declares the `deed-poll` Kubernetes namespace.** The one outstanding Phase 6 item
   that is a *question* rather than a piece of work, and a one-line answer for anyone who has done it.
   `cnp-flux-config` is still not cloned here, which is why it is unconfirmed.
3. ~~**Decide whether `job.terraform.yml:95` hardcoding `AZURE_CREDENTIALS_CFT_PREVIEW` is a bug.**~~
   **Moot 2026-09-06 — that workflow is being deleted.** The analysis below stands as a description of the
   action's behaviour, and may be worth reporting upstream to `cnp-githubactions-library` for the repos
   still using it. It
   passes the *preview* credential regardless of environment, while `stage.infrastructure.yml` only ever
   targets `environment: aat`. `job.helm-deploy.yml` switches `_PREVIEW`/`_AAT` by environment; Terraform
   does not. **The practical consequence is a trap: provisioning only `_AAT` leaves Terraform Apply
   still failing.**
4. **Send [`welsh-draft.csv`](welsh-draft.csv) and
   [`welsh-translation-request.csv`](welsh-translation-request.csv) for review** — 50 UI strings and 68
   prose strings, each with an unreviewed machine draft and a confidence. Read the ones marked `LOW`
   first; two of those are legal terms and one is a word collision, not a translation nicety.

### New on 2026-09-05, for the two new repos

5. ~~**Create `hmcts/deed-poll-shared-infrastructure`**~~ **Done 2026-09-06, as `hmcts/deed-poll-infra`.**
   The files are copied across and this repo's `infrastructure/` is deleted from the working tree; the
   repo has no commits yet. Scope grew beyond the resource group and Key Vault — App Insights, Redis and
   Postgres are shared too, per `DEED_POLL_INFRA_PLAN.md` Decision 2. Original wording: move the resource
   group and Key Vault out of
   this repo's `infrastructure/`. **There is no template** — copy `pt-shared-infrastructure`, which is
   cloned at `../apps/pt/pt-shared-infrastructure`. **Do this before the first successful
   `Terraform Apply`**: nothing has ever been applied, so there is no state to migrate, and that window
   closes the moment the credentials land. See [Moving the shared
   infrastructure](DEED_POLL_API_PLAN.md#moving-the-shared-infrastructure).
6. ~~**Settle `deed-poll-api`'s default branch.**~~ **Settled 2026-09-06: all four repos use `master`.**
   Steve's call. `deed-poll-api` and the newly created `deed-poll-infra` were both on `main`; both were
   renamed via the GitHub rename API, which moves the default-branch pointer and retargets open PRs.
   Deliberately done **before** Jenkins onboarding, since HMCTS Jenkins conventions assume `master` in
   places, and while `deed-poll-infra` still had one commit and no pipeline. `deed-poll-api`'s
   uncommitted task-12 work was verified untouched afterwards — the rename never checked anything out.
7. **Jenkins onboarding — now all *four* repos**, not two. `cnp-jenkins-config` entries. The note below
   turned out to be the decisive observation of the whole exercise: Jenkins has its own credentials path,
   so none of these joins the queue #99 was stuck in. On 2026-09-06 that reasoning was extended to admin
   and web as well, and #99 was closed.
8. **Consider fixing `SecurityConfigurationTest` by hand.** Ralphex spent its last half-hour on a Spring
   context ambiguity. That is often five minutes for a human and a long loop for an agent — fix it, commit
   it, and let Ralphex resume at task 13.

### What is actually left in Phase 6

**Rewritten 2026-09-06.** The previous version said nothing in it was code and nothing in it was mine to
do. The pipeline decision changed both halves of that: there is real code work again, and most of it is
ours.

| Item | State |
|---|---|
| Shared resource group, Key Vault, workload identity | ✅ Written and working, but **moving** to `hmcts/deed-poll-infra` — originally [PR #64](https://github.com/hmcts/deed-poll-admin/pull/64) in this repo's `infrastructure/`. See [`DEED_POLL_INFRA_PLAN.md`](DEED_POLL_INFRA_PLAN.md) |
| Migrate all four repos to the Jenkins CNP pipeline | ✅ **for `deed-poll-admin`** (2026-09-07): `.github/workflows/` deleted, `Jenkinsfile_CNP` added. Still to do for `deed-poll-web` and `deed-poll-api`, each of which has its own plan |
| ~~Move the session table to its own `session` schema~~ | ❌ **Reversed, not done.** Sessions moved to Redis on 2026-09-07 — no table, no schema, no migration. `public` is api's alone |
| Rename the per-component vault secrets | ✅ **for `deed-poll-admin`** (2026-09-07), in all four charts, plus a new `redis-url` entry on `apps/web`. Still to do for web and api |
| Six blockers on a green admin deploy | ✅ **The four in-repo ones are resolved** (2026-09-10, plan 03): chart at `charts/`, one image and one component, `yarn test:smoke` and `yarn test:functional` present, preview gets an ephemeral `redis` subchart. Both design decisions were taken. What remains is external — `cnp-jenkins-config` onboarding and `deed-poll-api` not being deployed. Detail in [`../docs/PIPELINES.md`](../docs/PIPELINES.md) |
| Wire the Playwright suite into a pipeline stage | **New.** `job.e2e-test.yml` went with `.github/workflows/` and nothing replaced it. It is also the only test anywhere that exercises a real `RedisStore` round trip |
| `cnp-jenkins-config` onboarding, four entries | **New, and now the critical path.** External |
| `session-secret` in the vault | ✅ Still generated rather than manual — `random_password` in the shared repo's `key-vault.tf`, on the first successful apply. Renamed per component |
| `deed-poll` Kubernetes namespace | Platform-level, **still unconfirmed**, but no longer a bare question: under Jenkins it is a `cnp-flux-config` change per component |
| ~~`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`~~ | ✅ **No longer needed.** GitHub Actions-specific; Jenkins authenticates as its own managed identity. PR #99 closed 2026-09-06 |
| ~~`AZURE_CREDENTIALS_CFT_PREVIEW`~~, ~~`AZURE_CREDENTIALS_CFT_AAT`~~ | ✅ **No longer needed**, same reason. The `_PREVIEW`/`_AAT` trap goes with them |
| `admin-idam-client-secret` in the vault | ✅ **Not blocked on IDAM — this was recorded backwards.** Corrected 2026-09-14: **we** generate it and IDAM consumes it, so it appears on the first apply of `deed-poll-infra` like the session secrets. `idam-access-config` reads it out of our vault by name and fails when it is empty. The rename to `admin-idam-client-secret` has landed on both sides. See `deed-poll-infra/README.md` |
| S2S microservice registration | **New.** Deliberately out of the first apply; the registration path is not yet identified |
| Path to live | Production only, and much may not apply — internal caseworker service on `platform.hmcts.net`, not public |

**Phase 5: the wait is no longer purely on IDAM.** Their `idam-access-config#993` is raised and still
unmerged, but as of 2026-09-14 it was failing on *our* missing vault — so the next move is ours: apply
`deed-poll-infra`. Nothing here can be verified against real IDAM until #993 is merged and deployed.

Verified 2026-09-04 against the live repository, not inferred: `actions/secrets` and `actions/variables`
are both empty, `actions/organization-secrets` lists 28 and **none of them is an Azure credential**, and
`actions/organization-variables` lists one (`APIHUB_ORGANISATION`).

### What happened on 2026-09-04

A short session, three merges, and one architectural decision that is worth not relitigating.

1. **PR #47 was merged as-is** — 292 files, Steve's call, on the grounds that keeping the branch
   diverged was costing more than the review it would have bought. That settles the first of
   `WAYS_OF_WORKING.md`'s two open questions; the reasoning is recorded there.
2. **Renovate was stopped from automerging majors** ([PR #63](https://github.com/hmcts/deed-poll-admin/pull/63)).
   `automerge: true` sat at the top level with no update-type bound, and master is unprotected, so the
   moment the ACR jobs went green **ten PRs including two unreviewed majors would have merged
   themselves.** The same change fixed a Dockerfile regex that had never matched anything — see
   ["Renovate's config was wrong in three ways"](#renovates-config-was-wrong-in-three-ways).
3. **The shared resource group and Key Vault were created** ([PR #64](https://github.com/hmcts/deed-poll-admin/pull/64)),
   closing the item that had the longest lead time of anything left. Not as a separate repo — see below.
4. **This file was pruned** from 2,297 lines, and the Phase 3 slice detail and the superseded 2026-09-03
   CI sections moved to [`archive/`](archive/). That closes the second of the two open questions.

### Why the shared infrastructure is not a separate repo — reversed 2026-09-06

**Both premises of this section have since failed, and its own evidence is what overturned it.** It argued
against a separate repo because (a) admin was the only component and (b) this service is GitHub Actions.
`deed-poll-api` and `deed-poll-web` broke (a) — and on 2026-09-06 the pipeline decision broke (b), which
was the load-bearing half. The observation below that *all 85 of those repos are Jenkins* is precisely the
divergence argument that led to moving all four repos onto the CNP pipeline.

`hmcts/deed-poll-infra` now exists. See [`DEED_POLL_INFRA_PLAN.md`](DEED_POLL_INFRA_PLAN.md). The rest of
this section is kept because the three template traps at the end of it are still real and still worth not
rediscovering.

The other **85** HMCTS `*-shared-infrastructure` repos all exist, and all of them are Jenkins — checked
by cloning `pt-shared-infrastructure` and `pcs-shared-infrastructure`, both of which carry
`Jenkinsfile_CNP` and wire their vault to `var.jenkins_AAD_objectId`. This service is GitHub Actions.
Combined with deed-poll-admin being the **only** component — so there is no second repo for a vault to
be shared *with*, which is the reason the split exists — the separate repo would have bought convention
at the price of a second federated-credential PR into the queue already blocking everything.

**A second Terraform root inside this repo was the obvious middle ground and does not work.**
`terraform-deploy` takes a `working-directory` input, but `terraform-deploy/action.yaml:159` derives the
backend state key as `{repository name}/{environment}/terraform.tfstate` and ignores it. Two roots here
would share one state file and each apply would destroy the other's resources. **Do not try this again
without overriding `state-store-container-name` per root.**

Three traps in the template's commented-out example, which #64 replaced — recorded because each would
have failed at a different stage:

- **Its source was `git@github.com:`.** Actions runners have no deploy key for hmcts repos, so it cannot
  clone. The other two modules in that root already used `git::https://`.
- **It passed `tenant_id`**, which `cnp-module-key-vault` documents as `(deprecated) does nothing`.
- **`product_group_name = "dcd_${var.product}"` names a group that does not exist**, and
  `team-access.tf` looks the group up by display name and creates its access policy *unconditionally* —
  so a wrong or empty value fails the apply on an invalid `object_id` rather than being skipped. It is
  `"DTS CFT Developers"` for now, the CFT-wide group the module already reads elsewhere and so is known
  to exist. **Narrow it to a "DTS Deed Poll" group once one exists.**

**The vault is `deed-poll-{env}`, not `{product}-{component}-{env}`.** An earlier version of this file
said the latter and worried about the 24-character Azure limit; that was wrong. `cnp-module-key-vault`
defaults the name to `{product}-{env}`, and `keyVaults: deed-poll:` in the chart's `values.yaml` is
what has to resolve, so `name` is deliberately left unset. `product` itself comes from
`annotations.team` in `charts/deed-poll-admin/Chart.yaml` — confirmed by running the action's own
extraction over the real file — so it is `deed-poll` and not the repo name.

### Renovate's config was wrong in three ways

All three found by running `renovate-config-validator --strict`, which is worth doing before editing
`.github/renovate.json` by hand:

- **`"node": { "enabled": true }` is the Travis manager.** The validator migrates it to `"travis"`. It
  has nothing to do with managing Node versions and there is no `.travis.yml`. Removed.
- **The Dockerfile manager had never matched a line.** It anchored on `FROM node:`, but every Dockerfile
  reads `FROM hmctsprod.azurecr.io/base/node:22-alpine`. Measured: 0 matches in all four files before,
  1 each after. **This is why `.nvmrc` says 24.20.0 while every image still runs Node 22.**
- **Migrating `regexManagers` → `customManagers` renames the manager `regex` → `custom.regex`**, so the
  `matchManagers` in the Node grouping rule had to move with it or that rule would have silently stopped
  matching — the same failure mode as the dead Dockerfile regex.

One consequence to expect: a grouped `Node.js version` PR for 22 → 24 on the images. It will not
automerge. **Whoever reviews it must confirm `hmctsprod.azurecr.io/base/node:24-alpine` exists**, because
`packageNameTemplate: "node"` resolves versions from Docker Hub but writes them to an ACR-qualified
reference. Anonymous pull on that registry is 401, so it could not be checked here.

Also worth knowing, and not ours to fix: **`cnp-githubactions-library` passes `terraform_version_file` to
`hashicorp/setup-terraform`, which has no such input.** It is silently ignored and `terraform_version:
latest` wins, so `infrastructure/.terraform-version` is decorative and CI runs whatever Terraform is
newest. Affects every HMCTS repo using that action.

### What happened on 2026-09-03

A long session. In order:

1. **The IDAM registration PR was raised**, and the six submitted files are committed at
   [`idam-pr/`](idam-pr/) rather than living only in `/tmp`.
2. **The refresh path was fixed** — it required an `id_token` that OIDC Core §12.2 makes optional, so
   every refresh threw and the middleware swallowed it. Both files had no tests at all.
3. **Master was broken three times and repaired three times** — PRs #42, #44 and #58. See
   ["Master's CI was red"](archive/SESSION_HISTORY_2026-09-03.md#masters-ci-was-red-twice-in-one-day).
4. **Loose end 4 closed** (#43), and 47 dead branches deleted with their SHAs recorded in
   [`DELETED_BRANCHES.md`](DELETED_BRANCHES.md) first.
5. **The e2e suite went 20/1 → 21/0**, and the recorded cause (loose end 16, the pg pool) was measured
   innocent — see the correction there.
6. **Four service decisions settled** in code: the service name, admin-only deletes, a 25 MB upload
   limit, and the Welsh translation commissioned.
7. **`osv-scan` and SonarCloud both made to pass**, which took three attempts at the workflow and
   exposed an invalid flag inherited from the template.

### Environment notes for tomorrow

- **`docker compose` is NOT up.** The previous version of this note said it was, and on 2026-09-04 it
  was not — only the devcontainer was running. Run `docker compose up -d` (Postgres +
  `rse-idam-simulator`) before the `ccd` schema tests or e2e, and **check rather than trusting this
  line**, which is exactly the kind of claim that goes stale between sessions.
- **`test:e2e` cannot start without a yarn shim on `PATH`** — Playwright's `webServer` runs
  `yarn dev:nowatch`, which resolves to corepack and dies. Recreate with
  `printf '#!/bin/sh\nexec node /tmp/yarn417/bin/yarn.js "$@"\n' > /tmp/yarnshim/yarn`.
- **Check `organization-secrets` as well as `secrets`** before concluding a secret is missing. 28 org
  secrets are available to this repo; `SONAR_TOKEN` is one, which is why a whole diagnosis was wrong once.

## Session handover (2026-09-03)

**The IDAM registration PR is raised.** Steve submitted it to `hmcts/idam-access-config` outside this
container on 2026-09-03, from the 6 files staged at `/tmp/deed-poll-idam-pr/` (base +
aat/demo/ithc/perftest overrides + roles.yaml). **Nothing further is needed from us on the request
itself** — the next move is IDAM's, and it is a wait rather than a task.

**What is still gated behind it**, unchanged: the client id and secret, so nothing can log in to a
deployed instance; the `idam-client-secret` vault entry; and the e2e journeys, which skip against a
deployed environment for exactly this reason.

**Nothing was left as an open question** — [`IDAM_REGISTRATION_REQUEST.md`](IDAM_REGISTRATION_REQUEST.md)
records all of them as answered from `hmcts/idam-access-config` and `hmcts/rse-idam-simulator` — but
**three things are unverified rather than settled, and every one of them fails quietly**: the role
string `caseworker-deedpoll-admin`, the shape of CFT IDAM's `/o/userinfo`, and whether the issuer
enforces PKCE and the client secret (the simulator checks neither, so local runs prove only this
client's half). Watch for these rather than expecting an error — a wrong role string shows up as
"nobody can edit privacy". Production redirect URIs are also deliberately empty in the submitted
config and must be added before a production deploy.

### The previous session's work did not build, and it hid a real defect

`be3dbba` committed the 2026-09-02 evening work — refresh tokens, client credentials, test users, the
role rename — after fixing **six TypeScript errors that meant `yarn build` had never passed on it**.
That handover claimed "all 250 tests passing", which was true and not sufficient: `vitest` transpiles
per file without type-checking, so `yarn test` cannot see an error `yarn build` fails on. **Run all
three — `lint`, `build`, `test` — before writing a handover that says a slice is done.**

One of the six was a genuine runtime bug rather than a type annotation:

- **`tokens.expires_at` does not exist on an OAuth token response.** The field is `expires_in`
  (seconds from now). `TokenEndpointResponse` carries an index signature
  (`[parameter: string]: JsonValue | undefined`), so reading a misspelt or invented field type-checks
  as `JsonValue` and is **`undefined` at runtime** — which is why the tests passed. Every session
  therefore took the one-hour fallback whatever IDAM actually said. **If IDAM's real access-token
  lifetime is shorter than an hour, `refreshMiddleware` never fires before expiry and the user gets a
  401 mid-session**; longer, and it refreshes needlessly. Now `expiresAtFrom()` in
  `apps/web/src/auth/idam.ts`, shared by `completeLogin`, `refreshTokens` and
  `getClientCredentialsToken`, reading `openid-client`'s `expiresIn()` helper. The one-hour fallback
  survives only for the case OIDC permits — an issuer that omits `expires_in` — and both branches are
  pinned.
- **`clientCredentialsGrant(configuration, scope)` passed the scope where the parameter set goes.**
  The second argument is `URLSearchParams | Record<string, string>`, so a bare string sent **no scope
  at all** and the token came back with the client's default rather than the least-privilege
  `profile roles` asked for. Now `{ scope }`.
- **`let tokens: client.TokenEndpointResponse` in `refreshTokens` stripped the helpers half of the
  type**, so `claims()` was not callable. The grant returns
  `TokenEndpointResponse & TokenEndpointResponseHelpers`; the annotation now says so.

**The test doubles were built to match the fiction**, which is why nothing caught it: `tokensWith` in
`idam.test.ts` and the mock in `client-credentials.test.ts` both returned `expires_at`, cast through
`as never` / `as TokenEndpointResponse`. Both now model `expires_in` **and** the `expiresIn()` helper,
because that pair is what the library returns. Same lesson as the deleted hand-written IDAM stub: a
double that supplies only what the code reaches for can only confirm its author's assumptions. Also
note `client-credentials.test.ts` had mocked `./idam.js` wholesale, which would have stubbed out the
new shared `expiresAtFrom` — it now spreads `importOriginal()` and stubs only `idamConfiguration`.

**One trap while fixing the tests, worth not repeating:** a default parameter swallows an explicit
`undefined`, so `tokensWith(claims, undefined)` silently tested the default and the
"issuer omitted `expires_in`" case asserted nothing. `expiresIn` is a required parameter now.

### The refresh path required an optional ID token, and had no tests

**Fixed 2026-09-03, Steve's call.** `refreshTokens` threw when the refresh response carried no ID token
subject. **OpenID Connect Core §12.2 states the refresh response is a normal token response "except
that it might not contain an `id_token`"** — its own example omits one, and `openid-client` agrees:
`refreshTokenGrant` resolves with `claims()` returning `undefined` rather than throwing
(`oauth4webapi` guards the whole ID-token block on `json.id_token !== undefined`). So against any
compliant issuer that omits it, **every refresh threw, `refreshMiddleware` logged the throw as
transient and called `next()`, and sessions expired exactly as though refresh had never been built.**
Nothing failed and nothing was reported.

**This is already happening locally.** `rse-idam-simulator` does not implement the refresh grant at all
— `IdamSimulatorController.java:260` dispatches only `authorization_code` and everything else falls
through to a 400, which `oauth4webapi` turns into a `ResponseBodyError` with `error: "Bad Request"`.
That is not `invalid_grant`, so it is rethrown and swallowed. **Refresh cannot be exercised end to end
against our own local stack**, which is why the fix is verified by unit tests and mutation rather than
by running it.

Three things changed:

- **An absent ID token is no longer an error.** The subject check that replaced it is conditional on one
  arriving.
- **`refreshTokens` no longer reads `/o/userinfo`, and returns `IdamTokens` rather than a
  `LoginResult`.** It used to build a `CurrentUser` that `refreshMiddleware` discarded — a wasted round
  trip on every refresh, guarded by a throw protecting a value nobody read. **Re-reading roles on
  refresh was considered and deliberately not done**: it would make a withdrawn role take effect
  mid-session, which is a real behaviour change (and what `apps/api` achieves by reading userinfo per
  request), not part of a refresh. `apps/web` roles therefore remain fixed for the life of a session.
- **The subject is now checked, which it never was.** §12.2 requires an ID token returned on refresh to
  carry the same `sub` as the one issued at authentication, and **`openid-client` does not enforce it** —
  its required-claims list is presence-only and it holds no expected subject for a token response. The
  old `fetchUserInfo(…, claims.sub)` call *looked* like it checked, but it was self-referential: it
  validated userinfo against the new ID token's own subject rather than against whoever logged in. So a
  refresh could have swapped the identity behind a live session. `signIn` now records `subject` and
  `refreshTokens` takes it as an argument; a mismatch returns `undefined`, which signs the user out. A
  session with no recorded subject is signed out rather than refreshed unchecked — same fail-closed
  polarity as everything else here.

**Both files had zero tests before this** — the only two things in `apps/web/src/auth/` without any, and
the reason all of the above shipped. `refresh-middleware.test.ts` is new (10 tests) and
`idam.test.ts` gained a `refreshTokens` block (9). **Checked by mutation, not by passing:** reinstating
the throw fails 5 tests including the regression test for it, disabling the subject check fails 1, and
disabling the no-subject sign-out fails 1.

The middleware's catch-all is unchanged and still treats an unrecognised failure as transient, which is
right — IDAM being unreachable is not a reason to sign everyone out — but it is also **how this defect
hid**, so the comment there now says as much: if sessions are expiring on schedule in a deployed
environment, read that log line before assuming the refresh window is wrong.

**What the 2026-09-02 session completed:**

- **Refresh token support** (`apps/web/src/auth/refresh-middleware.ts`): Automatically refreshes access
  tokens 5 minutes before expiry. If refresh fails (revoked/expired), forces re-login. Gives IDAM
  centralized control over access revocation.
- **Client credentials grant** (`apps/web/src/auth/client-credentials.ts`): Service-to-service
  authentication for calling IDAM APIs where no user is involved.
- **Test user creation** (`apps/web/src/auth/test-users.ts`): Programmatic test user creation via
  `idam-testing-support-api`. Users auto-cleanup after 3 hours in AAT. Uses client_credentials grant.
- **Role name updated**: Changed from placeholder `deedpoll-admin` to
  `caseworker-deedpoll-admin` following HMCTS conventions (products with hyphens remove hyphen in role
  names: `deed-poll` → `caseworker-deedpoll-admin`). Updated in `libs/deed-poll/src/auth/roles.ts` and
  tests. All 110 deed-polls route tests passing.
- **SSO providers**: Added `sso_providers: [moj]` to IDAM config for HMCTS caseworker SSO.
- **Post-logout redirect URIs**: Added `oidc:` section with `post_logout_redirect_uris` — directs users
  back to service root after logout completes at IDAM.
- **All open questions answered** by examining `hmcts/idam-access-config` and `hmcts/rse-idam-simulator`:
  - Role naming confirmed: `caseworker-deedpoll-admin` matches pattern
  - `tokenName` claim confirmed present on IDAM tokens (access_token vs id_token distinction works)
  - `post_logout_redirect_uris` should be registered (optional but recommended)
  - Preview environment URIs: AAT auto-adds `https://allow-pr-redirects` wildcard for PR-specific hostnames

**IDAM configuration summary:**
- Grant types: `authorization_code`, `refresh_token`
- Scopes: `openid`, `profile`, `roles`, `offline_access`
- Frontend: `HMCTS_ACCESS` (professional-facing)
- SSO: MOJ provider for caseworker authentication
- MFA: false (relies on account-level MFA)
- Role: `caseworker-deedpoll-admin` (managed by `ccd-admin`)
- Environments: base (production TBD) + aat/demo/ithc/perftest overrides (localhost + staging URLs)

**Code changes:**
- `apps/web/src/auth/session.ts`: Extended session interface to store tokens (idToken, refreshToken,
  accessToken, tokenExpiresAt)
- `apps/web/src/auth/idam.ts`: Changed completeLogin to return LoginResult with tokens object
- `apps/web/src/auth/refresh-middleware.ts`: NEW - automatic token refresh 5 min before expiry
- `apps/web/src/auth/client-credentials.ts`: NEW - client_credentials grant
- `apps/web/src/auth/test-users.ts`: NEW - test user creation API wrapper
- `apps/web/config/default.json`: Added `offline_access` to scope
- `apps/web/helm/values.yaml`: Updated issuer URL from `idam-web-public` to `hmcts-access`, added
  `offline_access` to scope
- `libs/deed-poll/src/auth/roles.ts`: Updated role constant to `caseworker-deedpoll-admin`
- `.business_context/IDAM_REGISTRATION_REQUEST.md`: Complete registration config + research findings
- `.business_context/PROGRESS.md`: Updated with test user creation note (2026-09-02)
- Tests: 14 new tests (client-credentials.test.ts, test-users.test.ts), updated route tests to use
  constant. Test counts are in the generated dashboard below rather than here — the figure this line
  used to carry was `apps/web`'s alone and read as the workspace total.

**Next thing to pick up: wait for the IDAM registration PR to be merged and deployed.** Once the client
is registered and the secrets are in the vault, Phase 5 authentication will be complete and deployable.
The only code remaining is Phase 6 (config, Helm, deployment), which depends on shared infrastructure
existing.

Phase 4's 12 page handlers are all ported and exercised against a running app. **Two pieces of
Phase 4 are deliberately outstanding rather than done** — neither blocks Phase 5, and both are
recorded below rather than lost:

1. **The Phase 4 verification pass** the plan asks for. **The e2e journeys and the accessibility
   checks are now done** (2026-09-02) — see ["Phase 4 verification"](#phase-4-verification-done-2026-09-02). What
   remains of it is **Welsh content only**: every page carries `cy` with matching keys, and a test now
   pins that the keys resolve, but the values are still English.
2. **`power_app_nest/` is deliberately NOT deleted.** Steve's call on 2026-09-01: it is gitignored,
   costs nothing but disk, and — as the rescue commit `47a9ad2` establishes — it has never been
   committed, so deleting it is unrecoverable rather than a revert away. Keeping it as a reference is
   cheap insurance. The one thing in it that mattered, `CONFORMANCE_HARNESS_PLAN.md`, is preserved in
   `.business_context/` regardless, so the directory going later loses nothing.

**Before writing any Phase 5 code, read ["Phase 4 — SSR pages"](#phase-4--ssr-pages-in-progress).**
Phase 5 replaces `userFromHeaders` in `libs/deed-poll/src/auth/header-user.ts` and the two one-line
app adapters that call it. That is the whole seam, and knowing why it is shaped that way saves
rediscovering it.

Read ["Phase 3 foundations"](archive/PHASE_3_SLICES.md#phase-3-foundations-done-caf4e03) and slices
[1](archive/PHASE_3_SLICES.md#phase-3-slice-1-deed-polls-done), [2](archive/PHASE_3_SLICES.md#phase-3-slice-2-notes-and-witnesses-done),
[3](archive/PHASE_3_SLICES.md#phase-3-slice-3-document-types-done) and [4](archive/PHASE_3_SLICES.md#phase-3-slice-4-documents-done) before touching a
handler or a form — between them they settle every decision that is already made, including three
defects of the same shape that only running the app revealed.

**Local disk storage cannot go to AKS** — pods are ephemeral and replicas share no volume. Uploads
work locally and are a development story until CDAM or the Azure Blob off-ramp — see
[`DEED_POLL_API_PLAN.md`](DEED_POLL_API_PLAN.md), which supersedes Phase 10 of the migration plan.
`.gitignore` now covers `data/` so uploaded blobs are never committable.

**One task is parked, not a question** — see "Parked tasks" below (task 1 is closed).

## At a glance

**Refresh at the end of every slice: `yarn progress:write`** (or
`node scripts/progress-dashboard.mjs --write --tests`, which is what it wraps and what works when
Yarn is not usable here). `yarn progress` prints without touching the file, and is instant because it
skips the suite.

**The roadmap and the gates below are hand-written** — no script can know why a phase is blocked —
but everything between the generated markers is counted from source and cannot drift. That split is
the point: this file's numbers *have* drifted before, and every instance was a number a command could
have answered. Stale test counts, a stale commit list, and `/api/deed-polls` paths that were never
right. Anything countable now gets counted.

```
TRACK A — productionise in the monorepo (deployable on its own, no CCD)
════════════════════════════════════════════════════════════════════════════
 0  hygiene & blocked inputs   ██████████████████████  done
 1  schema → monorepo          ██████████████████████  done
 2  domain → libs/deed-poll    ██████████████████████  done
 3  JSON API → apps/api        ██████████████████████  done — 29 handlers; transitional, see CDAM plan
 4  SSR pages → apps/web       █████████████████████░  12/12 ported, e2e + axe green; Welsh out for review
 5  authentication (IDAM)      ████████████████████░░  ◀── HERE. code done; PR raised, awaiting IDAM
 6  config, Helm, deployment   ████████████░░░░░░░░░░  reopened 2026-09-06: Jenkins CNP migration + infra split

TRACK B — CCD adoption (separable; start only once Track A is green)
════════════════════════════════════════════════════════════════════════════
 7  spike /ccd-persistence     ░░░░░░░░░░░░░░░░░░░░░░  ccd schema already vendored
 8  case type definition       ░░░░░░░░░░░░░░░░░░░░░░  hand-authored JSON, SDK is Java
 9  persistence endpoints      ░░░░░░░░░░░░░░░░░░░░░░  + retain-and-dispose reaper
10  CDAM documents             ░░░░░░░░░░░░░░░░░░░░░░  planned: DEED_POLL_API_PLAN.md (Spring Boot)
11  platform onboarding        ░░░░░░░░░░░░░░░░░░░░░░  all external, long lead times
```

What gates a deploy, **rewritten 2026-09-06** — and no longer "none of them code", since the Jenkins
migration and the infra split both are:

| Gate | Why it blocks |
|---|---|
| Phase 5 auth | **Registration PR raised 2026-09-03; waiting on IDAM.** Both apps authenticate, but until the client is registered there is nothing to point them at, and `idam-client-secret` cannot exist in the vault until IDAM supplies its value — so nobody can log in to a deployed instance, and `assertIdamSettings` refuses to start without it. No longer a task, just a wait |
| ~~Azure credentials~~ | ✅ **No longer a gate, 2026-09-06.** The four secrets were GitHub Actions-specific and Jenkins authenticates as its own managed identity. [PR #99](https://github.com/hmcts/azure-github-federation-config/pull/99) is closed |
| Jenkins onboarding | **The replacement gate.** Four `cnp-jenkins-config` entries, one per repo. External, but a well-trodden path rather than an unreviewed queue |
| Jenkins CNP migration | **New and ours.** `.github/workflows/` out, `Jenkinsfile_CNP` in, `variables.tf` rewritten for `withInfraPipeline`. See [`DEED_POLL_INFRA_PLAN.md`](DEED_POLL_INFRA_PLAN.md) |
| `deed-poll-infra` first apply | Nothing has ever been applied anywhere. Every component reads the vault this root creates, and **nothing enforces that ordering mechanically** |
| CI has no database | The `ccd` schema tests skip in CI. Honest, but not coverage |

**No longer a gate:** the shared infrastructure. `infrastructure/` used to read the resource group and
Key Vault as `data` with nothing creating them, so the plan failed before reaching a resource; both are
created now — and as of 2026-09-06 they live in `hmcts/deed-poll-infra`. See ["Why the shared
infrastructure is not a separate repo"](#why-the-shared-infrastructure-is-not-a-separate-repo-reversed-2026-09-06).

**CI, with a caveat added 2026-09-06.** Lint, test, `osv-scan`, SonarCloud and `Terraform Format` all pass
on master, having never passed before 2026-09-03 — see ["Master's CI was
red"](archive/SESSION_HISTORY_2026-09-03.md#masters-ci-was-red-twice-in-one-day). **All of it is being
deleted** with `.github/workflows/`, and replaced by the equivalent stages of the CNP Jenkins pipeline.
That was a deliberate trade for lower divergence from the estate; the one thing with no Jenkins equivalent
is CodeQL.

<!-- BEGIN GENERATED DASHBOARD -->

_Generated by `yarn progress:write`. Do not hand-edit inside the markers — the next run overwrites it._

### deed-poll-api — the surface this app consumes

```
caseworker path         operations
────────────────────────────────────
cases                   4
cases/documents         2
cases/field-rules       1
cases/notes             5
document-types          1
────────────────────────────────────
published in the spec   13
adapter functions       14
```

- The adapter's extra function is `checkApiReachable`, which the readiness probe uses against api's unauthenticated `/health/liveness` — not a caseworker operation. The path is the liveness group and not the ungrouped `/health` on purpose: see the docblock at the function.
- `src/api/contract.test.ts` is what proves the two lines correspond; this table only counts them.

### Phase 4 — SSR pages

- **13 page handlers** ported in `src/pages/deed-polls/`, against **12** in the prototype's `deed-poll-pages.controller.ts` and **9** Nunjucks templates.
- **17 end-to-end tests** written in `e2e-tests/tests/`, **2** of them deed-poll journeys. Accessibility and validation are checked inside the journeys, so they add no test count of their own.

### Tests

```
@hmcts-cft/cloud-native-platform        140 passed
@hmcts-cft/express-govuk-starter        127 passed
@hmcts-cft/express-session-postgres      23 passed
@hmcts-cft/express-session-redis          7 passed
@hmcts-cft/simple-router                 41 passed
@hmcts/deed-poll                        443 passed
@hmcts/deed-poll-api-client             138 passed
deed-poll-admin                         354 passed
─────────────────────────────────────────────────────
total                                  1273 passed
```

### Branch

```
collapse-to-single-app
4 commits ahead of master
HEAD  17f3bc5  feat: root Dockerfile confirmed, and the pipeline's post-deploy gate
```

<!-- END GENERATED DASHBOARD -->

## State

On master, everything merged and pushed — see ["Branch state"](#branch-state). Branch, commit count and
test counts live in the generated dashboard above rather than here, so there is only one place for them to
be wrong.

The commit list below is the Phase 1–3 history, kept for orientation. It stops well short of `master`'s
current tip and is not maintained — use `git log` for anything current.

```
346e623  Port the document-types handlers and give the in-use refusal a 409
7843eec  Add an at-a-glance dashboard to PROGRESS.md, with the numbers generated
83d54c4  404 a child list when its parent case does not exist
2e41014  Scope the nested child writes to their parent case
14d3936  Port the notes and witnesses JSON handlers
1c23f72  Port the deed-polls JSON handlers and fix the reference-number error class
b1ef30c  Capture the four open questions as open questions
8ec90f2  Refresh the handover for the next session
31f290e  Make the header-auth bypass opt-in by environment rather than opt-out
290e5cf  Record the Phase 3 foundations in the handover docs
caf4e03  Add the Phase 3 foundations: error mapping and role middleware
0132bd4  Record PR #36 as merged and narrow the open item to the residue
ce73cc5  Merge master to pick up the refreshed lockfile
2b42a14  Point the dependency-alert note at the remediation PR
ae51462  Correct the dependency-alert note in the handover docs
9754a8d  Record the migration plan and progress in .business_context
94e1715  Complete Phase 2: move the Prisma-backed services and conformance harness
4c81c16  Convert the class-validator DTOs to Zod schemas
c58e161  Move deed-poll domain logic into libs/deed-poll (part 1: pure modules)
a5e0d6e  Add the CCD decentralised-persistence ccd schema, vendored from the SDK
b17fac5  Port the deed-poll case model into the shared Prisma schema
```

`yarn lint`, `yarn build` and `yarn test` are all clean across the workspace (11 tasks). Per-package
test counts are in the dashboard above — run the generator with `--tests` to refresh them, and treat
a drop as a regression.

**Before running anything, Yarn needs sideloading** — Corepack cannot reach `repo.yarnpkg.com` from
the devcontainer. See the bullet under "Things a future session should not have to rediscover"; it
cost a chunk of a session to rediscover once already.

## Parked tasks

Answered by Steve on 2026-09-01: do these later, but **do not lose them**. Neither is a question
any more — the decision is "yes, just not now". Task 1 is now closed; task 2 still stands.

1. ~~**Draft the CNP product-code question for Platform Operations.**~~ **Closed 2026-09-01 — it is
   `deed-poll-admin`.** No message was needed in the end: HMCTS repos are named `{product}-{component}`
   ([`docs/how-to/new-component/github-repo.md`](../../docs/how-to/new-component/github-repo.md)), so
   the repo name settles it — product `deed-poll`, component `admin`, exactly what the re-scaffold
   assumed. The old `Jenkinsfile_CNP`'s `rpe` was a template leftover and can be ignored. See
   "The product code is settled" under Phase 6 for the two things that did fall out of it.
2. ~~**Check Renovate PR #31 (`applicationinsights` 3.16.0) merges cleanly and report.**~~
   **Checked 2026-09-03 — it merges cleanly and clears 12 advisories. Still not merged**, as instructed.
   See ["Renovate PR #31"](archive/SESSION_HISTORY_2026-09-03.md#renovate-pr-31-checked-not-merged) below for the measurements. The
   prediction recorded here was right about the mechanism being `protobufjs` and slightly understated
   the effect.

Decided and closed, recorded so they are not reopened:

- **Phase 3 was sliced**, not one pass: `deed-polls` → notes + witnesses → `document-types` →
  `documents`. All four done. The same slicing is worth applying to Phase 4's 12 page handlers.
- **Upload limits**, agreed 2026-09-01: **10 MB** and an accepted-type list (PDF, JPEG, PNG, TIFF,
  Word). The size is a guess pending real file sizes from the service team; see slice 4.
- **Prisma query logging stays on** under `yarn dev`. See Loose ends 3 for where to turn it off if
  it proves noisy.

## Done

### Phase 0 — hygiene

- `power_app_nest/` gitignored while it is staged in-tree. Its `node_modules` (498M), `dist`, `.env`
  and 57 document blobs were all committable before this.
- Bare `.env` and `.DS_Store` added to `.gitignore` — the template covered only `.env.local` and
  `.env.*.local`.
- `.business_context/dataverse_tables/` committed. These are the source-of-truth Dataverse exports;
  without them the schema-conformance suite cannot run. **Note they are alphabetically truncated**
  (A–R only, ending at "Refund Reference") despite declaring "Total columns: 70", so the harness
  asserts forward coverage only — every column present must map to a Prisma field — and must never
  be treated as a complete column set.

### Phase 1 — schema

`libs/postgres-prisma/prisma/schema/deed-poll.prisma`. Migrations re-baselined into one
(`apps/postgres/prisma/migrations/20260821194029_add_deed_poll_case_model`) rather than porting the
prototype's six, which were authored against Prisma 6 standalone.

Verified against local Postgres — 5 tables, 11 enums, 7 indexes — including the three things most
likely to have broken silently:

- `signaturerecieveddate`: the source column's misspelling is deliberate and is still mapped from the
  corrected TS name `signatureReceivedDate`.
- `Int[]` (`iShall`, `iHaveSubscribed`, `andAlsoMyOld`) round-trips through the `PrismaPg` adapter.
- `refundAmount` is `numeric(12,2)` and returns a `Decimal`.

### `ccd` schema (Track B groundwork)

`apps/postgres/ccd-runtime/` — the CCD decentralised-persistence runtime, **vendored verbatim** from
`ccd-config-generator` (upstream `b6bdfcde`, 2026-08-17). 25 SQL files, not the 4 the docs describe.
Read that directory's README before touching it. Two traps documented there and pinned by tests:

1. **`search_path` must include `ccd`.** The audit trigger inserts into `case_event_audit`
   *unqualified*, and plpgsql resolves that at execution time. A normal connection fails with
   `relation "case_event_audit" does not exist`. It only bites on `data` UPDATEs to `case_event`,
   never inserts — so it passes casual testing.
2. **`ccd.user_idam_id` must be set** in the transaction, or the trigger cannot attribute the row.

`migrate:reset` also drops the `ccd` schema now; Prisma only resets schemas in its own datasource, so
a reset previously left `ccd` populated with its history intact while `public` was empty.

### Phase 2 — domain layer

`libs/deed-poll/` — **25 suites, 441 tests**. The count reconciles exactly:

| | |
|---|---|
| Prototype | 17 suites / 269 tests |
| Not migrated: `auth/roles.guard.spec` | 6 tests — a Nest guard being replaced by Express middleware, rewritten in Phase 3 |
| Domain tests migrated | **263** |
| New Zod schema tests | 37 |
| Conformance | 141 |
| **Total** | **441** |

No domain test was dropped and **the assertions are unchanged** — the mocked Prisma client is aliased
back to `prisma` so every spec body still verifies what it did under Nest DI. In the deed-poll service
only the database is mocked; the four helper modules are the real implementations, as they were when
registered as DI providers.

What changed in the move:

- Nest removed. Stateless `@Injectable()` classes became modules of exported functions.
- CommonJS → ESM (`.js` specifiers), Jest → Vitest, `@prisma/client` → `@hmcts/postgres-prisma`.
- HTTP concerns out of the domain: `NotFoundException` / `BadRequestException` → `NotFoundError` /
  `InvalidInputError` in `libs/deed-poll/src/errors.ts`. The route layer maps them to status codes —
  that mapping was Phase 3 work and **now exists**, in `apps/api/src/errors.ts`.
- 10 class-validator DTOs → 4 Zod schema modules with `.partial()` counterparts.

## Things a future session should not have to rediscover

- **`libs/deed-poll` exports entity-specific names**, not `create`/`findAll`/`findOne`. Those
  collided across five modules once barrel-exported. It is `createWitness`, `findNotes`,
  `updateDeedPoll`, `getCaseFieldRules`, and so on.
- **`InvalidInputError` carries `FieldError[]`**, not just a message. The prototype threw
  `BadRequestException({ message, errors })` and the SSR forms render those errors against individual
  inputs. Phase 3/4 must surface them, or field-level validation silently becomes unattributed.
- **Zod nullability is deliberate.** Nullable columns use `.nullish()` so a PATCH can clear a value;
  the eight with Prisma defaults (`privacy`, `urgency`, the three `int[]` multiselects, the three
  booleans) use `.optional()`, so `null` fails validation instead of reaching Prisma. Tests assert
  both directions.
- **Dates stay ISO strings through validation.** The domain coerces them to `Date` immediately before
  Prisma, and the SSR forms submit `YYYY-MM-DD`. The schema accepts bare dates, UTC, offset and
  local-without-zone; it rejects `01/03/2026`.
- **`createNoteSchema` trims and delegates to `validateNoteText`.** Both are load-bearing: without
  the trim, `"   "` is accepted as a note and whitespace is stored.
- **Corepack cannot reach `repo.yarnpkg.com` from the devcontainer.** Yarn 4.17.0 has to be
  sideloaded: `npm pack @yarnpkg/cli-dist@4.17.0`, extract, then run
  `node <extracted>/bin/yarn.js`. Also `enableScripts` defaults to false here, so `YARN_ENABLE_SCRIPTS=true`
  is needed for Prisma's postinstall.
- **The `ccd` schema tests skip when no database is reachable** — CI has no Postgres. Run
  `docker compose up -d` locally to exercise them.

## Phase 3 — the JSON API (deleted 2026-09-09; kept as history)

> **`apps/api` no longer exists.** It was replaced, not migrated: `deed-poll-api` now serves the 13
> caseworker operations `apps/web` needs, and plan 02 deleted this app and its 261 route tests in full.
> Everything in this section is therefore **history** — accurate about what was built, wrong about what is
> in the tree. Nothing below is the reference for current code; `libs/deed-poll-api-client` is.
>
> It is worth keeping for two reasons: the three defects the slice sections record were found by running the
> app rather than by testing it, and the operations api deliberately does **not** publish (witness writes,
> document patch and delete, document-type writes) are the ones enumerated here.

**Phase 3 is complete — 29 of 29 handlers.** Foundations (`caf4e03`) plus four slices: `deed-polls`
(7), notes + witnesses (10), `document-types` (5) and `documents` (7). See the slice sections below;
three of them record a defect that only running the app revealed.

Move the 29 JSON handlers from the prototype's controllers into `apps/api/src/routes/` as
`simple-router` files. The domain functions they need all exist and are tested.

```
routes/deed-polls/index.ts                        ✅ GET list, POST create
routes/deed-polls/field-rules.ts                  ✅ GET
routes/deed-polls/[id].ts                         ✅ GET, PATCH, DELETE
routes/deed-polls/[id]/validate.ts                ✅ POST
routes/deed-polls/[id]/notes/{index,[noteId]}.ts       ✅ GET/POST, GET/PATCH/DELETE
routes/deed-polls/[id]/witnesses/{index,[witnessId]}.ts ✅ GET/POST, GET/PATCH/DELETE
routes/deed-polls/[id]/documents/{index,upload,[documentId]}.ts  ✅ all 7, incl. [documentId]/file
routes/document-types/{index,[id]}.ts                   ✅ GET/POST, GET/PATCH/DELETE
```

**Note the nested paths use `[id]`, not the `[deedPollId]` earlier revisions of this table showed.**
See slice 2 below for why.

Source controllers to port (then delete):

| Prototype file | Handlers | |
|---|---|---|
| `deed-poll/deed-poll.controller.ts` | 7 | ✅ ported |
| `notes/notes.controller.ts` | 5 | ✅ ported |
| `witnesses/witnesses.controller.ts` | 5 | ✅ ported |
| `documents/document-types.controller.ts` | 5 | ✅ ported |
| `documents/documents.controller.ts` | 7 | ✅ ported, incl. the Multer wiring |

None of the ported controllers are deleted yet; `power_app_nest/` goes as a whole at the end of
Phase 4.

Specific work:

1. ✅ **Error mapping.** Done — see below. Extended in slice 3 with `ConflictError` → 409.
2. ✅ **Validation per route.** Done across all four slices. Replace the global `ValidationPipe` with `safeParse` against the Zod
   schemas from `@hmcts/deed-poll`. `zodErrorToFieldErrors` and the 400 mapping are in place, so a
   handler can simply `throw parsed.error` on a failed `safeParse`. **Copy the four `deed-polls`
   route files for shape** — they are the worked example now, and they are a better guide than
   `routes/onboarding/`, which try/catches per handler and predates the error middleware.
3. ✅ **`RolesGuard` → Express middleware.** Done — see below.
4. ✅ **Multer.** Done in slice 4 — `apps/api/src/documents/upload.ts`. `uploadDocument` takes a plain
   `UploadedFile` (`buffer`, `originalname`, `mimetype`, `size`) rather than `Express.Multer.File`,
   and the middleware maps onto it, adding a 10 MB limit and a type list the prototype had neither of.

Verification: `yarn test` must show at least 477 in `libs/deed-poll` and 219 in `apps/api` plus
whatever the new route tests add; `yarn lint` and `yarn build` clean; and exercise the handlers
against a running app — see the recipe under "Exercising the API locally" below, which is worth
following rather than improvising, because two of the four things in it cost time to work out.

### Exercising the API locally

```
docker compose up -d                                   # Postgres; also un-skips apps/postgres tests
YARN_ENABLE_SCRIPTS=true <yarn> db:migrate             # sideloaded yarn — see the note above
cd apps/api && NODE_ENV=development ../../node_modules/.bin/tsx src/server.ts
```

- **The paths have no `/api` prefix.** It is `GET /deed-polls`, not `GET /api/deed-polls` — see
  slice 1 below for why. Earlier revisions of this file said `/api/...` throughout and were wrong.
- **Startup takes ~20 seconds**, nearly all of it one Azure Key Vault DNS lookup timing out
  (`getaddrinfo EAI_AGAIN deed-poll-aat.vault.azure.net`). Two `Warning:` lines about the vault and
  `/mnt/secrets` are expected and harmless. Poll `/health` rather than guessing a sleep.
- **The API needs a bearer token.** `x-user-roles` does nothing now — it is deleted, not disabled. Get
  a token from the local simulator and use it:

      ADMIN=$(curl -s -X POST http://localhost:5556/o/token -d grant_type=password \
        -d username=admin@example.com -d password=x -d client_id=deed-poll-admin \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).access_token))')
      curl -s http://localhost:3001/deed-polls -H "authorization: Bearer $ADMIN"

  The password grant is used only because it needs no browser; the code flow is what `apps/web` uses.
  `caseworker@example.com` is the same but role-less, which is how the privacy gate gets tested from
  both sides. `yarn idam:users` creates both.
- Local writes consume reference-number serials permanently, so `KBDP2026-…` will not start at
  00001 on a database that has been exercised. That is the counter working, not a bug.

## Phase 4 — SSR pages (in progress)

**All 12 page handlers ported**: the case list, the new-case form, the case detail page, the edit tab
(GET and POST), the four note handlers and the two upload handlers — plus a
document download route the prototype did not have, and the pages' own domain-error mapping. Foundations are in
`libs/deed-poll` (`date-parts`, `list-filters`, `list-view`, `edit-view`). The verification pass is done
— see ["Phase 4 verification"](#phase-4-verification-done-2026-09-02). Remaining: Welsh translation, and
deleting `power_app_nest/` if that decision is ever revisited.

**The templating swap the plan lists is already done.** `nunjucks.setup.ts` exists only in the
prototype; `apps/web` has always used `configureGovuk`. That file goes when the prototype does. Its
two custom Nunjucks filters (`govdate`, `label`) are *not* reproduced — formatting moved into the
view model instead (`list-view.ts`), which needs no bespoke Nunjucks environment and is testable.

### The service root is the case list

Steve's call, 2026-09-02: `/` was still the template's marketing home page — a panel titled "HMCTS
Express Monorepo Template" describing `hmcts/expressjs-monorepo-template` rather than this service.
Deleted, and `/` now redirects to `/deed-polls`.

**A redirect, not the list rendered at `/`.** `/deed-polls` stays the collection's canonical URL
because everything nested hangs off it, and the list's own filter links are absolute
(`/deed-polls?filter=…`) — so serving the list at `/` would render a page whose every link navigates
away from itself, and would give one collection two URLs.

**`/` stays on `requireAuth`'s public allowlist**, which looks wrong and is not. It only redirects, so
allowing it makes an anonymous visitor's `returnTo` the list rather than the root; off the allowlist
they would sign in, return to `/`, and be redirected a second time. The refusing is done by the
redirect *target*, which is guarded. Verified: `/` → 302 `/deed-polls` → 302
`/login?returnTo=%2Fdeed-polls` → 302 IDAM.

`/` needed a handler rather than just deleting the page: it is what anyone hitting the bare hostname or
a bookmarked root gets, and the onboarding confirmation page's return button points at it.

**It is not reached from the GOV.UK header, though — checked in the rendered HTML rather than inferred
from the template.** `site-header.njk` passes `govukHeader({ serviceName, serviceUrl: "/" })`, which
reads as though the header links to the root. It does not: **govuk-frontend 6 removed both options from
`govukHeader`** in favour of `govukServiceNavigation`, so the installed 6.2.0 template contains neither
name and silently ignores both. The only anchor in the rendered header is the GOV.UK crown, pointing at
`//gov.uk`. That surfaced a separate defect — see loose end 15 — which is worth reading before touching
either file.

Consequences worth knowing:

- **Three template e2e specs depended on that page.** `homepage.spec.ts` tested only its content, so it
  is deleted. `welsh-language.spec.ts` and `cookie-management.spec.ts` both navigated to `/` — which is
  now behind login, so the cookie banner would never be reached — and are retargeted at
  `/accessibility-statement`. That page is the right substitute for a specific reason: it is **public**,
  so the language toggle works before sign-in, and **genuinely translated**, which no deed-poll page is.
  Asserting Welsh on a deed-poll page would assert English.
- **`libs/onboarding` is now unreachable by navigation.** That home page held the only link to
  `/onboarding/start`. It is template demo content, still routed and still tested, but nothing in the
  service links to it — which strengthens the case for deleting it whenever the prototype goes.
- **One flake surfaced and is fixed.** `signInAsAdmin` now runs five times per suite (the setup, plus
  once per onboarding test), and under that load the cross-origin OIDC round trip exceeds Playwright's
  default 5s `expect` timeout — the callback had not finished exchanging. It now waits 30s explicitly.
  The failure read as a broken login rather than a slow one, which is the sort of flake that wastes a
  morning in CI. Three consecutive full runs green after the fix.
- **A second flake surfaced from the same root cause, and exposed a session-isolation bug in the deed-poll
  journey.** The Welsh-shape check (`?lng=cy`) writes to `req.session.locale`, and the journey was doing
  that on the shared session every test restored. So whichever test ran after the deed-poll journey saw
  its pages render in Welsh, and its English locators stopped matching — 30-second timeout, waiting for a
  button whose name had changed, in a different file. The Welsh check now signs in to its own throwaway
  context instead, which is the whole point of `expectWelshKeysResolve`: any check that writes to the
  session needs its own session. That brought the concurrent logins high enough to exhaust the shared pg
  pool (10 connections, no timeout) and hang the callback — see loose end 16. The final mitigation:
  `onboarding-happy-path.spec.ts` runs sequential-within-file rather than parallel, so the four tests
  share one session in series and the suite stays under the pool threshold. Slower (42s vs 24s), but five
  consecutive runs stable.

### Template names are global, and a collision fails silently

**`res.render("index")` from `pages/deed-polls/index.ts` rendered the template's own home page**,
with a 200 and no error. `collectViewPaths` in the govuk starter adds *every* page directory to the
Nunjucks search path as a flat list, parent first — so `pages/index.njk` shadowed
`pages/deed-polls/index.njk`. The page's own directory gives it no precedence.

**Always render with a directory-qualified name: `res.render("deed-polls/index")`.** That resolves
unambiguously against the `pages/` entry. Every existing template in `apps/web` happens to have a
globally unique basename, so nothing had hit this before; the remaining pages include `detail`,
`edit` and `upload`, which are exactly the names most likely to collide with something later.

**`pages/index.njk` is now deleted** (see "The service root is the case list"), so this particular
collision can no longer happen — **but the rule is unchanged and is not about that file.** The
mechanism is the flat search path, which is still flat: any two templates sharing a basename collide,
parent-most wins, and the loser fails silently with a 200. Do not read the deletion as making
qualified names optional.

This deviates from `.claude/rules/frontend.md`, which says the template name must match the file
name. It still does — the qualified name *is* the path — but the rule as written implies the bare
basename, and following that literally is what produced the wrong page.

**One trap while verifying:** `tsx src/server.ts` does not watch. An edit appears to have no effect
and it is easy to conclude the fix did not work; restart between changes.

### Middleware validation errors needed a different route out

Propagating the upload parser's rejection produced a **500**, not a 400. `domainErrorHandler`
deliberately passes `InvalidInputError` on, on the grounds that a page which validates is expected to
have caught it and re-rendered its own form. That is true of a **handler** and false of **middleware
running before one**: the multipart parser rejects an over-size or wrong-type file before the handler
exists to catch anything.

Diagnosing it was slower than it should have been because the starter's development 500 page prints
`err.message`, so the response contained the *correct* message — "The file must be smaller than 10MB" —
on the wrong status. It read as a status bug rather than a routing one.

So `apps/web`'s parser **records** its rejection on `res.locals` and calls `next()` normally, leaving
the handler to re-render. That is the one real difference from `apps/api`'s copy, where propagating is
right because its error middleware turns the rejection into a JSON 400 and there is no form to
re-render. Pinned by a test.

The upload **policy** — the 10 MB limit, the accepted-type list, the messages — moved into
`libs/deed-poll/src/documents/upload-policy.ts` so both apps enforce one set. The limit is the figure
the handover flags as needing confirmation with the service team; in two places, someone confirms it and
changes one. Only the Multer wiring is duplicated, because Multer is Express middleware.

### The note forms re-render instead of redirecting with `?error=`

The prototype's note and upload handlers redirected to `?error=<message>` on a validation failure, and
its own comment justified that on the grounds that these forms "carry one field". That is true, and it
is an argument about **how much** there is to lose rather than about whether losing it is acceptable.

`validateNoteText` rejects a note over 2000 characters, so the failure most likely to be hit is
precisely the one where the caseworker has typed the most — and a redirect discards the whole thing.
Both note forms therefore re-render with the submitted text and a 400, like the edit form and the
new-case form. Verified live: a 2001-character amendment comes back 400 with the text still in the
textarea and the stored note unchanged.

They validate through `createNoteSchema` rather than calling `validateNoteText` directly, because the
schema trims first and the trimmed value is what gets stored — so the page and the API accept exactly
the same input.

**Delete is checked before validation, deliberately.** It is a second submit button on the same form,
branching on `action`, so a note whose text would fail validation can still be deleted — the text is
irrelevant to a row about to disappear. Only the literal `"delete"` deletes; a missing `action` falls
through to save, so an absent value is never destructive. All three are pinned by tests and were
checked live, including that a delete routed through the wrong case 404s and leaves the note intact.

### The edit form is strict on write and lenient on read, deliberately

`tabFor` falls back to the first tab for an unrecognised id. That is right for a **GET** — the id
comes from a URL that may be stale or bookmarked, and showing the Application tab is a harmless
answer.

**It would be destructive on a POST.** `buildUpdatePatch` writes every field it is given, blanking
absent ones, because the Dynamics form persists the whole tab. The Application tab has **46 editable
fields**. So a POST to `/edit/nonsense` with an empty body, falling back, would null all 46 from a
body that never mentioned them. The prototype avoided this by accident: its `FORM_TABS.find` returned
undefined, `fields` became `[]`, and the save was a silent no-op that still redirected as if it had
worked.

The POST handler therefore looks the tab up strictly and throws `NotFoundError` — a 404 rather than
either a silent no-op or a fallback. Pinned by a test, and verified live: `POST /edit/nonsense`
returns 404 and the Application fields are untouched afterwards.

Subgrid tabs (notes, witnesses, documents) have **zero fields**, so a POST to one is a genuine no-op
and needs no special case. The GET renders a "managed as a list" message instead of a form.

### Do not simplify the edit template's error check to a truthiness test

Carried over from the prototype, and worth repeating because it looks like noise: a Nunjucks macro
call returns a SafeString, and **an empty SafeString is still truthy**. `{% if err %}` therefore
marked every date field as errored and emitted a bare "Error:" above it. The template tests
`errText | length` instead and passes a plain string on. Verified live: a clean load of the
Application tab renders **zero** `govuk-error-message` elements.

### The pages needed their own domain-error mapping

**A missing case returned 500.** `apps/web` mounts the govuk starter's `errorHandler`, which logs
and renders `errors/500` for anything at all — it has never heard of `NotFoundError`. So a caseworker
following a stale link to a deleted case was told the server had broken.

That is the **fourth** instance of the shape three Phase 3 defects had: an expected, caller-caused
condition reaching an error handler that does not recognise it. It was invisible until the detail
page existed, because no earlier page loaded anything that could be absent.

`apps/web/src/errors.ts` now maps `NotFoundError` → 404 (the starter's own `errors/404` view, so a
missing case and a mistyped URL look the same — both mean "there is nothing here") and
`ForbiddenError` → 403. It is mounted **before** the starter's handler and delegates anything it does
not recognise via `next(err)`, so a genuine fault still gets the starter's logging and 500 page.
An `InvalidInputError` reaching it is passed on deliberately: a page that validates is expected to
re-render its own form, so arriving here means a bug in that handler rather than a user error.

### Document blobs live in a cwd-relative directory, so the two apps disagree

`file-storage.ts` resolves `DATA_DIR ?? <cwd>/data`. Each app runs from its own workspace directory,
so **`apps/api` writes to `apps/api/data` and `apps/web` reads from `apps/web/data`** — a document
uploaded through the API is invisible to the web app, and the download link 404s. It took a while to
diagnose because the 404 was *correct*: the file genuinely was not where the reader looked.

Both `dev` scripts now set `DATA_DIR=../../data`, pointing at one directory at the repo root (already
gitignored). Verified: with it shared, the download returns 200 with the right bytes, MIME type,
sanitised filename and `no-store`; a document requested under the wrong case still 404s.

This is the local face of the constraint the plan already records — local disk cannot go to AKS,
because pods are ephemeral and replicas share no volume. In a deployed environment `DATA_DIR` would
have to be a shared mount, which is exactly what Phase 10's move to CDAM removes the need for.

### One more page than the prototype had

The prototype's detail template linked documents to `/api/deed-polls/.../file`, which worked because
one Nest app served both the API and the pages. They are now separate apps on separate ports, so
`apps/web` has its own download route
(`pages/deed-polls/[id]/documents/[documentId]/file.ts`) rather than a cross-origin link needing an
API base URL in config. A near-duplicate of the API's, deliberately: both are thin, and the shared
domain is what makes that cheap.

### Welsh

Every page carries `en` and `cy` with matching keys, per `.claude/rules/frontend.md`, but **`cy`
holds English text** — the migration plan's decision is to build the shape and translate later. The
workspace catalogue at `templates/tech-spec-references/welsh-translations.json` is 1,148 entries of
court-listing terminology and covers none of this vocabulary, so there was nothing to draw on.
Translating later is a content change rather than a page rewrite, which is the point of the shape.

**Translation is being commissioned — Steve's call, 2026-09-03.** `yarn welsh:extract` writes
[`welsh-translation-request.csv`](welsh-translation-request.csv), which is the artefact to send:
100 strings, **68 prose strings needing translation**, plus 7 non-prose values (URLs, an email, a phone
number, `GOV.UK`, `beta`) reported separately so nobody translates a URL or silently skips the two that
do need a Welsh equivalent. `yarn welsh:check` exits non-zero while any `cy` value is still identical to
its `en`, so it can gate a release later.

**Every prose string carries a machine draft, and none of it may be pasted into `cy.ts`.**
[`welsh-draft.csv`](welsh-draft.csv) holds them with a confidence and a reviewer note each; the
extractor joins it in. The point is that a reviewer edits a draft rather than translating cold, which is
cheaper — **not** that the drafts are usable. Three reasons they are not:

1. **Mutation errors are subtle and confidently made.** The first Welsh line written into this repo read
   `"Croeso i Gweinyddu…"`; `i` triggers soft mutation, so it should be `"Croeso i Weinyddu…"` — the same
   rule as `Cymru` → `i Gymru`. Corrected, and left as the worked example of why review is not optional.
2. **Legal terminology needs an authority, not recall.** `gweithred newid enw` for "deed poll" is a
   descriptive rendering and is unverified against TermCymru or the HMCTS Welsh Language Unit. It appears
   in the list page's heading and title, so it is the most visible string in the service. Check it first.
3. **Sign-off.** HMCTS Welsh for a live service normally goes through the Welsh Language Unit or an
   approved supplier, so a draft is an input to that process rather than a substitute for it.

**Five drafts are marked `LOW` and want reading before the rest:** `Declarant` and the two `deed poll`
phrases (legal terms), `Choose a type` (a mutation I could not settle), and **`Direction` — which
collides with `Address`**, since `Cyfeiriad` is the natural Welsh for both and the upload form shows both
fields. That one needs rephrasing rather than translating.

## Phase 5 — authentication (in progress)

**Both apps now authenticate, and the header bypass is deleted from the codebase.** `apps/web` takes a
browser OIDC session; `apps/api` takes an IDAM bearer token. What is missing is a real IDAM client,
which is an external request with lead time.

### What is done

| Where | What |
|---|---|
| `libs/deed-poll/src/auth/idam-claims.ts` | `userFromClaims` — reduces an ID token's claims to the domain's `CurrentUser` |
| `apps/web/src/auth/idam.ts` | the OIDC client: discovery, PKCE, code exchange, end-session |
| `apps/web/src/auth/session.ts` | sign-in/out, single-use flow state, session-id regeneration |
| `apps/web/src/auth/require-auth.ts` | global gate with a public allowlist |
| `apps/web/src/auth/current-user.ts` | now reads the session; the header scheme is **gone from this app** |
| `apps/web/src/pages/{login,logout}.ts`, `pages/oauth2/callback.ts` | the three flow endpoints |
| `docker-compose.yml` → `idam` | `hmcts/rse-idam-simulator`, the HMCTS-standard local issuer |
| `scripts/build-idam-simulator.mjs` | builds that image; the published one is unusable, see below |
| `scripts/seed-idam-users.mjs` | creates an admin and a role-less caseworker to sign in as |
| `apps/api/src/auth/idam.ts` | the resource-server half: JWKS signature check, `iss`/`aud`/`exp`, roles from userinfo |
| `apps/api/src/auth/authenticate.ts` | global bearer gate; 401 with `WWW-Authenticate` |
| `apps/api/src/auth/current-user.ts` | now reads the caller `authenticate()` resolved, not headers |
| `libs/deed-poll/src/auth/plain-http.ts` | the one cleartext-issuer decision both apps make |
| `apps/{api,web}/helm/values.yaml` | IDAM env vars, and the two secrets that must exist before a deploy |
| ~~`libs/deed-poll/src/auth/header-user.ts`~~ | **deleted.** The `x-user-roles` bypass no longer exists anywhere |
| `apps/web/src/auth/client-credentials.ts` | `client_credentials` grant for service-to-service authentication (2026-09-02) |
| `apps/web/src/auth/test-users.ts` | programmatic test user creation via `idam-testing-support-api` (2026-09-02) |
| `apps/web/src/auth/refresh-middleware.ts` | automatic token refresh 5 minutes before expiry; refuses a refresh it cannot verify (2026-09-03) |

**Test user creation is ready to use after IDAM registration** (2026-09-02). The `createTestUser()`,
`getTestUser()`, and `deleteTestUser()` functions are implemented and tested. They authenticate using
`client_credentials` grant and call `idam-testing-support-api` to create users with password already set,
bypassing the normal email activation flow. Users auto-cleanup after 3 hours in AAT. Requires our client
ID and secret from IDAM registration, and the real role name (`caseworker-deedpoll-admin`, still
unconfirmed against real IDAM).

**Refresh cannot be exercised end to end anywhere yet.** `rse-idam-simulator` has no refresh grant, and
real IDAM has no registered client — so `refreshTokens` and `refreshMiddleware` are covered by unit
tests and mutation only. See "The refresh path required an optional ID token" in the session handover
above; it is the one part of Phase 5 whose behaviour has never been observed against a live issuer.

### Decisions worth not relitigating

- **Endpoints are discovered, not configured.** This was written without access to a real IDAM, so any
  hardcoded path would have been a guess. `openid-client`'s `discovery()` reads
  `/.well-known/openid-configuration`, so the paths come from whoever operates the issuer.
- **`openid-client`, not a hand-rolled flow.** PKCE, `state`, the code exchange and ID-token validation
  against a rotating JWKS are all easy to implement almost-correctly, and an almost-correct one accepts
  tokens it should not.
- **`requireAuth` is global with an allowlist, not per-page.** A page added tomorrow is protected by
  default rather than protected when someone remembers, and the failure mode of the alternative is
  silent. Same polarity argument as the `NODE_ENV` allowlist. **Do not invert it to a denylist.**
- **An unauthenticated POST gets 403, not a redirect.** Replaying a POST after login would resubmit a
  form the user has not seen since — for the edit tab, 46 fields they may not have intended.
- **Plain-HTTP issuers are permitted only under `NODE_ENV` development or test.** `openid-client`
  refuses cleartext by default and is right to: the code exchange carries the client secret. The
  allowlist is the same shape and for the same reason as `header-user.ts`'s. **Do not relax it to a
  negation.**
- **Unrecognised IDAM roles are dropped.** IDAM issues roles across the whole CFT estate; keeping them
  would put strings this service has no rules for into the object its authorization decisions are made
  from.

### Roles come from /o/userinfo, not the ID token

**This was wrong first time, and the cft-workspace had the answer.** The flow originally read `roles`,
`name` and the rest from the ID token's claims. CFT IDAM's ID token is thin, so against real IDAM that
would have yielded **no roles at all** — and because unrecognised roles are dropped rather than
rejected, the symptom would have been "nobody can edit privacy", not an error.

Found by reading `hmcts/rse-idam-simulator`, the HMCTS-standard local IDAM, which the workspace
manifest lists at `libs/rse-idam-simulator`. Its `JwTokenGeneratorService` puts only `sub`, `aud`,
`scope`, `realm`, `auth_level` and similar in the token; `IdamUserInfo` — the `/o/userinfo` response —
is what carries `uid`, `email`, `sub`, `name`, `given_name`, `family_name` and `roles: List<String>`.
Those field names match `userFromClaims` exactly, so only the **source** was wrong. `completeLogin` now
calls `fetchUserInfo` after the exchange, and `openid-client` checks the response's subject against the
ID token's `sub`, so a userinfo response describing someone else is refused.

**Check the simulator's source before assuming anything else about IDAM's contract.** It is the closest
thing to a specification available locally, and it also settled two other open questions: discovery
does advertise `userinfo_endpoint` and `end_session_endpoint`.

### Local IDAM is the real simulator, not something written here

There **was** a hand-written stub, `scripts/stub-idam.mjs`. It is deleted, and the reason is worth
keeping: **a stub written alongside the code it verifies can only confirm its author's assumptions.**
Mine put roles in the ID token because that is where the flow looked for them, and then passed. It
would have gone on passing until the first real login failed. Making it faithful afterwards fixes that
instance and not the class.

`docker compose up -d` now starts the simulator alongside Postgres. Two commands first, once:

    yarn idam:build      # clone if needed, build the jar in a JDK 17 container, build the image
    yarn idam:users      # create admin@example.com (deedpoll-admin) and caseworker@example.com (none)

Then sign in at `/login` and append `&login_hint=admin@example.com` to the authorize URL, or pick the
user on the simulator's own login page.

**Do not pull the published image.** `hmctsprod.azurecr.io/hmcts/rse/rse-idam-simulator:latest`
predates the commits that make an authorization-code flow possible — verified by running it:

| What | Published `:latest` | Built from master |
|---|---|---|
| `/o/token` | requires `username` (password grant), so the exchange 400s | works |
| `/o/authorize` | `Allow: POST` only, so a browser redirect 405s | GET works |
| redirect back | does not echo `state` | echoes `state` and `iss` |

Two traps in running it. Its Gradle toolchain **pins Java 17** while the devcontainer has 21, hence
building the jar inside `gradle:8.14-jdk17` rather than installing another JDK or patching the clone.
And the **port must be mapped identically** (`5556:5556`), because its discovery document advertises
its own internal port — a remapped host port yields endpoint URLs that are unreachable from outside.

There is deliberately **no compose healthcheck**: the image's base is `java:25-distroless`, which has
no shell, so a `CMD-SHELL` probe fails with "/bin/sh: no such file" forever, and a check that can never
pass would hang any future `depends_on: service_healthy`.

### Two defects found, both by running it

1. **The new-case page hardcoded `{ isAdmin: false, userName: undefined }`.** Introduced in Phase 4
   slice 2 and invisible until identity became real. It meant every case created through the form was
   attributed to the service account **and** that an admin creating a Private case silently got Normal,
   because `defaultPrivacy` was told nobody was an admin. Every other page read the user correctly;
   this was the only one.
2. **A forged `state` produced a 500.** The security check was working — `openid-client` rejected it —
   but the rejection propagated to the starter's error handler. Now a 403, with the real error logged,
   because the operator's reading of "nobody can log in" differs entirely from the user's. Same shape
   as the upload-parser defect, and the fourth instance overall.

### What the stub cannot tell us

Verified end to end against the real simulator: discovery, the redirect out, the code exchange, a
signed ID token checked against the issuer's JWKS, `state` echoed and checked, roles arriving via
`/o/userinfo`, logout, replay refusal and forged-state refusal. Specifically that an admin's
`privacy=Private` is honoured while a role-less caseworker's is **dropped and their other edits on the
same tab still save**, and that writes carry the IDAM name.

**Two things are NOT verified locally, and switching to the real simulator changed neither:
PKCE and the client secret.** `openid-client` sends a correct S256 challenge and a `client_secret`,
and `rse-idam-simulator` checks neither — it has no `code_challenge` handling at all, and
`getOpenIdToken` takes `client_secret` as a parameter and never reads it
(`IdamSimulatorController.java:237`). Both were true of the deleted stub too. So local runs prove the
client's half of each and nothing more. Real IDAM is expected to enforce both, since the workspace
standard mandates PKCE and the client is confidential — but that is an expectation, and the
registration request now asks them to confirm it. An earlier version of this file claimed PKCE was
verified end to end; it was not.

What the simulator *does* enforce, so these were verified rather than assumed: `state` is echoed and
checked, the authorization code is invalidated on exchange (`invalidateAuthCode`), so replay is
refused by the issuer and not merely by this app, and `/o/userinfo` requires a bearer token it
actually issued.

**What only real IDAM will settle**, now that the simulator has answered the rest: whether the role
string is really `deedpoll-admin`, and whether CFT IDAM's own `/o/userinfo` matches the simulator's
`IdamUserInfo` shape. Both are handled defensively, which means they **fail closed** — a wrong role
string shows up as "nobody can edit privacy", not as an error.

### How `apps/api` authenticates

A bearer token, validated with `jose` — not `openid-client`, which models a *client* and wants a
secret and redirects. `createRemoteJWKSet` is the part worth not hand-rolling: it caches keys,
refetches on an unknown `kid`, and rate-limits that refetch so a stream of bogus `kid`s cannot be
turned into a denial of service against IDAM.

`jwtVerify` checks signature, `iss`, `aud`, `exp` and `nbf` in one call, deliberately — doing them
separately is how one gets forgotten. Then two checks it does not cover:

- **`tokenName` must not say `id_token`.** An ID token carries the same `aud` and the same signature
  as an access token, so nothing above separates them, and it is not a credential for calling an API.
  Checked only when present, since nothing in OIDC requires the claim.
- **`aud` must be one of `IDAM_API_AUDIENCES`.** IDAM signs for the whole CFT estate, so a valid
  signature alone only proves "some IDAM token". Empty config refuses every request rather than
  accepting any.

**Roles come from `/o/userinfo`, per request.** Not cached, deliberately: it is authorisation data, and
the operation the admin role gates is the one worth withdrawing it for. Discovery *is* cached, because
that is metadata and caching it keeps IDAM's availability out of the path of every call.

**A caller's fault is a 401; ours is a 500.** IDAM unreachable, discovery failing, or no configured
audience are all our problems, and answering 401 would tell every caller their credentials are wrong
while hiding an outage behind a status that reads as client error. `UnauthorizedError` is new in the
domain for the 401 half.

An unknown path answers 401 rather than 404, because the gate runs before routing. That is the right way
round: which paths exist is not something an unauthenticated caller needs to learn.

### Verified against the real simulator, not only in tests

```
no token                    401 + WWW-Authenticate: Bearer
garbage token               401
x-user-roles: deedpoll-admin  401   <- the old bypass, now inert
real admin token            200, privacy=Private honoured,   createdBy "An Admin"
real caseworker token       200, privacy silently -> Normal, createdBy "A Caseworker"
unknown path, no token      401
unknown path, with token    404
```

The token came from the simulator's password grant, whose claims match what the code expects exactly:
`iss: http://localhost:5556/o`, `aud: deed-poll-admin`, `tokenName: access_token`, `sub` the email,
**and no roles** — which is why they are read from userinfo.

`idam.test.ts` signs its own tokens with a generated key pair and serves a real JWKS over HTTP, so the
refusals are exercised rather than asserted: wrong key, expired, wrong audience, wrong issuer, an ID
token, an HS256 token, no subject, a revoked token, and a userinfo response for a different subject.
That test double decides **only the cryptography**, never the contract — the contract comes from the
simulator's source. That distinction is the whole lesson of the stub that was deleted.

### The session secret was a hole big enough to make all of this decoration

`config/default.json` ships `session.secret: "session-secret"`, and nothing overrode it. The session is
what asserts a user is signed in and which roles they hold, so a signing key checked into a public
repository means anyone can mint a cookie claiming `deedpoll-admin` and never touch IDAM at all.

`assertSessionSecret` now refuses to start on the placeholder outside development and test, and
`SESSION_SECRET` is wired from the key vault. **Failing at startup rather than warning**, because there
is nothing about running that would reveal it: everything works, users log in, and the sessions are
forgeable.

### How `apps/web`'s flow is tested

**`openid-client` runs for real** in `auth/idam.test.ts`, against a discovery document served over HTTP
by the test file itself. Only `authorizationCodeGrant` and `fetchUserInfo` are stubbed, because those
two need a token endpoint that signs real tokens. So the authorization URL, the S256 challenge and the
`state` are built by the library and asserted as the library built them — a test that mocked
`openid-client` would only pin that the mock was called.

The session double models `save`, `regenerate` and `destroy` rather than stubbing them to nothing,
because the code depends on what they *do*: `regenerate` clears the session data, exactly as
`express-session` does, so `signIn` writing the user before regenerating would lose it. A double whose
`regenerate` did nothing would pass either way, which is the sort of test that costs more than it earns.

**The tests were checked by breaking the code.** Four mutations, each caught:

| Mutation | Caught by |
|---|---|
| drop `raw.startsWith("//")` from `safeReturnTo` | 2 tests — the protocol-relative open redirect |
| write the session user before `regenerate` | 3 tests — session fixation |
| read the id token after `signOut` | 1 test — logout would stop hinting which session to end |
| `userFromClaims(claims)` instead of `(info)` | 2 tests — roles back from the thin ID token |

That last one is the bug that shipped and was found by accident. It now fails a test.

The one thing deliberately **not** asserted here is that the *whole* flow works against a live issuer.
**That is asserted now, in a browser:** `e2e-tests/tests/auth.setup.ts` drives `/login` → the
simulator's form → the callback → the exchange before every authenticated journey, so a break in the
flow fails every authenticated test rather than none. See ["Phase 4
verification"](#phase-4-verification-done-2026-09-02).

### Phase 6 — config, Helm, deployment (code done)

The plan's three bullets ([`ORIGINAL_PLAN_2026-08-21.md:191`](ORIGINAL_PLAN_2026-08-21.md)) are all
closed in code. What remains is external.

**Readiness now covers the tables, not just the connection.** `missingDeedPollTables()` and
`deedPollDatabaseChecks()` are in `libs/deed-poll/src/health.ts` — shared, because both apps ask the
same question of the same schema. One `information_schema` query, and it names the missing tables,
because a health check reduces to UP/DOWN and being paged for "readiness DOWN" with no further detail
wastes most of the diagnosis. `DEED_POLL_TABLES` cannot be derived (Prisma has no runtime
introspection), so `health.test.ts` checks the list against `deed-poll.prisma` itself — **a model added
without updating that list would otherwise leave readiness passing on a database lacking its table.**

Three defects found doing it, each worse than the gap the plan named:

1. **`apps/api` had no checks at all.** `healthcheck()` bare means `checks = {}` and
   `readinessChecks = checks`, so readiness passed unconditionally: AKS would route traffic to a pod
   that could not reach Postgres.
2. **`apps/web` had its database check on liveness.** `readinessChecks` defaults to `checks`, so
   passing them as `checks` puts them on **both** — and a Postgres blip would fail liveness and have
   Kubernetes restart every web pod. Restarting cannot fix someone else's database; it turns a
   recoverable dependency outage into a rolling one. Liveness is now empty on purpose: the process
   answering at all is the signal.
3. **Every probe returned HTTP 200, DOWN or not.** `libs/cloud-native-platform` did
   `res.json(result).status(...)` — Express has already flushed by then, so the status was ignored.
   Kubernetes reads the status code and not the body, so **no probe could ever have acted on a
   failure.** Its unit tests could not see it: `status` and `json` are both `mockReturnThis()`, so the
   two calls pass in either order. Fixed, with `healthcheck-middleware.wiring.test.ts` driving a real
   request — 11 of its assertions fail if the order is put back. **This is template-library code and
   wants upstreaming with loose end 11.**

Verified by stopping Postgres against a running `apps/api`: readiness 200 → **503** → 200 on recovery,
liveness 200 throughout.

### The deployed redirect URI was wrong, and the way it was wrong is worth knowing

`apps/web/helm/values.yaml` sets `ingressHost: deed-poll-admin-web.<env>...`, which reads as
authoritative. `helm/deed-poll-admin/values.template.yaml` **overrides** it with
`${TEAM_NAME}-{{ .Release.Name }}-web.${ENVIRONMENT}...` — and `TEAM_NAME` comes from
`annotations.team` in `Chart.yaml`, while `RELEASE_NAME` is `<chart>-staging` on main and
`<chart>-pr-<n>` for a PR. So the real hostnames are:

```
AAT      deed-poll-deed-poll-admin-staging-web.aat.platform.hmcts.net
preview  deed-poll-deed-poll-admin-pr-<n>-web.preview.platform.hmcts.net
```

> **Both hostnames above are wrong, and were corrected on 2026-09-10.** `helmInstall` exports neither
> `TEAM_NAME` nor `ENVIRONMENT` to a values template, so `envsubst` emptied `${ENVIRONMENT}` and
> `TeamConfig.getName("deed-poll")` fell back to the literal `pleaseTagMe` — the render was nearer
> `pleaseTagMe-deed-poll-admin-staging-web..platform.hmcts.net`. The chart now uses the `${SERVICE_FQDN}`
> the pipeline computes, which is `deed-poll-admin-staging.aat.platform.hmcts.net` in AAT. The diagnosis in
> this entry — that the parent template overrides the subchart and that the redirect URI has to sit beside
> the `ingressHost` it must match — was right; only the resulting strings were not.

The subchart value is the one you read first and the one that never applies. An `IDAM_REDIRECT_URI`
written there — which is what the last commit did — is silently wrong in every deployed environment, and
**IDAM refuses a `redirect_uri` that does not match a registered one**, so the failure lands on IDAM's
own page after a successful login, where no request reaches our logs.

It is now set beside the `ingressHost` it has to match, in both root templates, and `assertIdamSettings`
refuses to start on a localhost or cleartext redirect URI, or an empty client secret, outside
development and test. Confirmed by rendering: `IDAM_REDIRECT_URI == https://<ingressHost>/oauth2/callback`
for both environments. The parent-overrides-subchart semantics this relies on were checked against a
throwaway local chart — the real ones cannot be rendered here, since `nodejs` and `postgresql` come from
ACR and need auth.

**Preview needs a wildcard registration** (`deed-poll-deed-poll-admin-pr-*-web.preview…`) because every
PR gets its own hostname. Without one, preview environments cannot log in at all. That is now question 2
of the registration request.

### The product code is settled, and it changed almost nothing

`deed-poll-admin`. Per [`docs/how-to/new-component/github-repo.md`](../../docs/how-to/new-component/github-repo.md)
in the workspace, an HMCTS repo is named `{product}-{component}` — so the product is `deed-poll` and this
component is `admin`, which is what every file already assumed: `annotations.team: deed-poll`, the
`hmctsprod.azurecr.io/deed-poll/…` image path, the `deed-poll-{env}` shared vault, `aadIdentityName`.
The hostnames in the IDAM request are final. Parked task 1 is closed.

Two things fall out of it:

- ~~**Key vaults are `{product}-{component}-{env}`**~~ — **wrong, corrected 2026-09-04.** The vault is
  `{product}-{env}`, so `deed-poll-aat`, and the 24-character worry this bullet used to record does not
  arise. `cnp-module-key-vault` defaults the name to `{product}-{env}` and `keyVaults: deed-poll:` in all
  four `values.yaml` files is what has to resolve it, so `keyvault.tf` deliberately does not pass `name`.
  The component appears in the *resource group* (`deed-poll-{env}-admin`), not the vault.
- **`var.component` was still the template's `expressjs`.** Not a harmless default:
  `cnp-githubactions-library/terraform-deploy` passes `env`, `product`, `subscription`,
  `aks_subscription_id`, `tenant_id`, `builtFrom` and `ci_service_principal_object_id` — and **not
  `component`**. It derives `product` from `annotations.team` in the chart and leaves `component` to its
  default, so the resource group would have been `deed-poll-aat-expressjs` and the Postgres server tagged
  the same. Now `admin`.

### Still to do in Phase 6 — all external, and none of it is code — superseded 2026-09-06

**This whole section describes the GitHub Actions path and is no longer the plan.** Items 3 onward concern
federated credentials that Jenkins does not need. Kept because it is the fullest record of what that path
required, and because items 1 and 2 are still accurate history.

Read from `infrastructure/` and the workspace's ported CNP docs, in rough dependency order. **The
summary in ["What is actually left in Phase 6"](#what-is-actually-left-in-phase-6) at the top of this
file is the current one** — this section is the detail behind it.

1. ~~**A `deed-poll-shared-infrastructure` repo.**~~ **Closed 2026-09-04** by
   [PR #64](https://github.com/hmcts/deed-poll-admin/pull/64), which creates the resource group, the Key
   Vault and the `deed-poll-{env}-mi` workload identity (`aadIdentityName` in both charts) from this
   repo's own `infrastructure/` root, via `cnp-module-key-vault`. Deliberately not a separate repo — see
   ["Why the shared infrastructure is not a separate
   repo"](#why-the-shared-infrastructure-is-not-a-separate-repo) for the reasoning and the three traps in
   the template's example.
2. **The `deed-poll` Kubernetes namespace**, which `job.helm-deploy.yml:138` deploys into and
   `helm-deploy` takes as an input. Platform-level. `platops/hmcts.github.io` and
   `platops/cnp-githubactions-library` are now cloned, but `cnp-flux-config` is not — so **which repo
   declares namespaces is still unconfirmed.** Worth asking rather than assuming; it is a one-line answer
   for anyone who has done it before.
3. **Federated credentials for GitHub Actions OIDC** — the deploy uses `azure/login@v3` with
   `id-token: write`. See [`docs/how-to/federated-credentials.md`](../../docs/how-to/federated-credentials.md).
   **PR #99 is the registration; the resulting `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` still have to be
   set as repository secrets afterwards.** Merging #99 alone will not turn the build jobs green.
4. **ACR push rights to `hmctsprod`** for `job.helm-publish.yml:38`. See
   [`docs/how-to/publishing-acr-images.md`](../../docs/how-to/publishing-acr-images.md). Same app
   registration as item 3.
5. **`idam-client-secret` in the key vault.** The chart fails on a missing secret, deliberately.
   `session-secret` is no longer on this list — `keyvault.tf` generates it with `random_password`.
6. **Path to live**, for production only: Front Door, load balancer, TLS, shutter, public DNS, OAT. See
   [`docs/how-to/path-to-live/`](../../docs/how-to/path-to-live/). Much of it may not apply — this is an
   internal caseworker service on `platform.hmcts.net`, not a public one.

The same terraform root also creates resource group `deed-poll-{env}-admin` and a Postgres flexible
server `deed-poll-{env}` holding a `deed-poll-admin` database.

### The HMCTS Way documents the Jenkins pipeline only — confirmed, not inferred

Checked directly against the source repo (`hmcts/hmcts.github.io`, cloned to
`platops/hmcts.github.io`; the workspace `docs/` are a port of it). **`cnp-githubactions-library` and
`expressjs-monorepo` appear nowhere in its `source/` tree.** Only five pages mention GitHub Actions at
all, and just one is about deployment — the federated-credentials guide below. The port is complete, so
nothing is missing locally: 10 upstream `new-component` pages, 10 ported.

**As of 2026-09-06 this section stopped being an awkward finding and became the argument that settled the
pipeline question.** The HMCTS Way documenting only Jenkins, and `cnp-githubactions-library` appearing
nowhere in it, is exactly the divergence that moving all four repos to the CNP pipeline removes. The
credentials subsections below are now historical.

So the answer to "does the HMCTS Way tell us how to build our pipeline" is **no, not this pipeline.** It
describes the Jenkins route in full — `cnp-jenkins-config`, charts published to `hmcts-charts`, Flux
reconciling a `HelmRelease`, `values.aat.template.yaml` templated with `${SERVICE_FQDN}` — and this repo
does none of that:

| Docs assume | This repo does |
|---|---|
| Jenkins job via `cnp-jenkins-config` | GitHub Actions (`.github/workflows/workflow.main.yml`) |
| charts published to `hmcts-charts` git repo | `helm push` to `oci://hmctsprod.azurecr.io/helm` (`job.helm-publish.yml:70`) |
| Flux reconciles `HelmRelease` onto the cluster | `hmcts/cnp-githubactions-library/helm-deploy@main` runs `helm upgrade` directly (`job.helm-deploy.yml:98`) |
| `values.aat.template.yaml`, `${SERVICE_FQDN}` | `values.template.yaml`, `${TEAM_NAME}` / `${ENVIRONMENT}` |

`cnp-githubactions-library` is HMCTS's own and actively maintained, so the route is real — it is just
undocumented in the HMCTS Way. **The practical consequence is that the pipeline is already built**: what
is missing is credentials and platform prerequisites, not workflow code. Worth one confirmation from
Platform Operations that GHA is a supported route for a CFT service rather than a template experiment,
because if Flux turns out to be required for production, a `cnp-flux-config` PR joins the list above.

#### The credentials the pipeline needs — historical as of 2026-09-06

**None of these is needed any more.** They are GitHub Actions secrets, and the workflows referencing them
are being deleted with the move to the Jenkins CNP pipeline. Kept as the record of what that path required.

Every secret the workflows reference, and what each is for:

| Secret | Used by | How to get it |
|---|---|---|
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` | `azure/login` for ACR in `job.helm-publish.yml:34`, `job.promote-images.yml:68`, `job.helm-deploy.yml:88` | Self-service: a PR to [`azure-github-federation-config`](https://github.com/hmcts/azure-github-federation-config), per the guide below |
| `AZURE_CREDENTIALS_CFT_PREVIEW` | `terraform-deploy` (`job.terraform.yml:95`) and preview `helm-deploy` (`job.helm-deploy.yml:103`) | Service-principal JSON — see the note on OIDC below |
| `AZURE_CREDENTIALS_CFT_AAT` | AAT `helm-deploy` (`:118`) and `job.helm-cleanup.yml:27` | as above |
| `SONAR_TOKEN` | `job.test.yml:73` | **Already exists as an organisation secret**, and the `hmcts.deed-poll-admin` SonarCloud project already exists too. Nothing to do |
| `DATABASE_URL` | `job.lint.yml:46` | **Not removable as guessed** — the lint job runs `prisma validate`, which resolves `DATABASE_URL` from Prisma config and fails without it. Confirmed against PR #47's CI; see ["PR #47 and what CI actually says"](archive/SESSION_HISTORY_2026-09-03.md#pr-47-and-what-ci-actually-says-2026-09-03) |

**The Azure ones do not exist; `SONAR_TOKEN` does.** `actions/secrets` returns `total_count: 0`, but that
is repository secrets only — `actions/organization-secrets` lists 28 available to this repo, including
`SONAR_TOKEN`. Verified 2026-09-03. Neither `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_CREDENTIALS_CFT_*` nor `DATABASE_URL` exists at either level, so every check authenticating to
Azure fails and has been failing on master too.

The federated-credentials route is **self-service and documented**:
[`docs/how-to/federated-credentials.md`](../../docs/how-to/federated-credentials.md). Add an entry to
`app-registrations.yaml` naming the subjects (`repo:hmcts/deed-poll-admin:ref:refs/heads/master`,
`repo:hmcts/deed-poll-admin:pull_request`) and the roles/scopes, then raise a PR; the terraform pipeline
creates the app registration, service principal, federated credentials and role assignments on merge.
**Cap: 20 federated credentials per app registration**, one per subject line.

#### Two long-lived credentials that do not need to exist

`cnp-githubactions-library` ships `helm-deploy-openid` and `terraform-deploy-openid` — drop-in
equivalents that authenticate by OIDC and need **no stored credentials**. This repo uses the non-OIDC
variants for both, which is why `AZURE_CREDENTIALS_CFT_AAT` and `AZURE_CREDENTIALS_CFT_PREVIEW` exist as
service-principal JSON blobs — and those two cover the most privileged operations there are here:
`terraform apply` and `helm upgrade` into AKS.

The HMCTS Way is explicit that federated credentials are "a more secure approach than storing service
principal secrets", and the repo already uses OIDC for the ACR steps, so this is inconsistent as well as
weaker. **Switching to the `-openid` actions would remove both secrets.** Not done here: it cannot be
tested without Azure access, and a broken deploy pipeline is worse than a working one with two secrets in
it. Do it as its own change, against a real environment.

- **CI has no database**, so the `ccd` schema tests skip. Unchanged by this work.

### Still to do in Phase 5

- ~~**Send the registration request.**~~ **Done 2026-09-03** — PR raised to `hmcts/idam-access-config`
  from the files staged at `/tmp/deed-poll-idam-pr/`. Config recorded in
  [`IDAM_REGISTRATION_REQUEST.md`](IDAM_REGISTRATION_REQUEST.md). Nothing else here can move until it
  is merged and deployed, but that is now IDAM's move rather than ours.
- **Put the two secrets in the vault.** `apps/web/helm/values.yaml` now names `idam-client-secret` and
  `session-secret`, and the chart fails on a missing secret — which is the right way round for both. The
  client secret's value comes from IDAM; the session secret is ours, and just needs to be random.
- ~~**`apps/web`'s flow has no unit tests.**~~ **Done.** `apps/web` 144 → 223 tests, covering
  `login.ts`, `logout.ts`, `oauth2/callback.ts`, `auth/idam.ts`, `auth/session.ts` and
  `auth/current-user.ts`. See below for how, which matters more than the count.

## Phase 4 verification (done 2026-09-02)

**The two journeys and the accessibility pass are done, and the whole suite is green — in parallel, and
against the built assets rather than Vite's dev middleware, which is the mode `webServer` actually
uses.** Counts are in the generated dashboard above, not here. Welsh content is the only part of the
plan's Phase 4 verification line still outstanding — see below.

| File | What |
|---|---|
| `e2e-tests/tests/deed-polls.spec.ts` | the two journeys, with axe and validation checked inline |
| `e2e-tests/tests/idam-session.ts` | `signInAsAdmin`, the storage-state path, the deployed-stack guard |
| `e2e-tests/tests/auth.setup.ts` | Playwright `setup` project: signs in once, saves the session |
| `e2e-tests/playwright.config.ts` | the `setup` project and chromium's dependency on it |
| `e2e-tests/tests/onboarding-happy-path.spec.ts` | signs in; it had been broken since Phase 5 (below) |
| `apps/web/package.json` | `dev:nowatch` now sets `NODE_ENV`; it could not boot (below) |
| `.gitignore` | `.auth/` — the saved session is a live cookie, so a credential |

**Two tests, not twelve.** `.claude/rules/e2e-testing.md` is explicit that accessibility, validation
and Welsh belong *inside* a journey rather than in tests of their own, so they are. The journeys are
the two the plan named:

1. **create → detail → edit a tab → save.** Includes the empty-Date-Received refusal (the request that
   was a 500 until slice 1), and the signature-date pair rule, asserted as a re-render that keeps the
   submitted value rather than a redirect that discards it.
2. **add a note → amend → delete.** Includes the empty-note and over-2000-character refusals, and that
   the over-length one comes back **with the text still in the textarea** — the specific behaviour
   Phase 4 changed from the prototype's `?error=` redirect, and the one a regression would silently
   undo.

Two assertions are worth keeping for what they prove rather than what they check:

- **`Created By` is the signed-in caseworker, not the service account.** The new-case page hardcoded
  `userName: undefined` until Phase 5, and nothing but a real login could have caught it. Now a test
  would. The author is api's since the DAL cutover — derived from the token the page forwards, never
  sent as a parameter — so the assertion also proves the token travels. Against the mock it reads the
  token's `sub`, an email, because the mock has no IDAM to resolve "An Admin" from; against api it
  reads the IDAM display name.
- **The state after saving both signature dates is Awaiting *Enrolment*, not Awaiting Signature.** The
  cascade tests received before requested — the source workflow's ordering, preserved deliberately —
  so this pins the precedence where a caseworker would actually see it. It also proves the save reached
  the database, since state is derived and never supplied.

### Accessibility: clean, with no exclusions

Every deed-poll page passes `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` at six points across five
pages, including both error states. **`homepage.spec.ts` and the onboarding spec both exclude
`.govuk-footer__link` and `.language` as known template issues; the deed-poll spec excludes nothing,
and was checked with the exclusions removed rather than assumed.** Both selectors are in the shared
layout these pages also render, so carrying the exclusions over would have suppressed findings that do
not exist and hidden any that appeared later. Do not add one back without evidence.

That converts the expectation recorded here previously — "built from GOV.UK components, so it should
largely pass" — into a measurement.

### Three defects, all found by running the suite rather than by writing it

**The pattern from Phase 3 held: none of the three was visible to unit tests, and the first two meant
the e2e suite could not run at all.** It never had, because CI only runs it post-deploy and nothing has
deployed.

1. **`apps/web`'s `dev:nowatch` could not boot** — and it is the exact command Playwright's `webServer`
   runs. It sets `VITE_MIDDLEWARE=false` but not `NODE_ENV`, which `dev` beside it does. With
   `NODE_ENV` unset, `plainHttpPermitted()` is false and `assertSessionSecret` refuses to start on the
   placeholder secret, exactly as designed. So Phase 5's startup guards were correct and the script was
   the thing that was wrong. Every spec would have failed on a `webServer` timeout, which reads as a
   Playwright problem rather than a missing environment variable. Fixed by matching `dev`:
   `NODE_ENV=development DATA_DIR=../../data`.

2. **The four onboarding tests were redirecting to `/login`.** `requireAuth` is global and
   `/onboarding` is not on the public allowlist, so Phase 5 broke template tests that nobody ran.
   **Fixed by signing in, not by opening the paths up:** an internal caseworker service sitting behind
   login is the intended behaviour, and onboarding is not special. Adding it to `PUBLIC_PATHS` would
   have made the test pass by weakening the thing it should be protected by.

3. **One `storageState` file means one server-side session, shared by every test that restores it.**
   The onboarding form keeps its answers *in* the session, so under `fullyParallel` the four tests
   overwrote each other and the summary page showed whichever name landed last. Serial passed, parallel
   failed — the worst shape of flake, because the fix that hides it (`--workers=1`) also hides the next
   one. So the onboarding spec calls `signInAsAdmin` per test for a session of its own, while the
   deed-poll journeys share the saved state, which is safe because they only *read* the signed-in user.
   **Any future journey that writes to the session must sign in for itself**; the rule is recorded in
   `idam-session.ts` beside the constant.

### The session is obtained from the real IDAM, not fabricated

`auth.setup.ts` drives the whole authorization-code flow against `hmcts/rse-idam-simulator` — `/login`,
the simulator's own form, the callback, the exchange — and saves the resulting session. **Nothing mints
a cookie or short-circuits the gate.** A test-only bypass would be the very thing Phase 5 deleted from
the application, and it would let the login flow break with the suite still green, which is precisely
what the deleted hand-written stub did.

Two consequences worth knowing:

- **`yarn idam:build` and `yarn idam:users` are prerequisites for the suite**, not just for manual
  poking. Both are one-off. Without the accounts the simulator answers 401.
- **The simulator's login form has a `<label>` with no `for`**, so the setup uses `#username` /
  `#password` rather than `getByLabel`. Its markup is not ours to fix, and there is nothing for a
  role- or label-based locator to bind to. Do not "correct" it.

### The journeys skip against a deployed environment, deliberately

`job.e2e-test.yml` runs the suite against a **deployed** URL, not a local stack — so in CI the issuer is
real CFT IDAM, where **there is no registered client and no test account yet**. The auth-dependent tests therefore skip when `EXPRESSJS_MONOREPO_TEMPLATE_WEB_URL` or `TEST_URL` is set,
with a reason naming the registration request. Verified: 7 skipped, 16 passed, and no ENOENT on the
missing storage state, which is the failure mode a naive guard would have produced.

**This is the one place the IDAM registration now blocks a test rather than only a deploy.** When the
client and a test account exist, the guard becomes "use these credentials in a deployed environment"
rather than "skip".

### Still outstanding under Phase 4

1. **Welsh content.** Every page carries `en` and `cy` with matching keys and `cy` holds English, by the
   migration plan's decision. The journeys now load a page under `?lng=cy` and assert its heading and a
   link still render, which catches a **missing** `cy` key — that renders blank rather than erroring —
   but there is nothing Welsh to assert until there is a translation. Still a content change rather
   than a page rewrite, which was the point of building the shape.
2. **`power_app_nest/` is not deleted**, by decision. See the note at the top of this file.

Not done and not proposed: the upload journey. It writes a blob to `DATA_DIR`, which cannot work in a
deployed environment at all (local disk cannot go to AKS), so an e2e test of it would pin behaviour that
Phase 10's move to CDAM removes. The upload paths are covered by unit tests and were verified live end
to end — see Phase 3 slice 4.

## Loose ends

Small, real, and deliberately not done. None blocks Phase 3.

1. **Upstream the async-handler wrap into the template, once Phase 3's handlers exist.** The error
   mapping depends on Express 5 forwarding a rejected handler promise to error middleware.
   `normalizeHandlers` in `@hmcts-cft/simple-router` is the natural chokepoint to guarantee it
   instead of relying on framework behaviour — it is currently just
   `Array.isArray(x) ? x : [x]`, and upstream's copy at `hmcts/expressjs-monorepo-template` is
   byte-identical, so a patch applies cleanly.

   **Do not patch it locally.** `libs/simple-router` is template-provided (`@hmcts-cft/` scope,
   arrived wholesale in the re-scaffold `82e8b0d`). This repo was re-scaffolded on 2026-08-21 and
   will be again; a local patch would either be silently dropped or land as a conflict. Contribute it
   upstream so every service on the template benefits. Deferred until the 29 handlers are written,
   because they are the argument for the change.

   One trap for whoever writes it: **Express distinguishes error middleware by `fn.length`**, so a
   naive variadic wrapper (arity 0) would silently reclassify every 4-arg error handler as a normal
   one. `simple-router` already arity-checks (`>= 2 && <= 4`) for this reason. The wrapper must
   declare parameters explicitly and branch on the original's arity.

   The risk this mitigates is currently low: `apps/api` and `apps/web` pin `express` **exactly** at
   `5.2.1`, so the behaviour cannot drift away via semver or a lockfile refresh — it needs a
   deliberate major bump, which `errors.wiring.test.ts` would fail on. That is the intended signal.

2. **`libs/deed-poll/package.json` declares `"tsx": "*"` and `"vitest": "*"`.** Wildcards, which
   `CLAUDE.md` forbids ("Pinned dependencies: specific versions only"). Pre-existing on this branch,
   unrelated to any of the above. Root pins `vitest` at `4.1.10`; match it.

3. **Prisma query logging is now live under `yarn dev`.** Setting `NODE_ENV=development` revived
   `libs/postgres-prisma/src/index.ts:34`, which had never fired. If it proves noisy that line is the
   place to look, and `CLAUDE.md`'s `DEBUG=prisma:query` suggestion is now redundant rather than
   necessary.

4. ~~**`power_app_nest/` is untracked but *not* ignored on master.**~~ **Closed 2026-09-03**, by
   [PR #43](https://github.com/hmcts/deed-poll-admin/pull/43). It turned out to be **five** paths rather
   than one, and three were live rather than theoretical — `git status` on master listed
   `power_app_nest/`, `data/` and `e2e-tests/.auth/` as untracked, so `git add -A` would have staged
   ~500M of `node_modules`, real case-document blobs, **and a live session cookie**. `.env` (the
   template covered only `.env.local` and `.env.*.local`) and `.DS_Store` went too.

   Verified rather than assumed: no tracked file becomes ignored
   (`git ls-files | git check-ignore --stdin` is empty), nothing tracked has a `data/` component, and
   `.env.example` / `.env.sample` are still not ignored by the bare `.env` entry. The proof it worked is
   that `git status` on master is now clean where it previously listed three paths.

   The comments on master were written to be true *of master* rather than copied from here — this
   branch's text names `file-storage.ts`, `DATA_DIR` and the Phase 4 form, none of which exist there.
   Merging master produced the expected `.gitignore` conflict and this branch's fuller text was kept,
   since it is the accurate one in the merged tree.

5. ~~**Nothing restricts who can delete a case, and the delete cascades.**~~ **Answered 2026-09-04, and
   the exposure is closed by a different route than the one this note proposed.**

   **The decision** (Steve's): removing a case is a lifecycle question, not a REST verb. A caseworker
   **withdraws or closes** a case — a CCD event and a state transition, audited in `ccd.case_event`,
   removing nothing. **Hard delete becomes admin-only and narrow**, for data-protection erasure requests
   where removal is a legal obligation. Routine disposal is CCD's job via its authoritative
   `resolvedTTL`, and `retainPermanently` is the flag that opts a case out — which is what it was always
   for. Specified in [`DEED_POLL_API_PLAN.md`](DEED_POLL_API_PLAN.md) as **new scope, not a port**:
   an event, a UI control and a guarded admin route.

   **The exposure is gone meanwhile**, without the one-line guard this note suggested: `api.enabled` is
   now `false` in both Helm value templates, so `apps/api` is not deployed at all. It had no consumer —
   `apps/web` imports `libs/deed-poll` in-process — and it is slated for replacement. Nothing was ever
   exposed in practice either, since `Deploy to AAT` has never run.

   Kept for two things worth not relosing. **The cascade is confirmed, not assumed:** deleting a case
   with a note left zero rows in `deedpoll_notes`, checked directly against Postgres — so the admin
   hard-delete path must treat that as deliberate and test it. And the note's own framing was wrong in
   one respect: it described the route as reachable by "one unauthenticated request", which stopped
   being true once Phase 5 mounted `authenticate()` globally in `apps/api`. It was unguarded, not
   unauthenticated.

6. **A create can never succeed without `dateReceived`, but the schema calls it optional.**
   `createDeedPollSchema` marks every field optional on the stated grounds that a case is logged
   incrementally — yet `allocateForCreate` cannot derive a reference-number year without
   `dateReceived`, so a create omitting it now fails with a 400 (see slice 1). That is honest, but
   the constraint is discovered a transaction late rather than declared. Making `dateReceived`
   required on `createDeedPollSchema` — and only there, leaving the update schema partial — would
   surface it at parse time and make the API self-documenting. Not done unasked: it changes a schema
   the conformance harness and the Phase 4 forms both read, so it wants a deliberate look rather than
   being smuggled in with a route port.

7. ~~**A child list under a non-existent case answers `[]` with 200, not 404.**~~ **Fixed
   2026-09-01** — see "Child lists 404 for a missing parent" under Phase 3 slice 2.

8. ~~**Two Biome warnings in `apps/postgres/health-server.mjs`**~~ **Fixed 2026-09-01.** The unused
   parameter was `err`, in a handler that discarded it — so a proxy failure gave a 502 with nothing
   on stdout. It is logged now, whole rather than as `err.message`, which is empty for the
   ECONNREFUSED `AggregateError` this raises in practice. `req` is positional and became `_req`.
   Note the file is **template-provided** (arrived in the re-scaffold `82e8b0d`, its only commit), so
   a re-scaffold will reintroduce both warnings — see item 11.

11. **Contribute the `health-server.mjs` fix upstream**, for the same reason as item 1: the file came
    wholesale from `hmcts/expressjs-monorepo-template` and this repo will be re-scaffolded again, so
    the local fix will either be dropped or land as a conflict. Small enough to carry either way, but
    every service on the template has the same silent-failure handler. The template is not cloned in
    this workspace, so the local copy could not be diffed against upstream to confirm it has not
    already diverged.

12. ~~**`libs/onboarding` is the only workspace that does not run `biome check`.**~~ **Done** in
    `bb5d341`. The reason it stopped being deferrable: `biome lint src/` skips the `organizeImports`
    assist, so nine files were warnings to the root `biome check .` and clean to `yarn lint` — and any
    `biome check --write` at the root silently restaged them into whatever commit was open. They turned
    up inside the API authentication commit that way and had to be split back out. The churn the
    original note was avoiding is real but one-off; being restaged at random was not.

9. **The 10 MB upload limit is a guess.** `MAX_BYTES` in `apps/api/src/documents/upload.ts`. There
   was no existing limit in the repo or the prototype to inherit, and it was chosen for scanned
   certificates and multi-page PDFs. **Confirm against real file sizes with the service team**, and
   remember the file is buffered in memory, so the ceiling is really 10 MB × concurrent uploads
   against the pod's memory limit.

16. **The shared `pg.Pool` has no size limit and will stall when exhausted** (found 2026-09-02).

    **Read this first if a test hangs: on 2026-09-03 this was blamed for an e2e hang and was measured
    innocent.** The symptom matched the description below exactly — a deterministic hang inside a
    function performing a second concurrent login — so the pool was the obvious suspect. Polling
    `pg_stat_activity` while the test hung showed connections peaking at **3** against the default max
    of 10. The real cause was `browser.newContext()` inheriting the file's `storageState`, so the
    "anonymous" context was already signed in and waited forever for a login form that never rendered
    (`fc6e40c`). The pool defect below is still real and still unfixed; it was simply not this. **A
    plausible recorded cause is not evidence — measure before acting on it.**

    The pool
    backing Prisma and the session store is created in `libs/postgres-prisma` with **no `max`**, so
    `node-postgres` defaults to 10. OIDC login is several round trips on that pool — token exchange,
    userinfo, session writes — and under load (7 Playwright workers × concurrent logins) the pool drains
    and `pool.connect()` queues forever with no timeout. The symptom was a 30-second test hang on
    `/oauth2/callback`, which read as a broken login rather than pool exhaustion. Playwright's default
    test timeout rescued it, but in production a `/oauth2/callback` that never responds would wedge the
    session and leave the user hung. **Not fixed here** — it is a real defect but its scope is wider than
    e2e tests (every route handler reaching Prisma or the session store is affected), and any interim fix
    risks diverging from what the template should eventually ship. The right action is upstreaming a
    sensible pool config to `hmcts/expressjs-monorepo-template` — checked size, connection timeout, idle
    timeout — for the same reason as items 1, 11 and 15. The e2e suite mitigates by keeping logins to a
    minimum: the setup project signs in once, most tests share that session, and the one journey that
    needed its own session (the Welsh check, because `localeMiddleware` writes `req.session.locale`) now
    creates a throwaway context rather than signing in per test. That keeps the concurrent logins under
    the threshold that stalls the pool — a workaround, not a fix. Future: make `max` and
    `connectionTimeoutMillis` explicit in `libs/postgres-prisma/src/index.ts` when upstreaming the change.

15. **Every page is titled "Express Monorepo Template", and the header names no service at all.** Found
    while checking what actually pointed at `/` (2026-09-02). Two separate faults that look like one:

    - **`apps/web/src/locales/en.ts` sets `serviceName: "Express Monorepo Template"`** — a re-scaffold
      leftover. It still reaches `page-title.njk` (`{{ title }} - {{ serviceName }} - {{ govUk }}`), so
      **every page in the service is titled `<page> - Express Monorepo Template - GOV.UK`**, verified in
      the rendered HTML. User-visible, in the browser tab and in every bookmark. A one-value fix, but
      **the value is a content decision** — what this is called to the people using it, plus the Welsh —
      so it wants asking rather than defaulting to the repo name.
    - **`govukHeader` ignores `serviceName` and `serviceUrl` in govuk-frontend 6.** The starter's
      `site-header.njk` passes both; the installed 6.2.0 header template mentions neither, because v6
      moved them to `govukServiceNavigation`. So no service-name link renders, and the header is bare but
      for the crown. Fixing it means switching the starter to `govukServiceNavigation` — and
      `libs/express-govuk-starter` is **template-provided**, so this wants upstreaming for the same
      reason as items 1 and 11 rather than patching locally, and it affects every service on the
      template. Note axe cannot catch either fault: a title of "Express Monorepo Template - GOV.UK" is
      present and non-empty, which is all `document-title` checks.

14. **The case list has no pagination.** Steve's, 2026-09-02, for the backlog. `findDeedPolls` selects
    every case matching the filter and `index.njk` renders all of them into one `govukTable` — fine at
    the ~40 rows a dev database holds, and not fine at the volume a live deed-poll caseload reaches.
    Note the shape of the work is more than a `LIMIT`: the filter tabs would need to carry the page
    through, the count is needed for the pager, and **there is no sort control**, so "page 2" is only
    meaningful once the order is explicit — `findDeedPolls`'s current order is whatever it is rather
    than something the page states. `.claude/rules/backend.md`'s own performance note asks for
    pagination on list endpoints, so `GET /deed-polls` in `apps/api` wants the same treatment and the
    two should agree on the parameter names. Worth doing together, and worth asking the service team
    what a caseworker actually sorts and filters by before designing it.

13. **`e2e-tests` is not covered by `yarn lint`, and 6 of its files fail `biome check`.** Exactly the
    shape of item 12: the workspace has no `lint` script, so `turbo lint`'s 11 tasks skip it entirely,
    while a root `biome check .` reports 9 errors — all pre-existing template formatting (single quotes,
    where the repo is configured for double). **Which means a root `biome check --write` will silently
    restage them into whatever commit is open**, which is the specific accident item 12 was closed to
    stop. The three files added by the Phase 4 verification are written to conform and lint clean; the
    template's were left alone deliberately, so the formatting churn does not land inside a change about
    tests. Fixing it is: add `"lint": "biome check ."` to `e2e-tests/package.json` and format the five
    template files, as its own commit.

10. **Upload type-checking is by declared MIME type only.** `ALLOWED_MIME_TYPES` reads the
    `Content-Type` the client puts on the multipart part, which a client can lie about. It stops
    accidents, not attacks, and there is no virus scanning. Real inspection arrives with CDAM in
    Phase 10; until then uploads are local-development only anyway, since local disk cannot go to AKS.

## Branch state

**Merged. There is no migration branch.** `feat/deed-poll-migration` landed on master as
[PR #47](https://github.com/hmcts/deed-poll-admin/pull/47) on 2026-09-04 at 06:14 (`953e1ac`) — 292
files, +25,768 lines. Master is the working line; work from it directly.

The earlier decision recorded here was to keep the branch open rather than raise a PR, on the grounds
that a PR would sit open for weeks. That held until the branch was code-complete, at which point the
divergence cost more than the review it was buying — which is Steve's stated reason for merging it as
one PR rather than slicing it. See `WAYS_OF_WORKING.md`.

The diff was scanned for secrets before it was ever published — no `.env`, keys or credential-shaped
strings. The only hits were the template's `SESSION_SECRET` placeholder and Helm `secretRef` names,
which are references, not values.

**Master is unprotected, deliberately** — Steve's call on 2026-09-04, for speed during development, with
protections to be added once the migration is finished. The reason that is now a defensible trade rather
than a risk is [PR #63](https://github.com/hmcts/deed-poll-admin/pull/63): with majors excluded from
automerge, the blast radius of no required checks is patch and minor bumps only.

## Repository visibility, and the history secret scan (2026-09-03)

**`deed-poll-admin` is `internal`. Every comparable HMCTS service repo is `public`** — checked:
`expressjs-monorepo-template`, `cath-service`, `pcs-api`, `rpx-xui-webapp`. That asymmetry is the root
cause of the `osv-scan` failure rather than a missing setting, and it may simply be a default nobody
revisited.

**Code Security cannot be enabled on this repository.** It is `disabled`, and the API refuses to change
it even for a repo admin:

```
422 An enterprise policy prevented modifying Code Security enablement.
    Contact your enterprise owner for details.
```

Public repos get code scanning free, which is why the peer repos need no licence and show no such
setting. So the options are: make the repository public, request enterprise enablement (a paid seat that
no peer service needed), or stop uploading SARIF. The third was taken as an interim — see
`.github/workflows/job.osv-scanner.yml`, which explains itself and says to revert once the entitlement
exists. **`--fail-on-severity=HIGH` still gates merges**, so the scan's value is intact; what is lost is
the security-tab alert list, which was unusable anyway.

### The history was scanned before recommending anything about visibility

Going public exposes history, not just current code — and an inherited branch was named
`fix/remove_localhost_private_key_from_vcs`, which was reason enough to look properly. Earlier secret
checks in this file covered only the **branch diff**; this covered every blob.

**Scope:** 5,803 objects — everything reachable from all refs, plus all 47 deleted orphan branches from
[`DELETED_BRANCHES.md`](DELETED_BRANCHES.md). Those matter because **their objects are still on GitHub**:
`git fetch origin <sha>` for a deleted branch's commit still succeeds, so a visibility change exposes
them by SHA even though no ref points at them. 4,549 blobs were content-scanned for private-key blocks,
AWS access key ids, Azure `AccountKey=`, GitHub tokens, Slack tokens and JWTs.

**Result — two hits, and the important one is not in current history:**

| Finding | Where | Assessment |
|---|---|---|
| A real 1,679-byte **`BEGIN RSA PRIVATE KEY`** at `src/main/resources/localhost-ssl/localhost.key` | **15 of the 47 deleted orphan branches.** *Not* reachable from `master` or `feat/deed-poll-migration` | The key the deleted branch was named after. The `src/main/resources` path is a Java layout, so it predates the expressjs template entirely — inherited ancestry, never this service's. A localhost dev TLS key, so low value to an attacker, but it is a real private key and would become publicly retrievable |
| `-----BEGIN RSA PRIVATE KEY-----` in `.yarn/unplugged/…/node-gyp/test/fixtures/certs.js` | Deleted orphan branches only | **Not a secret.** node-gyp's own published test fixture, shipped in the public npm package. Also not in current history |

**No AWS keys, no Azure account keys, no GitHub or Slack tokens, no JWTs anywhere.**

**So: current history is clean.** The blocker on going public is not this service's code — it is the
inherited orphan objects. Two ways to clear it, both needing someone with more than repo admin:

1. **Ask GitHub Support to garbage-collect unreachable objects** on the repository, which is the
   documented route after removing secrets from history. The refs are already deleted, so nothing else is
   needed first.
2. **Decide the localhost key does not matter** — a self-signed key for `localhost` grants an attacker
   nothing on any HMCTS system. Defensible, and probably true, but it should be an explicit decision
   recorded here rather than an omission, because "there is a private key in the public history" is a
   sentence that will be asked about later.

Either way, **do not treat the earlier "diff was scanned for secrets" note as covering this.** It did
not; this section does.

## Dependency alerts on master

**3 open, verified 2026-09-04** — down from 28, because merging PR #47 replaced master's lockfile with
the migration branch's. Composition: 2 high, 1 medium.

**All three trace to one root, and none is fixable today:**

```
prisma@7.10.0 → mysql2@3.15.3            (pinned exact)   2 alerts
             → @prisma/config@7.10.0 → deepmerge-ts@7.1.5 (pinned exact)   1 alert
```

`prisma@7.10.0` is the newest stable release; everything above it is the `8.0.0-rc` line. Prisma 8 does
drop both packages from its dependency tree, so the alerts die when it ships — **but do not put a release
candidate on master to clear three alerts.** Worth noting `mysql2` is dead weight regardless: it is the
Prisma CLI's bundled MySQL driver and this service is Postgres.

**Do not raise a Renovate PR for these.** `prisma` is pinned exactly at `7.10.0` in
`libs/postgres-prisma` and `apps/postgres`, and [#52](https://github.com/hmcts/deed-poll-admin/pull/52)
was autoclosed when #58 made the same bump. There is nothing to bump to.

The history — how the count went 82 → 97 → 20 → 28 → 3, and a confident wrong explanation that had to be
retracted — is in [`archive/DEPENDENCY_ALERTS_HISTORY.md`](archive/DEPENDENCY_ALERTS_HISTORY.md). Read it
before writing any explanation of an alert count in this repo: the lesson is that a plausible mechanism
is not evidence, and the numbers are one `gh api` call away from being checked.
