# Plan: admin reads the caller's access from `GET /me`

> Agreed with Steve on 2026-10-15, one question at a time. Branch `feat/admin-me-capabilities`: the seven
> `feat/team-leader-delivery-manager` commits rebased onto master `e1debf4` (after #175 and #179), then this plan.

## Overview

`feat/team-leader-delivery-manager` (`01005af`) already gates admin on six capabilities. But it derives them locally
from IDAM roles (`capabilitiesFor(roles)` in `libs/deed-poll/src/auth/capabilities.ts`), and since 2026-10-13 IDAM is
sign-in only: permissions come from AM, resolved by the api. api#105 (merged 2026-10-15, `e8907d0`) publishes the
answer:

```json
{ "staff": true, "judicial": false, "capabilities": ["OVERRIDE_PRIVACY", "DELETE_NOTE", "DELETE_WITNESS", "MANAGE_SHARED_QUERIES", "REPAIR_CCD", "ACCESS_GAZETTE"] }
```

This plan makes admin store that answer on the session user at login and on each token refresh, and render every
capability decision from it. Admin then keeps no copy of the role-to-capability mapping. It also fixes a live mismatch
on master: admin gates the Gazette on `caseworker-deedpoll-admin`, but the api has required `ACCESS_GAZETTE` since #100.

## Context

- **Base.** Rebased onto master `e1debf4` (#175's session limits and #179's timeout warning) on 2026-10-15. The only
  conflict was docs, in `docs/plans/16-gazette-1-ready-list-review-and-send.md`; both sides were kept. Master was 26
  commits ahead.
- **What the branch already does** (per commit):
  - `595bbda`: the spec refresh to api #100
  - `4c29183`: capabilities, and `sessionUser` re-derives from stored roles
  - `46d97c5`: Gazette, note, witness and shared-query gates on capabilities
  - `01c67ea`: the mock Gazette role matrix and the personas
  - `43dc24f`: e2e staff-role accounts
  - `07ae827`: acceptance fixes
  - `01005af`: docs
- **Call sites of a capability** (as on the branch):
  - `src/app.ts:208`: `requireCapability(ACCESS_GAZETTE)`
  - `src/pages/deed-polls/index.ts:267`: the Gazette count
  - `libs/deed-poll/src/notes/delete-policy.ts:6`
  - `libs/deed-poll/src/witnesses/delete-policy.ts:6`
  - `src/pages/deed-polls/queries/[queryId]/edit.ts:136,187` and `queries/new.ts:182`
  - `isAdmin` via `OVERRIDE_PRIVACY`: `[id].ts:210`, `[id]/edit/[tab].ts:74,139`, `form-presentation.ts:69,94`,
    `edit-view.ts:84`
  - the landing page, `src/pages/index.ts:74`
  - the test double, `src/express-doubles.ts:81`
- **Session.** `DeedPollSession` is in `src/auth/session.ts`.
  - `signIn` sets `user` (called from `oauth2/callback.ts` and `switch-persona.ts`).
  - `sessionUser` normalises on read, at about `:143-147` on the branch.
  - `updateTokens` only replaces tokens.
  - Login builds the user in `src/auth/idam.ts` `loginFrom` (`:172-191`), which serves the OAuth callback and the
    password-grant persona switcher.
  - Refresh is `src/auth/refresh-middleware.ts`: `refreshTokens` at `:72`, then `updateTokens` at `:107`.
  - #175 (now on master) adds `authenticatedAt`/`lastSeenAt` and `session-lifetime.ts`. #179 adds
    `res.locals.sessionClock`, `/session/keep-alive` and `/session/status`.
- **Calling the api.** A client function `request(config, "GET", path, WIRE_SCHEMAS.X)` in
  `libs/deed-poll-api-client/src/api/client.ts`, and `callApi(caller, …)` in `libs/deed-poll/src/api/deed-poll-api.ts`.
  At login there's no session token yet, so build the `Caller` as `{ accessToken: tokens.access_token }`.
- **The spec refresh is all-or-nothing.**
  - `libs/deed-poll-api-client/SPEC-PROVENANCE.md` gives the regeneration procedure and the record format.
  - `contract.test.ts` checks that operations and schemas match both ways, and that properties and enums match.
  - Every response schema needs a `STRICT_RESPONSE_PROPERTIES` entry.
  - Register anything new other than `/me` as deferred.
- **The mock.** `libs/deed-poll-api-client/src/mock/server.ts` gates the Gazette on the role string
  `caseworker-deedpoll-delivery-manager` (`:297-300`). Roles come from in-process fixtures or from local IDAM userinfo.
- **Api semantics to mirror in the mock** (deed-poll-api `config/StaffArea.java`, `domain/auth/RoleCapabilities.java`):
  - `staff` is any of `caseworker-deedpoll`, `caseworker-deedpoll-team-leader`, `caseworker-deedpoll-delivery-manager`
    or `caseworker-deedpoll-admin`
  - `judicial` is `caseworker-deedpoll-judicial`
  - Team leader and legacy admin get `OVERRIDE_PRIVACY, DELETE_NOTE, DELETE_WITNESS, MANAGE_SHARED_QUERIES, REPAIR_CCD`
  - Delivery Manager gets those five plus `ACCESS_GAZETTE`
  - Capabilities come in that declaration order

## Decisions: implement these, do not revisit

1. **The session user carries `/me`'s answer, not roles:** `{ name, staff, judicial, capabilities }`.
   - `can(user, capability)` reads `user.capabilities`.
   - `isAdmin` = `capabilities` includes `OVERRIDE_PRIVACY`.
   - `isJudicial` = `judicial`.
   - Delete `capabilitiesFor`, and drop `roles` from `CurrentUser`.
   - Role constants stay **only** where IDAM test identities are provisioned or the mock reads them. That's the
     persona users, the seed scripts and the mock. Nothing in the app's authorisation path reads a role.
   - The comment "never persist capabilities in a session" is replaced. Its reason, stale authority, is now met by
     refreshing the answer.
2. **The stored answer is validated when read.** Unknown capability strings are dropped. A missing or malformed answer
   means `staff:false, judicial:false, capabilities:[]`, which fails closed.
3. **Login.** `loginFrom` calls `/me` with the new access token after userinfo. If `/me` fails, sign-in still completes,
   with no access at all and one WARN line (no subject, no token). It doesn't refuse the login: that's OWASP plan 01
   Task 6's job.
4. **Refresh.** After a successful `refreshTokens`, call `/me` with the new token.
   - On success, store the answer **in or beside `updateTokens`**.
   - On failure, keep the previous answer and log one WARN.
   - **`signIn` stays the only writer of `authenticatedAt` and `lastSeenAt`, and `updateTokens` must never write
     `authenticatedAt`** (admin#175's invariant). `session-lifetime-refresh.test.ts` must stay green.
5. **Sessions from before the deploy** have no stored answer. Fetch `/me` once, in the refresh middleware or right
   after it, using the session's access token. On failure that request gets no access, and the next request tries
   again. Nobody is forced to sign in again.
6. **`staffAccess(user)` → `{ staff, judicial }`** is exported next to `can`, for OWASP plan 01 Tasks 6–8. **This plan
   builds no staff block.** No `requireStaffRole`, no refusal at the callback, and **`src/auth/require-auth.ts` is not
   edited.** #178 owns it.
7. **The landing page behaves as on the branch:** `judicial && capabilities.length === 0` goes to the judicial pool,
   and everyone else goes to the case list. The source is the stored answer, not roles.
8. **The Gazette gate and the main-list Gazette count key on `ACCESS_GAZETTE`** through `can`, as the branch already
   does.
9. **The spec refresh** takes the whole api document at `e8907d0`.
   - Register `GET /me` (`getCallerAccess`, schema `CallerAccessResponse`) fully: a zod wire schema, a strict response
     entry, `IMPLEMENTED_OPERATIONS`, a client function `getCallerAccess(config)`, a domain function in
     `libs/deed-poll/src/auth/`, and a mock route.
   - Any other new operation or schema goes to `deferred-contract.json`.
   - Record the provenance per `SPEC-PROVENANCE.md`.
10. **The mock works `/me` out from the token's roles** with one table that mirrors the api semantics in Context. Its
    Gazette gate uses the same table (`ACCESS_GAZETTE`), not the role string. A test pins the table's capability names
    to the `CallerAccessResponse` enum in `openapi.json`, so a new api capability fails until the mock knows it.
11. **The persona switcher and the e2e fixtures** keep their IDAM role strings, because they provision identities. What
    they assert about the UI must follow from the mock's `/me`.
12. **Out of scope:**
    - admin's staff block (OWASP plan 01 Tasks 6–8)
    - the process-config screen and user management
    - any `REPAIR_CCD` UI
    - #178's files: `src/auth/session-lifetime.ts`, `src/pages/session/*`, layouts, locales, `src/assets/js/*`

## Development Approach

- Each task: implement, add tests, run the validation commands, commit.
- Run every command in the foreground only. Never background a build or test run.
- Follow the repo's CLAUDE.md rules, `.claude/rules/testing.md` ("mock the adapter, not `fetch`"), Biome, strict
  TypeScript and no `any`.
- Do not edit `require-auth.ts`, `session-lifetime.ts` or any of #178's files.

## Validation Commands

Run from this worktree. All green on the starting commit `f37508b` (the rebased branch before this plan), measured
2026-10-15:
- `yarn lint`: clean, 454 files
- turbo: `8 successful, 8 total`, 197 test files, **3,885 tests**: app 1,669, deed-poll 1,176, api-client 689,
  cloud-native-platform 153, govuk-starter 127, simple-router 41, session-postgres 23, session-redis 7
- `yarn build`: OK
- `git diff --check`: clean

```bash
yarn lint
npx turbo test test:app --concurrency=1
yarn build
git diff --check
```

**Not bare `yarn test`**: it can report `0 successful, 8 total` having run nothing. Expect `8 successful, 8 total`, and
record the vitest file and test counts from the output. `yarn welsh:check` exits 1 by design; don't treat it as a
failure. E2E isn't run from a worktree (docker compose project names collide); see Post-Completion.

## Implementation Steps

### Task 1: The spec refresh, the `/me` client and the mock

- [ ] Copy in the api document regenerated at `e8907d0`, supplied as
      `/Users/steve.newman/Documents/GitHub/deed-poll-admin-workspace/cft-workspace/local-notes/deed-poll-admin/openapi-e8907d0.json`.
      It was generated on 2026-10-15 in a clean detached api worktree by
      `JAVA_TOOL_OPTIONS=-XX:UseSVE=0 TESTCONTAINERS_RYUK_DISABLED=true ./gradlew integration --tests '*OpenAPIPublisherTest*' --no-watch-fs`.
      Its raw SHA-256 is `3ab71b0263c7dced9bbe1d5aecdca07fed0fb218c79bf15dafed8c7279e8a0d7`, and it has 52 operations,
      37 paths and 56 schemas. **The parsed delta against the committed document is exactly `GET /me` and
      `CallerAccessResponse`**; nothing else changed, so nothing is deferred. Format it as 2-space JSON, then Biome,
      and add a provenance entry in `SPEC-PROVENANCE.md`'s existing style.
- [ ] Register `getCallerAccess` and `CallerAccessResponse` fully (decision 9). Defer anything else new.
      `contract.test.ts` must pass.
- [ ] Add the mock's `/me` route and the shared role table. Move the mock's Gazette gate onto the table. Add a test that
      pins the table to the spec enum, and a test for each persona's `/me` answer.
- [ ] Mark completed

### Task 2: The session user is the stored answer

- [ ] Change `CurrentUser` and the session to `{ name, staff, judicial, capabilities }` (decision 1). Add read-time
      validation (decision 2), `can`, `isAdmin`, `isJudicial` and `staffAccess` (decision 6). Delete `capabilitiesFor`
      and every role read in the authorisation path. Update `src/express-doubles.ts`.
- [ ] Tests:
  - an unknown capability is dropped
  - a malformed or missing answer means no access
  - each capability call site behaves as before for Team leader, Delivery Manager, legacy admin, caseworker, judge
    and no-role callers
- [ ] Mark completed

### Task 3: Fetch at login and on refresh

- [ ] `loginFrom` calls `/me` (decision 3). The refresh middleware calls it after a successful refresh (decision 4),
      and backfills sessions that have no answer (decision 5).
- [ ] Tests:
  - login with `/me` OK
  - login with `/me` failing: signed in, no access, WARN
  - refresh OK replaces the answer
  - refresh with `/me` failing keeps the old answer
  - backfill OK, and backfill failing then succeeding on a later request
  - `authenticatedAt` is unchanged by refresh, and `session-lifetime-refresh.test.ts` is still green
  - the persona switcher's password-grant path also stores the answer
- [ ] Mark completed

### Task 4: Landing, personas and docs

- [ ] Landing per decision 7. Persona switcher and e2e fixtures per decision 11. Gazette gate and count per decision 8,
      and check they now read the stored answer.
- [ ] Update `CLAUDE.md`:
  - "Personas and role gating": the `/me` source, and the `KNOWN_ROLES` rule no longer applying to authorisation
  - the Gazette gate paragraph, now `ACCESS_GAZETTE`
  - the role-assignment line, which becomes "takes effect within one token lifetime, not at next login"
  Also update the README and the branch plan's rollout notes.
- [ ] Record the validation counts and the branch SHA in Execution notes. Don't claim any e2e or live verification.
- [ ] Mark completed

## Execution notes

## Post-Completion

Not Ralphex checkboxes:
- run e2e by hand outside the worktree: `staff-roles.spec.ts`, the Gazette journeys and the persona switcher
- the external review: a direct, scoped Copilot run, plus fast-forwarding local `master` first
- open the PR, then tell Gale (`cft-workspace-8b`) when it merges, because it's a Gazette release dependency
- OWASP plan 01 Tasks 6–8 build on `staffAccess` (unowned; Steve)
- the api chart's S2S secret mount for AM (a separate small api PR)
