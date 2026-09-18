# notify-2 — the caseworker Email tab

## Overview

Adds an **Email** tab to the case page and the journey behind it: the caseworker picks an email type, sees the
template populated from case and referral data, fills the free-text slots, checks the real rendered email, and
sends. It also shows what has already been sent, with its delivery state.

This is the `deed-poll-admin` half of the feature. The api half is
[`deed-poll-api/docs/plans/notify-1-email-plumbing.md`](../../../deed-poll-api/docs/plans/notify-1-email-plumbing.md),
and the analysis both plans rest on is
[`.business_context/NOTIFY_TEMPLATE_TAXONOMY.md`](../../.business_context/NOTIFY_TEMPLATE_TAXONOMY.md).

**Why a tab and a journey rather than an automatic email.** Three of the four business templates need text a
caseworker writes — the judge's reason, their comments, the sign-off. The templates are Word documents a
caseworker edits and sends from Outlook today, not mail-merge forms. So the system cannot simply email an
applicant when a state changes; a person composes part of what the applicant reads.

---

## This plan is PROVISIONAL, and more so than plans 11 and 12 were

**notify-1 has not been built.** Plans 11 and 12 were written ahead of a *published* api contract; this one is
written ahead of the api *existing*. So every schema name, property name and response shape below is an
**expectation, not a fact**, and is marked `[PROVISIONAL]` where it is load-bearing.

**Task 0 is the reconciliation gate and it is not a formality.** It cannot run until notify-1 is merged and
`openapi.json` refreshed. Until then this plan is a design document.

Two consequences worth stating plainly, because they have bitten this repo before:

- **The spec refresh is atomic.** `libs/deed-poll-api-client/src/api/contract.test.ts` compares
  `WIRE_SCHEMAS` against `spec.components.schemas` and `IMPLEMENTED_OPERATIONS` against the document's
  operations, **as set equality in both directions**. The moment the document gains notify-1's operations and
  schemas, the contract test fails until every one of them is registered. You cannot refresh the spec in one
  task and adopt the endpoints in the next.
- **But the registry is the seam.** The contract test checks *declarations* — that a schema is in
  `WIRE_SCHEMAS`, that an operation is in `IMPLEMENTED_OPERATIONS`, that strictness is pinned in
  `STRICT_RESPONSE_PROPERTIES`. It does not check that any adapter function calls them, or that any page
  exists. So Task 1 lands the whole contract atomically and stays green with no behaviour at all, and Tasks 2
  onwards add the behaviour incrementally. **That split is the only one available. Do not attempt another.**

---

## Decisions taken — implement these, do not revisit

1. **The Email tab is a fourth subgrid**, alongside `notes`, `witnesses` and `documents`. Add
   `{ id: "emails", label: "Emails", sections: [], subgrid: "emails" }` to `FORM_TABS` in
   `libs/deed-poll/src/deed-poll/form-fields.ts`, and a `{% elif tab.subgrid == "emails" %}` branch in
   `src/pages/deed-polls/detail.njk`. It carries no data-entry sections, exactly as the other three do not —
   an email is not a case field.

   **Tab order matters and is not cosmetic.** Put it after `documents`, at the end. The tab list ports a
   Dynamics form and `detail.njk`'s own comment records that this page once fell six tabs behind the form;
   inserting in the middle would reorder a caseworker's muscle memory for no gain.

2. **The journey is GDS one-thing-per-page, and the preview is the check-your-answers page.**

   | Step | Route | What |
   |---|---|---|
   | 1 | `GET /deed-polls/{id}/emails/new` | Which email? Radios, one per applicable template |
   | 2 | `GET,POST /deed-polls/{id}/emails/{template}/compose` | The free-text slots, pre-populated |
   | 3 | `POST /deed-polls/{id}/emails/{template}/preview` | The **real rendered email**, with Send and Back |
   | 4 | `POST /deed-polls/{id}/emails/{template}` | Send, then back to the tab with a success banner |

   **Sending is irreversible, so step 3 is mandatory rather than a nicety.** An applicant cannot be un-told
   that their application was refused. This is the same reason the deed-poll journeys already put a
   confirmation in front of a witness deletion.

