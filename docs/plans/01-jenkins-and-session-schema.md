# Plan: Move to the Jenkins CNP pipeline, and move sessions to Redis

## Overview

Two unrelated-looking changes that belong together because both are prerequisites for this service ever
deploying:

1. **Pipeline.** This repo moves from `cnp-githubactions-library` to the Jenkins CNP pipeline, and its
   Terraform moves out to `hmcts/deed-poll-infra`. `.github/workflows/` is deleted entirely.
2. **Sessions.** The session store moves from Postgres to Redis, which the shared root already provisions
   for `deed-poll-web`. That leaves `public` free for `deed-poll-api`'s Flyway, and removes the last
   reason this repo would keep Prisma once the api cutover lands.

Small in code terms — five tasks, none of them large. The care is in the ordering, because one of them
turns CI red if it lands on its own.

### Source material — read these, do not re-derive them

| What | Where |
|---|---|
| Target state, five decisions and the reasoning | `.business_context/DEED_POLL_INFRA_PLAN.md` |
| Why sessions move to Redis, and why not to `deed-poll-api` | same file, Decision 3, and Decision 1 of this plan |
| What is being deleted and why, in this repo specifically | same file, the `deed-poll-admin` section of "The file-by-file target state" |
| The shared root this repo's vault now comes from | `../deed-poll-infra/` and its `docs/plans/01-jenkins-and-shared-split.md` |
| Working `withPipeline` examples | `../apps/pcs/pcs-api/Jenkinsfile_CNP`, `../apps/pt/pt-api/` |
| The working Redis session wiring to copy | `../deed-poll-web/apps/web/src/app.ts` — `getRedisClient`, `expressSessionRedis`, and the `redis` readiness check |

### Architecture decisions already taken — implement these, do not revisit

1. **Sessions move to Redis.** **Revised 2026-09-07, and this reverses an earlier decision in this same
   plan** — it previously said sessions stay in Postgres in a `session` schema, and that Redis was
   rejected as more work for the same outcome. Three things changed:
   - `PostgresStore` takes a `schemaName` option but **cannot create the schema it names**, so "one config
     value" turned out to be a config value plus a migration plus a Prisma drift question.
   - Redis is provisioned in the shared root regardless, because `deed-poll-web` needs it. Admin using it
     adds **no infrastructure at all**.
   - Keeping Prisma in this repo solely to own one schema for a table Prisma does not model is noise, and
     it is the residue that would survive the api cutover.

   **`deed-poll-api` must NOT own sessions.** That was considered and rejected: `express-session` reads the
   store on every request and `requireAuth` is global, so it would put an HTTP round trip in front of every
   page render and make this app's availability the product of two services. It would also move IDAM access
   and refresh tokens into a second service, and couple an audience-agnostic backend to one frontend's OIDC
   session shape. No service in this estate does it; `pcs-frontend`, `pt-frontend` and `deed-poll-web` all
   hold their own sessions.
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
- **Do not renumber or reorder tasks 1 and 2.** The lib has to be vendored and registered before the app
  can import it; reversed, task 2 fails to compile on a module that is not there yet.
- Run `docker compose up -d` before task 2. It serves **Redis on 6379** as well as Postgres and
  `rse-idam-simulator`, and **do not assume it is already running** — a previous handover said it was when
  it was not. Postgres is still needed too: this app reads case data through Prisma until the api cutover.
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

### Task 1: Vendor the Redis session store

`libs/express-session-redis` exists in the template and in `deed-poll-web`, but not here — this repo's
`libs/` has only `express-session-postgres`.

- [ ] Copy `libs/express-session-redis` in **from `hmcts/expressjs-monorepo-template`**, which is the source of truth. `deed-poll-web` has a copy and it is almost certainly identical, but taking it from web would silently inherit any local edit web has made
- [ ] Register it the way the other `@hmcts-cft/*` libs are registered — the workspace list in the root `package.json`, and `apps/web`'s dependencies
- [ ] Add `redis` as a dependency of `apps/web`, pinned exactly per this repo's pinned-dependency rule. It is needed for `createClient`
- [ ] Run `yarn install --immutable` after — the check that catches a lockfile disagreeing with its manifests
- [ ] **Do not delete `libs/express-session-postgres`.** Leaving it costs nothing, and deleting a template-provided lib is a re-scaffold conflict waiting to happen
- [ ] Mark completed

