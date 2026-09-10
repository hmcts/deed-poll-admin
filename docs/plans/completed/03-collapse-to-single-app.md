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

- [x] Move `apps/web/src/` → `src/`, `apps/web/config/` → `config/`, `apps/web/Dockerfile` → `Dockerfile`,
      `apps/web/vite.build.ts` → `vite.build.ts`
- [x] Merge `apps/web/package.json`'s dependencies and scripts into the root `package.json`. Remove the
      `apps/*` workspace glob; keep `libs/*` and `e2e-tests`
- [x] Merge `apps/web/tsconfig.json` into the root `tsconfig.json`, keeping the `libs/*` path mappings
      — done as a **split**, not a merge, for a reason the note below records: the app's project settings
      are in a new `tsconfig.app.json` and only the `paths` stayed at the root
- [x] Update every relative path that crossed the old boundary. Known ones, all currently
      `../helm/values.yaml` from `src/`: `src/secrets.ts` and its test's `toMatch(/apps\/web\/helm\/…/)`
      assertion. Grep for `apps/web`, `../../`, and `DATA_DIR` before declaring this done
- [x] Update `vitest.config.ts`, `turbo.json`, `sonar-project.properties` and `scripts/merge-lcov.mjs` — all
      four encode the workspace layout
- [x] `yarn install --immutable`, then all four validation commands
- [x] Mark completed

**Completed 2026-09-10.** `apps/` is gone: the application is the root package, `src/` and `config/` sit at
the root, and `workspaces` is `["e2e-tests", "libs/*"]`. Six things the checkboxes did not name.

- **Turbo will not run a root-package script unless the task is named `//#<task>`,** and a root task called
  `//#build` makes `yarn build` — which *is* `turbo build` — invoke itself. So the app's tasks are
  `//#build:app`, `//#test:app`, `//#dev:app`, and each orchestrating script runs `turbo <x> <x>:app`. The
  `:app` suffix is load-bearing, not decoration. Libraries still build first via `^build`.
- **`apps/web/tsconfig.json` could not simply be merged up, and merging it up costs 44 tests.** Giving the
  root `tsconfig.json` an `include` of `src/**/*` broke `libs/deed-poll`, every failure of the shape
  `deed-poll-api call failed (unavailable)` or `expected Error … to be an instance of NotFoundError`.
  `vite-tsconfig-paths` matches each source file against the tsconfig *projects* it discovers — files
  literally named `tsconfig.json` — to decide whether the `paths` aliases apply, and the root file was the
  only project covering a library's *test* files, because every `libs/*/tsconfig.json` excludes
  `**/*.test.ts`. Once it had an `include`, those tests matched no project: `service.ts` resolved
  `@hmcts/deed-poll-api-client` to the library source while its test resolved the built `dist`, so the two
  held different module instances and every `vi.mock` of the adapter silently stopped applying. The fix is
  `tsconfig.app.json`, which tsconfck does not discover as a project. `build:app` is therefore
  `tsc -p tsconfig.app.json && vite build …`.
- **`references` is one of the few fields `extends` does not inherit** (checked with `tsc --showConfig`, not
  assumed), which is why they are restated in `tsconfig.app.json`. They are what stops the source-resolving
  `paths` from dragging `libs/**` into the app's `rootDir`. It lists the same five libraries `apps/web` did
  and no more: `simple-router` is not `composite`, so referencing it is a hard `TS6306`.
- **`yarn lint` is now `biome check .` at the root, and that sweeps wider than the old `turbo lint` did.**
  Two consequences. `biome.json` needed `vcs.enabled` + `useIgnoreFile` or the gitignored `power_app_nest/`
  prototype contributed 98 errors from 16 files. And `.devcontainer/devcontainer.json`,
  `e2e-tests/playwright.config.ts` and `templates/tech-spec-references/welsh-translations.json` are
  reformatted in this commit — verified by reverting them, which reintroduces 3 errors. `lint:changed` and
  `lint:fix:changed` are gone rather than re-pathed: as `turbo lint --filter=…` they would have skipped the
  application entirely, since the root package has no `lint` task.
- **`apps/web/helm/` is at `helm/web/` for now.** Task 3's checkboxes never mention it, but leaving it put
  would have kept `apps/` alive; task 4 deletes `helm/` wholesale. `helm/deed-poll-admin/Chart.yaml` points
  at `file://../web` in the interim.