3. **The preview HTML renders inside a sandboxed `iframe` with `srcdoc`, never interpolated into the page.**
   The HTML comes from Notify by way of api, and it contains text a caseworker typed. Nunjucks autoescapes,
   so showing it at all means reaching for `| safe` — and `| safe` on a string that has travelled through two
   services and a human is how an admin page inherits someone else's escaping bug.

   An `iframe` with `srcdoc` and `sandbox` (no `allow-scripts`, no `allow-same-origin`) gives two things at
   once: nothing in that HTML can touch the admin page's DOM, cookies or session, **and** the email's own
   styles cannot leak into the admin page or inherit from it — so what the caseworker sees is closer to what
   the applicant will see. Do not "simplify" this to `| safe` later; the reason is written here.

4. **`libs/deed-poll-api-client` is the only thing that speaks HTTP, and it still never throws.** Three
   functions returning `ApiResult<T>`, wire types as aliases of the document's schemas rather than
   restatements, and neither the wire types nor the mock exported from the package index. An unreachable api
   is a state the tab renders, not a 500.

5. **`libs/deed-poll/src/emails/` owns the domain half**, grouped by feature as this repo requires — no
   `models/`, no `utils/`, no `types.ts`, types beside the code that uses them. Every service function takes
   a `Caller` (`{ accessToken }`) and nothing else, because api derives the audit author from the token.
   `callApi` turns a failed `ApiResult` into the domain errors `src/errors.ts` already renders.

6. **The mock must serve all three operations.** The unit suite drives
   `libs/deed-poll-api-client/src/mock/server.ts` in process and `yarn dev` runs it on 3200, so a page with
   no mock support is a page with no tests and no local development. Fixtures go in `mock/fixtures.ts`
   alongside the existing ones.

7. **Validation is server-side, in the page handler, and api is still the authority.** No client-side
   JavaScript for it: this is Express and Nunjucks, a `POST` round trip is how every other form here reports
   errors, and a GDS error summary linking to the offending field is what the pattern asks for. api's 400
   naming each offending slot is the backstop, and its message is what the page shows if the two ever
   disagree — **do not reimplement api's rules, mirror them and defer.**

8. **One api call per thing the page needs.** `GET /caseworker/cases/{id}/emails` is expected to return
   *everything the tab needs*: what has been sent, what may be sent now, and for each sendable template its
   slots with pre-populated defaults. The tab must not make one call for history and another for
   applicability, and the compose page must not call preview merely to discover a default.
   **[PROVISIONAL] — see flag 1. notify-1 as written does not return history or slot defaults.**

9. **Preview costs a Notify call, so it happens on an explicit action only.** Never on keystroke, blur or
   autosave. Notify's rate limit is shared with real sends, and a tab that previewed as the caseworker typed
   would spend the service's allowance on drafts and start failing real sends with a 429. The journey in
   decision 2 gives this for free — keep it that way.

10. **The tab shows delivery state, not just "sent".** api's outbox carries `Pending`, `Sent` and `Failed`,
    and the difference matters to a caseworker: an email that failed permanently needs a phone call. Render
    the state, the template, when, and which caseworker sent it. **Do not** show a retry button — retry is
    the outbox's job and a second send is what decision 2 of notify-1 has a unique index to prevent.

11. **No email content is stored or rendered from this repo.** The subject and body exist in Notify and in
    api's outbox row. The tab lists metadata. A caseworker who needs to know exactly what was sent is a later
    plan, and it is api's data to serve.

---

## Expected contract `[PROVISIONAL]`

What Task 0 must reconcile. Current published state, from
[`libs/deed-poll-api-client/SPEC-PROVENANCE.md`](../../libs/deed-poll-api-client/SPEC-PROVENANCE.md): **30
caseworker operations across 17 paths, 4 judicial across 4 paths, plus `GET /` — 35 across 22 paths, 27
schemas.**

After notify-1: **33 caseworker operations across 20 paths — 38 across 25 paths.**

| Operation | Expected |
|---|---|
| `GET /caseworker/cases/{id}/emails` | What was sent, what may be sent, slots with defaults |
| `POST /caseworker/cases/{id}/emails/{template}/preview` | Notify-rendered subject, HTML, template version |
| `POST /caseworker/cases/{id}/emails/{template}` | Send; answers with the outbox row |

Schema names are **guesses** — notify-1's plan says "DTOs under `api/caseworker/dto`" without naming them.
Task 0 replaces this table with what api actually published.

---

## Constraints

Repo rules apply and are not negotiable: strict TypeScript with no `any`, ES modules only, Biome formatting,
pinned dependency versions, tests colocated with the code they test, domain-driven folders, functional style
with no class unless there is shared state, and comments that say *why*.

Additional to this plan:

