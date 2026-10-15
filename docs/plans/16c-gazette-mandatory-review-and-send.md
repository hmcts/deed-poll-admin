# Plan 16c: Mandatory Gazette review and confirmed sending

> **Role boundary superseded, 12 October 2026:** Gazette now requires the Delivery Manager's
> `ACCESS_GAZETTE` capability. Team leader and legacy admin alone are refused, including the ready count.
> Historical admin-role references below describe the earlier implementation. See
> [the role-change plan](20261009-team-leader-delivery-manager.md) for the matrix, rollout prerequisites
> and local validation; this note does not claim deployment or live role verification.


## Decision and scope — 9 October 2026

Steve chose mandatory checklist completion initially. All five proposed checks are
required for each application before it can be selected and sent. Wording can be
refined later; the rule is implemented without adding a configurable advisory mode.

This slice builds on admin PR #165 (`43a05d6`) in a separate worktree. It consumes
the already merged API PR #93 contract and changes no API code or OpenAPI artifact.
The parent [plan 16](16-gazette-1-ready-list-review-and-send.md) remains the feature
record; [16b](completed/16b-gazette-contract-and-request-status.md) records its read foundation.

## Implemented journey

- [x] The existing ready list links to **Review and select applications**.
- [x] `/deed-polls/gazette/batch` handles selection, per-case review, confirmation
  and recovery. Paging preserves selected cases from other pages. Unreviewed cases
  have disabled checkboxes, backed by server-side rejection of forged selection.
- [x] Every review requires the five distinct acknowledgements. Incomplete input
  is preserved. The page shows former/new names including middle names, and links
  to full application details in another tab.
- [x] A review is tied to a digest of the complete API case detail, including nested
  notes, witnesses and documents. Re-read at acknowledgement, before and after API
  preview, and before first send. Changes invalidate review; read failures block it.
- [x] Confirmation displays the API recipient/revision, adult/minor counts, expiry
  and complete selected reference list. The user must explicitly confirm sending
  one email with the appropriate spreadsheet download links.
- [x] Domain writes preserve the original body and request key. A classified Gazette
  refusal uses localised wording; generic errors/unknown codes never imply that no
  request was admitted. All five accepted states redirect to the status page.
- [x] Lost responses offer an explicit check with the original keyed POST. Recovery
  does not re-read eligibility or substitute new recipient/data/key values, even
  after review or preview expiry. No new-send action appears on recovery/status.

## Transport and concurrency

Hidden form state is HMAC-signed with the existing session secret, domain separated
and bound to the session ID. It contains review digests and the original confirmation,
not a database record or API checklist flag. A new visit has an independent UUID;
duplicating a form retains its identity. The first confirmation derives a request
UUID from that visit/session. Returning through an older selection form always derives
the same key. Consequently a stale tab cannot mint a second identity: the API returns
the original status or `REQUEST_KEY_REUSED` when the body differs. A changed selection
before admission gets a fresh preview with renewed confirmation, keeping the visit key.

The editable visit lasts two hours. An attempted recovery remains usable for the
session with its original payload; expiring the preview is not evidence of non-admission.
After logout or session replacement, old forms fail validation and recovery is via the
request list. Keys never enter URLs, logs or case notes. Forms carry state through POST
renders; an accepted submission uses a 303 redirect to its public batch status URL.
There is no session-wide mutable current batch and no session-map lost-update race.

The batch endpoint alone allows a bounded 512 KiB form, enough for 100 IDs/references
at their field limits plus signed review/confirmation state. Other forms retain their
existing limit. Selected IDs and all signed payload fields are validated.

API remains authoritative for the final atomic readiness, reservations, recipient and
exported-cell snapshot checks. The UI digest is conservative, so unrelated case-detail
changes can also require another review. It is not a transaction lock or a durable
business attestation; no API claim to that effect is made.

## Validation

Baseline is PR #165: 3,669 tests passed, three skipped; build/lint and four browser
journeys passed. Welsh baseline: 615 strings, 474 identical (467 prose, seven non-prose).

- [x] `yarn build` and `yarn lint`.
- [x] Full serial test suite: 3,703 passed, three pre-existing skips, including missing/duplicate checks, tampered/session-copied
  state, maximum form size, stale/nested case changes, generic failures, all structured
  refusal codes, stable keys through back navigation and expired recovery.
- [x] Five IDAM-authenticated browser journeys with axe checks, including mandatory
  review, mixed adult/minor confirmation, all delivery states, lost responses,
  repeated old confirmations and simultaneous submission of one confirmation.
- [x] English/Welsh extraction: 675 strings; still 474 identical (467 prose, seven
  non-prose). The expected non-zero baseline remains; no new identical prose.
- [ ] Human review of new Welsh text and any later checklist wording refinements.

Browser tests use a fresh mock and disposable local Redis/IDAM. No real email was
sent, no Notify configuration changed and no environment was deployed or enabled.

## Remaining operational steps

1. Review/merge #165 before this dependent implementation.
2. Complete human language review and environment acceptance testing.
3. Deploy API PR #93 and migrations before this admin release; provision the agreed
   Notify templates/download-link retention and recipient setting before explicitly
   enabling sending. Keep relinquishment outside this process.
