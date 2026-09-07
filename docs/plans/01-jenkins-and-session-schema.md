# Plan: Move to the Jenkins CNP pipeline, and give sessions their own schema

## Overview

Two unrelated-looking changes that belong together because both are prerequisites for this service ever
deploying:

1. **Pipeline.** This repo moves from `cnp-githubactions-library` to the Jenkins CNP pipeline, and its
   Terraform moves out to `hmcts/deed-poll-infra`. `.github/workflows/` is deleted entirely.
2. **Sessions.** The session table moves from `public` into its own `session` schema, so that
   `deed-poll-api`'s Flyway can own `public` without meeting a table it did not create.

Small in code terms — five tasks, none of them large. The care is in the ordering, because one of them
turns CI red if it lands on its own.

### Source material — read these, do not re-derive them

| What | Where |
|---|---|
| Target state, five decisions and the reasoning | `.business_context/DEED_POLL_INFRA_PLAN.md` |
| Why the session table moves rather than going to Redis | same file, Decision 3 — the comparison table is the short version |
| What is being deleted and why, in this repo specifically | same file, the `deed-poll-admin` section of "The file-by-file target state" |
| The shared root this repo's vault now comes from | `../deed-poll-infra/` and its `docs/plans/01-jenkins-and-shared-split.md` |
| Working `withPipeline` examples | `../apps/pcs/pcs-api/Jenkinsfile_CNP`, `../apps/pt/pt-api/` |
| The session store's own options | `libs/express-session-postgres/src/postgres-store.ts` — it already takes `schemaName` and `tableName` |

### Architecture decisions already taken — implement these, do not revisit

1. **Sessions stay in Postgres.** Redis was considered and rejected: this is a low-volume internal
   service, `PostgresStore` already supports a custom schema, and Redis would have meant porting a lib,
   swapping the store, re-pointing readiness and adding a secret. Do not introduce
   `@hmcts-cft/express-session-redis` here. `deed-poll-web` uses Redis; this repo does not.
2. **This repo owns no Terraform.** The resource group, Key Vault, App Insights, Redis and Postgres all
   live in `deed-poll-infra`. Do not recreate an `infrastructure/` directory.
3. **All GitHub Actions go**, not just the deploy-side ones. The CNP Jenkins pipeline covers build, test,
   Sonar and dependency scanning. CodeQL has no Jenkins equivalent and losing it is accepted.
4. **Vault secret names are per component** where sharing would be unsafe: `admin-session-secret`,
   `admin-idam-client-secret`, and `app-insights-connection-string` replacing
   `ExpressJsAppInsightsConnectionString`. `postgres-url` is unchanged — one shared database.
5. **The aliases stay the same.** `SESSION_SECRET`, `IDAM_CLIENT_SECRET`,
   `APPLICATION_INSIGHTS_CONNECTION_STRING`, `DATABASE_URL`. Only the vault-side names change, so no
   application code reads a different environment variable.

### Constraints

- **Task 4 must be a single commit.** `detect-infra-changes` gates on `^infrastructure/`, and the commit
  that deletes that directory matches the pattern — so deleting it without also deleting the workflows
  fires the Terraform stage against a directory that no longer exists. One commit, both deletions.
- **Do not renumber or reorder tasks 1 and 2.** The migration creates the schema; the app then points at
  it. Reversed, local startup fails on `CREATE TABLE IF NOT EXISTS session.session` in a schema that does
  not exist.
- Run `docker compose up -d` before anything that touches the database. Postgres and
  `rse-idam-simulator` both come from it, and **do not assume it is already running** — a previous
  handover said it was when it was not.
- No secret values in this repo. `admin-idam-client-secret` comes from IDAM by hand and does not exist yet.

## Validation Commands
- `yarn lint`
- `yarn build`
- `yarn test`

