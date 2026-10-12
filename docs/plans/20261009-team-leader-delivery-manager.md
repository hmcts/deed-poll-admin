# Team leader and Delivery Manager: admin application

## Overview

Replace the caseworker-admin persona with Team leader and introduce Delivery Manager. Delivery Manager
inherits Team leader's existing casework privileges. The entire Gazette area, its navigation and count
are Delivery Manager-only; Team leaders cannot view ready lists or history, configure recipients,
preview, submit or inspect publication requests. Further management powers are separate requirements.

Requirements confirmed on 9 October 2026. This plan does not implement missing Gazette UI journeys.
When those journeys land, their area and API gates must follow this rule from the outset.

Companions:

- [API permissions plan](../../../deed-poll-api/docs/plans/20261009-team-leader-delivery-manager.md).
- [Infra and identity rollout plan](../../../deed-poll-infra/docs/plans/20261009-team-leader-delivery-manager.md).

## Context

Planning baseline: admin `master` at `3ac876c`; unrelated untracked business-context images are present.
The existing Gazette UI is the read-only implementation from completed plan 16a. The API's locally
available `origin/master` at `938795d` has newer Gazette settings/preview/submission/status operations
than this UI consumes. Reconcile the intended release baseline, not the API's older checked-out CDAM
branch. Local refs are planning evidence, not confirmation of deployed versions.

Relevant files:

- `libs/deed-poll/src/auth/{roles,idam-claims,current-user}.ts` and package exports.
- `src/auth/{current-user,session,require-role,idam,refresh-middleware,persona-switcher,persona-users}.ts`.
- `src/app.ts`, `src/pages/index.ts`, `src/pages/deed-polls/index.ts`, `src/pages/deed-polls/gazette/**`.
- Privacy presentation, note/witness delete policies, saved-query publishing controls under
  `libs/deed-poll/src/` and `src/pages/deed-polls/`.
- `libs/deed-poll-api-client/src/mock/server.ts`, `src/seed/accounts.ts` in that package,
  `scripts/seed-idam-users.mjs`, `scripts/seed-local-cases.mjs`.
- `e2e-tests/tests/idam-session.ts`, persona/Gazette browser tests and Playwright configurations.
- `libs/deed-poll-api-client/openapi.json`, wire/contract inventories and `SPEC-PROVENANCE.md`.

The current `/deed-polls/gazette` prefix uses `requireRole(DEEDPOLL_ADMIN)`; its dashboard count uses
`isAdmin`. The mock's history route explicitly checks the old claim. All three must change.
`KNOWN_ROLES` filters unrecognised claims, so adding a type alone cannot introduce a working role.

## Permission contract

Use exactly `caseworker-deedpoll-team-leader` and `caseworker-deedpoll-delivery-manager` in lockstep
with API and IDAM. The API plan is the authority for the shared matrix and capability vocabulary:
`OVERRIDE_PRIVACY`, `DELETE_NOTE`, `DELETE_WITNESS`, `MANAGE_SHARED_QUERIES`, `REPAIR_CCD`,
`ACCESS_GAZETTE`. Mirror only what the UI needs, with tests holding it to that contract.

- Team leader: all existing non-Gazette admin permissions, including privacy, deletion and shared queries.
- Delivery Manager: the same, plus the whole Gazette facility, with no need for another role assignment.
- Legacy `caseworker-deedpoll-admin`: temporary Team leader compatibility, never Gazette access.
- Judicial rights remain independent. Mixed-role permissions are additive; neither new role implies judge.
- Empty or unrecognised roles confer no privileged capabilities. Preserve ordinary caseworker behaviour.

API remains the data/permission boundary. Every production call still sends only the access token.
Do not send derived capabilities or role assertions to the API. Retained privacy-context `isAdmin`
booleans must derive from `OVERRIDE_PRIVACY`; use explicit capabilities for other affected controls.

The named Gazette ready filter, including a bookmarked URL or saved-query shortcut on the ordinary
case-list page, must not expose a Gazette worklist to non-Delivery Managers. Keep ordinary case pages,
their existing fields and case notes visible under existing rules. Do not add case-level segregation.

## Development Approach

- Work in an isolated admin implementation branch/worktree. Read CLAUDE.md and applicable
  `.claude/rules/{frontend,backend,testing,e2e-testing}.md`. Preserve other developers' files/services.
