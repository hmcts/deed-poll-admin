#!/usr/bin/env bash
set -euo pipefail

# Script: set-image-variables.sh
# Purpose: Set dynamic image tag variables and release name for Helm deployment
# Arguments:
#   $1: affected_apps - JSON array of affected app names
#   $2: helm_apps - JSON array of all apps with Helm charts
#   $3: change_id - PR/change ID
#   $4: short_sha - Short git SHA
#   $5: timestamp - Build timestamp (unused, kept for compatibility)
#   $6: application_name - Application name for release name
# Outputs:
#   Environment variables:
#   - RELEASE_NAME:
#     - PR (numeric change_id): {application_name}-pr-{change_id}
#     - Non-PR (e.g., staging): {application_name}-{change_id}
#   - {APP}_IMAGE for each Helm app
#     - If app was affected (PR): pr-{change_id}-{sha}
#     - If app was affected (non-PR): {change_id}-{sha}
#     - If app was not affected: latest

main() {
  local affected_apps="${1:-}"
  local helm_apps="${2:-}"
  local change_id="${3:-}"
  local short_sha="${4:-}"
  local timestamp="${5:-}"
  local application_name="${6:-}"

  if [ -z "$helm_apps" ] || [ -z "$change_id" ] || [ -z "$application_name" ]; then
    echo "Usage: $0 <affected_apps_json> <helm_apps_json> <change_id> <short_sha> <timestamp> <application_name>"
    exit 1
  fi

  # Default affected_apps to empty array if not provided
  if [ -z "$affected_apps" ]; then
    affected_apps="[]"
  fi

  # Calculate and export release name
  # If change_id is numeric (PR number), use pr-{id} format
  # Otherwise use the change_id directly (e.g., staging)
  local release_name
  if [[ "${change_id}" =~ ^[0-9]+$ ]]; then
    release_name="${application_name}-pr-${change_id}"
  else
    release_name="${application_name}-${change_id}"
  fi
  if [ -n "${GITHUB_ENV:-}" ]; then
    echo "RELEASE_NAME=${release_name}" >> "$GITHUB_ENV"
  fi
  echo "Release name: ${release_name}"

  echo "Setting image tag variables for Helm apps..."

  # Process each Helm app
  echo "$helm_apps" | jq -r '.[]' | while read -r app; do
    # Convert app name to environment variable name
    # Example: web -> WEB_IMAGE, my-app -> MY_APP_IMAGE
    local env_var_name
    env_var_name=$(echo "${app}" | tr '[:lower:]' '[:upper:]' | tr '-' '_')_IMAGE

    # Check if app was affected (needs rebuild)
    if echo "$affected_apps" | jq -e --arg app "$app" 'index($app)' > /dev/null 2>&1; then
      # App was affected - use SHA tag to force pod recreation
      # If change_id is numeric (PR), use pr-{id}-{sha}
      # Otherwise use {change_id}-{sha} (e.g., staging-abc1234)
      local image_tag
      if [[ "${change_id}" =~ ^[0-9]+$ ]]; then
        image_tag="pr-${change_id}-${short_sha}"
      else
        image_tag="${change_id}-${short_sha}"
      fi

      if [ -n "${GITHUB_ENV:-}" ]; then
        echo "${env_var_name}=${image_tag}" >> "$GITHUB_ENV"
      fi

      echo "✓ ${app}: ${image_tag} (rebuilt)"
    else
      # App not affected - use latest
      local image_tag="latest"

      if [ -n "${GITHUB_ENV:-}" ]; then
        echo "${env_var_name}=${image_tag}" >> "$GITHUB_ENV"
      fi

      echo "○ ${app}: ${image_tag} (not rebuilt, using static tag)"
    fi
  done
}

main "$@"
