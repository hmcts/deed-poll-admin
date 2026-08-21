#!/usr/bin/env bash
set -euo pipefail

# Script: generate-build-metadata.sh
# Purpose: Generate build metadata from app's Helm chart
# Outputs:
#   - team_name: Extracted from Chart.yaml annotations.team
#   - application_name: Extracted from Chart.yaml name
#   - git_repo: Git repository URL (converted to HTTPS)
#   - timestamp: Current timestamp (YYYYMMDDHHmmss format)
#   - short_sha: Short git SHA (first 7 characters)
#   - registry_prefix: ACR registry prefix (team/team-app)
#   - image_tag: Combined image tag for this PR/build

main() {
  local change_id="${1:-}"
  local git_sha="${2:-}"
  local app_name="${3:-}"

  if [ -z "$change_id" ] || [ -z "$git_sha" ] || [ -z "$app_name" ]; then
    echo "Usage: $0 <change_id> <git_sha> <app_name>"
    exit 1
  fi

  echo "Generating build metadata for app: ${app_name}..."

  # Path to app's Helm chart
  local chart_path="apps/${app_name}/helm/Chart.yaml"

  if [ ! -f "$chart_path" ]; then
    echo "Error: Chart.yaml not found at ${chart_path}"
    exit 1
  fi

  # Extract team from Chart.yaml annotations
  local team_name
  team_name=$(grep -A 1 'annotations:' "$chart_path" | grep 'team:' | awk '{print $2}' | tr -d '"')

  if [ -z "$team_name" ]; then
    echo "Error: team annotation not found in ${chart_path}"
    exit 1
  fi

  # Extract application name from Chart.yaml
  local application_name
  application_name=$(grep '^name:' "$chart_path" | awk '{print $2}' | tr -d '"')

  # Get git repository URL (convert git@ to https://)
  local git_repo
  git_repo=$(git config --get remote.origin.url | sed 's/git@github.com:/https:\/\/github.com\//' | sed 's/\.git$//')

  # Generate timestamp and short SHA
  local timestamp
  timestamp=$(date +%Y%m%d%H%M%S)

  local short_sha
  short_sha=$(echo "$git_sha" | cut -c1-7)

  # Construct derived values
  local registry_prefix="${team_name}/${application_name}"
  local image_tag="pr-${change_id}-${short_sha}"

  # Output to GitHub Actions
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "team-name=${team_name}" >> "$GITHUB_OUTPUT"
    echo "application-name=${application_name}" >> "$GITHUB_OUTPUT"
    echo "git-repo=${git_repo}" >> "$GITHUB_OUTPUT"
    echo "timestamp=${timestamp}" >> "$GITHUB_OUTPUT"
    echo "short-sha=${short_sha}" >> "$GITHUB_OUTPUT"
  fi

  # Output to environment
  if [ -n "${GITHUB_ENV:-}" ]; then
    echo "REGISTRY_PREFIX=${registry_prefix}" >> "$GITHUB_ENV"
    echo "IMAGE_TAG=${image_tag}" >> "$GITHUB_ENV"
  fi

  # Log results
  echo "App: ${app_name}"
  echo "Chart: ${chart_path}"
  echo "Team: ${team_name}"
  echo "Application: ${application_name}"
  echo "Git repo: ${git_repo}"
  echo "Timestamp: ${timestamp}"
  echo "Short SHA: ${short_sha}"
  echo "Registry prefix: ${registry_prefix}"
  echo "Image tag: ${image_tag}"
  echo "Full image: ${registry_prefix}:${image_tag}"
}

main "$@"
