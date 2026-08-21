# GitHub Actions Scripts

This directory contains reusable bash scripts used outside of the main CI/CD pipeline workflows.

## Pipeline Scripts Location

Pipeline-specific scripts have been moved to their respective job folders for better organization:

| Script | New Location |
|--------|--------------|
| `detect-affected-apps.sh` | `.github/workflows/jobs/build-and-publish-images/` |
| `generate-build-metadata.sh` | `.github/workflows/jobs/build-and-publish-images/` |
| `set-image-variables.sh` | `.github/workflows/jobs/build-and-publish-images/` |
| `deploy-preview.sh` | `.github/workflows/jobs/helm-deploy/` |
| `get-deployment-urls.sh` | `.github/workflows/jobs/pr-comment/` |

See the README.md in each job folder for documentation on those scripts.

## Scripts in This Directory

### `init.sh`

Initializes a new repository from the template by replacing placeholder values with team-specific names.

**Usage:**
```bash
./.github/scripts/init.sh
```

**Interactive Prompts:**
- Team name (e.g., CaTH, Civil, Divorce)
- Product name (e.g., Service, Money-Claims, Possessions)

**Actions:**
1. Validates input (alphanumeric, spaces, and hyphens only)
2. Converts to lowercase with hyphens (e.g., CaTH Service → cath-service)
3. Replaces all template values throughout the codebase:
   - `deed-poll-admin` → `{team}-{product}`
   - `deed-poll` → `{team}` (lowercase)
   - `Deed Poll` → `{TEAM}` (uppercase)
4. Rebuilds yarn lockfile
5. Runs tests to verify setup
6. Removes itself after completion

**Files excluded from replacement:**
- `node_modules/`
- `.git/`
- `dist/`
- `.turbo/`
- `coverage/`

---

### `setup-sonarcloud-project.sh`

Automatically creates SonarCloud projects if they don't already exist, enabling seamless CI/CD integration.

**Usage:**
```bash
export SONAR_TOKEN="your-token"
./.github/scripts/setup-sonarcloud-project.sh
```

**Required Environment Variables:**
- `SONAR_TOKEN`: SonarCloud authentication token with project creation permissions

**Configuration Source:**
Reads from `sonar-project.properties`:
- `sonar.projectKey`: Unique project identifier
- `sonar.projectName`: Display name
- `sonar.organization`: SonarCloud organization

**Logic:**
1. Checks if project exists via SonarCloud API
2. If exists: Exits successfully
3. If not exists: Creates new project with public visibility
4. Sets up main branch configuration

---

## Best Practices

### Error Handling
All scripts use `set -euo pipefail` for strict error handling:
- `-e`: Exit on any error
- `-u`: Exit on undefined variables
- `-o pipefail`: Exit if any command in a pipeline fails

### Testing Locally
Scripts can be tested locally without GitHub Actions:

```bash
# Test port-forwards
cd /path/to/repo
.github/scripts/setup-port-forwards.sh deed-poll deed-poll-admin-pr-123
.github/scripts/cleanup-port-forwards.sh deed-poll-admin-pr-123
```

### Debugging
Set `GITHUB_OUTPUT` and `GITHUB_ENV` to temporary files for local testing:

```bash
export GITHUB_OUTPUT=/tmp/github_output.txt
export GITHUB_ENV=/tmp/github_env.txt

.github/scripts/some-script.sh

cat /tmp/github_output.txt
cat /tmp/github_env.txt
```

### Adding New Scripts
When adding new scripts:
1. Use `#!/usr/bin/env bash` shebang
2. Include `set -euo pipefail`
3. Add clear comments explaining purpose, inputs, and outputs
4. Make executable: `chmod +x .github/scripts/your-script.sh`
5. Document in this README
6. Test locally before committing
