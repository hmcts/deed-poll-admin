# Gazette recipient settings validation — 8 October 2026

Based on merged admin master `3ac876c` (PR #162). The published settings contract
comes from API commit `c286ffa96150798bfbe279e40bd656bbd45508b5`; see the client
[SPEC-PROVENANCE](../../libs/deed-poll-api-client/SPEC-PROVENANCE.md) for its fingerprint
and complete measured delta. Deploy that API and V33 before the admin editor.

## Delivered

The ready list links to `/deed-polls/gazette/settings`, covered by the existing
admin area role gate and same-origin write protection. It reads/writes the shared
recipient through the client and domain layers, starts unset, displays change
attribution and preserves input on validation errors. A stale original revision
returns a conflict page requiring reload. It never silently refreshes a revision
and repeats a write. English and Welsh copy are included; settings writes send no
email. The realistic HTTP mock enforces roles, validation, revision checks and no-op
saves, and resets the setting with its fixtures.

## Verification

- `yarn format`, `yarn lint`, `yarn build` passed.
- Full `yarn test`: 3,595 passed, three existing skipped. Two additional contract/
  validation assertions were then added; the final client/mock suite passed all
  626 tests (3,597 passing tests across the final suites).
- `yarn test:gazette`: all three browser journeys passed with the local IDAM
  simulator, isolated mock/app ports 3216/3316 and dedicated Redis 6316/database 1.
  Coverage includes non-admin refusal, ready/history reads, recipient persistence,
  invalid addresses, stale parallel forms, Welsh and axe accessibility checks.
- The generated OpenAPI comparison preserves every existing path/schema and adds
  only the GET/PUT settings contract and its two schemas. Contract checks retain
  exact consumed/deferred inventories and pin the email validation pattern.
- Welsh extraction was refreshed. New copy still needs human language review;
  the pre-existing untranslated-string baseline remains.

No external Ralphex review, deployment, live Notify call or batch send was run.
The parent plan remains active: review/checklist selection, confirmation with
recipient revision, durable sending/recovery, Notify provisioning and full send
acceptance coverage remain outstanding.
