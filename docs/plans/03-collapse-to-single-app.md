# Plan: Collapse this repo to a single MVC application

## Overview

Once [`02-dal-cutover-to-api.md`](02-dal-cutover-to-api.md) has run, this repo is a presentation layer with
no data access layer. This plan makes its **shape** match that: one deployable application, one image, one
Helm chart, one `Jenkinsfile_CNP` component.

Steve's call, 2026-09-08. The four-app monorepo was never a decision — it arrived with
`hmcts/expressjs-monorepo-template` at `82e8b0d` and has been carried since. Plan 02 already deletes two of
the four apps. This plan removes the third and flattens the fourth, so what is left is the caseworker
application and the libraries it actually uses.

### Why this is worth doing, and why now

It is not tidiness. The four-app shape has a concrete, measured cost that surfaced during the pipeline
cutover, and it blocks deployment:

- **`helmInstall` builds one image per component.** `az acr build … .` builds a root `Dockerfile` into a
  single `deed-poll/admin` image and exposes it to the values templates as `${IMAGE_NAME}`. This repo has no
  root `Dockerfile` — it has four — and `helm/deed-poll-admin/values*.template.yaml` reference
  `${WEB_IMAGE}`, `${API_IMAGE}`, `${CRONS_IMAGE}` and `${POSTGRES_IMAGE}`, which the deleted GitHub Actions
  build job used to set and nothing sets now. `envsubst` would emit untagged image references.
- The alternative — **four `product`/`component` pairs, four charts, four `Jenkinsfile_CNP`s, four
  `cnp-jenkins-config` onboarding requests** — is four times the external lead time, to independently scale
  components that plan 02 deletes.
- **The chart is also in the wrong directory.** `Helm.HELM_RESOURCES_DIR` is the literal `charts`, and
  `helmInstall.groovy` throws `No Helm charts directory found at charts` before doing anything else, then
  requires `charts/deed-poll-admin/values.yaml`. This repo has `helm/deed-poll-admin/` and no `values.yaml`.

Collapsing to one app makes the first two questions disappear rather than answering them, and reduces the
third to a directory move. Both blockers recorded in
[`../PIPELINES.md`](../PIPELINES.md) — "one image vs four" and "preview environments have no session store" —
were only hard because of the umbrella chart. See that file's "What still has to happen before this pipeline
can deploy".

### Prerequisite

**Plan 02 must be complete and merged first.** This plan assumes `apps/api`, `apps/postgres`,
`libs/postgres-prisma` and every Prisma import are already gone. Running it earlier means doing the chart
surgery twice and resolving the same deletions in two places.

### A defect in plan 02 that this plan must not inherit

**Plan 02 misses `libs/onboarding`.** Grep it: onboarding is not mentioned once, yet
`libs/onboarding/src/onboarding/queries.ts` imports `{ prisma } from "@hmcts/postgres-prisma"` and calls
`prisma.onboardingSubmission`. So plan 02's own success criterion — *"No `@hmcts/postgres-prisma` anywhere …
Grepping for `prisma` in `apps/` and `libs/` returns nothing"* — **cannot pass as written**. Task 1 below
resolves it. Whoever runs plan 02 first should expect that criterion to fail and should not paper over it by
re-pointing onboarding at the api client: onboarding is template demo content and api has no equivalent
endpoint, so the right answer is deletion, not migration.

### Source material — read these, do not re-derive them

| What | Where |
|---|---|
| What the DAL cutover already deletes | [`02-dal-cutover-to-api.md`](02-dal-cutover-to-api.md), tasks 5 and 8 |
| The five things blocking a green deploy, verified against `cnp-jenkins-library` | [`../PIPELINES.md`](../PIPELINES.md) |
| Why the chart must be at `charts/` and what `helmInstall` requires | same file, items 1–3 |
| The shared root that owns the vault, Redis and App Insights | `../../deed-poll-infra/` |
| A single-component `withPipeline` for a Node frontend | `../../apps/pt/pt-frontend/`, `../../apps/pcs/pcs-frontend/` — neither is cloned; fetch from GitHub |
| That `libs/onboarding` is template demo content, unreachable by navigation | `../../.business_context/PROGRESS.md`, the `libs/onboarding` note |

