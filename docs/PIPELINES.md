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
[`plans/02-dal-cutover-to-api.md`](plans/02-dal-cutover-to-api.md).

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

Six things worth knowing:

- **The Sonar stage needs a root `lcov.info`, and nothing in the pipeline produces one.** Vitest writes
  coverage per workspace (`apps/web/coverage/lcov.info`, and eight more), with `SF:` paths relative to each
  package; `sonar-project.properties` points at a single root report. The GitHub Actions test job used to
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
  nothing more. Type errors are caught instead by the image build, because each `Dockerfile` runs
  `yarn install && yarn build` itself. This matters because `yarn test` runs vitest, which transpiles
  without type-checking — a tree with type errors can have a fully green test run.
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

The `Jenkinsfile_CNP` is correct and minimal, but a green deploy needs more than the Jenkinsfile. Numbered
as they were found, and the first four were **inside this repo** — they are being struck through as
[`plans/03-collapse-to-single-app.md`](plans/03-collapse-to-single-app.md) lands, each with the task that
retired it. Its task 6 rewrites this section once the last one goes.

1. **The chart directory is in the wrong place.** `helmInstall` reads `Helm.HELM_RESOURCES_DIR`, which is the
   literal `charts`, and throws `No Helm charts directory found at charts` if it is missing. It then looks for
   `charts/${product}-${component}/values.yaml` — `charts/deed-poll-admin/values.yaml` — and throws if that
   file does not exist, before applying `values.template.yaml`. This repo keeps its umbrella chart at
   `helm/deed-poll-admin/` with no `values.yaml`. Compare `pcs-api` and `pt-frontend`, both of which use
   `charts/<product>-<component>/`.
2. **The pipeline builds one image; the umbrella chart expects two.** `az acr build ... .` builds the root
   `Dockerfile` into a single `deed-poll/admin` image, and `helmInstall` exposes it to the values templates as
   `${IMAGE_NAME}`. This repo has no root `Dockerfile` — it has two, at `apps/{web,crons}/Dockerfile` — and
   `helm/deed-poll-admin/values.template.yaml` references `${WEB_IMAGE}` and `${CRONS_IMAGE}`, which were set
   by the deleted GitHub Actions build job and are set by nothing now. `envsubst` would substitute empty
   strings and produce untagged image references. **Resolving this is a design decision, not a rename**:
   either one Jenkinsfile per deployable (two `product`/`component` pairs, two charts), or one image with a
   root `Dockerfile` selecting an entrypoint. Not decided — but it is a smaller decision than it was, since
   `${API_IMAGE}` and `${POSTGRES_IMAGE}` went with the data access layer.
3. ~~**No `yarn test:smoke`.**~~ **Resolved 2026-09-10**, plan 03 task 5. Both scripts now exist —
   `test:smoke` runs the `@smoke`-tagged spec against `TEST_URL`, `test:functional` is a documented no-op —
   and `src/pipeline.test.ts` fails if either goes missing again. See "What the pipeline runs" above. Note
   that `test:functional` was the more urgent of the two: `functionalTestEnvironments` includes `preview`,
   so it runs on every pull request and not only on a release to AAT.
4. **Preview environments have no session store.** `helm/deed-poll-admin/values.preview.template.yaml`
   sets nothing at all for Redis — no `redis:` subchart and no `REDIS_URL` — and `hmcts/deed-poll-infra`
   applies per environment on the `aat`,
   `demo`, `ithc`, `perftest` and `prod` branches, not in `preview`. `apps/web` now holds sessions in Redis,
   and `assertRedisUrl` refuses to start on `config/default.json`'s loopback default outside development, so
   a preview pod would fail fast rather than come up sessionless. Two ways out, and this is a decision, not a
   rename: enable a `redis` subchart per PR the way the AAT template disables one, or point preview at the
   AAT cache's `redis-url`. The first is ephemeral and isolated; the second shares a cache across every open
   PR. Not decided.
5. **External onboarding**, tracked in [`.business_context/PROGRESS.md`](../.business_context/PROGRESS.md):
   a `cnp-jenkins-config` entry per component — two now, not four — the `deed-poll` namespace and a
   HelmRelease per component in `cnp-flux-config`, and the IDAM client registration that
   `admin-idam-client-secret` depends on.
6. **`deed-poll-api` is not deployed.** Not a defect in this repo and not fixable here: every case page
   needs it, so a deploy that otherwise succeeded would come up with readiness DOWN until api's own
   pipeline cutover lands. `DEED_POLL_API_URL` already names the host it will answer on. See
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
