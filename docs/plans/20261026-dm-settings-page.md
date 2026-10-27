# Plan: the Delivery Manager settings page

## Overview

Steve asked on 2026-10-14 for a page where a Delivery Manager adjusts the service's business process values while
the service runs, and on 2026-10-15 for that area to link to the platform's staff administration. This plan is the
admin half of the **first phase**, decided on 2026-10-26:

1. **A new page, `/deed-polls/settings`**, in its own area gated by the new `MANAGE_PROCESS_CONFIG` capability, and
   linked from the case list for holders only.
2. **The referral claim window**, the first live process value, edited in hours and minutes (30 minutes to 24
   hours). A warning before the Save button says the change takes effect immediately for every case.
3. **The London Gazette recipient**, moved here from `/deed-polls/gazette/settings` as its own section with its own
   Save. It is shown only to callers who also hold `ACCESS_GAZETTE`.
4. **A link to XUI staff administration**, for adding staff and changing their access through the platform (Steve,
   2026-10-15). There is no deed-poll user store.

The other six process values are later plans, one each, that build the behaviour and the setting together. Do not
add fields, placeholders or "coming soon" text for them.

**Prerequisite:** the api half, `deed-poll-api` `docs/plans/20261026-dm-process-settings.md`, merged. This plan
starts by refreshing `libs/deed-poll-api-client/openapi.json` from that merge commit. **Deploying** this page also
needs that api serving on every replica in the target environment, not merely merged. Until then the page's reads
fail, and the api's rule is that nobody edits process settings while old api pods remain.

**A signed-in user may not see the page straight away.** `MANAGE_PROCESS_CONFIG` reaches a session through `/me`,
which admin asks at sign-in and after each token refresh. So an existing Delivery Manager session gets the link
within one token lifetime, or at once on signing in again. A missing link right after deploy is that, not a failed
deployment. The docs say so.

## Context

