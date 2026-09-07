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

- [x] Copy `libs/express-session-redis` in **from `hmcts/expressjs-monorepo-template`**, which is the source of truth. `deed-poll-web` has a copy and it is almost certainly identical, but taking it from web would silently inherit any local edit web has made
  - Fetched the five files from the template at `HEAD`. Web's copy turned out to be byte-identical in `src/index.ts` and `src/index.test.ts` — its only divergence is the `repository`/`homepage`/`bugs` metadata, re-pointed at `deed-poll-web`. Ours is re-pointed at `deed-poll-admin` and carries `"private": true`, matching every other vendored lib here (`express-session-postgres`, `cloud-native-platform`, `simple-router`, `express-govuk-starter`); web omits `private`.
- [x] Register it the way the other `@hmcts-cft/*` libs are registered — the workspace list in the root `package.json`, and `apps/web`'s dependencies
  - The root `workspaces` list is the glob `libs/*`, so it needed no edit. The registrations that are per-lib and *did*: the root `tsconfig.json` `paths` entry, `apps/web/tsconfig.json`'s `references`, and `apps/web`'s dependency on `workspace:*`.
- [x] Add `redis` as a dependency of `apps/web`, pinned exactly per this repo's pinned-dependency rule. It is needed for `createClient`
  - `redis` at `6.0.0` and `connect-redis` at `9.0.0`, both matching `deed-poll-web` so the two repos resolve the same versions. `connect-redis` is a peer dependency of the lib and is what provides `RedisStore`, so `apps/web` has to declare it too.
- [x] Run `yarn install --immutable` after — the check that catches a lockfile disagreeing with its manifests
  - Clean. It warns that the lib does not provide `redis` to `connect-redis`'s peer requirement; that comes from the template's own manifest, is identical in `deed-poll-web`, and sits alongside three pre-existing warnings of the same kind in this repo.
- [x] **Do not delete `libs/express-session-postgres`.** Leaving it costs nothing, and deleting a template-provided lib is a re-scaffold conflict waiting to happen
  - Untouched. `apps/web/src/app.ts` still constructs the Postgres store — the swap is task 2.
- [x] Mark completed
  - `yarn lint`, `yarn build` and `yarn test` all pass. 1,555 tests, up from the 1,548 baseline by the vendored lib's 7.

### Task 2: Swap the session store to Redis

Copy `deed-poll-web/apps/web/src/app.ts`'s pattern — it is the working example, in the sister repo, on the
same template.

- [x] Add `"redis": { "url": "redis://localhost:6379" }` to `apps/web/config/default.json`, matching web's key exactly so the two repos read the same shape
  - Plus the `redis.url` → `REDIS_URL` entry in `custom-environment-variables.json`, which the checkbox did not name and without which the vault secret task 3 adds would be read by nothing. Web has both.
- [x] Add a `getRedisClient` helper as web has it: `createClient({ url: config.get("redis.url") })`, an `error` listener, then `await redisClient.connect()`
  - One deviation: it takes the URL string rather than the `config` instance. Web types that parameter `any`, which this repo's rules forbid, and the only thing wanted from `config` is one string — so the call site does `config.get<string>("redis.url")`. Same behaviour, no `any`.
  - `REDIS_URL` added to `getPropertiesVolumeSecrets`'s `omit`, alongside `DATABASE_URL` and for the same reason: a non-production run against a real vault would otherwise overwrite the local URL with the deployed one. `omit` is not applied to the production mount-point path, so this does not affect a deployed pod.
- [x] Replace `expressSessionPostgres({ pgConnection: pgPool, sessionOptions: { secret: sessionSecret } })` at `apps/web/src/app.ts:40` with `expressSessionRedis({ redisConnection, sessionOptions: { secret: sessionSecret } })`
  - `pgPool` is no longer imported by `app.ts` at all. `apps/web`'s dependency on `@hmcts-cft/express-session-postgres` and its `tsconfig` reference are left in place, on the same reasoning as task 1: unwiring a template-provided lib is the re-scaffold conflict, not the cost.
- [x] **Write a comment at the call site explaining why sessions are here and not behind `deed-poll-api`.** This app is deliberately losing its data access layer to api, so the *next* reader will reasonably ask why session state is the exception, and "consistency" would tell them to move it. Say what the comment must convey, not just that it exists:
  - Session state is **transport state**, not domain data. It is keyed by a cookie this app issued, means nothing to any other service, and has no business rules for api to enforce.
  - **Putting it behind api would invert authorisation.** Reading the session is how this app learns who the caller is — so api would have to serve that read authorised by a *service* credential, before any user is identified. Any compromise of this app could then read any session. Held locally, the session id arrives in a signed cookie and never leaves the process.
  - There is also **nothing for this app to own** on the other side of that split: `express-session`'s store contract is `get`/`set`/`destroy`/`touch`, called by middleware before any of this app's code runs. It would be a proxy, not a layer.
  - Every frontend in the estate holds its own sessions — `pcs-frontend`, `pt-frontend`, `deed-poll-web`. None holds its own case data.