- **`dist/pages` output is wrong, and was wrong before this task.** It nests as
  `dist/pages/src/pages/deed-polls/deed-polls/note-edit.njk`. Confirmed pre-existing by building master in a
  throwaway worktree, which produced the identically broken `apps/web/dist/pages/src/pages/errors/errors/403.njk`.
  Out of scope for a relocation; task 5 owns "confirm it builds from the flattened layout" and should decide.

**Test-count delta: 0 unit, 0 e2e.** 1,246 before and after, summed from the per-package totals in
`yarn test`: app-at-root 327 (29 files), deed-poll 443, cloud-native-platform 140, deed-poll-api-client 138,
express-govuk-starter 127, simple-router 41, express-session-postgres 23, express-session-redis 7. The 327
that were `@hmcts/web`'s now report under `//:test:app`. `yarn install --immutable`, `yarn lint` (260 files,
0 errors, 2 pre-existing `noUndeclaredEnvVars` warnings), `yarn build` (8/8) and `yarn test` are all green.
One measurement trap worth recording: a `yarn test` run from inside `libs/deed-poll` reports 443 passing and
exits 0, which looks like a green whole-repo suite and is not one. Check the package list turbo prints.

### Task 4: One chart at charts/deed-poll-admin

- [x] Create `charts/deed-poll-admin/` and delete `helm/`. The directory name is not a preference:
      `Helm.HELM_RESOURCES_DIR` is the literal `charts` and `helmInstall` throws without it
- [x] Write `charts/deed-poll-admin/values.yaml`. `helmInstall` requires this file to exist before it applies
      `values.template.yaml`; its absence is blocker 1 in `PIPELINES.md`
- [x] **Rename `values.template.yaml` to `values.aat.template.yaml`, and put the real configuration in
      `values.yaml`.** This is the mechanism, not a tidy-up: `helmInstall` renders `values.template.yaml`
      *over* `values.yaml` and passes the result in its place, so anything in `values.yaml` that the template
      does not restate is silently lost. `values.${environment}.template.yaml` is instead **appended** to
      helm's `-f` list, so it layers. `pcs-frontend` and `deed-poll-web` both have only the environment-scoped
      form and no bare `values.template.yaml` — match them. Keep `values.preview.template.yaml`
- [x] Collapse the umbrella chart into a single `nodejs` chart — no `dependencies:`, no subcharts, no
      `*.enabled` conditions. Model on `pt-frontend`/`pcs-frontend`, not on `pcs-api`
      — **done with two deliberate exceptions, both forced; see the note below**
- [x] Replace `${WEB_IMAGE}` with `${IMAGE_NAME}`, which is what `helmInstall` actually exports. Delete the
      `${CRONS_IMAGE}` block — `${API_IMAGE}` and `${POSTGRES_IMAGE}` went with plan 02
- [x] **Use `${SERVICE_FQDN}` for the ingress host, and stop hand-rolling it.** Read "The hostname" above
      first — this is a decision, not a rename. `values.aat.template.yaml` sets `ingressHost: ${SERVICE_FQDN}`
      and derives `IDAM_REDIRECT_URI` from the same variable; `values.yaml` carries
      `deed-poll-admin.{{ .Values.global.environment }}.platform.hmcts.net`, matching `deed-poll-web`'s shape.
      **`${TEAM_NAME}` and `${ENVIRONMENT}` must not appear anywhere in the chart** — neither is exported to
      the template, and `TEAM_NAME` is a team display name, not a slug
- [x] **Check `idam-access-config#993` states the same hosts before ticking the box above.** At the time of
      writing it is open and states the old hand-rolled host; the agreed correction is in "The hostname"
      above. If it has since merged, **stop and read what it actually says** rather than assuming. A
      mismatch is not caught by any test here — it fails at login, in one environment only
      — **checked against the PR branch, still open, still the old host; recorded, not silently accepted**
- [x] Carry these forward verbatim rather than re-deriving them — each was established at cost:
  - `keyVaults:` reads `app-insights-connection-string`, `redis-url`, `admin-session-secret` and
    `admin-idam-client-secret`. **No `postgres-url`** — plan 02 removed the database
  - `IDAM_REDIRECT_URI` **must** equal the chart's own `ingressHost` with `/oauth2/callback` appended, and
    must be registered with IDAM verbatim. A mismatch breaks login in that environment and nowhere else
  - Probes point at `/health/readiness` and `/health/liveness`