- Testing approach: add regression tests with each code task, implement, then run focused tests and lint.
  Keep tasks sequential; API implementation/contract is an input, not something this plan edits.
- Keep `CurrentUser` session data serialisable. Resolve capabilities through functions from recognised
  roles; do not persist a `Set`, function or trusted new permission boolean that breaks Redis sessions.
- Normalise existing stored session users through the current role mapping so an old `isAdmin: true`
  never admits Gazette. Existing stored roles are login snapshots; a token refresh currently updates
  tokens, not role assignments. Record fresh-login/session invalidation in the rollout, rather than
  assuming refresh updates roles or adding IDAM calls to every page render.
- Preserve mount ordering: authentication, settled session/persona locals, area gate, router.
  API refusals must still map to the established forbidden response, including during mixed-version rollout.
- Use the workspace Ralphex launcher and a selected review profile without rewriting `.ralphex/config`.
  Local task commits/reviews belong here; publication and live rollout are separate handoffs.

## Validation Commands

Run from the admin implementation worktree with immutable dependencies installed:

```bash
yarn lint
npx turbo test test:app --concurrency=1
yarn build
yarn test:gazette
yarn test:e2e
yarn welsh:check
git diff --check
```

Run focused affected tests while implementing; run the full set at acceptance. Record actual counts,
skips and pre-existing Welsh failures rather than suppressing them. Use isolated mock/app ports and
Redis state for browser tests. Never reset another developer's mock or share live session artifacts.

## Implementation Steps

### Task 1: Reconcile the release inputs and API contract

**Files:** this plan; API client OpenAPI artifact, provenance and contract tests.

- [ ] Record admin baseline SHA, dirty state, test/lint/Welsh baselines and the API source/artifact identity from its companion plan. Inventory every admin check and Gazette entry point on the intended implementation branch.
- [ ] Reconcile the complete API artifact, including newer Gazette endpoints and unrelated changes. Preserve exhaustive path/schema drift checks; use the established explicit deferred-operation inventory for unconsumed operations, not wildcard exclusions or speculative client/UI implementations.
- [ ] Update contract/provenance tests as needed and record the exact delta. Do not invent endpoints or silently replace a newer contract with the checked-out API branch's older one.
- [ ] Identify overlapping active Gazette journey work and record which source/plan owns each surface. Run contract and baseline tests before changing roles.

### Task 2: Introduce roles and derive permissions safely across sessions

**Files:** domain auth role/claim/current-user modules, minimal capability mapping, package exports,
`src/auth/{current-user,session}.ts`, `src/pages/index.ts` and corresponding tests.

- [ ] Add both claim values to the role union and `KNOWN_ROLES`; mark the old claim as migration-only. Derive Team leader capabilities and Delivery Manager's superset using the API matrix.
- [ ] Normalise session users through recognised roles when resolving permissions, including existing Redis sessions. Ignore stale stored privilege flags; absent/unrecognised roles must not produce elevated capabilities.
- [ ] Preserve login, subject validation, refresh, logout and audit-name behaviour. Do not require every session to have a newly serialised permission field or a method prototype.
- [ ] Keep Team leader and Delivery Manager homes on the case list; preserve judicial-only and combined-role landing behaviour. Do not rename the application/repository or OAuth client because the role name changed.
- [ ] Test each role alone, legacy-only sessions, malformed/unknown roles, mixed judicial roles and stale `isAdmin` flags. Run auth/session/landing tests and lint.

### Task 3: Preserve Team leader controls and restrict every Gazette entry

**Files:** `src/app.ts`, `src/auth/require-role.ts` or its capability companion, case-list and saved-query
pages, Gazette pages, privacy adapters and delete policies; colocated page/app/domain tests.

- [ ] Move the whole `/deed-polls/gazette` prefix to `ACCESS_GAZETTE`, after authentication and before routing. Keep future pages covered by the same mount, including any settings/send/status/recovery UI added before execution.
- [ ] Make the dashboard Gazette link, count and count request Delivery Manager-only. Non-Delivery Managers make no Gazette count/history requests. Preserve zero/unavailable states for authorised users and independence from other worklist failures.
- [ ] Guard named-ready-filter execution outside the area, including bookmarked case-list URLs and saved-query links. Hide Gazette-specific filter choices/shortcuts for other roles; handle API 403 without falling back to an unrestricted worklist. Preserve ordinary query ownership/management and ordinary case visibility.
- [ ] Derive privacy, note/witness deletion and shared-query publishing controls from the corresponding inherited capabilities. Delivery Manager-only and Team leader-only users must both retain the previous non-Gazette admin experience.
- [ ] Extend filesystem-derived area coverage and page tests: anonymous login redirect; all non-Delivery Manager roles refused direct Gazette URLs; mixed roles obey the matrix; rejected actions never call the API. Test both viewing and any POST handlers present.
- [ ] Run affected app/domain/template tests and lint. Preserve bilingual user copy and extract new strings if any; development persona copy keeps its existing English-only convention.