- [x] **Add Redis to the readiness check, and leave `deedPollDatabaseChecks()` in place.** This app still reads case data through Prisma until the api cutover, so it depends on *both* — a readiness probe that stopped naming the database would go green while every case page 500s. Web's `redis: hc.raw(() => redisConnection.ping())` is the shape
  - `readinessChecks: { ...deedPollDatabaseChecks(), redis: hc.raw(() => redisConnection.ping()) }`, with `checks: {}` still empty so liveness cannot restart a pod over someone else's outage. Verified against the running app: `/health/readiness` answers `{"redis":"UP","postgres":"UP","deedPollSchema":"UP"}` and `/health/liveness` answers `{}`.
  - Note that web puts Redis on `checks` — i.e. on liveness as well, since `readinessChecks` defaults to `checks`. Not copied: this repo already fixed that shape once, for the reason the comment above the call records.
- [x] Update the app-level tests. What is worth pinning is that this app constructs the Redis store rather than the Postgres one — a silent regression to Postgres sessions would work locally and only show up as an api Flyway conflict later
  - New `apps/web/src/app.test.ts` — there was no app-level test in this app at all, so this is the first. Seven tests: the Redis store is constructed with the connected client and `expressSessionPostgres` is not called; `createClient` gets the configured URL; an `error` listener is registered; readiness names all three checks and liveness names none; and the Redis readiness entry reports UP on a ping and DOWN when the ping rejects.
  - `hc` and the `@hmcts/deed-poll` domain are partially mocked rather than replaced, so what the readiness entry actually does on failure is part of what is pinned.
- [x] Confirm Redis is reachable first: it is served by this repo's own `docker compose` on 6379, which `deed-poll-web` also relies on. Then start the app, sign in, and confirm the session survives a page navigation
  - **The premise was wrong: this repo's `docker-compose.yml` had no Redis service** — only Postgres and `rse-idam-simulator`. Added one, copied from `deed-poll-web`'s (`redis:8-alpine`, `redis-cli ping` healthcheck, `--appendonly yes`) and deliberately sharing its `deed-poll-redis` container name, so the two repos use one local instance rather than racing for 6379 and the second `compose up` fails on the name instead of quietly starting a second store.
  - Signed in for real against the local `rse-idam-simulator` — driven with `curl` rather than a browser, because Chromium is not installed in this environment. Landed on `/deed-polls` (200), navigated on with the same cookie and stayed authenticated, and the Redis record holds `deedPoll.user` with `caseworker-deedpoll-admin`, `subject`, and the tokens. The session id after login differs from the pre-login one, so `signIn`'s `regenerate` is still doing its job through the new store.
  - Run on port 3100 with `IDAM_REDIRECT_URI` overridden: `deed-poll-web`'s dev server already held 3000, and that is another session's working state.
- [x] **No Prisma migration, and no `session` schema.** An earlier version of this plan added one; there is nothing to create, because the Redis store needs no DDL
  - Nothing added under `libs/postgres-prisma/prisma/`, and the store created no table — the signed-in session was found in Redis under `sess:<id>` and nowhere in Postgres.
- [x] Mark completed
  - `yarn lint`, `yarn build` and `yarn test` all pass. 1,562 tests, up from 1,555 by the seven new app-level ones.

### Task 3: Rename the vault secrets in all four charts

Four `values.yaml` files carry a `keyVaults: deed-poll:` block: `apps/web`, `apps/api`, `apps/crons` and
`apps/postgres`. Not all four reference every secret — read each rather than assuming.

- [x] `ExpressJsAppInsightsConnectionString` → `app-insights-connection-string` in every file that references it. The old name came from the expressjs template, and `deed-poll-api` is Spring Boot and reads the same secret
  - Three of the four charts referenced it: `apps/web`, `apps/api`, `apps/crons`. `apps/postgres` names only `postgres-url` — it is the Prisma Studio service and has no App Insights wiring, which is why the task said to read each rather than assume.
- [x] `session-secret` → `admin-session-secret`
  - `apps/web` only; no other chart holds a session secret. Note what was deliberately *not* renamed: `apps/web/config/default.json`'s `session.secret` is the literal string `"session-secret"` as a local placeholder **value**, and `assertSessionSecret` refuses to start on exactly that string outside development and test. It is not a vault name, and changing it would disarm that guard.
- [x] `idam-client-secret` → `admin-idam-client-secret`
  - `apps/web` only. Also updated the one place in application code that names the vault entry in prose: `apps/web/src/auth/settings.ts:54`'s `IDAM_CLIENT_SECRET is empty` error, which told the reader to go look for an entry that no longer exists under that name. No test asserts that substring.
- [x] **Add `redis-url` → `REDIS_URL` to `apps/web`'s list** — the store from task 2 needs it, and the shared root writes it
  - Placed after `postgres-url`, before the two must-exist-first secrets, so the vault-provided infrastructure URLs read together.
- [x] **Leave `postgres-url` in place, in all four charts.** This is the one thing not to tidy: this app still reads case data through Prisma until the api cutover, so removing the database credential would break every case page. It comes out at the cutover, with Prisma, not here
  - All four still carry it, and `apps/web`'s now says why in a comment, so the next reader tidying vestigial Postgres wiring finds the reason at the line rather than in this plan.
