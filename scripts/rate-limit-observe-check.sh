#!/usr/bin/env bash
# Replays one email-preview POST past the email-preview budget (30 per 10 minutes, per subject), so AAT's admin
# and api both write `rate_limit bucket=email-preview mode=observe …` lines (OWASP plan 06, Task 6). See
# docs/DEPLOYMENT.md, "Checking the abuse limits in observe".
#
# Preview, not search: every case-list read in AAT also runs the CCD linking sweep, so a search loop would link
# records into CCD. A preview only renders the email. Nothing is sent, stored or created.
#
# Usage: scripts/rate-limit-observe-check.sh [--check-only] <file holding a "Copy as cURL (bash)" preview POST> [requests]
#
# The file holds your session cookie. This script never prints it, and refuses anything but a preview POST to
# AAT's admin. Delete the file when you're done. --check-only parses the file and stops, sending nothing.
#
# The copied command is never eval'd: rate-limit-observe-check-parse.py splits it as bash would, checks the
# resulting argument list, and that list is what runs, so a request that was not checked cannot be sent.
set -euo pipefail

CHECK_ONLY=false
if [[ "${1:-}" == "--check-only" ]]; then CHECK_ONLY=true; shift; fi
CURL_FILE="${1:?usage: $0 [--check-only] <copied-curl-file> [requests]}"
REQUESTS="${2:-35}"
WINDOW_SECONDS=600
LIMIT=30
PARSER="$(dirname "$0")/rate-limit-observe-check-parse.py"

[[ -f "$CURL_FILE" ]] || { echo "No such file: $CURL_FILE" >&2; exit 2; }
[[ "$REQUESTS" =~ ^[0-9]+$ ]] && (( REQUESTS > LIMIT && REQUESTS <= 60 )) \
  || { echo "requests must be between $((LIMIT + 1)) and 60" >&2; exit 2; }

# Parsed twice, because a process substitution's exit status is lost: once for the verdict, once for the list.
python3 -I "$PARSER" "$CURL_FILE" > /dev/null || exit 3
curl_args=()
while IFS= read -r -d '' arg; do curl_args+=("$arg"); done < <(python3 -I "$PARSER" "$CURL_FILE")
(( ${#curl_args[@]} > 0 )) || { echo "Refusing: the copied request could not be read." >&2; exit 3; }
if [[ "$CHECK_ONLY" == true ]]; then
  echo "Accepted: one preview POST to AAT's admin, ${#curl_args[@]} arguments. Nothing was sent."
  exit 0
fi

# Both apps count fixed windows aligned to the clock, so every request must land in one window.
into_window=$(( $(date +%s) % WINDOW_SECONDS ))
if (( into_window > WINDOW_SECONDS - 120 )); then
  wait_for=$(( WINDOW_SECONDS - into_window + 2 ))
  echo "Waiting ${wait_for}s for a fresh ${WINDOW_SECONDS}s window, so all ${REQUESTS} requests count together."
  sleep "$wait_for"
fi

started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Sending ${REQUESTS} previews from ${started} (limit ${LIMIT} per ${WINDOW_SECONDS}s)."

# A plain list rather than an associative array: macOS still ships bash 3.2.
statuses=""
for (( i = 1; i <= REQUESTS; i++ )); do
  status="$("${curl_args[@]}" --silent --output /dev/null --write-out '%{http_code}' 2>/dev/null || echo "curl-failed")"
  statuses="${statuses}${status}"$'\n'
  sleep 1
done

finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Finished ${finished}. Responses (count, status):"
printf '%s' "$statuses" | sort | uniq -c

if [[ "$(printf '%s' "$statuses" | sort -u)" == "200" ]]; then
  echo "All 200, as observe should be: nothing was refused."
else
  echo "Not all 200. Observe refuses nothing, so a 429 means a limit is enforcing; anything else, check the page." >&2
fi
echo "Expect $(( REQUESTS - LIMIT )) observe lines from each app. Query from ${started} to ${finished} (docs/DEPLOYMENT.md)."
