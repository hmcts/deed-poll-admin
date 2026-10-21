# Plan: give the Gazette submit a timeout that fits the send it waits for

## Overview

Address review finding **R03 (Lower)** from the repeat quality and security review (workspace
`local-notes/deed-poll-admin/20261020-arbor-quality-security-review.md`): a Gazette send that succeeds after 10 s is
shown to the Delivery Manager as "outcome unknown", because the api client's generic 10 s timeout applies to the
submit while api does the whole send (spreadsheets and Notify) inside that request. Recovery already works ("Check
request status" replays the same key and body, so nothing is sent twice); the cost is alarming copy and support work
on an irreversible action.

Give the submit its own timeout, as uploads already have, sized to the network path rather than to api's worst case,
and record why it cannot simply match api.

## Context

Baseline: admin `origin/master` `6b438d4`. Read `CLAUDE.md` (especially the Gazette paragraphs near the top and
"Abuse limits") and the applicable `.claude/rules/` before implementation. Record the execution baseline and recheck
the finding there.

- `libs/deed-poll-api-client/src/api/client.ts`: `DEFAULT_TIMEOUT_MS = 10_000` applies to every call that sets no
  timeout of its own; `submitGazetteNotice` (around line 177) sets none. Uploads are the precedent:
  `UPLOAD_TIMEOUT_MS = 60_000`, applied as `config.timeoutMs ?? UPLOAD_TIMEOUT_MS`, so `DEED_POLL_API_TIMEOUT_MS`
  (read in `libs/deed-poll/src/api/deed-poll-api.ts` `apiConfig`) still wins when set. Copy that shape.
- api does the send synchronously: `GazetteNotify` uses a 60 s call deadline and 30 s read timeout
  (`deed-poll-api` `src/main/java/uk/gov/hmcts/reform/deedpoll/notify/GazetteNotify.java:38,47-48` on its
  `origin/master` `554fe49`).
- **The network path caps the wait at 30 s, below api's 60 s.** Admin reaches api's `.internal` address through the
  backend Application Gateway. deed-poll-api's entry in `hmcts/azure-platform-terraform`
  `environments/{stg,demo}/backend_lb_config.yaml` sets no `request_timeout`, and
  `hmcts/terraform-module-application-backend` `main.tf:105` defaults it to **30** seconds. So a send taking longer
  than 30 s is cut off by the gateway (a 504) whatever admin waits. Verify both facts again (read only: the
  `platops/azure-platform-terraform` clone's `origin/HEAD`, and `gh api repos/hmcts/terraform-module-application-backend/contents/main.tf`)
  and record what you found.
- A gateway 504 is classified `unavailable` by `client.ts`, and `callGazetteApi` (`libs/deed-poll/src/api/deed-poll-api.ts`)
  turns anything but a typed Gazette refusal into `GazetteOutcomeUnknownError`, so a cut-off send already lands on
  the unknown-outcome recovery page with its original key. That must stay true.

Review evidence (a portable reproduction to adapt into a real test; do not import workspace files):
`local-notes/deed-poll-admin/20261020-arbor-review-evidence/arbor-review-gazette.probe.test.ts`, test "G02".

## Development Approach

1. Add a Gazette submit timeout constant beside `UPLOAD_TIMEOUT_MS`, applied only to `submitGazetteNotice` (and to the
   status-check replay if that is a separate call with the same server-side work; check), as
   `config.timeoutMs ?? GAZETTE_SUBMIT_TIMEOUT_MS`. Size it **just above the gateway's 30 s** (for example 35 s), so a
   10-30 s send is reported as what it is, and the gateway, not admin, is what ends a longer one. Do not set it to
   api's 60 s: past 30 s it would only keep a pod waiting for a response the gateway has already abandoned.
2. Document the sizing at the constant: the three numbers (admin, gateway, api), where each is set, and that a send
   longer than 30 s still becomes an unknown outcome until the gateway or api changes.
3. Leave every other call on `DEFAULT_TIMEOUT_MS`. Leave the preview call as it is unless it does the same work.
4. Keep the unknown-outcome behaviour exactly: a genuine abort, a gateway 504 or a dropped connection still renders the
   recovery page with the original key and body, and never offers a new key.
5. **Out of scope, recorded as follow-ups in the execution notes and `CLAUDE.md`:** raising deed-poll-api's
   `request_timeout` in `azure-platform-terraform`'s backend gateway config (a platform-team PR, every environment),
   or having api answer 202 and send in the background. Neither is changed here. No api, chart or Terraform change.
6. Work test first. Preserve others' changes. Local task commits are appropriate; publishing, merging and deployment
   are separate.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed dependencies and local Redis. Never flush Redis: it is shared. Record actual counts, failures and
skips; distinguish baseline failures from regressions, and inspect formatting diffs for unrelated changes. Do not
send email and do not call a live environment.

Run every build and test command in the foreground and wait for it to finish. A backgrounded build ends the
session and the next one builds over it, wiping the results.

## Implementation Steps

### Task 1: A submit timeout sized to the gateway (R03)

**Files:** `libs/deed-poll-api-client/src/api/client.ts` and its test; a domain-level test beside the Gazette service
(`libs/deed-poll/src/gazette/`), using a real local HTTP server as the G02 probe does.

- [ ] Record the execution baseline and the re-verified gateway and api timeouts in the execution notes.
- [ ] Add failing tests: a submit answered with a valid `200 Sent` after 12 s (over the old 10 s, under the new
      limit) resolves as sent, with exactly one admission at the server; a submit with no answer before the new limit
      becomes `GazetteOutcomeUnknownError`; `DEED_POLL_API_TIMEOUT_MS` (or `config.timeoutMs`) still overrides it; an
      ordinary call still times out at `DEFAULT_TIMEOUT_MS`. Use fake timers or a short injected timeout where a real
      wait would make the suite slow, but keep one real-HTTP test that proves the wiring.
- [ ] Implement, run focused tests and all Validation Commands, and record the results.

### Task 2: Record the timeouts and hand off

**Files:** `CLAUDE.md`, this plan.

- [ ] In `CLAUDE.md`'s Gazette paragraph, add one or two sentences: the submit's own timeout, why it sits just above
      the gateway's 30 s and not at api's 60 s, and that a send over 30 s is still an unknown outcome until the gateway
      `request_timeout` or api changes (the two follow-ups). Reference this plan and finding R03.
- [ ] Record final commits, changed files and test counts in the execution notes.
- [ ] Run all Validation Commands and hand off to the Ralphex review phases.

## Acceptance Criteria

- A Gazette send that succeeds within the gateway's limit is reported as sent, not as an unknown outcome.
- A send cut off by the gateway, an abort or a dropped connection still renders the recovery page with the original
  key, and never a new key.
- Every other api call keeps its current timeout; `DEED_POLL_API_TIMEOUT_MS` still overrides.
- The admin, gateway and api timeouts are written down together, with the two follow-ups.
- All Validation Commands pass with no new failures or skips.

## Execution notes

(Record baseline, the timeout verification, red/green evidence and final results here.)

## Post-Completion

Follow-ups for others: deed-poll-api's `request_timeout` in `azure-platform-terraform`'s backend gateway config, or an
asynchronous send in api. Publishing, merging and deployment are separate from this plan.