> All three, every task. `yarn test` runs vitest, which transpiles without type-checking — it passes on
> code `yarn build` rejects. A previous handover here claimed 250 green tests on a tree with six type
> errors, one of which silently gave every session a one-hour token lifetime.
>
> `yarn test:e2e` is deliberately **not** a validation command. Playwright's `webServer` shells out to
> `yarn dev:nowatch`, which resolves to Corepack and dies without a `yarn` shim on `PATH`. That makes it
> environment-dependent in a way that would have the loop fighting the harness rather than the task. Run
> it by hand once at the end — see the success criteria.

### Task 1: Add a migration creating the `session` schema

`PostgresStore` issues `CREATE TABLE IF NOT EXISTS %I.%I` and creates its own table, but **it does not
create the schema**. Something has to, or startup fails once Task 2 lands.

A Prisma migration is the right home: it runs wherever migrations run, and it survives the
`deed-poll-api` cutover untouched, because api's Flyway owns `public` and `ccd` and has no reason to look
at this one.

- [ ] Add a new timestamped migration directory under `apps/postgres/prisma/migrations/`, following the naming of the existing `20260821194029_add_deed_poll_case_model`, containing `migration.sql` with `CREATE SCHEMA IF NOT EXISTS "session";`
- [ ] Do **not** add the schema to `schema.prisma`'s datasource or enable the multi-schema preview feature. Prisma does not need to model this schema — the session store owns everything in it
- [ ] Run `docker compose up -d`, then `yarn db:migrate`, and confirm the schema exists: `select schema_name from information_schema.schemata where schema_name = 'session'`
- [ ] Check for drift, because this is the one thing this approach can go wrong on: run Prisma's migrate status against the migrated database and confirm it does not report the new schema as drift. If it does, record what it says in this task rather than working around it — the fallback is `prisma db execute` outside the migration history, and that is a decision, not a fix
- [ ] Mark completed

### Task 2: Point the session store at the `session` schema

- [ ] In `apps/web/src/app.ts`, add `storeOptions: { schemaName: "session" }` to the `expressSessionPostgres(...)` call at line 40, alongside the existing `pgConnection` and `sessionOptions`
- [ ] Leave `tableName` at its default of `session`, so the table is `session.session`
- [ ] Update or add tests asserting the store is constructed with that schema. `libs/express-session-postgres/src/postgres-store.test.ts` already covers the store's own behaviour — what is worth pinning here is that **this app** passes the option, because the default is `public` and a silent regression to it would only show up as an api Flyway conflict months later
- [ ] Start the app and sign in, confirming the session lands in `session.session` and that `public` gains no session table
- [ ] Leave `deedPollDatabaseChecks()` alone. Re-pointing readiness is `deed-poll-api` cutover work, recorded in `DEED_POLL_API_PLAN.md`, not this plan
- [ ] Mark completed

### Task 3: Rename the vault secrets in all four charts

Four `values.yaml` files carry a `keyVaults: deed-poll:` block: `apps/web`, `apps/api`, `apps/crons` and
`apps/postgres`. Not all four reference every secret — read each rather than assuming.

- [ ] `ExpressJsAppInsightsConnectionString` → `app-insights-connection-string` in every file that references it. The old name came from the expressjs template, and `deed-poll-api` is Spring Boot and reads the same secret
- [ ] `session-secret` → `admin-session-secret`
- [ ] `idam-client-secret` → `admin-idam-client-secret`
- [ ] Leave `postgres-url` unchanged — one shared database, one unprefixed name
- [ ] Keep every `alias` exactly as it is. The application reads `SESSION_SECRET`, `IDAM_CLIENT_SECRET`, `APPLICATION_INSIGHTS_CONNECTION_STRING` and `DATABASE_URL`, and none of those changes
- [ ] Keep the comments explaining that the chart fails on a missing secret and that `idam-client-secret` cannot exist until IDAM replies — update the name in that comment too
- [ ] Grep the whole repo for the three old names, including `helm/deed-poll-admin/values*.template.yaml`, and confirm none survives
- [ ] Mark completed

### Task 4: Delete `infrastructure/` and `.github/workflows/` — one commit