- **Do not invent an api path.** `libs/deed-poll-api-client/openapi.json` is the authority, as CLAUDE.md says.
- **Do not delete or rename any of the six pipeline `yarn` scripts.** `src/pipeline.test.ts` fails if one
  goes, and the Jenkins stage fails on a missing script.
- **This repo owns no database and exposes no JSON API.** The tab renders pages; api holds the data.
- **`tsconfig.app.json` is not to be merged into `tsconfig.json`.** The root file deliberately has no
  `include`; giving it one made 44 library tests resolve `@hmcts/*` to `dist` and silently stop applying
  `vi.mock`.
- **Accessibility is not a later pass.** The axe checks run inside the Playwright suite, and a preview in an
  `iframe` needs a `title` for a screen reader. Decision 3's sandbox must not cost the caseworker the ability
  to read what they are about to send.

---

## Validation Commands

**These run after every task, so everything here must be green after every task — not only at the end.**

```bash
yarn lint
npx turbo test test:app --concurrency=1
```

**Use exactly that test command.** A bare `yarn test` in this repo reports failure with `0 successful, 8 total`
and "no tests" while running nothing at all — it looks like a red suite and is not one. `--concurrency=1` is
what makes it run.

**Verified green on `master` at 2026-09-18 before this plan was written:** `yarn lint` clean, and
`8 successful, 8 total` across 114 test files. **Measure the test count as the baseline before Task 1** and
record it in Task 6 — the task-file figures are 45 + 4 + 42 + 10 + 1 + 12.

`yarn test:e2e` needs Playwright browsers and a running app, so it is Task 6's business, not every task's.
Browser downloads are proxy-blocked here — symlink a cached chromium build to the wanted version.

---

## Tasks

### Task 0: Reconcile this plan against the published contract — RUN THIS FIRST, ALONE

**STOP if notify-1 is not merged.** This plan cannot be implemented against a design document.

```bash
# 1. The three operations must be in the published document. Each must print a key, not null.
yq -p json -o json '.paths."/caseworker/cases/{id}/emails".get.operationId' \
  libs/deed-poll-api-client/openapi.json
yq -p json -o json '.paths | keys | map(select(test("emails")))' \
  libs/deed-poll-api-client/openapi.json

# 2. The operation and schema counts must have moved as expected.
yq -p json -o json '[.paths | to_entries[] | .value | keys[]] | length' \
  libs/deed-poll-api-client/openapi.json   # expect 38
yq -p json -o json '.components.schemas | keys | length' \
  libs/deed-poll-api-client/openapi.json   # expect 27 + however many notify-1 added

# 3. The adapter must NOT yet know about them — this plan adds that.
rg -c "emails" libs/deed-poll-api-client/src/api/wire.ts || echo "absent, as expected"
```

**Do not use a bare `rg` for a property name as a gate.** Plan 12 recorded this trap and it is still live: a
bare grep for `newSurname` in `wire.ts` passes on a comment or an unrelated string. Gate on `yq` against the
document and on a *registered* schema key, never on a substring.

Then, against the published document rather than against this plan:

- Replace the **Expected contract** table with the real operation and schema names.
- Resolve every `[PROVISIONAL]` marker, and **flag 1 in particular**: does `GET …/emails` return send history
  and slot defaults? If it does not, this plan's decision 8 is unbuildable as written and the choice is to
  amend notify-1 or to split the tab's history into a later plan. **Record which, and why, in this file.**
- Confirm the slot names and their validation rules (required, max length) from the document.
- Note anything api did differently from notify-1's plan, since notify-1 may have been amended while running.

- [ ] notify-1 merged and its spec published, the three operations present in `openapi.json` with their real
      names, every `[PROVISIONAL]` marker in this file resolved, flag 1 answered in writing, and the
      validation commands green with no changes made

### Task 1: The contract — atomically

Refresh the document and register everything it added. **No adapter functions and no pages in this task** — it
is the registry only, and it is the one task that cannot be made smaller.

Read first: `libs/deed-poll-api-client/SPEC-PROVENANCE.md` (the refresh procedure and what it demands be
re-checked), `libs/deed-poll-api-client/src/api/contract.test.ts` (all of it), and
`libs/deed-poll-api-client/src/api/wire.ts`.

- Refresh `openapi.json` from api, following `SPEC-PROVENANCE.md`, and **write a new provenance entry**
  recording the api commit, the new counts, and what changed that was not an addition. That document's
  standard is property-by-property accounting; match it.
