# CI/CD Pipeline Guide

This repo builds and deploys through the **Jenkins CNP pipeline**. `Jenkinsfile_CNP` at the repo root is the
whole configuration:

```groovy
@Library("Infrastructure@2.4.4") _

def type = "nodejs"
def product = "deed-poll"
def component = "admin"

withPipeline(type, product, component) {
}
```

`.github/workflows/` no longer exists. It held a 44-file GitHub Actions pipeline
(`workflow.main.yml`, `workflow.preview.yml`, and the `stage.*` / `job.*` files it composed), deleted
wholesale — see [`.business_context/DEED_POLL_INFRA_PLAN.md`](../.business_context/DEED_POLL_INFRA_PLAN.md),
Decisions 1 and 3, for why, and for the one thing genuinely lost by the move (CodeQL, which has no Jenkins
equivalent). `.github/renovate.json` stays: it is configuration, not a workflow.

This repo also owns **no Terraform**. The resource group, Key Vault, App Insights and Redis all
live in [`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra), which deploys itself with
`withInfraPipeline`. There is no infrastructure stage here. The Postgres that root provisions is
`deed-poll-api`'s; this repo has no database — see
[`plans/completed/02-dal-cutover-to-api.md`](plans/completed/02-dal-cutover-to-api.md).

## What the pipeline runs

`type = "nodejs"` means the stages call `YarnBuilder`
([`cnp-jenkins-library/src/uk/gov/hmcts/contino/YarnBuilder.groovy`](https://github.com/hmcts/cnp-jenkins-library/blob/master/src/uk/gov/hmcts/contino/YarnBuilder.groovy)).
The `yarn` scripts each stage invokes, and whether this repo has them:

| Stage | Script | Present here |
|---|---|---|
| Build | `yarn lint` | yes |
| Test | `yarn test` | yes |
| Test | `yarn test:coverage` | yes |
| Test | `yarn test:a11y` | yes — a documented no-op, see below |
| Security | `yarn-audit-with-suppressions.sh`, written into the workspace by the library | n/a |
| Sonar | `sonar-scanner`, configured by `sonar-project.properties` | yes — coverage via the merge below |
| Smoke (after each deploy) | `yarn test:smoke` | yes — the `@smoke`-tagged spec, see below |
| Functional (`aat` and every preview) | `yarn test:functional` | yes — a documented no-op, see below |
| E2E | `yarn test:e2e` | yes, but the stage is **off** — see below |

Seven things worth knowing:

- **The Sonar stage needs a root `lcov.info`, and nothing in the pipeline produces one.** Vitest writes
  coverage per package (`coverage/lcov.info` for the application at the root, and one under each of the seven
  `libs/*`), with `SF:` paths relative to each package; `sonar-project.properties` points at a single root
  report — `lcov.info`, which is therefore a build artefact and gitignored. The GitHub Actions test job used to
  merge them with `npx lcov-result-merger --prepend-source-files`, and deleting that job removed the only
  step that made the file — so Sonar would have found no report and reported 0% coverage on new code, which
  is the condition the quality gate fails on. `yarn test:coverage` now ends with
  `node scripts/merge-lcov.mjs`, which does the same merge and rewrites each `SF:` path to be root-relative.
  Nothing else in the pipeline changes, because `test:coverage` is already what the test stage runs.

- **None of the test-stage scripts is optional.** `YarnBuilder.test()` is `yarn("test")` then
  `runYarn("test:coverage")` then `runYarn("test:a11y")`, and `runYarn` ends with
  `if (status != 0 && !task.contains('install')) steps.error(...)`. A missing script is not skipped — yarn
  exits non-zero on `Couldn't find a script named ...` and the stage fails. That is why the root
  `package.json` carries a `test:a11y` that only prints a line explaining itself: the axe-core assertions
  live in the Playwright suite, which needs browsers and a running app and so cannot run on the bare test
  agent, but the script has to exist for the stage to go green.

- **`yarn test:smoke` is one request, and it is deliberately coupled to `deed-poll-api`.**
  `sectionDeployToAKS` calls `builder.smokeTest()` after **every** deploy with `TEST_URL` set to the
  environment it has just deployed, so `e2e-tests/tests/smoke.spec.ts` is the only thing in this repo that
  runs against a real deployment. It asserts `/health/readiness` answers 200 with
  `{ status: "UP", services: { deedPollApi: "UP", redis: "UP" } }` — and `src/app.ts` puts both dependencies
  on readiness on purpose, so **this gate stays red until `deed-poll-api` deploys** (gap 6 below). That is
  the intended reading, not something to route around by asserting liveness: liveness is empty here, so it
  only says the process is answering, and a pod that 500s every case page has not deployed successfully.
  The rest of the Playwright suite is not tagged `@smoke` because the journeys need a caseworker signed in
  through the local `rse-idam-simulator` and fixtures from the in-memory api mock on :3200 — a deployed
  environment has neither. `src/pipeline.test.ts` pins all of this, including that exactly one spec carries
  the tag, because every one of these mistakes surfaces only on a real Jenkins run.

- **`yarn test:functional` is a no-op that has to exist, and it runs far more often than its name suggests.**
  `Environment.functionalTestEnvironments` is `[aat, preview, idam-aat, idam-preview]`, so
  `onFunctionalTestEnvironment` fires on **every pull request**, not only on a release to AAT. The script
  prints why there is no suite behind it; deleting it fails the first successful preview deploy.

- **`yarn test:e2e` runs in no pipeline, and that is a decision.** `AppPipelineConfig.e2eTest` defaults
  false and `Jenkinsfile_CNP` does not call `enableE2eTest()`, so the E2E stage never runs. It cannot, for
  the same reason the journeys are not tagged `@smoke`. Two consequences worth holding: the only thing that
  exercises a real `RedisStore` round trip runs on developer machines and nowhere else, and
  `sectionDeployToAKS` will run the suite for any PR carrying the GitHub label `enable_e2e_test` — one label
  away from a red stage that means nothing. The reporters are also worth knowing about:
  `playwright.config.ts` gates its junit reporter on `CI`, which Jenkins does not set, so `test:smoke`
  overrides the reporters on the command line to put its report at `smoke-output/smoke-result.xml` — where
  `smokeTest()` collects it with `allowEmptyResults: true`, meaning a report written anywhere else is
  silently not published rather than a failure.

- **The build stage does not run `yarn build`.** `YarnBuilder.build()` is `yarn lint` plus version info,
  nothing more. Type errors are caught instead by the image build, because the root `Dockerfile` — the one
  `az acr build … .` builds, and the only one in the repo — runs `yarn install && yarn build` itself. This
  matters because `yarn test` runs vitest, which transpiles without type-checking, so a tree with type errors
  can have a fully green test run. `yarn build` is `turbo build build:app`, and `build:app` starts with
  `tsc -p tsconfig.app.json`, which is where the application's own type-check happens.
- **Secrets are not injected by the pipeline.** There is no `loadVaultSecrets` call, because this app reads
  its secrets from a properties volume mounted by the Helm chart's `keyVaults:` block. See
  [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Running the same checks locally

```bash
yarn lint       # what the build stage runs
yarn test       # the test stage runs all three of these, and fails on any of them
yarn test:coverage
yarn test:a11y
yarn build      # not run by the build stage, but run inside every image build

# what the post-deploy gate runs. TEST_URL is how the pipeline points it at the environment it just
# deployed; without it Playwright starts the local stack instead.
TEST_URL=http://localhost:3000 yarn test:smoke
```

## What still has to happen before this pipeline can deploy

**Nothing left in this repo.** Six blockers were enumerated here against the library source; the four that
were inside this repo are resolved, all by
[`plans/03-collapse-to-single-app.md`](plans/03-collapse-to-single-app.md), which collapsed four deployables
to one. What remains is external, and the numbering is kept so that anything citing "blocker 4" still
resolves.

1. ~~**The chart directory is in the wrong place.**~~ **Resolved 2026-09-10**, task 4. The chart is
   `charts/deed-poll-admin/`, which is what `Helm.HELM_RESOURCES_DIR` — the literal `charts` — requires, and
   `charts/deed-poll-admin/values.yaml` exists, which `helmInstall` throws without. `helm/` is deleted.
2. ~~**The pipeline builds one image; the umbrella chart expects two.**~~ **Resolved 2026-09-10**, tasks
   2–4. The design decision this recorded as undecided was taken: **one deployable, one component, one
   image.** `apps/crons` is deleted, `apps/web` is the root package, the moved `Dockerfile` is the root one
   `az acr build … .` builds, and the chart is a single `nodejs` chart reading `${IMAGE_NAME}` — the variable
   `helmInstall` actually exports. `${WEB_IMAGE}`, `${CRONS_IMAGE}`, `${API_IMAGE}` and `${POSTGRES_IMAGE}`
   are gone with the subcharts that needed them.
3. ~~**No `yarn test:smoke`.**~~ **Resolved 2026-09-10**, task 5. Both scripts now exist —
   `test:smoke` runs the `@smoke`-tagged spec against `TEST_URL`, `test:functional` is a documented no-op —
   and `src/pipeline.test.ts` fails if either goes missing again. See "What the pipeline runs" above. Note
   that `test:functional` was the more urgent of the two: `functionalTestEnvironments` includes `preview`,
   so it runs on every pull request and not only on a release to AAT.
4. ~~**Preview environments have no session store.**~~ **Resolved 2026-09-10**, task 4, and this was a
   decision rather than a rename. Preview gets an **ephemeral `redis` subchart per pull request** —
   `redis.enabled` is `false` in `values.yaml` and `true` in `values.preview.template.yaml` only, and
   `REDIS_URL` points at `{{ .Release.Name }}-redis-master`. The alternative, pointing preview at AAT's
   `redis-url`, was rejected: every open PR would share one keyspace, so a collision or a flush in one is
   felt in the rest, and preview sessions would outlive the PR inside a store nothing here can clear.
   `deed-poll-web` settled it the same way, and its HDPI-8155 probe budget is copied with it — under
   Dynatrace instrumentation the chart-default 2s exec-probe budget leaves redis permanently
   Running-but-not-Ready. The failure mode here is not `deed-poll-web`'s crashloop: `getRedisClient` races
   `connect()` against a bound and serves anyway, so the pod comes up and `redisStatus` reports
   `redis: DOWN` for ever, which keeps it out of its own Service. Same cause, same fix, different symptom.
5. **External onboarding**, tracked in [`.business_context/PROGRESS.md`](../.business_context/PROGRESS.md),
   and now **one component's worth rather than four**: a `cnp-jenkins-config` entry for `deed-poll`, the
   `deed-poll` namespace and a HelmRelease in `cnp-flux-config`, and the IDAM client registration that
   `admin-idam-client-secret` depends on.

   Two parts of it will bite before anything else does, so they are named here rather than left to be
   rediscovered from a red build:

   - **`TeamConfig.setTeamConfigEnv` calls three getters that `steps.error` outright when the product is
     missing from [`cnp-jenkins-config/team-config.yml`](https://github.com/hmcts/cnp-jenkins-config/blob/master/team-config.yml)** — namespace, Slack channels and the `tags.application`
     value. `deed-poll` is missing. **So the pipeline hard-fails before it builds anything**, and no chart
     value is reached at all. Do not look for the cause in this repo.
   - **The IDAM registration must state the hosts this chart states**, and nothing checks that
     mechanically. `charts/deed-poll-admin/` uses `${SERVICE_FQDN}` in AAT and preview —
     `deed-poll-admin-staging.aat.platform.hmcts.net` in AAT — and
     `deed-poll-admin.{{ .Values.global.environment }}.platform.hmcts.net` elsewhere.
     [`hmcts/idam-access-config#993`](https://github.com/hmcts/idam-access-config/pull/993) states exactly
     that and **merged on 2026-09-16**. Had it not, a deploy that otherwise succeeded would fail at sign-in on
     IDAM's own page *after* a successful login, where no request reaches this app and nothing here logs.
     Changing either host now needs a second PR there, so a change to the two chart files above is a change
     to `apps/deed-poll/{base,aat}/services.yaml` in the same breath.

     Three things on #993 were corrected on its branch on 2026-09-10 rather than left for review to catch,
     because all three fail the same silent way: the AAT host, which was the old hand-rolled
     `deed-poll-deed-poll-admin-staging-web.aat…`; the other environments, now one templated
     `deed-poll-admin.<<ENV>>.platform.hmcts.net` entry in `base` covering demo, ithc, perftest and
     production, which also replaced three redundant overlays; and the vault secret, which the PR wrote as
     `idam-client-secret` where this chart reads **`admin-idam-client-secret`** — the component-prefixed
     name `hmcts/deed-poll-infra` documents, kept because three components share one vault and `deed-poll-web`
     will need its own client. `apps/pcs` names its two the same way. The reasoning is in
     [`.business_context/IDAM_REGISTRATION_REQUEST.md`](../.business_context/IDAM_REGISTRATION_REQUEST.md).

     **Preview sign-in is an open question, not an oversight**: `${SERVICE_FQDN}` differs per pull request
     and `idam-access-config` registers nothing for `pcs-frontend`'s previews either. #993's description
     asks IDAM directly; do not invent a wildcard in a values file, which cannot register anything in any
     case.

   - **The persona switcher needs two more grant types in AAT, and that is not raised either.** The dev
     persona switcher signs a tester in as a persona's own IDAM user, which needs `password` on the client,
     and creates that user through `idam-testing-support-api`, which needs `client_credentials`. Read from
     the clone on **2026-09-19**, `apps/deed-poll/base/services.yaml` registers `authorization_code` and
     `refresh_token` and nothing else — so **both** are missing, not the one the plan originally named, and
     an environment overlay *replaces* `grant_types` rather than appending, so the aat overlay has to restate
     all four. Until it merges, AAT's strip renders and every persona refuses with a reason naming that
     repository: `src/auth/persona-users.ts` classifies the refusal rather than reaching the 500 page, so
     this fails visibly and in one place. Nothing local is affected — the simulator's fixtures need no
     registration, so `yarn dev` and the e2e suite are unaffected. The switcher is off in every other
     environment (`docs/DEPLOYMENT.md`), so this blocks nothing but itself.

   - **The judicial role is a second, separate registration, and it is not raised yet.** `/judicial/**` is
     gated on `caseworker-deedpoll-judicial` (`libs/deed-poll/src/auth/roles.ts`), which needs its own PR
     against `apps/deed-poll/base/roles.yaml` in `idam-access-config` — #993 covered the client and the admin
     role only. As at **2026-09-19** the change exists only as a local branch in the gitignored
     `platops/idam-access-config` clone, so nothing is registered. Until it merges, a judge signs in to a
     deployed environment **successfully** and then resolves to no roles — `KNOWN_ROLES` drops what IDAM does
     not assert — so every judicial URL answers the "Page not found" view at 403 and nothing in this repo is at
     fault. Local development and the e2e suite are unaffected: `scripts/seed-idam-users.mjs` seeds
     `judge@example.com` straight into the simulator. The exact YAML, the claim-string constraint and the
     push instructions are in
     [`.business_context/JUDICIAL_ROLE_REGISTRATION.md`](../.business_context/JUDICIAL_ROLE_REGISTRATION.md).
6. **`deed-poll-api` is not deployed.** Not a defect in this repo and not fixable here: every case page
   needs it, so a deploy that otherwise succeeded would come up with readiness DOWN until api's own
   pipeline cutover lands — and `yarn test:smoke` asserts readiness, so **the post-deploy gate stays red
   until api deploys.** That is the intended failure rather than something to route around.
   `DEED_POLL_API_URL` already names the host it will answer on. See
   [`DEPLOYMENT.md`](DEPLOYMENT.md#deed-poll-api).

## No `Jenkinsfile_nightly`

Deliberate. A nightly is a separate pipeline with its own security, cross-browser and full-functional
stages; adding one that has never run would land a second untested thing at the same time. `pcs-api` and
`pt-frontend` both carry one and are the models when it is wanted.

## References

- [`hmcts/cnp-jenkins-library`](https://github.com/hmcts/cnp-jenkins-library) — the pipeline itself.
  `vars/withPipeline.groovy`, `vars/sectionDeployToAKS.groovy`, `vars/helmInstall.groovy` and
  `src/uk/gov/hmcts/contino/YarnBuilder.groovy` are the four files that answer most questions
- [`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra) — the shared Terraform root and its
  README
- [`.business_context/DEED_POLL_INFRA_PLAN.md`](../.business_context/DEED_POLL_INFRA_PLAN.md) — the five
  decisions behind this layout
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — charts, secrets, environments and troubleshooting