### Task 2: Swap the session store to Redis

Copy `deed-poll-web/apps/web/src/app.ts`'s pattern — it is the working example, in the sister repo, on the
same template.

- [ ] Add `"redis": { "url": "redis://localhost:6379" }` to `apps/web/config/default.json`, matching web's key exactly so the two repos read the same shape
- [ ] Add a `getRedisClient` helper as web has it: `createClient({ url: config.get("redis.url") })`, an `error` listener, then `await redisClient.connect()`
- [ ] Replace `expressSessionPostgres({ pgConnection: pgPool, sessionOptions: { secret: sessionSecret } })` at `apps/web/src/app.ts:40` with `expressSessionRedis({ redisConnection, sessionOptions: { secret: sessionSecret } })`
- [ ] **Write a comment at the call site explaining why sessions are here and not behind `deed-poll-api`.** This app is deliberately losing its data access layer to api, so the *next* reader will reasonably ask why session state is the exception, and "consistency" would tell them to move it. Say what the comment must convey, not just that it exists:
  - Session state is **transport state**, not domain data. It is keyed by a cookie this app issued, means nothing to any other service, and has no business rules for api to enforce.
  - **Putting it behind api would invert authorisation.** Reading the session is how this app learns who the caller is — so api would have to serve that read authorised by a *service* credential, before any user is identified. Any compromise of this app could then read any session. Held locally, the session id arrives in a signed cookie and never leaves the process.
  - There is also **nothing for this app to own** on the other side of that split: `express-session`'s store contract is `get`/`set`/`destroy`/`touch`, called by middleware before any of this app's code runs. It would be a proxy, not a layer.
  - Every frontend in the estate holds its own sessions — `pcs-frontend`, `pt-frontend`, `deed-poll-web`. None holds its own case data.
- [ ] **Add Redis to the readiness check, and leave `deedPollDatabaseChecks()` in place.** This app still reads case data through Prisma until the api cutover, so it depends on *both* — a readiness probe that stopped naming the database would go green while every case page 500s. Web's `redis: hc.raw(() => redisConnection.ping())` is the shape
- [ ] Update the app-level tests. What is worth pinning is that this app constructs the Redis store rather than the Postgres one — a silent regression to Postgres sessions would work locally and only show up as an api Flyway conflict later
- [ ] Confirm Redis is reachable first: it is served by this repo's own `docker compose` on 6379, which `deed-poll-web` also relies on. Then start the app, sign in, and confirm the session survives a page navigation
- [ ] **No Prisma migration, and no `session` schema.** An earlier version of this plan added one; there is nothing to create, because the Redis store needs no DDL
- [ ] Mark completed

### Task 3: Rename the vault secrets in all four charts

Four `values.yaml` files carry a `keyVaults: deed-poll:` block: `apps/web`, `apps/api`, `apps/crons` and
`apps/postgres`. Not all four reference every secret — read each rather than assuming.

- [ ] `ExpressJsAppInsightsConnectionString` → `app-insights-connection-string` in every file that references it. The old name came from the expressjs template, and `deed-poll-api` is Spring Boot and reads the same secret
- [ ] `session-secret` → `admin-session-secret`
- [ ] `idam-client-secret` → `admin-idam-client-secret`
- [ ] **Add `redis-url` → `REDIS_URL` to `apps/web`'s list** — the store from task 2 needs it, and the shared root writes it
- [ ] **Leave `postgres-url` in place, in all four charts.** This is the one thing not to tidy: this app still reads case data through Prisma until the api cutover, so removing the database credential would break every case page. It comes out at the cutover, with Prisma, not here
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
- Sessions are in Redis. No `session` schema and no session table anywhere in Postgres, and no Prisma migration was added.
- The readiness check names **both** Redis and the deed-poll tables — this app still reads case data through Prisma until the api cutover.
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