### Architecture decisions already taken — implement these, do not revisit

1. **One deployable, one component.** Product `deed-poll`, component `admin`, one image, one chart at
   `charts/deed-poll-admin/`. Not four.
2. **`apps/crons` is deleted, not kept.** Its entire content is
   `export const exampleCronJob = async () => { console.log("Example cron job executed"); }`. It arrived with
   the template, has been touched three times since — a dependency bump, a secret rename and the pipeline
   cutover, all incidental — and no cron has ever been written. If a scheduled job is needed later, a
   `Jenkinsfile_nightly` or a CronJob in the chart is the CNP answer, not a permanently empty workspace.
3. **`libs/onboarding` and its pages are deleted.** Template demo content, unreachable by navigation since
   the prototype home page went, and the only remaining Prisma consumer after plan 02.
4. **`apps/web` flattens to the repo root.** `src/`, `config/`, `Dockerfile`, `vite.build.ts` move up. One
   `package.json`, no Yarn workspaces for applications.
5. **`libs/` stays a workspace.** Do **not** flatten the libraries into `src/`. Four of them
   (`cloud-native-platform`, `express-govuk-starter`, `simple-router`, `express-session-postgres`) are
   template-provided at `82e8b0d`, and keeping them as packages is what makes a future template re-scaffold
   tractable. `libs/deed-poll` is 75 files of tested domain logic and the conformance argument for the whole
   migration — it earns its boundary.
6. **`libs/express-session-postgres` stays on disk and stays a dependency**, unused, as recorded in
   `CLAUDE.md`. It is template-provided; unwiring it invites a re-scaffold conflict. Do not "tidy" it as part
   of this plan.

### Constraints

- **Every task must leave `yarn lint`, `yarn build` and `yarn test` green.** Order the file moves so nothing
  references a path before it exists or after it is gone.
- **No behaviour changes.** This is deletion and relocation. A diff that changes a view model, a validation
  rule or a route's behaviour is out of scope and should be a separate commit with its own reasoning.
- **Do not run `yarn dev:up`.** It runs `docker compose up -d`, which collides with `deed-poll-web` on the
  shared Redis container name. Start dependencies with `docker start` or `docker compose up -d postgres idam`.
- **Test counts must not drop except where tests are deliberately deleted.** Onboarding removal takes 72 unit
  tests and 5 e2e tests with it. Record the arithmetic in the completion note so a future reader can tell a
  deliberate deletion from a regression: **1,608 unit → ~1,536**, **21 e2e → 16**.
- `REDIS_URL=redis://127.0.0.1:6379` and `yarn idam:users` are needed for `test:e2e` in the devcontainer.
  See the README.

## Validation Commands

- `yarn install --immutable`
- `yarn lint`
- `yarn build`
- `yarn test`
- `yarn test:e2e` — by hand, with dependencies up and users seeded

## Tasks

### Task 1: Delete the onboarding demo

- [ ] Delete `libs/onboarding/` entirely, and remove `@hmcts/onboarding` from every `package.json` naming it
- [ ] Delete `apps/web/src/pages/onboarding/` — `(start)`, `(name)`, `(role)`, `(date-of-birth)`, `(address)`,
      `(summary)`, `confirmation` and `index.ts`
- [ ] Delete `e2e-tests/tests/onboarding-happy-path.spec.ts` (5 tests)
- [ ] Remove the `onboarding_submission` table's migration only if plan 02 has not already deleted the
      migrations wholesale. **Do not** hand-edit a committed Flyway or Prisma migration that has been applied
      anywhere