Baseline: admin `origin/master` `cc43cde` (2026-10-26). **Rebase onto current `origin/master` before starting** and
re-record the baseline there: other admin changes (for example Scout's preview-clock test fix) may have landed. Read `CLAUDE.md`, `.claude/rules/{backend,frontend,testing}.md`
and the files below, and record the execution baseline.

Decisions (Steve, 2026-10-26; the source is `cft-workspace/.context/deed-poll-admin/dm-config-plan-relevance-2026-10-26.md`):

| # | Decision |
|---|---|
| D1 | Phase 1 = settings store + claim window live + XUI link. The other six values come later. |
| D2 | Gazette recipient settings move onto this page. |
| D3 | New `MANAGE_PROCESS_CONFIG`, Delivery Managers only. |
| D4 | The claim window is 30 minutes to 24 hours, in whole minutes. |
| D5 | Every change is audited by api. The page shows last changed by/at. |
| D6 | `/deed-polls/settings`, its own gated area, linked from the case list. The Gazette page's settings link points here. |
| D7 | The XUI link is per environment, from the chart: `https://manage-case.{env}.platform.hmcts.net/staff` (aat, demo, ithc, perftest) and `https://manage-case.platform.hmcts.net/staff` in prod. Preview uses AAT's. Never production XUI from a non-production environment. |

Juniper's implementation defaults, not separately decided (raise any you disagree with before running):

- **Two forms, two Saves, two revisions.** The process section and the Gazette section post separately, each carrying
  only its own revision, so a conflict in one never blocks or overwrites the other's *stored* value. **A browser
  submits only the form whose button was pressed, so unsaved edits in the other section are lost on any submit, and
  this page does not try to keep them.** The intro says so: "Save each section before you change another." A test
  pins that sentence.
- **The old address redirects.** `GET /deed-polls/gazette/settings` answers a 302 to `/deed-polls/settings#gazette-recipient`.
  Its `POST` is removed: the service is not live yet (prod is a dark deployment until 2026-11-02), so no open form is
  stranded.
- **The warning is GOV.UK warning text above the process section's Save**, not a separate confirmation page.

Files to read first:

- **The page being moved:** `src/pages/deed-polls/gazette/settings.ts`, `settings.njk` and `settings.njk.test.ts`
  (revision as a hidden control, 400 re-render keeping input, a 409 with a reload link, `?saved=true`, last changed
  by/at in `Europe/London`); `libs/deed-poll/src/gazette/service.ts` (`findGazetteSettings`, `saveGazetteSettings`),
  `libs/deed-poll/src/gazette/schemas.ts` (`gazetteSettingsFormSchema`) and `settings.test.ts`.
- **Gates:** `src/app.ts` line ~248, `app.use("/deed-polls/gazette", requireCapability(ACCESS_GAZETTE))`;
  `src/auth/require-role.ts`; `src/app.test.ts` (~574 and ~612, which read page directories off the filesystem and
  check the mount covers them); `src/auth/require-role.test.ts` (~105/141). Mount the new gate the same way, after
  `requireAuth`, and extend those tests so `src/pages/deed-polls/settings/**` is proven covered.
- **Capabilities:** `libs/deed-poll/src/auth/capabilities.ts` (add `MANAGE_PROCESS_CONFIG`) and the mock table
  `libs/deed-poll-api-client/src/mock/caller-access.ts` (the Delivery Manager row gains it; its test pins the table to
  `CallerAccessResponse`'s enum in `openapi.json`). `CLAUDE.md`'s capability table gains a column.
- **The api client:** `libs/deed-poll-api-client/src/api/client.ts` (`getGazetteSettings`/`updateGazetteSettings`
  ~264-270 to copy), `contract.test.ts` (set-equality both ways between the client and `openapi.json`), the mock's
  Gazette settings routes (`mock/gazette-requests.test.ts` ~360) and `SPEC-PROVENANCE.md` (how every refresh is
  recorded).
- **The case list:** `src/pages/deed-polls/index.ts`/`index.njk`, the Gazette panel at ~80-85, which is shown only to
  `ACCESS_GAZETTE` holders and degrades on its own. The settings link needs no api read: it is shown from the
  session's capability alone.
- **The Gazette area index:** `src/pages/deed-polls/gazette/index.njk` line ~10 (the settings link).
- **The e2e journeys that use the old page:** `e2e-tests/tests/gazette.spec.ts` ~83, 107-116 and 234 (`${READY}/settings`),
  run by `yarn test:gazette` (its own mock and ports; see `CLAUDE.md`).

### The spec refresh is all or nothing

`contract.test.ts` compares the client and `openapi.json` both ways, so the refreshed spec carries **everything** api
published up to the merge commit, not just process settings. Before refreshing, diff the api spec at the merge commit
against admin's copy, and list every operation and schema that changes. If anything other than process settings and
the `CallerAccessResponse` enum changed, stop and report it: that is someone else's unmerged admin work, and it has
to land first or with this. Generate the spec as `SPEC-PROVENANCE.md` records (`OpenAPIPublisherTest` in a clean api
worktree at the merge commit, 2-space JSON, then Biome), and add a provenance row with the SHA-256.

## Development Approach

1. **Spec, client, mock.** Refresh `openapi.json` (above). Add `getProcessSettings(config)` and
   `updateProcessSettings(input, config)` beside the Gazette pair, with wire schemas from the spec. Add mock routes
   for `GET`/`PUT /caseworker/process-settings`. They need `MANAGE_PROCESS_CONFIG`, start at 120 minutes / revision 0
   / null attribution, enforce the same closed keys, bounds (30–1440, integers), stale-revision 409 and unchanged
   no-op as api, and reset with the mock's other fixtures. Add the capability to the mock's Delivery Manager row.
2. **Domain.** `libs/deed-poll/src/settings/` (a new domain directory): `service.ts` with `findProcessSettings` and
   `saveProcessSettings` through `callApi`, and `schemas.ts` with a form schema factory taking the page's messages,
   as `gazetteSettingsFormSchema` does. **This form is digits only, and does not reuse the shared case parser.**
   `readNumericInput` accepts signs and integer spellings such as `+2` and `2.0`, which suits the case form and not
   this one. Leave that parser unchanged. Each control's value is trimmed and must then match `^\d{1,4}$`:
   - `hours`: blank or 0–24;
   - `minutes`: blank or 0–59.

   Blank reads as 0 unless both are blank. `+2`, `-1`, `2.0`, `1.5`, `1e1`, `0x2`, a thousands separator, a
   non-ASCII digit, an array or object (a repeated or bracketed name), and a **missing** control (the form always
   sends both) are each invalid. The total must be 30–1440, so 24 hours 1 minute is refused, and both blank is refused.
   The page sends `referralClaimExpiryMinutes` and the revision.

   **Where each error is shown** (M4). The two inputs sit in one GOV.UK fieldset, `id="claim-window"`, with ids
   `claimWindowHours` and `claimWindowMinutes`:
   - An invalid hours or minutes value is that input's error, and the summary links to that input.
   - A total out of range, both blank, or api's own 400 naming `referralClaimExpiryMinutes`, is the fieldset's error.
     It marks both inputs, and the summary links to `#claimWindowHours`.
   - A missing or invalid revision, or api's 400 naming `revision`, is the reload control's error
     (`id="reload-process-settings"`), as the Gazette page does.
   - A test asserts that every error-summary link in every rendered error state resolves to an element on the page.
3. **The page.** `src/pages/deed-polls/settings/index.ts` and `index.njk` (extending `layouts/app.njk`), with `en`/`cy`
   pairs. Follow the repo's convention for new copy awaiting translation: `cy` mirrors `en`, as the document viewer
   did, and the strings appear in `yarn welsh:check`'s count (which exits 1 by design). From top to bottom:
   - **Heading and intro.**
   - **"Referral claim window" section** (`id="process-settings"`):
     - hours and minutes inputs, with a hint naming the range;
     - warning text: "Changes take effect immediately for every case. A judge's claim that has been untouched for
       longer than the new window returns to the shared pool the next time any judge opens the referral pool or
       their own referrals, or claims a referral. A longer window does not return claims that have already gone
       back to the pool";
     - last changed by/at;
     - Save.
   - **"London Gazette recipient" section** (`id="gazette-recipient"`): only when the caller holds `ACCESS_GAZETTE`.
     The existing page's form, copy and behaviour, moved.
   - **"Staff and access" section:** one sentence and the XUI link (D7), opening in a new tab with
     `rel="noopener noreferrer"`. Its text says staff-admin access in XUI is needed, as 79754fa's copy did.

   Handlers:
   - `GET` reads process settings, and Gazette settings too when held, with `Promise.allSettled`: a failed Gazette
     read degrades its section with a sentence, and never loses the page (CLAUDE.md, "A second call for one panel
     must not be able to lose the page").
   - `POST /deed-polls/settings` saves the process section.
   - `POST /deed-polls/settings/gazette-recipient` saves the Gazette section. It is gated in the handler on
     `ACCESS_GAZETTE` as well as by the area gate, because api checks the same.

   **What each POST does (M2, M4).** The section that was submitted is *primary*; the other is *additive*.
   - **Local validation fails:** nothing is written and api is not called for the write. Re-render with status 400,
     the submitted section showing the exact text as typed **and its original revision**.
   - **api answers 400:** the same, with api's field mapped as above.
   - **api answers 409:** re-render with status 409. The submitted section keeps the typed text and its **original**
     revision, shows the conflict sentence, and requires an explicit reload through the reload link. Never swap a
     fresh revision in under the typed text, because the next Save would then overwrite a change the user has not
     seen.
   - **Re-rendering the additive section:** read its current stored value. If that read fails, the additive section
     shows its unavailable sentence and **no usable Save**. It never hides or replaces the primary section's
     errors. A caller without `ACCESS_GAZETTE` gets no Gazette read in any handler, and no Gazette section.
   - **Success:** a 303 to `/deed-polls/settings?saved=<section>#<section>`. The GET then reads both sections. If
     either read fails, the saved banner still shows (the save is known to have succeeded) and only that section
     degrades. A successful save is never presented as failed, and nothing is retried automatically.
4. **Gates and links.** In `app.ts`, `app.use("/deed-polls/settings", requireCapability(MANAGE_PROCESS_CONFIG))`, after
   `requireAuth`, beside the Gazette gate. On the case list, a "Service settings" link for `MANAGE_PROCESS_CONFIG`
   holders only. On the Gazette index, the settings link points to `/deed-polls/settings#gazette-recipient`. Delete
   the old `gazette/settings.njk` and its template test once their assertions have moved to the new page's tests.
   The old `settings.ts` becomes the redirect.
5. **XUI link (D7).**
   - Config key `externalLinks.xuiStaffAdmin`, mapped from `XUI_STAFF_ADMIN_URL` in `custom-environment-variables.json`.
     `config/default.json` sets the AAT address for local runs. Never production.
   - Set in `charts/deed-poll-admin/values.yaml` from `global.environment` the way `DEED_POLL_API_URL` is (~line 66).
     Prod drops the environment segment, so it needs a conditional: `manage-case.platform.hmcts.net` when
     `global.environment` is `prod`, otherwise `manage-case.{{ .Values.global.environment }}.platform.hmcts.net`,
     both with `/staff`.
   - `values.preview.template.yaml` pins AAT's address, as it pins `DEED_POLL_API_URL` (~line 44).
   - Extend `src/deployment-chart.test.ts`: render each environment and assert the exact address, that prod gets
     the bare host, and that no non-prod render (preview included) names `manage-case.platform.hmcts.net`.
   - XUI checks the `staff-admin` role itself, so the link is a link and never a permission. The copy says the
     access is needed.
6. **Tests first**, co-located and following `.claude/rules/testing.md`:
   - domain parsing: every boundary (29/30/1440/1441 minutes, 24h0m, 24h1m, 0h30m, blank/blank, blank hours with 45
     minutes) and every refused spelling listed in the Development Approach (`+2`, `2.0`, `1.5`, `-1`, `1e1`, `0x2`,
     `1,000`, a non-ASCII digit, an array, an object, a missing control). `" 2 "` is accepted as 2 after trimming;
   - service calls mocked at the adapter;
   - handler: render, both POSTs, and for each POST: local-validation 400 with no api write call, api 400, api 409
     keeping the typed text and the original revision with the reload control, the additive section's read failing
     on each of those (degraded, with no save control, primary errors intact), success when the follow-up GET read
     fails (banner still shown), and the error-summary-link check; the "save each section" sentence;
   - a Delivery Manager without `ACCESS_GAZETTE` (construct the access) sees no Gazette section, and gets a refusal
     if they post it;
   - template tests in the moved page's style, spreading `en` first;
   - gate tests (`app.test.ts`, `require-role.test.ts`): a Team leader and a caseworker get the 403-on-404-view;
   - the old URL redirects;
   - the case-list link appears for holders only;
   - mock tests for the new routes.
   - **e2e:** update `gazette.spec.ts` to the new page and anchor (the Gazette journeys must still pass under
     `yarn test:gazette`), and add one happy-path journey: a Delivery Manager opens the page from the case list,
     changes the claim window and sees it saved.
7. **Out of scope:** the six later values; any change to Gazette sending, review or history; a confirmation page; a
   deed-poll user store; api changes.
8. **Publishing:** local task commits only. The PR description must state the api prerequisite and the spec
   refresh's full delta. **Do not open or publish the PR until Scout confirms the ITHC freeze is in**, because any
   admin master merge rolls ITHC before the freeze pin lands.

## Validation Commands

Run from the repository root before implementation and after each task:

```bash
yarn install --immutable
yarn format
yarn lint
yarn build
REDIS_URL=redis://127.0.0.1:6379 yarn turbo test test:app --concurrency=1 --force
yarn npm audit --recursive --environment production
```

`yarn build` runs `tsconfig.app.json` and `tsconfig.assets.json`. Never quote bare `yarn test`'s output: it is not
the suite (memory note "deed-poll-admin yarn test false red"). The Redis session suites run only with `REDIS_URL` set
and Redis on 6379 (`docker ps` shows `deed-poll-redis`). Record the per-package test counts from the turbo output, not
a total. Run the e2e journeys (`yarn test:gazette` and the new journey's config) after Tasks 4 and 5. They need local
IDAM on 5556 and their own mock and app ports, as `CLAUDE.md` describes. Run them on a private-port config, never
against a shared developer mock, and never reuse servers on 3000/3200.

**Baseline on `cc43cde` (2026-10-26, Juniper): GREEN.** `yarn lint` clean (580 files); `yarn build` exit 0; `yarn npm audit --recursive --environment production`: no suggestions; full suite with `--force`, 8/8 tasks: app 3,042, deed-poll 1,552, deed-poll-api-client 1,159, express-govuk-starter 132, cloud-native-platform 156, express-session-postgres 85, simple-router 45, express-session-redis 7 (6,178 passed, 0 failed). The Redis suites ran. Re-record at execution time if master has moved.

Run every build and test command in the foreground and wait for it to finish. A backgrounded build ends the session,
and the next one builds over it, wiping the results. **Never move `dist` aside to test a clean build.** That poisons
the shared turbo cache; use `--force` (memory note "admin paths fall through to dist").

## Implementation Steps

### Task 1: Refresh the spec, extend the client and the mock

**Files:** `libs/deed-poll-api-client/openapi.json`, `SPEC-PROVENANCE.md`, `src/api/client.ts`, `contract.test.ts` if
it lists operations, the mock's routes and tests, `mock/caller-access.ts` and its test, `libs/deed-poll/src/auth/capabilities.ts`.

- [ ] Record the execution baseline, and the api merge commit this refresh comes from.
- [ ] Diff the api spec against admin's copy and record the full delta. Stop if it holds anything beyond process settings and the capability.
- [ ] Add failing client and mock tests, implement, then run the focused tests and all Validation Commands, and record the results.

### Task 2: Domain parsing and service

**Files:** `libs/deed-poll/src/settings/service.ts`, `schemas.ts`, their tests, and the package index exports.

- [ ] Add failing tests for every boundary listed in the Development Approach and for the api error mapping.
- [ ] Implement, run the focused tests and all Validation Commands, and record the results.

### Task 3: The page

**Files:** `src/pages/deed-polls/settings/index.ts`, `index.njk`, `gazette-recipient.ts` (the second POST), their tests,
and the moved assertions from `gazette/settings.njk.test.ts`.

- [ ] Add failing handler and template tests (both sections, both POSTs, the conflicts, the degraded Gazette read, the hidden Gazette section).
- [ ] Implement, run the focused tests and all Validation Commands, and record the results.

### Task 4: Gates, links and the old address

**Files:** `src/app.ts`, `src/app.test.ts`, `src/auth/require-role.test.ts`, `src/pages/deed-polls/index.ts`/`.njk`,
`src/pages/deed-polls/gazette/index.njk`, `src/pages/deed-polls/gazette/settings.ts` (now the redirect), delete
`gazette/settings.njk` and its test, `e2e-tests/tests/gazette.spec.ts`.

- [ ] Add failing gate, link and redirect tests.
- [ ] Implement, run all Validation Commands and `yarn test:gazette`, and record the results.

### Task 5: The XUI link and the happy-path journey

**Files:** `config/default.json`, `config/custom-environment-variables.json`, `charts/deed-poll-admin/values.yaml`,
`values.preview.template.yaml`, `src/deployment-chart.test.ts`, the page's link test, a new e2e journey for the page.

- [ ] Add failing tests for the link and for every environment's rendered address.
- [ ] Implement and add the e2e journey. Run it, `yarn test:gazette` and all Validation Commands, and record the results.

### Task 6: Documentation and final verification

**Files:** `CLAUDE.md` (capability table, a short "Delivery Manager settings" section: the area gate, two forms and
two revisions, the Gazette section's second capability, the redirect), `README.md` if it lists pages.

- [ ] Update the docs.
- [ ] Run all Validation Commands one final time, with `yarn build --force` as well, so nothing is cached. Record which turbo tasks were cached and which executed, and the per-package counts against the baseline. Run `yarn format` before each commit. Confirm `git status` is clean apart from the task commits.