- [x] Keep every `alias` exactly as it is. The application reads `SESSION_SECRET`, `IDAM_CLIENT_SECRET`, `APPLICATION_INSIGHTS_CONNECTION_STRING` and `DATABASE_URL`, and none of those changes
  - Confirmed by diff: every changed line is a `- name:`, and no `alias:` line was touched. `REDIS_URL` is new rather than changed.
- [x] Keep the comments explaining that the chart fails on a missing secret and that `idam-client-secret` cannot exist until IDAM replies — update the name in that comment too
  - Both kept and renamed. Added one sentence to the session-secret comment recording *why* it is per component and not shared with `deed-poll-web` — one signing key across a caseworker service and a public one makes a forged cookie portable between them — since the rename is otherwise indistinguishable from cosmetic prefixing.
- [x] Grep the whole repo for the three old names, including `helm/deed-poll-admin/values*.template.yaml`, and confirm none survives
  - Nothing survives in charts or application code. The two umbrella templates turned out to name no vault secrets at all — they override images, ingress hosts and `IDAM_REDIRECT_URI` — so they needed no edit. What still matches, correctly: `infrastructure/*.tf`, which task 4 deletes wholesale, and `.business_context/` plus this plan, which record the rename as history.
- [x] Mark completed
  - `yarn lint`, `yarn build` and `yarn test` all pass. 1,562 tests, unchanged — this task changes no TypeScript behaviour, only chart secret names and one error-message string.

### Task 4: Delete `infrastructure/` and `.github/workflows/` — one commit

**These two deletions must land together.** `detect-infra-changes` gates on `^infrastructure/`, so the
deleting commit matches its own pattern, fires the Terraform stage, and fails against a missing directory.
Deleting the workflows in the same commit means there is no stage left to fire.

`infrastructure/` is already deleted from the working tree and staged nowhere — its eight files now live in
`hmcts/deed-poll-infra` at `0a61b9c`, byte-for-byte.

- [x] Delete `infrastructure/` in full, if anything remains of it
  - **The premise was wrong: nothing had been deleted.** All eight files were present in the working tree *and* tracked in `HEAD` — `appinsights.tf`, `keyvault.tf`, `main.tf`, `output.tf`, `postgres.tf`, `state.tf`, `variables.tf` and `.terraform-version`. This is the second premise in this plan to have been recorded as done when it was not (task 2's "docker compose serves Redis" was the first), so the "if anything remains" hedge is what saved it. Verified against `hmcts/deed-poll-infra` that the content lives there before deleting.
- [x] Delete `.github/workflows/` in full — `workflow.main.yml`, `workflow.preview.yml`, every `stage.*` and every `job.*`, and the `jobs/` documentation directory
  - 44 files: 3 `workflow.*`, 7 `stage.*`, 15 `job.*`, and the 19-file `jobs/` tree (13 `README.md` and 6 `.sh` helpers). `workflow.claude.yml` went with them — it is not deploy-side, but Decision 3 is *all* GitHub Actions, and leaving one workflow behind would leave `.github/workflows/` in existence for the sake of a Claude action this repo can invoke locally.
- [x] **Keep `.github/renovate.json`.** It is configuration, not a workflow, and it carries three fixes that took a session to find: the Travis manager removed, the Dockerfile regex corrected from `FROM node:` to the ACR-qualified image, and `regexManagers` migrated to `customManagers` with the `matchManagers` reference moved with it
  - Untouched, and proved so rather than eyeballed: `git hash-object` gives `1989497` both before and after the deletions, and the file does not appear in the commit's diff at all. All three fixes confirmed present — no `travis` anywhere, the `FROM` regex is the ACR-qualified `(?:[^\s/]+(?:/[^\s/]+)*/)?node:` form, and `customManagers`/`matchManagers` are both there.
- [x] Keep anything else under `.github/` that is not a workflow — issue templates, `CODEOWNERS`, `dependabot.yml` if present
  - None of those three exist in this repo. Four other files did and all survive: `copilot-instructions.md`, `osv-scanner.toml`, `scripts/setup-sonarcloud-project.sh` and `scripts/README.md`. Note that the last two are now **orphaned config** — `osv-scanner.toml` was read by the deleted `job.osv-scanner.yml`, and the Sonar setup script by the deleted pipeline. Deliberately left: the checkbox says keep what is not a workflow, and CNP's own Sonar and OSV stages may want them. Flagged rather than tidied.
- [x] Commit both deletions together, with a message recording why they are one commit
  - One commit, 52 deletions, no other files touched.
- [x] Mark completed
  - `yarn lint`, `yarn build` and `yarn test` all pass. 1,562 tests, unchanged from task 3 — nothing in the build ever referenced either directory.
  - Left for task 5, which owns the documentation checkbox: `docs/PIPELINES.md` and `docs/DEPLOYMENT.md` are 851 lines describing the GitHub Actions pipeline that no longer exists, and `apps/postgres/ccd-runtime/migrate.test.ts:10` cites `job.test.yml` in a prose comment as the reason those tests provision no database.

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
