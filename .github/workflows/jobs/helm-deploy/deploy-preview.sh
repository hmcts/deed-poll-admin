#!/usr/bin/env bash
set -euo pipefail

# Script: deploy-preview.sh
# Purpose: Deploy preview environment locally for testing
# Usage: ./deploy-preview.sh [PR_NUMBER] [--dry-run]

print_usage() {
  cat <<EOF
Usage: $0 [PR_NUMBER] [OPTIONS]

Deploy a preview environment to AKS cluster.

Arguments:
  PR_NUMBER         PR number for deployment (default: local)

Options:
  --dry-run        Show what would be deployed without actually deploying
  --skip-update    Skip Helm dependency updates (use cached charts)
  -h, --help       Show this help message

Examples:
  # Deploy PR 114
  $0 114

  # Deploy with "local" tag
  $0 local

  # Deploy locally without updating dependencies
  $0 local --skip-update

  # Dry run to see what would be deployed
  $0 114 --dry-run
EOF
}

# Check Helm release status and fix stuck states
check_helm_status() {
  local release_name="$1"
  local namespace="$2"

  echo "Checking Helm release status..."

  # Check if release exists
  if ! helm status "${release_name}" -n "${namespace}" &>/dev/null; then
    echo "Release does not exist yet, proceeding with installation"
    return 0
  fi

  # Get current status
  local status
  status=$(helm status "${release_name}" -n "${namespace}" -o json 2>/dev/null | jq -r '.info.status' || echo "unknown")

  echo "Current release status: ${status}"

  case "$status" in
    deployed|superseded)
      echo "Release is in a healthy state, proceeding with upgrade"
      return 0
      ;;
    pending-upgrade|pending-install|pending-rollback)
      echo "⚠️  Release is stuck in ${status} state"
      echo "Attempting to recover by rolling back to last deployed revision..."

      # Get last successful revision
      local last_good_revision
      last_good_revision=$(helm history "${release_name}" -n "${namespace}" -o json 2>/dev/null | \
        jq -r '[.[] | select(.status == "deployed" or .status == "superseded")] | max_by(.revision) | .revision' || echo "")

      if [ -n "$last_good_revision" ] && [ "$last_good_revision" != "null" ]; then
        echo "Rolling back to revision ${last_good_revision}..."
        if helm rollback "${release_name}" "${last_good_revision}" -n "${namespace}" --wait --timeout 2m; then
          echo "✓ Rollback successful"
          return 0
        else
          echo "⚠️  Rollback failed, will attempt uninstall and reinstall"
        fi
      fi

      echo "No valid revision to rollback to, uninstalling release..."
      if helm uninstall "${release_name}" -n "${namespace}" --wait --timeout 2m; then
        echo "✓ Release uninstalled, will proceed with fresh installation"
        return 0
      else
        echo "❌ Failed to uninstall stuck release"
        return 1
      fi
      ;;
    failed|uninstalling|uninstalled)
      echo "Release is in ${status} state"
      if [ "$status" = "failed" ] || [ "$status" = "uninstalled" ]; then
        echo "Cleaning up failed release..."
        helm uninstall "${release_name}" -n "${namespace}" --wait --timeout 2m 2>/dev/null || true
        echo "✓ Cleanup complete, will proceed with fresh installation"
      fi
      return 0
      ;;
    *)
      echo "Release is in unknown state: ${status}"
      echo "Proceeding with caution..."
      return 0
      ;;
  esac
}

# Deploy with retry logic and exponential backoff
deploy_with_retry() {
  local release_name="$1"
  local namespace="$2"
  shift 2
  local helm_cmd=("$@")

  local max_attempts=3
  local attempt=1

  while [ $attempt -le $max_attempts ]; do
    echo "=========================================="
    echo "Deployment attempt ${attempt} of ${max_attempts}"
    echo "=========================================="

    if "${helm_cmd[@]}"; then
      echo "✓ Deployment successful on attempt ${attempt}"
      return 0
    fi

    local exit_code=$?
    echo "❌ Deployment failed with exit code ${exit_code}"

    if [ $attempt -lt $max_attempts ]; then
      local wait_time=$((attempt * 30))
      echo "Waiting ${wait_time} seconds before retry..."
      sleep "$wait_time"

      # Re-check Helm status before retrying
      echo "Checking Helm status before retry..."
      check_helm_status "${release_name}" "${namespace}" || {
        echo "Failed to recover from stuck state"
        return 1
      }

      attempt=$((attempt + 1))
    else
      echo "❌ All ${max_attempts} deployment attempts failed"
      echo "Checking final Helm status for debugging..."
      helm status "${release_name}" -n "${namespace}" 2>&1 || true
      return 1
    fi
  done

  return 1
}