- [x] **Resolve preview environments' session store** — blocker 4 in `PIPELINES.md`, and a decision, not a
      rename. `assertRedisUrl` refuses `config/default.json`'s loopback default outside development, so a
      preview pod fails fast rather than coming up sessionless. Either enable a `redis` subchart per PR, or
      point preview at the AAT cache's `redis-url`. **Record which and why in the chart**
      — **decided: an ephemeral `redis` subchart per PR**
- [x] Mark completed

**Completed 2026-09-10.** `charts/deed-poll-admin/` holds `Chart.yaml`, `values.yaml`,
`values.aat.template.yaml`, `values.preview.template.yaml` and `.helmignore`; `helm/` is gone, taking
`helm/web/` — the subchart task 3 parked there — with it. `src/deployment-chart.test.ts` pins the chart
against the sixteen things the pipeline requires of it, because every one of them fails only on a real
Jenkins run. Six things the checkboxes did not name.

- **"No `dependencies:`" cannot be met literally, and the success criterion that repeats it is wrong.** A
  `nodejs` chart *is* a dependency on the `nodejs` base chart at `oci://hmctsprod.azurecr.io/helm` — that is
  what makes it a CNP chart rather than a bare set of templates — and `deed-poll-web` and `pcs-frontend` both
  declare it. What the bullet means, and what was done, is **no `file://` dependency on a directory in this
  repo and no `*.enabled` condition gating one of our own components**: the four
  `deed-poll-admin-{web,api,crons,postgres}` subcharts and their `web.enabled` / `crons.enabled` toggles are
  gone. Two dependencies remain: `nodejs`, and `redis`.
- **`redis` is the second exception, and the two bullets conflict.** "No subcharts, no `*.enabled`
  conditions" and "resolve preview's session store — either enable a `redis` subchart per PR, or point
  preview at the AAT cache" cannot both be honoured. The subchart wins: pointing every open PR at AAT's cache
  shares one keyspace across all of them, so a flush or a key collision in one PR is felt in the rest, and
  preview sessions outlive the PR inside a store nothing here can clear. So `redis.enabled` is `false` in
  `values.yaml` and `true` in `values.preview.template.yaml` only — the one `*.enabled` condition left, and it
  switches an upstream chart rather than one of ours. `deed-poll-web` settled the same question the same way,
  and its preview block is copied wholesale including the HDPI-8155 probe budget.
- **The preview failure mode here is not `deed-poll-web`'s, and the comment says so.** A never-Ready redis
  master crashloops that app, because it awaits its client. This one does not: `getRedisClient` races
  `connect()` against `REDIS_CONNECT_TIMEOUT_MS` and serves anyway, so the pod comes up and `redisStatus`
  reports `redis: DOWN` for ever — which keeps it out of its own Service. Same cause, same fix, different
  symptom, and a copied comment claiming a crashloop would send someone looking at the wrong logs.
- **`src/secrets.ts` pointed into `helm/`, so deleting it would have silently unaliased every secret.** It
  reads the chart out of the image to build the Key Vault alias map, and
  `getPropertiesVolumeSecrets` swallows a missing or unparseable chart — returning an empty map rather than
  throwing — so every secret would have arrived under its vault name and nothing would have failed until the
  first `config.get` in a deployed pod. It now reads `../charts/deed-poll-admin/values.yaml`, and the test
  asserts the path out of the source rather than recomputing it. `charts/` is not in `.dockerignore`, and the
  runtime stage is `FROM base`, so the file is in the image.
- **`js-yaml` is a new root devDependency**, pinned at `4.3.2` with `@types/js-yaml` at `4.0.9` — the
  versions already in the lockfile via `libs/cloud-native-platform`, which parses the same chart in
  production code. The chart test needs structural reads (`redis.master.readinessProbe.timeoutSeconds`,
  the vault list) that string matching cannot do honestly. So `yarn install --immutable` fails on this task's
  own change, as it did in tasks 2 and 3: run plain `yarn install` first.
