#!/usr/bin/env bash
# Replays one email-preview POST past the email-preview budget (30 per 10 minutes, per subject), so AAT's admin
# and api both write `rate_limit bucket=email-preview mode=observe …` lines (OWASP plan 06, Task 6). See
# docs/DEPLOYMENT.md, "Checking the abuse limits in observe".
#
# Preview, not search: every case-list read in AAT also runs the CCD linking sweep, so a search loop would link
# records into CCD. A preview only renders the email. Nothing is sent, stored or created.
#
# Usage: scripts/rate-limit-observe-check.sh <file holding a "Copy as cURL (bash)" preview POST> [requests]
#
# The file holds your session cookie. This script never prints it, and refuses anything but a preview POST to
# AAT's admin. Delete the file when you're done.
set -euo pipefail

CURL_FILE="${1:?usage: $0 <copied-curl-file> [requests]}"
REQUESTS="${2:-35}"
WINDOW_SECONDS=600
LIMIT=30

[[ -f "$CURL_FILE" ]] || { echo "No such file: $CURL_FILE" >&2; exit 2; }
[[ "$REQUESTS" =~ ^[0-9]+$ ]] && (( REQUESTS > LIMIT && REQUESTS <= 60 )) \
  || { echo "requests must be between $((LIMIT + 1)) and 60" >&2; exit 2; }

command_text="$(tr '\n' ' ' < "$CURL_FILE" | sed 's/\\ / /g')"
url="$(grep -o -E "https://[^'\" ]+" <<< "$command_text" | head -1)"

if ! [[ "$url" =~ ^https://deed-poll-admin(-staging)?\.aat\.platform\.hmcts\.net/deed-polls/[^/]+/emails/[^/]+/preview$ ]]; then
  echo "Refusing: the copied request must be a preview POST to AAT's admin, ending /emails/<template>/preview." >&2
  exit 3
fi
if ! grep -q -E -- "--data(-raw|-binary|-urlencode)?[ =]" <<< "$command_text"; then
  echo "Refusing: the copied request has no form body. Copy the POST, not the page load." >&2
  exit 3
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
  status="$(eval "$(cat "$CURL_FILE")" --silent --output /dev/null --write-out '%{http_code}' 2>/dev/null || echo "curl-failed")"
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