### Task 4: Align mocks, seeded users and persona switching

**Files:** persona modules, seed scripts/accounts, API mock, test doubles and related fixtures/tests.

- [ ] Replace the normal admin persona with `Team leader` and add `Delivery Manager`, each using its new role alone. Keep caseworker and judicial personas, environment allowlists and production-disabled switching unchanged.
- [ ] Update local IDAM fixture seeding, mock data readers and test helpers to use the least role needed. Gazette seed read-back uses Delivery Manager; ordinary privileged fixtures use Team leader. Retain a separate legacy negative fixture for migration coverage.
- [ ] Update the mock's Gazette gates, including the ready filter, to match API. Retain mock-only userinfo resolution and in-process fixtures; never put an asserted role header into production requests. Do not broaden the mock into an unrelated full security rewrite.
- [ ] Test seed/persona definitions, switching, missing-IDAM-role errors and mock allow/deny outcomes for every role. Keep account creation behind existing non-production controls.
- [ ] Run relevant mock/persona/seeder tests and the full unit suite; record results.

### Task 5: Prove the role journeys in the browser

**Files:** `e2e-tests/tests/idam-session.ts`, auth setup, Gazette/persona/casework specs and test configs.

- [ ] Create separate session fixtures through real local IDAM login for Team leader and Delivery Manager; preserve ordinary/judicial fixtures. Do not bypass login or copy one persona's cookie into another fixture.
- [ ] Prove Delivery Manager alone sees Gazette counts, ready lists and history, and can use any implemented Gazette settings/action UI. Prove Team leader, legacy admin, caseworker and judicial users cannot enter via links or direct URLs.
- [ ] Prove both new roles retain representative existing privileges: privacy controls, note/witness deletion and shared-query publishing. Prove neither receives judicial access without that separate role.
- [ ] Exercise bookmarked ready-filter/saved-query paths, logout/relogin after role assignment changes, and an old session with stored admin state. Verify blocked paths send no Gazette requests where the UI should gate first.
- [ ] Run isolated Gazette and affected full browser journeys with inline accessibility checks. If send UI is absent, record that fact and rely on API tests for send enforcement; do not invent a send journey to complete this task.

### Task 6: Verify acceptance criteria and document the cutover

**Files:** `README.md`, `CLAUDE.md`, active `docs/plans/16-gazette-1-ready-list-review-and-send.md`,
this plan's execution evidence and any active successor Gazette plans found in Task 1.

- [ ] Run full unit/lint/build, required browser journeys and Welsh checks. Record actual results, baseline exceptions and changed permission coverage.
- [ ] Re-scan runtime controls, mocks, seeders and tests for old admin role gates. Remaining legacy references must have an explicit compatibility or negative-test purpose; Gazette must not use `isAdmin`.
- [ ] Update user/developer documentation to the new names and matrix. Mark older active Gazette access decisions superseded, preserving completed-plan evidence. Keep future selection/send/settings work bound to the Delivery Manager area.
- [ ] Record artifact/source identities, API deployment dependency, fresh-login/session handling, IDAM prerequisites and legacy-retirement handoff for the infra plan. Do not mark live verification complete from mock/browser tests.

## Post-Completion

Deploy after API enforcement is present on every serving instance and both IDAM roles/CCD reader
mappings are available. New role assignments need fresh login; old session snapshots cannot establish
current assignment. Normalise stored roles for rollout compatibility and use the infra runbook to
invalidate affected sessions when assignments change. Do not flush shared Redis or rotate OAuth/session
secrets just to rename roles.

Legacy-only accounts retain Team leader privileges during migration and lose Gazette immediately
under the new gate. Only explicitly assigned Delivery Managers regain Gazette. Remove the legacy role
and its compatibility/tests in a coordinated follow-up after the infra retirement criteria are met.