- **`WEB_IMAGE`, `CRONS_IMAGE` and `postgres-url` do not grep clean, and should not.** The success criterion
  asks for zero hits; there are four, all of them the deliberate record of an absence — the test that asserts
  no database secret has to name `postgres-url` to forbid it, and the comment explaining why the image
  variable is `${IMAGE_NAME}` has to name what it replaced. No chart value or code path references any of
  them.

**The hostname, and what is now out of step with it.** The chart states
`deed-poll-admin-staging.aat.platform.hmcts.net` in AAT (`${SERVICE_FQDN}`) and
`deed-poll-admin.{{ .Values.global.environment }}.platform.hmcts.net` elsewhere.
[`idam-access-config#993`](https://github.com/hmcts/idam-access-config/pull/993) was read on its own branch
rather than assumed: **still open, still registering the old
`deed-poll-deed-poll-admin-staging-web.{env}.platform.hmcts.net`**, so it must be corrected before it merges
or login fails on IDAM's page after a successful sign-in, where nothing here logs. Correcting an external PR
is not this repo's to do, so the record was corrected instead —
`.business_context/IDAM_REGISTRATION_REQUEST.md` no longer defends the doubled segment as "per platform
pattern" and states the two hosts to register, and `.business_context/idam-pr/README.md` says the same
without editing the submitted YAML, which is a record of what *was* sent. Reading #993 also turned up
something the plan did not anticipate: it has IDAM write the client secret to `deed-poll-<<ENV>>` as
`idam-client-secret`, while this chart reads `admin-idam-client-secret` — per-component because the vault is
shared with `deed-poll-web`. One of the two has to move, and the chart's is the name
`hmcts/deed-poll-infra` provisions. Raised in that document, not fixed here.

**Test-count delta: +17 unit, 0 e2e — 1,246 → 1,263, all seventeen in `src/deployment-chart.test.ts`.**
Deliberate, not a regression in the other direction: every assertion in it fails only on a real Jenkins
deploy otherwise. Per-package totals from `yarn test:force`: app-at-root 344, deed-poll 443,
cloud-native-platform 140, deed-poll-api-client 138, express-govuk-starter 127, simple-router 41,
express-session-postgres 23, express-session-redis 7 — every package but the app unchanged to the test. Two
existing fixtures moved with the hostname decision and neither changes behaviour: `src/auth/settings.test.ts`
asserted against the old doubled host, and its comment cited `apps/web/helm/values.yaml`.
`yarn install --immutable`, `yarn lint` (261 files, 0 errors, the same 2 pre-existing `noUndeclaredEnvVars`
warnings), `yarn build` (8/8) and `yarn test` (8/8) are green.

### Task 5: Root Dockerfile and the pipeline

- [x] The moved `Dockerfile` is now the root one `az acr build … .` expects. Confirm it builds from the
      flattened layout and still runs `yarn build`, which is the **only** type-check in the pipeline —
      `YarnBuilder.build()` is `yarn lint` and nothing else
- [x] `Jenkinsfile_CNP` keeps `withPipeline("nodejs", "deed-poll", "admin")` and its empty body. Confirm the
      library pin still matches `deed-poll-infra`'s (`2.4.4` at time of writing), so the product's two
      pipelines move together
- [x] Add `yarn test:smoke` — blocker 3. `sectionDeployToAKS` calls `builder.smokeTest()` after **every**
      deploy, unconditionally, so its absence fails the run the first time a deploy succeeds. A single
      request asserting `/health/readiness` is `UP` is enough; do not build a second e2e suite
      — **and `yarn test:functional` with it; see the note on why that half was the more urgent one**
- [x] Wire `yarn test:e2e` into a stage, or record explicitly that it still runs nowhere. It is the only
      thing that exercises a real `RedisStore` round trip and it currently runs in no pipeline at all
      — **recorded, not wired**
- [x] Mark completed

**Completed 2026-09-10.** `yarn test:smoke` runs `e2e-tests/tests/smoke.spec.ts` — one request, asserting
`/health/readiness` answers 200 with `{ status: "UP", services: { deedPollApi: "UP", redis: "UP" } }` — and
`src/pipeline.test.ts` pins the six scripts the pipeline invokes, the `product`/`component`/`type` triple and
the library pin's shape. Six things the checkboxes did not name.

- **The Dockerfile was built, not read.** `hmctsprod.azurecr.io/base/node:22-alpine` needs ACR credentials
  this environment has none of, so the check was run against a shim base (`node:22-alpine`, an `hmcts` user,
  `WORKDIR /opt/app`) with every other line of the real file verbatim. It builds: `yarn install` resolves the
  flattened workspaces, `yarn build` runs 8/8 inside the image, `yarn workspaces focus --production` with no
  workspace name pulls `libs/*` through the `workspace:*` links, and the runtime stage holds `dist/server.js`
  **and `charts/deed-poll-admin/values.yaml`** — the file `src/secrets.ts` reads to build the Key Vault alias
  map, which `.dockerignore` does not exclude.
- **Task 3's open question about `dist/pages` is answered, and the answer is "leave it".** The doubled nesting
  (`dist/pages/src/pages/deed-polls/deed-polls/index.njk`) is not merely harmless, it is load-bearing:
  `collectViewPaths` in `configureGovuk` adds *every* directory under `dist/pages` as a nunjucks search path,
  so `res.render("deed-polls/index")` resolves against the `…/src/pages/deed-polls` one. Flattening the copy
  would change template resolution for every page, which is not a relocation. Confirmed rather than reasoned:
  the whole Playwright suite passes against `node dist/server.js` with `VITE_MIDDLEWARE=false`, so every page
  and every built asset serves from the flattened output. The reasoning is now a comment on the
  `viteStaticCopy` target that produces it.
- **`yarn test:functional` was the more urgent half of blocker 3, and the plan did not say so.**
  `Environment.functionalTestEnvironments` is `[aat, preview, idam-aat, idam-preview]`, so
  `onFunctionalTestEnvironment` fires on **every pull request** — the missing script would have failed the
  first successful preview deploy, before any release to AAT. It is an echo explaining itself, the same shape
  as `test:a11y` and the same shape `deed-poll-web` settled on: there is no deployed environment with an IDAM
  client, a test account or an api to run journeys against.
- **The smoke gate is deliberately coupled to `deed-poll-api`, so it stays red until api deploys.** Readiness
  names api and Redis and liveness is empty, which is the whole design in `src/app.ts` — so asserting
  liveness instead would buy a green stage that says only "the process is answering". Gap 6 in
  `PIPELINES.md` is the reason it will fail first, and that is the right failure: a pod that 500s every case
  page has not deployed successfully.
- **Two reporter traps, both silent, and `YarnBuilder` swallows each.** `smokeTest()` collects
  `smoke-output/**/*result.xml` with `allowEmptyResults: true`, and `playwright.config.ts` gates its junit
  reporter on `CI`, which Jenkins does not set — so a smoke run would have reported to the console only and
  published nothing while still looking green. `test:smoke` therefore sets the reporters on the command line
  (`--reporter=list,junit`, `PLAYWRIGHT_JUNIT_OUTPUT_NAME=../smoke-output/smoke-result.xml`) rather than
  changing the config, which would have re-pointed the e2e run's output too. `smoke-output/` is now
  gitignored and dockerignored.
- **`EXPRESSJS_MONOREPO_TEMPLATE_WEB_URL` is gone from the e2e config**, and that is a fix rather than a
  tidy-up now that something depends on `TEST_URL`. It was read *first* for `baseURL` and for the `webServer`
  decision, and nothing in this repo or the pipeline sets it — so set on an agent it would have outranked
  `TEST_URL` and pointed the post-deploy gate at the wrong host while reporting green. `deed-poll-web`
  removed it for the same reason. `.business_context/PROGRESS.md` still mentions it as history; task 6 owns
  that file.

**Test-count delta: +10 unit, +1 e2e — 1,263 → 1,273 and 17 → 18.** Both deliberate: the ten are
`src/pipeline.test.ts`, and the one is the smoke spec, which the default `yarn test:e2e` run also picks up
because it is a spec in the suite rather than a separate one. Per-package totals from `yarn test:force`:
app-at-root 354, deed-poll 443, cloud-native-platform 140, deed-poll-api-client 138, express-govuk-starter
127, simple-router 41, express-session-postgres 23, express-session-redis 7 — every package but the app
unchanged to the test. `yarn install --immutable`, `yarn lint` (263 files, 0 errors, the same 2 pre-existing
`noUndeclaredEnvVars` warnings), `yarn build` (8/8) and `yarn test` (8/8) are green. `yarn test:smoke` was run
against a real app on :3200 + :3000 and passes, writing `smoke-output/smoke-result.xml` where `smokeTest()`
looks for it; `yarn test:e2e` passes 18/18 twice — once against `tsx src/server.ts` and once against
`node dist/server.js`.

### Task 6: Documentation and the record

- [x] `CLAUDE.md` — the Project Structure tree is now wrong in every line. Rewrite for the flat layout, and
      remove the four-app description. Its "Deployment and sessions" section survives
- [x] `docs/PIPELINES.md` — blockers 1–4 are resolved or resolved-by-deletion. Rewrite that section to say
      what is actually left, which should be only external onboarding
- [x] `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/DEMO.md`, `README.md` — all describe four apps,
      `helm/`, and in places a database. Check each; several were corrected during plan 01 and will be wrong
      again
- [x] `.claude/agents/infrastructure-engineer.md` — it is instructions rather than prose, so a stale layout
      there actively misleads a future session. Highest-value fix in this task
- [x] `.business_context/PROGRESS.md` — record the collapse, the test-count arithmetic, and the preview-Redis
      decision from task 4
- [x] Delete the untracked strays if still present: `lcov.info`, `power_app_nest/` and `data/` are all
      untracked and empty or generated. `steves_notes.md` is Steve's and is gitignored — **leave it**
      — **`power_app_nest/` deliberately kept, see the note below**
- [x] `yarn progress:write`
- [x] Mark completed

**Completed 2026-09-10.** Six documentation surfaces rewritten, plus four the checkboxes did not name and one
deviation.

- **`CLAUDE.md`** — the flat tree, and the two mechanical consequences a future session would otherwise
  rediscover: the `//#<task>` root-task rule, and `tsconfig.app.json` (44 silent failures if the app's
  settings are merged into the root project). The pipeline bullet now names all six `yarn` scripts, not
  three, and the paths `apps/web/src/{app,errors}.ts` and `apps/web/helm/values.yaml` are corrected.
- **`docs/PIPELINES.md`** — the blocker section now opens "**Nothing left in this repo.**" Items 1–4 are
  struck through with what resolved each, and the numbering is kept so anything citing "blocker 4" still
  resolves. Item 5 gained the two things that bite first: the `team-config.yml` hard-fail, which happens
  *before* any build so the cause is not in this repo, and the IDAM host mismatch — `idam-access-config#993`
  open and still registering the old hand-rolled host, plus `idam-client-secret` against this chart's
  `admin-idam-client-secret`. Also corrected: coverage is now one root report plus seven `libs/*`, and the
  root `lcov.info` is a gitignored artefact.
- **`docs/DEPLOYMENT.md` and `docs/ARCHITECTURE.md`** — "Umbrella Chart Structure" replaced by "one chart,
  one component", with the mechanical reason (`${IMAGE_NAME}` is the only image variable) rather than a
  preference. Preview's ephemeral Redis is documented as decided, including the rejected shared-cache
  alternative, the HDPI-8155 probe budget, and why the vault list is re-declared minus `redis-url`
  (`getPropertiesVolumeSecrets` writes every mounted secret unconditionally on the mount-point path).
- **`README.md`** and **`docs/DEMO.md`** — the "Monorepo Architecture" framing and the four-app tree are
  gone; the new-module recipe now points at the root `package.json` and `src/pages/`.
- **`.claude/agents/infrastructure-engineer.md`** was the largest rewrite, and worth the space: it carried a
  complete umbrella-chart recipe with `file://../../apps/{web,crons}/helm` dependencies and hostnames built
  from `${TEAM_NAME}`/`${ENVIRONMENT}`. An agent following it would have rebuilt exactly what task 4
  removed. Now: the single chart, the five variables `helmInstall` actually exports, the three rules that
  fail only on a real Jenkins run, and preview's Redis with its reasons.
- **Four surfaces the checkboxes did not name, found by grepping for `apps/web`.** The `paths:` frontmatter
  in `.claude/rules/backend.md` and `.claude/rules/frontend.md` still globbed `apps/web/src/pages/**`, so
  **both rule files had silently stopped matching anything** since task 3 — a functional break, not stale
  prose. Fixed, along with `.claude/agents/full-stack-engineer.md` and
  `.claude/skills/module-scaffold/SKILL.md`. Ten in-repo `apps/web/src/…` paths in source docblocks were
  re-pointed too; the one in `libs/deed-poll/src/api/deed-poll-api.ts` naming
  `deed-poll-web/apps/web/…` is another repo's path and correct.
- **Every reference to `docs/plans/02-dal-cutover-to-api.md` was broken**, in 33 files: plans 01 and 02 moved
  into `docs/plans/completed/` and nothing followed them. Repointed repo-wide.
- **`.business_context/PROGRESS.md`** has a new newest-first section recording the collapse in seven points,
  the arithmetic, and the preview-Redis decision with its rejected alternative. Two stale rows corrected: the
  "six blockers" row and a `helm/deed-poll-admin/Chart.yaml` citation.

**Deviation: `power_app_nest/` was not deleted, and the checkbox's premise about it is wrong.** It is not
empty or generated — it is the 501M Nest prototype this repo's domain functions were ported from. It has no
git repository of its own and is gitignored, so nothing could restore it; `libs/deed-poll/src/index.ts` and
several `.business_context/` documents cite it; and `scripts/progress-dashboard.mjs` reads it to count the
prototype's scope, degrading that figure permanently if it goes. Deleting it buys back disk at the cost of
the only copy. Recorded in PROGRESS.md so the decision is not rediscovered as an oversight. `lcov.info` (a
`yarn test:coverage` artefact) and an empty `data/` were deleted, as was the empty leftover `apps/`.
`steves_notes.md` untouched.

**Test-count delta: 0 unit, 0 e2e.** 1,273 unit across 8 packages and 18 e2e, both unchanged — this task
touched no test. `yarn lint`, `yarn build`, `yarn test` green, and `yarn test:e2e` passes 18/18, which is the
one hand-run this plan's Validation section defers to the end.

## Success criteria

- `yarn lint`, `yarn build`, `yarn test` and `yarn test:e2e` all pass.
- **Unit tests 1,273 and e2e 18.** From a 1,256 baseline, the only drop is `apps/crons`'s 10 tests, deleted
  with it in task 2 (1,256 → 1,246). Two additions, both revised in the task that made them, from the 1,246
  and 17 this line first quoted — which assumed the plan added no tests of its own: task 4's 17 in
  `src/deployment-chart.test.ts` (1,246 → 1,263) and task 5's 10 in `src/pipeline.test.ts` (1,263 → 1,273),
  plus task 5's one e2e spec, the `@smoke` one (17 → 18). The onboarding tests this plan was originally
  written to remove were already deleted by plan 02. Any other drop is a regression — say so in the
  completion note either way, rather than leaving a reader to work out whether tests vanished on purpose.
- No `apps/` directory. No `helm/` directory. No `libs/onboarding`. No `@hmcts/crons`.
- `charts/deed-poll-admin/values.yaml` exists, and `charts/deed-poll-admin/Chart.yaml` declares no `file://`
  dependency and no condition gating one of this repo's own components. Revised in task 4 from "contains no
  `dependencies:`", which is not satisfiable: a `nodejs` chart depends on the `nodejs` base chart by
  definition. It declares two — `nodejs`, and the `redis` that task 4 turned on for preview only.
- A root `Dockerfile` exists and is the one the pipeline would build — moved in task 3, and built in task 5
  against a shim base image, since the real one needs ACR credentials.
- Grepping the repo for `WEB_IMAGE`, `CRONS_IMAGE` and `postgres-url` returns **no chart value and no code
  path** — revised in task 4 from "returns nothing", which the assertion forbidding a database secret has to
  break by naming it. Four hits remain, all of them a deliberate record of an absence. `API_IMAGE` and
  `POSTGRES_IMAGE` return nothing at all.
- `charts/deed-poll-admin/values.aat.template.yaml` derives both the ingress host and `IDAM_REDIRECT_URI`
  from `${SERVICE_FQDN}`, `values.yaml` carries the `{{ .Values.global.environment }}` service host, and
  **`TEAM_NAME` appears in no hostname anywhere**. The chart and `idam-access-config#993` state the same
  hosts, and `IDAM_REGISTRATION_REQUEST.md` has been corrected, since it currently defends the doubled
  segment as deliberate.
- `yarn test:smoke` exists and passes against a running app. So does `yarn test:functional`, added with it in
  task 5: `functionalTestEnvironments` includes `preview`, so the pipeline invokes it on every pull request.
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