main() {
  local pr_number="${1:-local}"
  local dry_run=false
  local skip_update=false

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        print_usage
        exit 0
        ;;
      --dry-run)
        dry_run=true
        shift
        ;;
      --skip-update)
        skip_update=true
        shift
        ;;
      *)
        pr_number="$1"
        shift
        ;;
    esac
  done

  # Navigate to repository root
  cd "$(git rev-parse --show-toplevel)"

  # Read metadata from root Helm chart
  local chart_path="helm/deed-poll-admin/Chart.yaml"
  if [ ! -f "$chart_path" ]; then
    echo "Error: Chart.yaml not found at ${chart_path}"
    exit 1
  fi

  # Extract metadata
  export AZURE_TENANT_ID=531ff96d-0ae9-462a-8d2d-bec7c0b42082
  export TEAM_NAME=$(yq '.annotations.team' "$chart_path")
  export APPLICATION_NAME=$(yq '.name' "$chart_path")
  export GIT_REPO=$(git config --get remote.origin.url | sed 's/git@github.com:/https:\/\/github.com\//' | sed 's/\.git$//')
  export TIMESTAMP=$(date +%Y%m%d%H%M%S)
  export SHORT_SHA=$(git rev-parse --short HEAD)
  export CHANGE_ID="${pr_number}"

  # Set image tags (allow override from environment)
  if [ "$pr_number" = "local" ]; then
    export WEB_IMAGE="${WEB_IMAGE:-latest}"
    export API_IMAGE="${API_IMAGE:-latest}"
    export CRONS_IMAGE="${CRONS_IMAGE:-latest}"
    export POSTGRES_IMAGE="${POSTGRES_IMAGE:-latest}"
  else
    # Use static PR tag for local deployments (CI pushes both timestamped and static tags)
    export WEB_IMAGE="${WEB_IMAGE:-pr-${pr_number}}"
    export API_IMAGE="${API_IMAGE:-pr-${pr_number}}"
    export CRONS_IMAGE="${CRONS_IMAGE:-pr-${pr_number}}"
    export POSTGRES_IMAGE="${POSTGRES_IMAGE:-pr-${pr_number}}"
  fi

  # Deployment variables
  export RELEASE_NAME="${RELEASE_NAME:-${APPLICATION_NAME}-pr-${CHANGE_ID}}"
  local release_name="${RELEASE_NAME}"
  local namespace="${TEAM_NAME}"

  echo "=========================================="
  echo "Preview Deployment Configuration"
  echo "=========================================="
  echo "Team:           ${TEAM_NAME}"
  echo "Application:    ${APPLICATION_NAME}"
  echo "PR/Change ID:   ${CHANGE_ID}"
  echo "Release Name:   ${release_name}"
  echo "Namespace:      ${namespace}"
  echo "Git Repo:       ${GIT_REPO}"
  echo "Git SHA:        ${SHORT_SHA}"
  echo "Timestamp:      ${TIMESTAMP}"
  echo "Web Image:      ${WEB_IMAGE}"
  echo "API Image:      ${API_IMAGE}"
  echo "Crons Image:    ${CRONS_IMAGE}"
  echo "Postgres Image: ${POSTGRES_IMAGE}"
  echo "=========================================="
  echo

  if [ "$dry_run" = true ]; then
    echo "DRY RUN MODE - No changes will be made"
    echo
  fi

  # Process values template
  echo "Processing Helm values template..."
  cd "helm/${APPLICATION_NAME}"
  envsubst < values.preview.template.yaml > values.preview.yaml

  if [ "$dry_run" = true ]; then
    echo "Generated values.preview.yaml:"
    cat values.preview.yaml
    echo
  fi

  # Update Helm dependencies
  if [ "$skip_update" = true ]; then
    echo "Skipping Helm dependency updates (using cached charts)..."
  else
    echo "Updating subchart dependencies..."
    for subchart in ../../apps/*/helm; do
      if [ -f "$subchart/Chart.yaml" ]; then
        echo "  Updating dependencies for $subchart"
        if [ "$dry_run" = false ]; then
          (cd "$subchart" && helm dependency update)
        else
          echo "  Would run: cd $subchart && helm dependency update"
        fi
      fi
    done

    echo "Updating parent chart dependencies..."
    if [ "$dry_run" = false ]; then
      helm dependency update
    else
      echo "Would run: helm dependency update"
    fi
  fi

  # Deploy Helm chart
  echo "Deploying Helm chart..."

  # Check and fix any stuck Helm releases before deployment
  if [ "$dry_run" = false ]; then
    check_helm_status "${release_name}" "${namespace}" || {
      echo "❌ Failed to resolve Helm release state"
      exit 1
    }
  fi

  local helm_cmd=(
    helm upgrade --install "${release_name}" .
    --namespace "${namespace}"
    --values values.preview.yaml
    --atomic
    --cleanup-on-fail
    --set "global.tenantId=${AZURE_TENANT_ID}"
    --set global.environment=aat
    --set global.enableKeyVaults=true
    --set global.devMode=true
    --set global.disableTraefikTls=false
    --set "global.tags.teamName=${TEAM_NAME}"
    --set "global.tags.applicationName=${APPLICATION_NAME}"
    --set "global.tags.builtFrom=${GIT_REPO}"
    --set global.tags.businessArea=CFT
    --set global.tags.environment=development
    --wait
    --timeout 10m
  )

  if [ "$dry_run" = true ]; then
    echo "Would run:"
    printf '%s\n' "${helm_cmd[@]}"
  else
    # Use retry logic for robust deployment
    if deploy_with_retry "${release_name}" "${namespace}" "${helm_cmd[@]}"; then
      echo
      echo "=========================================="
      echo "Deployment completed successfully!"
      echo "=========================================="
      echo "Release: ${release_name}"
      echo "Namespace: ${namespace}"
      echo
      echo "To check status:"
      echo "  kubectl get pods -n ${namespace}"
      echo "  helm status ${release_name} -n ${namespace}"
      echo
      echo "To get URLs:"
      echo "  kubectl get ingress -n ${namespace}"
    else
      echo
      echo "=========================================="
      echo "❌ Deployment failed after all retries"
      echo "=========================================="
      echo "Release: ${release_name}"
      echo "Namespace: ${namespace}"
      echo
      echo "For debugging:"
      echo "  kubectl get pods -n ${namespace}"
      echo "  helm status ${release_name} -n ${namespace}"
      echo "  kubectl logs -n ${namespace} -l app.kubernetes.io/instance=${release_name}"
      exit 1
    fi
  fi
}

main "$@"
