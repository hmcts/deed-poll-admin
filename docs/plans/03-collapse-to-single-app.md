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
  root `Dockerfile` — it has two, since plan 02 deleted `apps/api` and `apps/postgres` — and
  `helm/deed-poll-admin/values*.template.yaml` reference `${WEB_IMAGE}` and `${CRONS_IMAGE}`, which the
  deleted GitHub Actions build job used to set and nothing sets now. `envsubst` would emit untagged image references.
- The alternative — **a `product`/`component` pair, a chart, a `Jenkinsfile_CNP` and a `cnp-jenkins-config`
  onboarding request per component** — multiplies the external lead time, to independently scale components
  plan 02 has already reduced to two.
- **The chart is also in the wrong directory.** `Helm.HELM_RESOURCES_DIR` is the literal `charts`, and
  `helmInstall.groovy` throws `No Helm charts directory found at charts` before doing anything else, then
  requires `charts/deed-poll-admin/values.yaml`. This repo has `helm/deed-poll-admin/` and no `values.yaml`.

Collapsing to one app makes the first two questions disappear rather than answering them, and reduces the
third to a directory move. Both blockers recorded in
[`../PIPELINES.md`](../PIPELINES.md) — "one image vs two" and "preview environments have no session store" —
were only hard because of the umbrella chart. See that file's "What still has to happen before this pipeline
can deploy".

### Prerequisite

**Plan 02 must be complete and merged first.** This plan assumes `apps/api`, `apps/postgres`,
`libs/postgres-prisma` and every Prisma import are already gone. Running it earlier means doing the chart
surgery twice and resolving the same deletions in two places.

### A defect in plan 02 that this plan must not inherit

**Resolved, 2026-09-09.** Plan 02 task 5 deleted onboarding rather than papering over it, exactly as this
section asks, so task 1 below is a verification. The account is kept because it is the reasoning for the
deletion, and because plan 02 records the same thing from its own side.

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
| The six things blocking a green deploy, verified against `cnp-jenkins-library` | [`../PIPELINES.md`](../PIPELINES.md) |
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
   tractable. `libs/deed-poll` is 68 files of tested domain logic — 443 tests — and still holds the four
   conformance *rule* layers, so it earns its boundary. (It was 75 files before plan 02; the structural
   conformance layer retired to api, and the query layer became adapter calls.)
6. **`libs/express-session-postgres` stays on disk and stays a dependency**, unused, as recorded in
   `CLAUDE.md`. It is template-provided; unwiring it invites a re-scaffold conflict. Do not "tidy" it as part
   of this plan.

### The hostname, and why it is in this plan

Added 2026-09-08 after reading `cnp-jenkins-library` and `hmcts/idam-access-config` rather than inferring
from either. This plan rewrites the values templates, so it is the moment this gets fixed or gets locked in.

**Today's host is hand-rolled, and neither variable in it means what the template assumes.**
`values.template.yaml` builds it from parts:

```
${TEAM_NAME}-{{ .Release.Name }}-web.${ENVIRONMENT}.platform.hmcts.net
```

Both `${TEAM_NAME}` and `${ENVIRONMENT}` are wrong, and an earlier revision of this section — and
`IDAM_REGISTRATION_REQUEST.md` — got the expansion wrong in the same way. Corrected 2026-09-10 by reading
`vars/helmInstall.groovy` and `src/uk/gov/hmcts/pipeline/TeamConfig.groovy`:

- **`TEAM_NAME` is not the product name.** `TeamConfig.getName(product)` looks `team:` up in
  [`cnp-jenkins-config/team-config.yml`](https://github.com/hmcts/cnp-jenkins-config/blob/master/team-config.yml)
  and returns the constant `'pleaseTagMe'` when the product is absent. It is a **team display name**, not a
  slug: `pcs`'s is `"Possession Claim Service"`, spaces included. `deed-poll` is absent from that file
  entirely, so today it would expand to `pleaseTagMe`. Nothing about it was ever safe in a hostname.
- **`ENVIRONMENT` is not exported to the template at all.** `helmInstall` sets exactly five variables —
  `NAMESPACE`, `SERVICE_NAME`, `IMAGE_NAME`, `SERVICE_FQDN`, `INGRESS_IP`. `envsubst` replaces an unset
  variable with the empty string, so the host renders with a doubled dot. No other chart in the workspace
  uses `${ENVIRONMENT}` — checked across all 95 CNP repos, zero hits.

So the real expansion is nearer `pleaseTagMe-deed-poll-admin-staging-web..platform.hmcts.net` than the
`deed-poll-deed-poll-admin-staging-web.aat…` previously recorded here. `Release.Name` is the only part that
was right: `helmInstall` sets it to `"${product}-${component}-${imageTag}"` = `deed-poll-admin-staging`. The
trailing `-web` is umbrella-chart residue naming a subchart this plan deletes.

**`IDAM_REGISTRATION_REQUEST.md` calls the doubled segment "deliberate — per platform pattern". It is not a
pattern, it is two undefined variables, and this plan supersedes it.**

**A prerequisite this uncovered, and it is not this plan's to fix.** `TeamConfig.setTeamConfigEnv` calls
three getters that `steps.error` outright when the product is missing from `team-config.yml` — namespace,
Slack channels and the `tags.application` value. `deed-poll` is missing. **So the pipeline hard-fails before
it builds anything, for all four repos, and no hostname is reached at all.** That is Jenkins onboarding's
job, not task 4's — recorded here only so nobody debugging a red first build looks for it in this chart.

**There are two hostnames, not one, and that is the part easy to get wrong.** Corrected 2026-09-10 after
reading `pcs-frontend`'s charts and `hmcts/idam-access-config` `master`. An earlier draft of this section
claimed `pcs-frontend` uses `${SERVICE_FQDN}` "and nothing more". It does not — it layers a stable service
host underneath a pipeline-computed one:

| Where | `ingressHost` | Applies to |
|---|---|---|
| `charts/pcs-frontend/values.yaml` | `pcs.{{ .Values.global.environment }}.platform.hmcts.net` | demo, ithc, perftest, prod |
| `charts/pcs-frontend/values.aat.template.yaml` | `${SERVICE_FQDN}` | aat only |
| `charts/pcs-frontend/values.preview.template.yaml` | `${SERVICE_FQDN}` | preview only |

`helmInstall` exports `SERVICE_FQDN` from `azPrivateDns.getHostName(aksServiceName)`, where `aksServiceName`
is `product-component-imageTag` — so in aat it resolves to `product-component-staging.aat.platform.hmcts.net`.
That is not inferred: `idam-access-config`'s `apps/pcs/aat/services.yaml` registers
`https://pcs-frontend-staging.aat.platform.hmcts.net/oauth2/callback` verbatim, which is the same expansion
for pcs. **For this app it is `deed-poll-admin-staging.aat.platform.hmcts.net`** — no doubling, no `-web`.

**`pcs` registers both forms with IDAM, and so must we:**

- `apps/pcs/base/services.yaml` — `https://pcs.<<ENV>>.platform.hmcts.net/oauth2/callback`, one `<<ENV>>`
  entry covering every environment, plus the prod apex `https://pcs.platform.hmcts.net/oauth2/callback`.
- `apps/pcs/aat/services.yaml` — adds `https://pcs-frontend-staging.aat.platform.hmcts.net/oauth2/callback`
  **and restates** the `pcs.aat…` one, plus `localhost:3209` for local development. It restates it because
  the environment overlay appears to *replace* `redirect_uris` rather than append to it. That is an inference
  from pcs's shape, not something verified in `idam-access-config`'s tooling — but it means an overlay file
  must be self-contained, and dropping the base entry from it is a silent way to break login in that
  environment only.

**`deed-poll-web` already does exactly this**, settled when it moved to the pipeline on 2026-09-09:
`charts/deed-poll-web/values.yaml` carries
`ingressHost: deed-poll-web.{{ .Values.global.environment }}.platform.hmcts.net` and
`values.aat.template.yaml` overrides to `${SERVICE_FQDN}`. **So there is no pattern to invent here — copy the
sibling repo.** This app is the outlier in the product: it has no `values.yaml` at all, only a
`values.template.yaml`, which `helmInstall` renders *over* `values.yaml` rather than layering after it.

**Nothing is registered yet, so this is free — but only until it is not.**
[`hmcts/idam-access-config#993`](https://github.com/hmcts/idam-access-config/pull/993) is **open and
unmerged**; `apps/deed-poll/base/services.yaml` 404s on that repo's `master`, so the files exist only on the
PR branch, and it is blocked on questions of ours in any case. **Once #993 merges, changing it needs a second
IDAM PR** — and a mismatched `redirect_uri` fails on IDAM's own page *after* a successful login, where no
request reaches this app, which is a genuinely confusing failure to debug.

Three things that follow, stated as context rather than as checkboxes — the actionable one is in task 4:

- **The chart and #993 must agree, and nothing enforces it mechanically.** The decision taken 2026-09-10 is
  to correct #993 **before** it merges rather than register the wrong host and raise a follow-up: `base` gets
  `https://deed-poll-admin.<<ENV>>.platform.hmcts.net/oauth2/callback`, and `aat` gets that plus
  `https://deed-poll-admin-staging.aat.platform.hmcts.net/oauth2/callback` and `localhost:3000`.
- **Production redirect URIs are deliberately empty** in #993 and must be added before any production deploy.
  Nothing enforces that either, and there is no production hostname yet.
- **Preview environments are an unresolved gap, not an oversight of ours.** `${SERVICE_FQDN}` differs per pull
  request, and `idam-access-config` registers nothing for pcs preview at all — so either IDAM permits a
  pattern not visible in that repo, or pcs preview sign-in does not work. Do not invent a wildcard; record
  the gap and ask IDAM.

### Constraints

- **Every task must leave `yarn lint`, `yarn build` and `yarn test` green.** Order the file moves so nothing
  references a path before it exists or after it is gone.
- **No behaviour changes.** This is deletion and relocation. A diff that changes a view model, a validation
  rule or a route's behaviour is out of scope and should be a separate commit with its own reasoning.
- **Do not run `yarn dev:up`.** It runs `docker compose up -d`, which collides with `deed-poll-web` on the
  shared Redis container name. Start dependencies with `docker start` or `docker compose up -d redis idam` —
  there is no `postgres` service in `docker-compose.yml` any more.
- **Test counts must not drop except where tests are deliberately deleted.** The onboarding removal this plan
  was written to do has already happened, in plan 02 task 5, so its 72 unit and 5 e2e tests are already out of
  the baseline. Record the arithmetic in each completion note so a future reader can tell a deliberate
  deletion from a regression. The baseline this plan starts from is **1,256 unit and 17 e2e**, measured on
  `master` at `5dc0d08` after plan 02 merged — not the 1,229 an earlier revision of this line quoted, which
  was counted mid-run before that plan's own review commits added 27 more.
  - **One deliberate drop is expected: `apps/crons`'s 10 tests**, when task 2 deletes it. So 1,256 → **1,246**,
    and nothing after that should move. The e2e count does not change at all — no task here touches a page.
- `REDIS_URL=redis://127.0.0.1:6379` and `yarn idam:users` are needed for `test:e2e` in the devcontainer.
  See the README.

## Validation Commands

- `yarn install --immutable`
- `yarn lint`
- `yarn build`
- `yarn test`

**`yarn test:e2e` is deliberately not in that list.** Every command above runs after *every* task, and the
e2e suite needs a built app, `docker compose up -d redis idam` and `yarn idam:users` seeded first — so as a
validation command it goes red on the first task and stays red, failing tasks that are themselves fine. It
was in this list until 2026-09-10 with a "— by hand" annotation, which a human reads and the runner does
not. Run it **once, by hand, at the end of the plan**, and check it against the 17-test baseline above.

## Tasks

### Task 1: Delete the onboarding demo

**Already done, 2026-09-09, by plan 02 task 5, and verified and ticked the same day.** It could not be
deferred: `libs/onboarding` was the only thing still importing `@hmcts/postgres-prisma`, which task 5
deletes, and task 5's own constraint is to leave `yarn build` green. Decision 3 above is what was carried
out, unchanged. The test-count arithmetic in Constraints has been revised accordingly: the 72 unit and 5
e2e tests were charged to plan 02, so **this task's own delta is zero**.

- [x] Delete `libs/onboarding/` entirely, and remove `@hmcts/onboarding` from every `package.json` naming it
- [x] Delete `apps/web/src/pages/onboarding/` — `(start)`, `(name)`, `(role)`, `(date-of-birth)`, `(address)`,
      `(summary)`, `confirmation` and `index.ts`
- [x] Delete `e2e-tests/tests/onboarding-happy-path.spec.ts` (5 tests)
- [x] Remove the `onboarding_submission` table's migration only if plan 02 has not already deleted the
      migrations wholesale. **Do not** hand-edit a committed Flyway or Prisma migration that has been applied
      anywhere
- [x] Check `e2e-tests/tests/idam-session.ts` and `deed-polls.spec.ts`, both of which mention onboarding, and
      remove only the onboarding references — not the sign-in helper they share
- [x] The Welsh-language e2e test is **safe** — checked while writing this plan: it targets
      `/accessibility-statement`, not an onboarding page. Do not delete it. Its own comment explains why it
      cannot use a deed-poll page (those need a session and their `cy` still holds English), so if onboarding
      removal ever appears to break it, the cause is elsewhere
- [x] Mark completed, recording the unit and e2e test-count delta

**Verified and ticked, 2026-09-09.** Every box was satisfied by plan 02 task 5, checked rather than assumed:
`libs/onboarding/`, the eight pages, their two asset entries and
`e2e-tests/tests/onboarding-happy-path.spec.ts` are gone, the migrations went wholesale so there was no
`onboarding_submission` migration left to hand-edit, and `idam-session.ts` / `deed-polls.spec.ts` kept the
shared sign-in helper. The Welsh test still targets `/accessibility-statement`. **Test-count delta for this
task: zero** — the 72 unit and 5 e2e tests were already charged to plan 02.

### Task 2: Delete apps/crons

- [x] Delete `apps/crons/`, including its `helm/` subchart
- [x] Remove the `deed-poll-admin-crons` dependency and its `crons.enabled` condition from
      `helm/deed-poll-admin/Chart.yaml` and both values templates
- [x] Remove `@hmcts/crons` from the workspace and any `turbo.json` reference
- [x] Mark completed

**Completed 2026-09-10.** `apps/` now holds `web` alone, and `helm/deed-poll-admin/Chart.yaml` has one
dependency. Three things the checkboxes did not name and a future reader should not have to re-find:

- **`turbo.json` never referenced `crons`** — its task graph is entirely glob-driven, so there was nothing
  to remove. The `@hmcts/crons` workspace membership came from the `apps/*` glob plus a `tsconfig.json`
  `paths` entry pointing at `./apps/crons/src`; the glob stays for `apps/web` until task 3, and the path
  mapping is gone.
- **`yarn install --immutable` fails on this task's own deletion and that is correct.** Removing a
  workspace member necessarily changes `yarn.lock`, and `--immutable` forbids exactly that. Run a plain
  `yarn install` to drop the `@hmcts/crons@workspace:apps/crons` entry, then `--immutable` passes. The same
  will be true of task 3.
- **One stale comment went with it.** `apps/web/src/secrets.ts` cited `apps/crons/src/index.ts` as
  precedent for awaiting secrets in the entrypoint. The reasoning above it stands on its own; the citation
  now points at nothing.

**Test-count delta: −10 unit, 0 e2e — exactly the deliberate drop Constraints predicts.** Measured
`1,256 → 1,246` by summing the per-package totals from `yarn test:force` before and after: crons' 10 tests
(`src/example.test.ts`, `src/index.test.ts`) and no others. Every other package is unchanged to the test —
web 327, deed-poll 443, cloud-native-platform 140, deed-poll-api-client 138, express-govuk-starter 127,
simple-router 41, express-session-postgres 23, express-session-redis 7. `yarn lint`, `yarn build` and
`yarn test` are green.

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
- [ ] **Rename `values.template.yaml` to `values.aat.template.yaml`, and put the real configuration in
      `values.yaml`.** This is the mechanism, not a tidy-up: `helmInstall` renders `values.template.yaml`
      *over* `values.yaml` and passes the result in its place, so anything in `values.yaml` that the template
      does not restate is silently lost. `values.${environment}.template.yaml` is instead **appended** to
      helm's `-f` list, so it layers. `pcs-frontend` and `deed-poll-web` both have only the environment-scoped
      form and no bare `values.template.yaml` — match them. Keep `values.preview.template.yaml`
- [ ] Collapse the umbrella chart into a single `nodejs` chart — no `dependencies:`, no subcharts, no
      `*.enabled` conditions. Model on `pt-frontend`/`pcs-frontend`, not on `pcs-api`
- [ ] Replace `${WEB_IMAGE}` with `${IMAGE_NAME}`, which is what `helmInstall` actually exports. Delete the
      `${CRONS_IMAGE}` block — `${API_IMAGE}` and `${POSTGRES_IMAGE}` went with plan 02
- [ ] **Use `${SERVICE_FQDN}` for the ingress host, and stop hand-rolling it.** Read "The hostname" above
      first — this is a decision, not a rename. `values.aat.template.yaml` sets `ingressHost: ${SERVICE_FQDN}`
      and derives `IDAM_REDIRECT_URI` from the same variable; `values.yaml` carries
      `deed-poll-admin.{{ .Values.global.environment }}.platform.hmcts.net`, matching `deed-poll-web`'s shape.
      **`${TEAM_NAME}` and `${ENVIRONMENT}` must not appear anywhere in the chart** — neither is exported to
      the template, and `TEAM_NAME` is a team display name, not a slug
- [ ] **Check `idam-access-config#993` states the same hosts before ticking the box above.** At the time of
      writing it is open and states the old hand-rolled host; the agreed correction is in "The hostname"
      above. If it has since merged, **stop and read what it actually says** rather than assuming. A
      mismatch is not caught by any test here — it fails at login, in one environment only
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
- **Unit tests 1,246 and e2e 17.** From a 1,256 baseline, the only drop is `apps/crons`'s 10 tests, deleted
  with it in task 2. The onboarding tests this plan was originally written to remove were already deleted by
  plan 02. Any other drop is a regression — say so in the completion note either way, rather than leaving a
  reader to work out whether tests vanished on purpose.
- No `apps/` directory. No `helm/` directory. No `libs/onboarding`. No `@hmcts/crons`.
- `charts/deed-poll-admin/values.yaml` exists, and `charts/deed-poll-admin/` contains no `dependencies:`.
- A root `Dockerfile` exists and is the one the pipeline would build.
- Grepping the repo for `WEB_IMAGE`, `CRONS_IMAGE` and `postgres-url` returns nothing. `API_IMAGE` and
  `POSTGRES_IMAGE` already do.
- `charts/deed-poll-admin/values.aat.template.yaml` derives both the ingress host and `IDAM_REDIRECT_URI`
  from `${SERVICE_FQDN}`, `values.yaml` carries the `{{ .Values.global.environment }}` service host, and
  **`TEAM_NAME` appears in no hostname anywhere**. The chart and `idam-access-config#993` state the same
  hosts, and `IDAM_REGISTRATION_REQUEST.md` has been corrected, since it currently defends the doubled
  segment as deliberate.
- `yarn test:smoke` exists and passes against a running app.
- `libs/` still contains the seven surviving packages — `express-session-postgres` among them, and
  `deed-poll-api-client`, which plan 02 added.

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
