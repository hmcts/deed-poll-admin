#!/usr/bin/env bash
set -euo pipefail

# Script: get-deployment-urls.sh
# Purpose: Get deployment URLs from Kubernetes ingress resources
# Arguments:
#   $1: namespace - Kubernetes namespace
#   $2: release_name - Helm release name
# Outputs:
#   JSON object with app URLs

main() {
  local namespace="${1:-}"
  local release_name="${2:-}"

  if [ -z "$namespace" ] || [ -z "$release_name" ]; then
    echo "Usage: $0 <namespace> <release_name>"
    exit 1
  fi

  echo "Retrieving deployment URLs from namespace: ${namespace}, release: ${release_name}" >&2

  # Wait for ingresses to be ready (max 30 seconds)
  local timeout=30
  local elapsed=0
  echo "Waiting for ingress resources to be ready..." >&2

  while [ $elapsed -lt $timeout ]; do
    local ingress_count
    ingress_count=$(kubectl get ingress -n "$namespace" -l "app.kubernetes.io/instance=${release_name}" --no-headers 2>/dev/null | wc -l || echo "0")

    if [ "$ingress_count" -gt 0 ]; then
      echo "Found ${ingress_count} ingress resource(s)" >&2
      break
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  # Get all ingress resources for this release
  local urls_json="{"
  local first=true

  # Query ingresses with the release label (use process substitution to avoid subshell)
  while IFS='=' read -r app_name host; do
    if [ "$first" = true ]; then
      first=false
    else
      urls_json="${urls_json},"
    fi

    # Clean up app name (remove release prefix if present)
    app_name=$(echo "$app_name" | sed "s/^${release_name}-//" | sed 's/-/_/g')

    urls_json="${urls_json}\"${app_name}\":\"https://${host}\""
  done < <(kubectl get ingress -n "$namespace" -l "app.kubernetes.io/instance=${release_name}" -o json | \
    jq -r '.items[] | (.metadata.labels["app.kubernetes.io/name"] // .metadata.name) as $name | (.spec.rules[0].host // "") as $host | if $host == "" then empty else "\($name)=\($host)" end')

  urls_json="${urls_json}}"

  # Fallback: if no ingresses found, return empty object
  if [ "$urls_json" = "{}" ]; then
    echo "Warning: No ingress resources found for release ${release_name} in namespace ${namespace}" >&2
  fi

  # Output JSON to stdout (workflow will capture and set as output)
  echo "$urls_json"
}

main "$@"