- Add a zod schema to `WIRE_SCHEMAS` for every schema the document gained.
- Add every new operation to `IMPLEMENTED_OPERATIONS`.
- Pin `STRICT_RESPONSE_PROPERTIES` for each new **response** schema, and add each new **request** schema to
  the request list in `should pin strictness for every response schema`.
- **Contingency:** if the document's property names differ from Task 0's reconciliation, the document wins —
  amend this plan, do not adapt the schema to the plan.

- [ ] `openapi.json` refreshed with a new `SPEC-PROVENANCE.md` entry to that file's standard, every new schema
      registered and every new operation listed, strictness pinned for each, `contract.test.ts` green, and the
      validation commands green

### Task 2: The adapter and its mock

Three functions and the mock that serves them. Still no pages.

Read first: `libs/deed-poll-api-client/src/api/client.ts` for the `ApiResult` idiom, and
`libs/deed-poll-api-client/src/mock/server.ts` + `fixtures.ts`.

- Three client functions, returning `ApiResult<T>`, never throwing, each carrying an `AbortSignal.timeout` as
  the others do.
- Mock handlers for all three, with fixtures covering: a case with a rejected referral (the template is
  sendable), a case without one (it is not), a case with no `applicantEmail` (send is refused), and a case
  with one `Sent` and one `Failed` email in its history.
- Tests: the happy path for each function, a 4xx surfacing as a failed `ApiResult` rather than a throw, and a
  parse failure on an unexpected payload.

- [ ] Three functions on the adapter with mock support and fixtures for the sendable, not-sendable,
      no-email-address and mixed-history cases, none of them throwing, and the validation commands green

### Task 3: The domain service and the view models

Read first: `libs/deed-poll/src/api/deed-poll-api.ts` (`callApi`, `Caller`), and an existing feature folder
such as `libs/deed-poll/src/notes/` for the shape to copy.

- `libs/deed-poll/src/emails/` — service functions over the adapter, taking `Caller`.
- A view model for the tab's history table and one for the radio list, derived rather than hand-built, so the
  Nunjucks stays free of logic as `detail.njk`'s existing branches are.
- Slot validation mirroring api's rules (decision 7), returning field-addressed errors a GOV.UK error summary
  can render.
- Tests: an unreachable api becomes a rendered state rather than a throw; validation names every offending
  slot at once rather than the first; a case with no sendable template yields an empty radio list rather than
  an error.

- [ ] Service functions take only a `Caller`, an unreachable api degrades rather than throws, slot validation
      names every offending field at once, view models are derived, and the validation commands green

### Task 4: The Email tab

Read first: `libs/deed-poll/src/deed-poll/form-fields.ts` (`FORM_TABS`), `src/pages/deed-polls/detail.njk`
(the three existing `subgrid` branches), `src/pages/deed-polls/[id].ts`.

- The `emails` entry in `FORM_TABS`, last (decision 1).
- The `{% elif tab.subgrid == "emails" %}` branch: a `govukTable` of what has been sent with its state, and a
  "Send an email" button. Empty state when nothing has been sent, matching how the other subgrids read when
  empty.
- **Contingency:** if Task 0 found that history is not available, render only the button and say in the
  template comment that the history is pending notify-1's amendment — do not invent a second api call.
- Tests: the tab appears for every case; the table renders both states; the empty state renders; the button
  is absent when nothing is sendable, with a hint saying why (an applicant with no email address is the
  common case and a silent missing button would read as a bug).

- [ ] The tab renders last with sent emails and their states, an empty state, and a button that is absent with
      a reason when nothing can be sent; `[id].test.ts` and the `njk` tests cover all of it; validation green

### Task 5: The journey

Read first: `src/pages/deed-polls/[id]/notes/new.ts` and `[id]/notes/[noteId]/edit.ts` for the page shape,
and `src/pages/deed-polls/[id]/edit/[tab].ts` for how a route parameter is validated.

- The four routes of decision 2, as file-based pages under `src/pages/deed-polls/[id]/emails/`.
- The compose page pre-populates the slots from the tab payload; the preview page renders the returned HTML in
  a sandboxed `iframe` with a `title` (decision 3); the send posts and redirects to the tab with a banner.
- An unknown or non-applicable template in the path is a 404, not a 500 — the route parameter is user input.
- Tests: the full journey; a validation failure returns to compose with an error summary and the caseworker's
  text preserved; a send failure returns to preview with api's message and the text preserved; the `iframe`
  carries `sandbox` without `allow-scripts` and without `allow-same-origin`, asserted in the `njk` test,
  because that attribute is the whole of decision 3 and a later tidy-up could drop it silently.