- [ ] Check `e2e-tests/tests/idam-session.ts` and `deed-polls.spec.ts`, both of which mention onboarding, and
      remove only the onboarding references — not the sign-in helper they share
- [ ] The Welsh-language e2e test is **safe** — checked while writing this plan: it targets
      `/accessibility-statement`, not an onboarding page. Do not delete it. Its own comment explains why it
      cannot use a deed-poll page (those need a session and their `cy` still holds English), so if onboarding
      removal ever appears to break it, the cause is elsewhere
- [ ] Mark completed, recording the unit and e2e test-count delta

### Task 2: Delete apps/crons

- [ ] Delete `apps/crons/`, including its `helm/` subchart
- [ ] Remove the `deed-poll-admin-crons` dependency and its `crons.enabled` condition from
      `helm/deed-poll-admin/Chart.yaml` and both values templates
- [ ] Remove `@hmcts/crons` from the workspace and any `turbo.json` reference
- [ ] Mark completed

### Task 3: Flatten apps/web to the root

- [ ] Move `apps/web/src/` → `src/`, `apps/web/config/` → `config/`, `apps/web/Dockerfile` → `Dockerfile`,
      `apps/web/vite.build.ts` → `vite.build.ts`
- [ ] Merge `apps/web/package.json`'s dependencies and scripts into the root `package.json`. Remove the
      `apps/*` workspace glob; keep `libs/*` and `e2e-tests`
- [ ] Merge `apps/web/tsconfig.json` into the root `tsconfig.json`, keeping the `libs/*` path mappings
- [ ] Update every relative path that crossed the old boundary. Known ones, all currently
      `../helm/values.yaml` from `src/`: `src/secrets.ts` and its test's `toMatch(/apps\/web\/helm\/…/)`
      assertion. Grep for `apps/web`, `../../`, and `DATA_DIR` before declaring this done
- [ ] Update `vitest.config.ts`, `turbo.json`, `sonar-project.properties` and `scripts/merge-lcov.mjs` — all
      four encode the workspace layout
- [ ] `yarn install --immutable`, then all four validation commands
- [ ] Mark completed

### Task 4: One chart at charts/deed-poll-admin

- [ ] Create `charts/deed-poll-admin/` and delete `helm/`. The directory name is not a preference:
      `Helm.HELM_RESOURCES_DIR` is the literal `charts` and `helmInstall` throws without it
- [ ] Write `charts/deed-poll-admin/values.yaml`. `helmInstall` requires this file to exist before it applies
      `values.template.yaml`; its absence is blocker 1 in `PIPELINES.md`
- [ ] Collapse the umbrella chart into a single `nodejs` chart — no `dependencies:`, no subcharts, no
      `*.enabled` conditions. Model on `pt-frontend`/`pcs-frontend`, not on `pcs-api`
- [ ] Replace `${WEB_IMAGE}` with `${IMAGE_NAME}`, which is what `helmInstall` actually exports. Delete the
      `${API_IMAGE}`, `${CRONS_IMAGE}` and `${POSTGRES_IMAGE}` blocks
- [ ] Carry these forward verbatim rather than re-deriving them — each was established at cost:
  - `keyVaults:` reads `app-insights-connection-string`, `redis-url`, `admin-session-secret` and
    `admin-idam-client-secret`. **No `postgres-url`** — plan 02 removed the database
  - `IDAM_REDIRECT_URI` **must** equal the chart's own `ingressHost` with `/oauth2/callback` appended, and
    must be registered with IDAM verbatim. A mismatch breaks login in that environment and nowhere else
  - Probes point at `/health/readiness` and `/health/liveness`
- [ ] **Resolve preview environments' session store** — blocker 4 in `PIPELINES.md`, and a decision, not a
      rename. `assertRedisUrl` refuses `config/default.json`'s loopback default outside development, so a
      preview pod fails fast rather than coming up sessionless. Either enable a `redis` subchart per PR, or
      point preview at the AAT cache's `redis-url`. **Record which and why in the chart**