**These two deletions must land together.** `detect-infra-changes` gates on `^infrastructure/`, so the
deleting commit matches its own pattern, fires the Terraform stage, and fails against a missing directory.
Deleting the workflows in the same commit means there is no stage left to fire.

`infrastructure/` is already deleted from the working tree and staged nowhere — its eight files now live in
`hmcts/deed-poll-infra` at `0a61b9c`, byte-for-byte.

- [ ] Delete `infrastructure/` in full, if anything remains of it
- [ ] Delete `.github/workflows/` in full — `workflow.main.yml`, `workflow.preview.yml`, every `stage.*` and every `job.*`, and the `jobs/` documentation directory
- [ ] **Keep `.github/renovate.json`.** It is configuration, not a workflow, and it carries three fixes that took a session to find: the Travis manager removed, the Dockerfile regex corrected from `FROM node:` to the ACR-qualified image, and `regexManagers` migrated to `customManagers` with the `matchManagers` reference moved with it
- [ ] Keep anything else under `.github/` that is not a workflow — issue templates, `CODEOWNERS`, `dependabot.yml` if present
- [ ] Commit both deletions together, with a message recording why they are one commit
- [ ] Mark completed

### Task 5: Add `Jenkinsfile_CNP`

The umbrella chart is `helm/deed-poll-admin/` and its `Chart.yaml` declares `annotations.team: deed-poll`,
so product `deed-poll` and component `admin` line up with the CNP convention of
`helm/{product}-{component}` without renaming anything.

- [ ] Add `Jenkinsfile_CNP` with the `Infrastructure` library, `def type = "nodejs"`, `def product = "deed-poll"`, `def component = "admin"`, and `withPipeline(type, product, component) { }`
- [ ] Model it on `../apps/pcs/pcs-api/Jenkinsfile_CNP` for structure, but do **not** copy its product or component. Note that the old `Jenkinsfile_CNP` this repo once had declared `rpe` — a template leftover, and the reason the product code was queried at all
- [ ] Do not add a `Jenkinsfile_nightly` in this plan. It is a separate pipeline with its own security and cross-browser stages, and adding one that has never run would be a second untested thing landing at once
- [ ] Record in the README that this repo now deploys via Jenkins and owns no Terraform, pointing at `hmcts/deed-poll-infra` for the shared resources and at `.business_context/DEED_POLL_INFRA_PLAN.md` for why
- [ ] Mark completed

## Success criteria

- `yarn lint`, `yarn build` and `yarn test` all pass, with no drop in test count from the 1,548 recorded in
  `PROGRESS.md`'s generated dashboard. Treat a drop as a regression.
- `yarn test:e2e` passes 21/21 when run by hand, with the `yarn` shim on `PATH` and
  `docker compose up -d` running.
- The session table is at `session.session`. `public` contains no session table.
- No `infrastructure/` directory and no `.github/workflows/` directory. `.github/renovate.json` still
  present and unchanged.
- `Jenkinsfile_CNP` exists, declaring `deed-poll` / `admin`.
- Grepping the repo finds no `ExpressJsAppInsightsConnectionString`, no bare `session-secret` and no bare
  `idam-client-secret`.
- `yarn progress:write` re-run so the generated dashboard is current.

## Out of scope for this plan

- **Anything in `deed-poll-infra`.** That repo has its own plan and should be done first, since this
  repo's vault is created there.
- `cnp-jenkins-config` onboarding, the `cnp-flux-config` namespace and HelmRelease, and the IDAM client —
  all external, all tracked in `PROGRESS.md`.
- The `deed-poll-api` cutover: deleting `apps/api`, re-pointing `deedPollDatabaseChecks`, and handing
  `public` to api's Flyway. Tracked in `DEED_POLL_API_PLAN.md`.
- Welsh translation review, and the four remaining Phase 6 platform items.
- `Jenkinsfile_nightly`.
- Upstreaming the `PostgresStore` gap — it accepts a `schemaName` it cannot create — to
  `hmcts/expressjs-monorepo-template`. Worth doing, but not from this repo.