- [ ] All four routes live, the preview renders in a titled sandboxed iframe asserted by test, a validation or
      send failure never loses the caseworker's typing, an unknown template is a 404, and validation green

### Task 6: Journey test, accessibility and full validation

- A Playwright spec in `e2e-tests/tests/` for the whole journey against the in-memory mock, including the axe
  checks that `test:a11y` delegates to.
- **Contingency:** Playwright browser downloads are proxy-blocked here — the failure is an HTTP 400
  `GatewayExceptionResponse`, not slowness. Symlink a cached chromium build to the version Playwright wants
  rather than retrying the download.
- Full validation: `yarn lint`, `npx turbo test test:app --concurrency=1`, `yarn test:coverage` (the plan aims
  at >90%), and `yarn test:e2e`. Record the test count against the baseline measured before Task 1.
- Re-read this file's `[PROVISIONAL]` markers and confirm none survived.

- [ ] The journey passes end to end with axe clean, coverage above 90% on the new code, every `[PROVISIONAL]`
      marker gone, the test count recorded against the baseline, and `yarn lint`, the unit suite and
      `yarn test:e2e` all green

---

## Deliberately not in this plan

- **notify-1's api work.** A hard dependency, not a parallel track.
- **notify-0, the provisioning.** Without a Notify service the preview cannot render and the send cannot
  leave — but the mock covers both, so this plan is testable regardless.
  [`.business_context/NOTIFY_PROVISIONING_REQUEST.md`](../../.business_context/NOTIFY_PROVISIONING_REQUEST.md).
- **The other three templates.** The tab is built to list what api says is sendable, so a template added in
  notify-3 or notify-4 should appear with no change here. **That is the design intent and Task 4's test should
  prove it** — a fixture with two sendable templates must render two radios without a code change.
- **Showing the sent email's content.** Decision 11.
- **A retry button.** Decision 10.
- **Welsh.** Bilingual templates are Notify's business; `src/locales/` covers the tab's own labels when the
  time comes.
- **Any change to the referrals tab.** The judge's direction is read through the emails payload, not by
  reaching into `referrals-admin-1`'s view models.

---

## Flags for Steve — pick these up on return

1. **notify-1 does not give the tab what it needs, and I would rather widen notify-1 than add a second call.**
   Its `GET /caseworker/cases/{id}/emails` returns *which templates apply*. The tab also needs **what has
   already been sent and its delivery state** — otherwise a caseworker cannot tell whether the email went, and
   a permanent failure is invisible to the one person who could ring the applicant. It also needs the
   **pre-populated slot defaults**, or the compose page has to call `preview` just to discover the judge's
   reason.

   Both belong in that one response: "everything the Email tab needs", which is also this repo's stated
   performance rule. **That is a small amendment to notify-1's decision 9 and its Task 4, and it is cheaper to
   make before notify-1 runs than after.** Say the word and I will amend it.

2. **The preview renders HTML from Notify inside the admin page, and I have deliberately made that awkward.**
   A sandboxed `iframe` rather than `| safe`. It is slightly more work and it is the right default: that HTML
   carries text a caseworker typed, and it has passed through two services. If someone later "simplifies" it
   to `| safe` the reasoning is in decision 3 and in Task 5's test, which asserts the sandbox attribute
   precisely so the simplification fails a test rather than shipping.

3. **This plan cannot start until notify-1 is merged, and notify-1 cannot go green until notify-0 is done.**
   The chain is notify-0 → notify-1 → notify-2, and only the middle one is ralphex work. Worth knowing when
   planning the sprint: there is no way to parallelise notify-2 against notify-1, because the contract test's
   set equality means the spec refresh cannot be staged.

4. **api's Jenkins job could not build PR #24 or #25**, both times reporting *"This commit cannot be built"* —
   and #25 changed one markdown file, so it is not the content. notify-1 is the plan that will actually need
   a working CI signal. Worth fixing before it runs rather than during.

5. **The caseworker's sign-off is still undecided.** Every template ends `Kind regards,` with nothing after it.
   Options were their name from the token, a fixed team signature, or a typed field. I have not designed for
   it, because it is a content decision that changes the Notify template rather than this repo — but whoever
   authors `application-rejected` needs an answer, and the tab may need a third slot if it is typed.
