# OSV Scanner Job

## Purpose

Scans project dependencies for known vulnerabilities using Google's OSV Scanner. Results are uploaded to the GitHub Security tab as SARIF format for visibility and tracking.

## Inputs

| Type | Name | Required | Description |
|------|------|----------|-------------|
| - | - | - | No inputs required |

## Artifacts

| Direction | Name | Description |
|-----------|------|-------------|
| Produced | SARIF | Uploaded to GitHub Security tab (not as downloadable artifact) |

## Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| - | - | No environment variables required |

## Secrets

| Name | Required | Description |
|------|----------|-------------|
| - | - | No secrets required |

## Outputs

| Name | Description |
|------|-------------|
| - | No outputs (results uploaded to GitHub Security tab) |

## Configuration

The scanner is configured via `.github/osv-scanner.toml`. This file can be used to:
- Ignore specific vulnerabilities with justification
- Configure scanning behavior

The workflow only fails on HIGH or CRITICAL severity vulnerabilities (`--fail-on-severity=HIGH`). Lower severity issues are still reported to the GitHub Security tab but won't block PRs.

## Permissions

This job requires specific permissions:
- `actions: read` - Required to upload SARIF file to CodeQL
- `security-events: write` - Required to upload SARIF file to security tab
- `contents: read` - Read repository contents

## External Workflow

This job uses Google's official OSV Scanner reusable workflow:
`google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.3.2`