- [ ] Mark completed

### Task 5: Root Dockerfile and the pipeline

- [ ] The moved `Dockerfile` is now the root one `az acr build … .` expects. Confirm it builds from the
      flattened layout and still runs `yarn build`, which is the **only** type-check in the pipeline —
      `YarnBuilder.build()` is `yarn lint` and nothing else
- [ ] `Jenkinsfile_CNP` keeps `withPipeline("nodejs", "deed-poll", "admin")` and its empty body. Confirm the
      library pin still matches `deed-poll-infra`'s (`2.4.4` at time of writing), so the product's two
      pipelines move together
- [ ] Add `yarn test:smoke` — blocker 3. `sectionDeployToAKS` calls `builder.smokeTest()` after **every**
      deploy, unconditionally, so its absence fails the run the first time a deploy succeeds. A single
      request asserting `/health/readiness` is `UP` is enough; do not build a second e2e suite
- [ ] Wire `yarn test:e2e` into a stage, or record explicitly that it still runs nowhere. It is the only
      thing that exercises a real `RedisStore` round trip and it currently runs in no pipeline at all
- [ ] Mark completed

### Task 6: Documentation and the record

- [ ] `CLAUDE.md` — the Project Structure tree is now wrong in every line. Rewrite for the flat layout, and
      remove the four-app description. Its "Deployment and sessions" section survives
- [ ] `docs/PIPELINES.md` — blockers 1–4 are resolved or resolved-by-deletion. Rewrite that section to say
      what is actually left, which should be only external onboarding
- [ ] `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/DEMO.md`, `README.md` — all describe four apps,
      `helm/`, and in places a database. Check each; several were corrected during plan 01 and will be wrong
      again
- [ ] `.claude/agents/infrastructure-engineer.md` — it is instructions rather than prose, so a stale layout
      there actively misleads a future session. Highest-value fix in this task
- [ ] `.business_context/PROGRESS.md` — record the collapse, the test-count arithmetic, and the preview-Redis
      decision from task 4
- [ ] Delete the untracked strays if still present: `lcov.info`, `power_app_nest/` and `data/` are all
      untracked and empty or generated. `steves_notes.md` is Steve's and is gitignored — **leave it**
- [ ] `yarn progress:write`
- [ ] Mark completed

## Success criteria

- `yarn lint`, `yarn build`, `yarn test` and `yarn test:e2e` all pass.
- **Unit tests ~1,536 and e2e 16**, the drop being exactly the deleted onboarding tests and nothing else. A
  larger drop is a regression.
- No `apps/` directory. No `helm/` directory. No `libs/onboarding`. No `@hmcts/crons`.
- `charts/deed-poll-admin/values.yaml` exists, and `charts/deed-poll-admin/` contains no `dependencies:`.
- A root `Dockerfile` exists and is the one the pipeline would build.
- Grepping the repo for `WEB_IMAGE`, `API_IMAGE`, `CRONS_IMAGE`, `POSTGRES_IMAGE` and `postgres-url` returns
  nothing.
- `yarn test:smoke` exists and passes against a running app.
- `libs/` still contains the six surviving packages, `express-session-postgres` among them.

## Out of scope for this plan

- **Plan 02's own work.** This plan starts where that one finishes.
- **Splitting a component back out.** If `crons` ever needs to be real, that is a new decision with the
  chart in a much simpler state to change.
- **`cnp-jenkins-config` onboarding, `cnp-flux-config`, the IDAM client.** All external. The point of this
  plan is that it reduces the onboarding request from four repositories-worth to one component.
- **Anything in `deed-poll-web`.** It has the same template shape and the same four `${*_IMAGE}` placeholders,
  and its own cutover plan asserts the chart "is already right" — which is wrong for the same reason admin's
  did. That is its own plan, in its own repo.
- **Flattening `libs/`.** Decision 5.
