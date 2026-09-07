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

This repo also owns **no Terraform**. The resource group, Key Vault, App Insights, Redis and Postgres all
live in [`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra), which deploys itself with
`withInfraPipeline`. There is no infrastructure stage here.

## What the pipeline runs

`type = "nodejs"` means the stages call `YarnBuilder`
([`cnp-jenkins-library/src/uk/gov/hmcts/contino/YarnBuilder.groovy`](https://github.com/hmcts/cnp-jenkins-library/blob/master/src/uk/gov/hmcts/contino/YarnBuilder.groovy)).
The `yarn` scripts each stage invokes, and whether this repo has them:

| Stage | Script | Present here |
|---|---|---|
| Build | `yarn lint` | yes |
| Test | `yarn test` | yes |
| Test | `yarn test:coverage` — optional, skipped when absent | yes |
| Test | `yarn test:a11y` — optional, skipped when absent | no; the axe checks live in the Playwright suite |
| Security | `yarn-audit-with-suppressions.sh`, written into the workspace by the library | n/a |
| Sonar | `sonar-scanner`, configured by `sonar-project.properties` | yes |
| Smoke (after each deploy) | `yarn test:smoke` | **no — see the gaps below** |
| Functional (functional-test environments) | `yarn test:functional` | **no — see the gaps below** |

Two things worth knowing:

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
yarn test       # what the test stage runs
yarn build      # not run by the build stage, but run inside every image build
```

## What still has to happen before this pipeline can deploy

The `Jenkinsfile_CNP` is correct and minimal, but a green deploy needs more than the Jenkinsfile. All four
of these are outstanding, and the first three are **inside this repo**:

1. **The chart directory is in the wrong place.** `helmInstall` reads `Helm.HELM_RESOURCES_DIR`, which is the
   literal `charts`, and throws `No Helm charts directory found at charts` if it is missing. It then looks for
   `charts/${product}-${component}/values.yaml` — `charts/deed-poll-admin/values.yaml` — and throws if that
   file does not exist, before applying `values.template.yaml`. This repo keeps its umbrella chart at
   `helm/deed-poll-admin/` with no `values.yaml`. Compare `pcs-api` and `pt-frontend`, both of which use
   `charts/<product>-<component>/`.
2. **The pipeline builds one image; the umbrella chart expects four.** `az acr build ... .` builds the root
   `Dockerfile` into a single `deed-poll/admin` image, and `helmInstall` exposes it to the values templates as
   `${IMAGE_NAME}`. This repo has no root `Dockerfile` — it has four, at `apps/{web,api,crons,postgres}/Dockerfile` —
   and `helm/deed-poll-admin/values.template.yaml` references `${WEB_IMAGE}`, `${API_IMAGE}`, `${CRONS_IMAGE}`
   and `${POSTGRES_IMAGE}`, which were set by the deleted GitHub Actions build job and are set by nothing now.
   `envsubst` would substitute empty strings and produce untagged image references. **Resolving this is a
   design decision, not a rename**: either one Jenkinsfile per deployable (four `product`/`component` pairs,
   four charts), or one image with a root `Dockerfile` selecting an entrypoint. Not decided.
3. **No `yarn test:smoke`.** `sectionDeployToAKS` calls `builder.smokeTest()` after every deploy,
   unconditionally, and `yarn test:functional` on functional-test environments. Both are missing, so both
   would fail the run once a deploy succeeds.
4. **External onboarding**, tracked in [`.business_context/PROGRESS.md`](../.business_context/PROGRESS.md):
   four `cnp-jenkins-config` entries, the `deed-poll` namespace and a HelmRelease per component in
   `cnp-flux-config`, and the IDAM client registration that `admin-idam-client-secret` depends on.

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
