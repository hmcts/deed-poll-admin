#!/usr/bin/env bash
set -euo pipefail

# Script: detect-affected-apps.sh
# Purpose: Detect which apps have been affected by changes using Turborepo
# Usage: detect-affected-apps.sh [base-sha]
#   base-sha: Optional. SHA to compare against (defaults to origin/master)
# Outputs:
#   - affected_apps: JSON array of apps with Dockerfiles that were affected
#   - helm_apps: JSON array of all apps with Helm charts
#   - has_changes: boolean indicating if any apps were affected

# Accept optional base SHA as first argument
BASE_SHA="${1:-}"

main() {
  echo "Detecting affected apps using Turborepo..."

  local use_fallback="false"

  # Use provided base SHA, or default to origin/master
  if [ -n "$BASE_SHA" ]; then
    export TURBO_SCM_BASE="$BASE_SHA"
    echo "Using custom base: $BASE_SHA"
  else
    # No cached SHA - check if HEAD equals origin/master (first run on master)
    local head_sha origin_master_sha
    head_sha=$(git rev-parse HEAD)
    origin_master_sha=$(git rev-parse origin/master 2>/dev/null || echo "")

    if [ "$head_sha" = "$origin_master_sha" ]; then
      # HEAD is origin/master, so turbo --affected would find nothing
      # Fall back to building all apps with Dockerfiles
      echo "No cached SHA and HEAD equals origin/master - will build all apps"
      use_fallback="true"
    else
      export TURBO_SCM_BASE="origin/master"
      echo "Using default base: origin/master"
    fi
  fi

  local affected_apps

  if [ "$use_fallback" = "true" ]; then
    # Build all apps with Dockerfiles
    affected_apps=$(find apps/*/Dockerfile 2>/dev/null | sed 's|apps/\([^/]*\)/Dockerfile|\1|' | jq -R -s -c 'split("\n") | map(select(. != ""))')
    echo "Fallback: detected all apps with Dockerfiles"
  else
    # Get affected packages using Turborepo (comparing against base branch)
    # Note: --affected and --filter cannot be used together
    local affected_json
    affected_json=$(yarn turbo ls --affected --output=json 2>/dev/null || echo '{"packages":{"items":[]}}')

    # Extract paths, filter to apps directory, strip apps/ prefix, and filter to only those with Dockerfiles
    affected_apps=$(echo "$affected_json" | jq -r '.packages.items[].path // empty' | { grep '^apps/' || true; } | sed 's|^apps/||' | while read -r app_name; do
      if [ -f "apps/${app_name}/Dockerfile" ]; then
        echo "$app_name"
      fi
    done | jq -R -s -c 'split("\n") | map(select(. != ""))')
  fi

  # Find all apps with Helm charts
  local helm_apps
  helm_apps=$(find apps/*/helm -name Chart.yaml 2>/dev/null | sed 's|apps/\([^/]*\)/helm/Chart.yaml|\1|' | jq -R -s -c 'split("\n") | map(select(. != ""))')

  # Determine if we have any changes
  local has_changes="false"
  if [ "$affected_apps" != "[]" ] && [ -n "$affected_apps" ]; then
    has_changes="true"
  fi

  # Output results for GitHub Actions
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "affected-apps=$affected_apps" >> "$GITHUB_OUTPUT"
    echo "helm-apps=$helm_apps" >> "$GITHUB_OUTPUT"
    echo "has-changes=$has_changes" >> "$GITHUB_OUTPUT"
  fi

  # Log results
  echo "Affected apps (with Dockerfiles): $affected_apps"
  echo "Helm apps (all): $helm_apps"
  echo "Has changes: $has_changes"
}

main "$@"
