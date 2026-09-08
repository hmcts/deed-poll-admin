# `.github/scripts`

One script lives here. The five pipeline scripts this README used to index —
`detect-affected-apps.sh`, `generate-build-metadata.sh`, `set-image-variables.sh`, `deploy-preview.sh` and
`get-deployment-urls.sh` — were deleted with `.github/workflows/` when this repo moved to the Jenkins CNP
pipeline, along with the `init.sh` template bootstrap script, which removes itself on first run and is long
gone. See [`docs/PIPELINES.md`](../../docs/PIPELINES.md).

## `setup-sonarcloud-project.sh`

Creates the SonarCloud project if it does not already exist.

```bash
export SONAR_TOKEN="your-token"
./.github/scripts/setup-sonarcloud-project.sh
```

**Required environment variables**
- `SONAR_TOKEN` — a SonarCloud token with project-creation permission

**Configuration source** — read from `sonar-project.properties`:
- `sonar.projectKey`, `sonar.projectName`, `sonar.organization`

**Behaviour**
1. Checks whether the project exists via the SonarCloud API
2. Exits successfully if it does
3. Otherwise creates it with public visibility and sets up the main branch

It is **not** called by the Jenkins pipeline — the CNP Sonar stage assumes the project already exists. Run this
by hand once, then leave it alone. It is kept rather than deleted because that one-off is easy to get wrong and
the CNP Sonar stage gives an unhelpful error when the project is missing.
