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

## ~~This plan is PROVISIONAL, and more so than plans 11 and 12 were~~ — no longer, as of 2026-09-21

> **Task 0 is done and this plan is no longer provisional.** Read "The contract — measured, not expected"
> below for the real operation and schema names; it replaced the *Expected contract* section's guesses. No live
> `[PROVISIONAL]` marker survives — the remaining occurrences of the word are this section's history and the
> instructions that told Task 0 to clear them. **Four decisions were corrected by that reconciliation and the
> corrections are in place** (2, 3, 8 and 16); the history below is kept because the reasoning still explains
> why those decisions were shaped as they were.

**notify-1 has not been built.** Plans 11 and 12 were written ahead of a *published* api contract; this one is
written ahead of the api *existing*. So every schema name, property name and response shape below is an
**expectation, not a fact**, and is marked `[PROVISIONAL]` where it is load-bearing.

**Update 2026-09-19.** notify-1 is now partly built — tasks 1 to 4 are committed on an unpushed api branch
and task 5 is in flight — so this plan is closer than it was, but **nothing has been published**: no spec
refresh has happened and no `openapi.json` in this repo has moved. Task 0 remains the gate and remains
unrunnable. What *has* changed is that the api side of this plan's biggest open question is now designed:
decision 8's `[PROVISIONAL]` is lifted and flag 1 is answered, both by api's
[`notify-5`](../../../deed-poll-api/docs/plans/notify-5-case-correspondence-history.md). Decisions 12 to 15
and Task 5a are written against notify-5 and are **conditional on it having shipped** — Task 0 decides.

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
   | 1 | `GET,POST /deed-polls/{id}/emails/{template}/compose` | The free-text slots, pre-populated |
   | 2 | `POST /deed-polls/{id}/emails/{template}/preview` | The **real rendered email**, with Send and Back |
   | 3 | `POST /deed-polls/{id}/emails/{template}` | Send, then back to the tab with a success banner |

   **Sending is irreversible, so the preview step is mandatory rather than a nicety.** An applicant cannot be
   un-told that their application was refused. This is the same reason the deed-poll journeys already put a
   confirmation in front of a witness deletion.

   **Amended by Task 0, 2026-09-21 — there is no "which email?" step, and this is three routes not four.**
   The table above originally opened with `GET /deed-polls/{id}/emails/new`, radios one per applicable
   template. api ships **one** template (`application-rejected`); `EmailTemplate` has a single member and the
   other three in `NOTIFY_TEMPLATE_TAXONOMY.md` §6 are notify-3 and notify-4. A radio list of one option is
   dead UI that reads as an unfinished feature, so **Task 4's "Send an email" button links straight to the
   compose page for the one applicable template.** Steve's decision, 2026-09-21.

   **The template stays a route parameter, which is what makes this additive rather than a rework.** When
   notify-3 adds a second template, the picker is a new page in front of an unchanged compose route — not a
   change to the journey's shape. Do not hardcode `application-rejected` into the compose, preview or send
   handlers; take it from the path as planned, and resolve *which* template the button points at from the
   `availability` list at render time. If more than one template is ever applicable and no picker exists, that
   is the trigger to build one.

3. **The preview HTML renders inside a sandboxed `iframe` with `srcdoc`, never interpolated into the page.**
   The HTML comes from Notify by way of api, and it contains text a caseworker typed. Nunjucks autoescapes,
   so showing it at all means reaching for `| safe` — and `| safe` on a string that has travelled through two
   services and a human is how an admin page inherits someone else's escaping bug.

   An `iframe` with `srcdoc` and `sandbox` (no `allow-scripts`, no `allow-same-origin`) gives two things at
   once: nothing in that HTML can touch the admin page's DOM, cookies or session, **and** the email's own
   styles cannot leak into the admin page or inherit from it — so what the caseworker sees is closer to what
   the applicant will see. Do not "simplify" this to `| safe` later; the reason is written here.

   **Note 2026-09-19 — the HTML is optional at source.** `TemplatePreview.getHtml()` returns
   `Optional<String>`, so a preview can legitimately arrive with no HTML. The preview page needs a fallback
   that shows the text body rather than an empty iframe, rendered the way decision 12 renders history. Task 0
   should confirm whether api's preview response makes the field optional; if it does not, that is worth
   raising rather than assuming Notify will always populate it.

   **Resolved by Task 0, 2026-09-21 — the field is nullable, and the fallback as described is unbuildable.**
   `EmailPreviewResponse` publishes exactly three properties: `html`, `subject`, `templateVersion`. Two
   findings follow, and the second corrects the note above:

   1. **`html` is nullable**, so the fallback is needed. springdoc emits no nullability for a response body, so
      `type: string` means "a string when present" — see `SPEC-PROVENANCE.md`. Register it nullable; do **not**
      add it to `STRICT_RESPONSE_PROPERTIES`.
   2. **There is no text body on the preview response to fall back *to*.** The note assumed one, by analogy
      with history. `EmailHistoryResponse.body` is a *history* field and exists only once an email has been
      sent; a preview has no outbox row, so nothing carries the text rendering. So the fallback is **a
      sentence, not a second rendering**. Do not synthesise a text preview from the slots — that would show the
      caseworker something Notify did not render, which is the one thing decision 3 exists to prevent.

      **Implement fail-closed: no preview, no Send.** Render the sentence and withhold the Send button. This
      follows decision 2 — the preview is mandatory *because* sending is irreversible — and it matches the
      polarity of the `NODE_ENV` allowlists and `plain-http.ts` that this repo deliberately keeps. The
      alternative reading is that a null `html` is Notify's failure rather than a reason to refuse a send, and
      a caseworker with a refused application to communicate is then stuck. **Flagged for Steve rather than
      settled by Task 0**, because it trades a blocked caseworker against an unchecked irreversible send and
      that is a business call. It is a one-line change either way and nothing else depends on it.

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
   **~~[PROVISIONAL] — see flag 1. notify-1 as written does not return history or slot defaults.~~ Verified
   against the published document by Task 0, 2026-09-21.** `CaseEmailsResponse` is
   `{ availability[], history[], slotDefaults[] }` — all three, in one response, exactly as this decision
   required. Nothing on the tab or the per-email page needs a second call.

   **Resolved 2026-09-19 — `[PROVISIONAL]` lifted, and flag 1 is answered in full.** Rather than widening
   notify-1 mid-flight, api took the amendment as its own plan:
   [`notify-5-case-correspondence-history.md`](../../../deed-poll-api/docs/plans/notify-5-case-correspondence-history.md).
   Its **decision 5** extends this exact endpoint with history alongside availability, quoting this decision's
   performance rule as the reason; its **decision 6** adds the slot defaults, quoting decision 9 below —
   because preview costs a Notify call and a default is a value api already computes. Both halves of flag 1
   are therefore delivered, in the shape this plan asked for, and **the change is additive**: notify-5's task
   3 keeps the availability list's existing shape precisely so this plan's work is not invalidated. Task 0
   still reconciles against the published document rather than against this paragraph.

9. **Preview costs a Notify call, so it happens on an explicit action only.** Never on keystroke, blur or
   autosave. Notify's rate limit is shared with real sends, and a tab that previewed as the caseworker typed
   would spend the service's allowance on drafts and start failing real sends with a 429. The journey in
   decision 2 gives this for free — keep it that way.

10. **The tab shows delivery state, not just "sent".** api's outbox carries `Pending`, `Sent` and `Failed`,
    and the difference matters to a caseworker: an email that failed permanently needs a phone call. Render
    the state, the template, when, and which caseworker sent it. **Do not** show a retry button — retry is
    the outbox's job and a second send is what decision 2 of notify-1 has a unique index to prevent.

    **Addition 2026-09-19 — the words are constrained, not free.** api knows only that **Notify accepted**
    the send; it does not know the email arrived, and it can never know whether the applicant opened or
    downloaded anything. notify-5's decision 9 settles this on the api side and **decision 10 records that
    download tracking is impossible rather than deferred** — there is no download concept anywhere in the
    Notify Java client. So: **do not render the word "Delivered"**, do not add a "viewed" or "downloaded"
    column, and do not let a designer add one later. "Sent" here means *accepted by GOV.UK Notify*, and the
    tab should say something a caseworker cannot misread as proof of receipt. A caseworker who concludes from
    this screen that an applicant has their deed poll, when the email bounced, is the failure this tab exists
    to prevent.

11. **No email content is stored or rendered from this repo.** The subject and body exist in Notify and in
    api's outbox row. The tab lists metadata. A caseworker who needs to know exactly what was sent is a later
    plan, and it is api's data to serve.

    **Superseded 2026-09-19 — that later plan is notify-5, and the first sentence stays true while the third
    no longer does.** Nothing is stored *in this repo*; that rule is unchanged and load-bearing. But api now
    serves the rendered subject and body, captured at send time from `SendEmailResponse`, so **the tab may
    render content it is given** and decision 14 says how. The original reasoning is kept because the
    boundary it draws — content is api's, not admin's — is exactly why this is a rendering change here and
    not a storage one.

12. **Content is text, and it must not go anywhere near decision 3's renderer.** notify-5's decision 2
    carries the correction: `SendEmailResponse` exposes only a plain-text body, and **`getHtml()` exists on
    `TemplatePreview` alone**. So the two content surfaces in this feature are genuinely different things:

    | | Source | Form | How it renders |
    |---|---|---|---|
    | Preview (step 3) | `TemplatePreview` | **HTML** | Sandboxed `iframe` + `srcdoc` — decision 3 |
    | History | `SendEmailResponse` | **Plain text** | Nunjucks autoescaping, newlines preserved with CSS |

    **Do not reuse the iframe for history and do not reach for `| safe`.** Autoescaping is correct for text
    and the sandbox buys nothing here. Notify's body is Markdown-flavoured, so bullets arrive as `*` — render
    them as they are rather than passing caseworker free text through a Markdown renderer, which would
    recreate the escaping problem decision 3 exists to avoid.

13. **The history screen says what it is showing, because it is not what the applicant saw.** The applicant
    received Notify's branded HTML; the stored body is the text rendering of the same template with the same
    values. Label it as **the wording that was sent**, not as a copy of the email. Getting this wrong invites
    "that is not what they got" from the one person who might have to defend it.

14. **Content lives on a per-email page, not in the tab's table.** The table stays a table — template, when,
    who, state. A row links to `GET /deed-polls/{id}/emails/{notificationId}`, which shows the subject, the
    body, the recipient, the state and the documents that email carried. Two reasons: a body is several
    paragraphs and would destroy a `govukTable`'s scannability, and the tab is the thing a caseworker loads
    every time whereas the content is the thing they occasionally need.

    **It needs no extra api call** — decision 8's single response already carries it, so the page reads from
    the same payload the tab did. A 404 for a notification id that is not this case's, which api enforces by
    scoping rather than this repo by filtering.

15. **An email with no content renders as explained, never as blank.** Three cases produce no body, and they
    are not the same thing: a `Pending` email has not been sent yet; a permanently `Failed` one never was;
    and anything sent **before notify-5 shipped** has no stored text and never will, because api refuses to
    fetch it back from Notify (notify-5's constraint on backfill, and its flag 1). Each needs its own
    sentence. A blank panel reads as a bug, and "sent before we started keeping the text" is a different
    reassurance from "this has not gone yet".

16. **Every send carries one idempotency key for its compose journey.** notify-6 introduces repeatable,
    case-driven chases: one per case would be the wrong business rule, while no key lets a double-click send
    twice. Generate one UUID when the compose journey starts, preserve it through compose, preview, local/api
    validation failures and the final send, and ~~send it as api's required `Idempotency-Key` header~~. Starting
    a new compose journey creates a new UUID. Do not derive it from template, content or time.

    **Corrected by Task 0, 2026-09-21 — there is no `Idempotency-Key` header, and there never was one
    planned. The key is admin-local only.** This was the load-bearing false claim in this plan and it would
    have cost a task cycle:

    - **api's document has no such parameter.** `POST /caseworker/cases/{id}/emails/{template}` takes two path
      parameters and an optional JSON body, and the string `idempotenc` appears **zero** times in the whole
      document. In api's source it appears only in two migrations and `NotificationRepository` — never in a
      controller, never as a `@RequestHeader`.
    - **api decided the opposite approach on purpose.** notify-1's own decision 6: *"Idempotency is a database
      constraint, not a check"* — a partial unique index on `("referralId", "template")`. A second send answers
      **409**, and that is the protection.
    - **Sending the key would be a 400, not a no-op.** `SendEmailRequest` sets `additionalProperties: false`,
      alone in this contract, so an unknown body key is refused **and named**. So do not put the UUID in the
      body either.

    **What to build instead.** Keep the UUID, keep it entirely inside this repo: it is the form token that
    stops a double-click or a browser resubmit posting twice, which is a real problem this journey has and api
    cannot see. Do not send it anywhere. Handle api's **409** as its own rendered state on the preview page —
    "this email has already been sent for this referral", with a link to the tab — because the 409 is
    reachable without any double-click at all: two caseworkers on the same case will produce it.

    **This is per referral, not per compose journey, and that asymmetry is api's.** notify-1's decision 4 says
    so and flags that it "may not generalise" to notify-6's repeatable chases. Nothing here needs to solve
    that; it needs to not assume a key that does not exist.

---

## The contract — measured, not expected

**Reconciled by Task 0 on 2026-09-21 against api `09d70e35c86b718b290e9dd693695750df32f468`** (`origin/master`,
"Merge pull request #33 from hmcts/referrals-api-4"), generated per `SPEC-PROVENANCE.md`. The expectations this
section used to carry were right on the counts and wrong on nothing except the schema names, which were
flagged as guesses.

| | Admin's copy (`ee37173`) | api master (`09d70e3`) |
|---|---|---|
| Operations | 35 | **38** |
| Schemas | 27 | **37** |

**The refresh is purely additive: three operations, ten schemas, nothing removed, and no pre-existing schema
altered in any property.** Diffed property-by-property, not by count, as `SPEC-PROVENANCE.md` step 3 requires.

**api-4 therefore has zero contract delta** — measured, not taken from its plan's assertion. `referrals-admin-4`
needs no refresh of its own, and this plan's Task 1 carries the whole delta.

### The three operations

| Operation | Request | Response |
|---|---|---|
| `GET /caseworker/cases/{id}/emails` | — | `CaseEmailsResponse` |
| `POST /caseworker/cases/{id}/emails/{template}/preview` | `PreviewEmailRequest` (optional) | `EmailPreviewResponse` |
| `POST /caseworker/cases/{id}/emails/{template}` | `SendEmailRequest` (optional) | `SentEmailResponse` |

Only `200` is declared on each. Path parameters only — **no headers**, see decision 16. Both bodies are
`required=false`, because `judges_reason` is pre-populated server-side when omitted.

### The ten schemas

| Schema | Shape |
|---|---|
| `CaseEmailsResponse` | `{ availability[], history[], slotDefaults[] }` — the whole tab in one call |
| `EmailTypeResponse` | `{ template, applicable, reason, slots[], provisioned }` |
| `EmailSlotResponse` | `{ name, maxLength, required }` |
| `EmailSlotDefaultsResponse` | `{ template, fields }` — `fields` is a `string→string` map keyed by slot name |
| `EmailPreviewResponse` | `{ subject, html, templateVersion }` — **HTML**, and `html` is nullable |
| `SentEmailResponse` | `{ id, recipient, enqueued }` |
| `EmailHistoryResponse` | `{ id, template, templateName, subject, body, recipient, notifyState, failureReason, createdBy, createdOn, documents[] }` — **`body` is plain text** |
| `CorrespondenceDocumentResponse` | `{ id, name }` |
| `PreviewEmailRequest` | `{ judges_reason?, additional_notes? }`, `additionalProperties: false` |
| `SendEmailRequest` | `{ judges_reason?, additional_notes? }`, `additionalProperties: false` |

**The write bodies published properly** — both carry their two slots with real `maxLength`s, not the `{}`
failure of 2026-09-17 that `SPEC-PROVENANCE.md` makes a mandatory check. Both omit `type: object`, consistent
with every other hand-registered write body in this contract.

### Four things to register exactly as api published them, not as convention would

1. **The slot keys are `snake_case`** — `judges_reason`, `additional_notes` — and so are the keys inside
   `EmailSlotDefaultsResponse.fields` and `EmailSlotResponse.name`. This repo's `CLAUDE.md` says the wire is
   camelCase and nothing is renamed at the boundary; **these are the documented exception**, because they are
   Notify placeholder names and are the personalisation keys and the body keys at once. api's own source says
   they "are not renamed to Java style anywhere". A task that camelCases them breaks the personalisation
   **silently** — Notify substitutes nothing and sends the template with empty slots.
2. **`EmailTypeResponse.template` is a bare `string`, not an enum.** So `contract.test.ts` cannot pin the
   template set, and a template api adds later arrives with nothing failing. Do not model it as a closed union
   in a way that throws on an unknown value; render an unrecognised template by its `templateName`.
3. **`notifyState` is `Pending | Sent | Failed`**, and api's own description says *"Sent means accepted by
   GOV.UK Notify; it does not mean delivered."* That is decision 10's wording constraint already justified at
   source, and `failureReason` is the field that makes a `Failed` row actionable.
4. **`html` is nullable and so is `body`** — springdoc emits no response nullability, so nothing goes in
   `STRICT_RESPONSE_PROPERTIES` from this feature. Decision 3 covers the null `html`; decision 15 covers the
   absent `body`.

### notify-5 shipped, so nothing is skipped

`history[]` and `slotDefaults[]` are both on the wire. **Decisions 8 and 12–15 are all buildable, Task 4's
contingency does not fire, and Task 5a is not skipped.** Decision 12's text-versus-HTML table is confirmed
correct by the schemas: `EmailPreviewResponse.html` is HTML and `EmailHistoryResponse.body` is plain text, with
api's description spelling out that "the applicant received branded HTML". Had api published one field for
both, one of those two renderings would have been an injection.

### What is on the wire but out of scope

`EmailHistoryResponse.documents[]` exists, but the one shipped template has `documentKeys = List.of()`, so no
email can currently carry an attachment. Render the list — decision 14 already says to — and expect it empty.
Attachments arrive with notify-4, which is blocked on document generation.

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

**~~Verified green on `master` at 2026-09-18 before this plan was written:~~** ~~`yarn lint` clean, and
`8 successful, 8 total` across 114 test files.~~ **Measure the test count as the baseline before Task 1** and
record it in Task 6 — the task-file figures are 45 + 4 + 42 + 10 + 1 + 12.

**Re-measured by Task 0 on `master` at `030e099`, 2026-09-21 — this is the baseline, not the 09-18 figure.**
`yarn lint` exits 0 (2 warnings, 0 errors — `noUndeclaredEnvVars` on `REDIS_URL` in two test files, pre-existing
and not this plan's). `npx turbo test test:app --concurrency=1` → `8 successful, 8 total`, **150 test files,
2,598 passed + 3 skipped = 2,601**. The 09-18 figure of 114 files predates the referrals and persona-switcher
work; do not quote it, and do not treat the gap as something this plan caused.

| Package | Files | Tests |
|---|---|---|
| root app (`//`) | 65 | 1,032 + 3 skipped |
| `@hmcts/deed-poll` | 52 | 901 |
| `@hmcts/deed-poll-api-client` | 4 | 327 |
| `@hmcts-cft/cloud-native-platform` | 10 | 140 |
| `@hmcts-cft/express-govuk-starter` | 12 | 127 |
| `@hmcts-cft/simple-router` | 4 | 41 |
| `@hmcts-cft/express-session-postgres` | 2 | 23 |
| `@hmcts-cft/express-session-redis` | 1 | 7 |

`yarn test:e2e` needs Playwright browsers and a running app, so it is Task 6's business, not every task's.
Browser downloads are proxy-blocked here — symlink a cached chromium build to the wanted version.

---

## Tasks

### Task 0: Reconcile this plan against the published contract — RUN THIS FIRST, ALONE

> **DONE 2026-09-21, by hand in a Claude Code session rather than by a ralphex task, and not skippable by a
> later reader.** Findings are written into the decisions above and into "The contract — measured, not
> expected", which replaced this task's *Expected contract* section. Summary, worst first:
>
> 1. **Decision 16's `Idempotency-Key` header does not exist** and never was planned — api made idempotency a
>    database constraint. Sending it would be a **400**, because `additionalProperties: false`.
> 2. **api ships one template, not four**, so the "which email?" step is gone from decision 2 — Steve's call.
> 3. **The preview has no text body to fall back to** when `html` is null; decision 3's note assumed one.
> 4. **The slot keys are `snake_case`** and must not be normalised to this repo's camelCase wire convention.
> 5. **notify-5 shipped**, so flag 1 is answered yes, decision 12's table is confirmed correct by the schemas,
>    and nothing in Tasks 4 or 5a is skipped.
> 6. **api-4 has zero contract delta**, measured — so Task 1 carries only this feature's additions.
>
> **One decision is deliberately left to Steve and is not a blocker:** whether a null preview `html` should
> withhold the Send button (decision 3, resolution 2). Fail-closed is written in as the default.
>
> **Two corrections to this task's own method, recorded because they would recur:**
>
> - **Its gate commands pointed at the wrong document.** They ran `yq` against
>   `libs/deed-poll-api-client/openapi.json` — *this* repo's copy — and required the emails operations to be
>   present. But refreshing that file is **Task 1's** job, and it cannot be done earlier because the refresh is
>   atomic (see the two bullets under "This plan is PROVISIONAL"). So the gate could only ever read `[]` and
>   `35`, hit "STOP if notify-1 is not merged", and kill the plan on task 1 of 8 with notify-1 merged all along.
>   **A gate on a published contract must read api's generated document, not admin's copy of it.** Generate it
>   per `SPEC-PROVENANCE.md` and diff, which is what was actually done.
> - **Do not generate it by switching the api clone's branch.** A `ralphex` run was building api-4 in that
>   clone at the time. Read api at a pinned commit with `git show <sha>:<path>`, which touches neither the
>   working tree nor `HEAD`, and only run the generator once that clone is idle and clean.

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
  and slot defaults? **notify-5 is the plan that makes them return, so the real question is whether it has
  shipped.** Check the published document rather than the plan:

  ```bash
  # History and slot defaults — present only if notify-5 shipped.
  yq -p json -o json '.components.schemas | keys | map(select(test("(?i)email|notification"))) ' \
    libs/deed-poll-api-client/openapi.json
  ```

  If they are absent, decisions 12 to 15 are unbuildable and **that is a legitimate outcome, not a blocker**
  — build the metadata tab, take Task 4's contingency, and **record in this file that content is pending
  notify-5** rather than inventing a second call or an empty page.
- **Check whether the body field is typed as text or HTML.** notify-5's decision 2 says text, and decisions
  12 and 13 depend on it. If api published HTML instead, decision 12's table is wrong and the renderer
  changes — reconcile before building, not after.
- Confirm the slot names and their validation rules (required, max length) from the document.
- Note anything api did differently from notify-1's plan, since notify-1 may have been amended while running.

- [x] notify-1 merged and its spec published, the three operations present in `openapi.json` with their real
      names, every `[PROVISIONAL]` marker in this file resolved, flag 1 answered in writing, whether notify-5
      has shipped recorded along with what follows from it, and the validation commands green with no changes
      made

      **Done 2026-09-21.** One departure, stated rather than hidden: the operations are **not** yet in
      `libs/deed-poll-api-client/openapi.json`, because putting them there is Task 1 and the refresh is atomic —
      see the method correction above. They are verified present in api's generated document at `09d70e3`, and
      their real names are recorded in "The contract — measured, not expected". Validation commands measured
      green with **no file changed except this plan**.

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
- The send function accepts the journey's UUID and supplies it as `Idempotency-Key`; tests pin the exact
  header and prove a retry reuses it.
- Mock handlers for all three, with fixtures covering: a case with a rejected referral (the template is
  sendable), a case without one (it is not), a case with no `applicantEmail` (send is refused), and a case
  with one `Sent` and one `Failed` email in its history. **If notify-5 has shipped, the history fixtures
  carry content**: one `Sent` row with a subject and a multi-paragraph body, one `Sent` row with **no** body
  (sent before the text was kept), one `Pending` and one `Failed` — the four states decision 15 needs a
  sentence for, so Task 5a's tests have something to render.
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
  "Send an email" button — which links **straight to the compose page** of the single applicable template,
  resolved from `availability` at render time rather than hardcoded (decision 2 as amended by Task 0; there is
  no picker page). Empty state when nothing has been sent, matching how the other subgrids read when
  empty. Each row links to the per-email page of Task 5a (decision 14); the table itself carries no content.
- **The state column's wording is decision 10's addition, and it is a test, not a preference.** Assert that
  the rendered tab contains no occurrence of "Delivered", "Viewed", "Opened" or "Downloaded", so that a later
  well-meaning wording change fails a test rather than telling a caseworker something the service cannot
  know.
- **Contingency:** if Task 0 found that history is not available, render only the button and say in the
  template comment that the history is pending **notify-5** — do not invent a second api call.
- Tests: the tab appears for every case; the table renders both states; the empty state renders; the button
  is absent when nothing is sendable, with a hint saying why (an applicant with no email address is the
  common case and a silent missing button would read as a bug).

- [ ] The tab renders last with sent emails and their states, rows linking to the per-email page, an empty
      state, a button that is absent with a reason when nothing can be sent, and no word implying receipt;
      `[id].test.ts` and the `njk` tests cover all of it; validation green

### Task 5a: The per-email page

**Skip this task entirely if Task 0 found notify-5 has not shipped**, and record that it was skipped. It
renders data that would not exist.

Read first: decisions 12, 13, 14 and 15, and Task 4's view model to extend.

- `GET /deed-polls/{id}/emails/{notificationId}` — subject, body, recipient, state, when, who sent it, and
  the documents that email carried. Read from the same payload the tab uses (decision 14), so no new adapter
  function and no new api call.
- **The body renders as text through autoescaping, with newlines preserved in CSS** — not `| safe`, not the
  iframe, not a Markdown renderer. Decision 12 has the table and the reasoning.
- A heading or caption labelling it as the wording that was sent rather than as the email (decision 13).
- The three no-content cases each get their own sentence (decision 15): not sent yet, failed and never sent,
  and sent before the text was kept.
- A `notificationId` that is not this case's is a 404 — it is user input in a path, exactly as Task 5's
  template parameter is.
- Tests: a sent email renders its subject and body; **a body containing `<script>` appears as visible text
  and not as an element**, asserted in the `njk` test because decision 12 is the whole reason this page does
  not reuse the iframe; each of the three no-content cases renders its own wording rather than a blank; an
  unknown id is a 404; and the page makes no second api call.

- [ ] One email's content renders as escaped text with its documents, markup in the body is inert and proven
      so by test, all three no-content cases are explained rather than blank, an unknown id is a 404, and the
      validation commands green

### Task 5: The journey

Read first: `src/pages/deed-polls/[id]/notes/new.ts` and `[id]/notes/[noteId]/edit.ts` for the page shape,
and `src/pages/deed-polls/[id]/edit/[tab].ts` for how a route parameter is validated.

- The **three** routes of decision 2, as file-based pages under `src/pages/deed-polls/[id]/emails/`. **Not
  four** — Task 0 removed the "which email?" picker, because api ships one template. There is no
  `/emails/new`.
- The compose page pre-populates the slots from the tab payload; the preview page renders the returned HTML in
  a sandboxed `iframe` with a `title` (decision 3), and says so in a sentence when `html` is null; the send
  posts and redirects to the tab with a banner.
- The compose GET creates an idempotency UUID and the forms preserve it unchanged through preview, correction
  and final send. A fresh visit to the compose page starts a new journey and therefore gets a new UUID.
  **The UUID is admin-local and is sent to api in neither a header nor the body** — decision 16 as corrected by
  Task 0. It exists to stop a double-click or a browser resubmit; api's own protection is a unique index that
  answers 409.
- **api's 409 is a rendered state on the preview page**, not an error page: "this email has already been sent
  for this referral", with a link back to the tab. Reachable without any double-click — two caseworkers on one
  case produce it.
- An unknown or non-applicable template in the path is a 404, not a 500 — the route parameter is user input.
- Tests: the full journey; a validation failure returns to compose with an error summary and the caseworker's
  text preserved; a send failure returns to preview with api's message and the text preserved; the `iframe`
  carries `sandbox` without `allow-scripts` and without `allow-same-origin`, asserted in the `njk` test,
  because that attribute is the whole of decision 3 and a later tidy-up could drop it silently.

- [ ] All three routes live, the preview renders in a titled sandboxed iframe asserted by test and explains
      itself in a sentence when `html` is null, a 409 renders as its own state rather than an error page, a
      validation or send failure never loses the caseworker's typing, an unknown template is a 404, and
      validation green

### Task 6: Journey test, accessibility and full validation

- A Playwright spec in `e2e-tests/tests/` for the whole journey against the in-memory mock, including the axe
  checks that `test:a11y` delegates to.
- **Contingency:** Playwright browser downloads are proxy-blocked here — the failure is an HTTP 400
  `GatewayExceptionResponse`, not slowness. Symlink a cached chromium build to the version Playwright wants
  rather than retrying the download.
- Full validation: `yarn lint`, `npx turbo test test:app --concurrency=1`, `yarn test:coverage` (the plan aims
  at >90%), and `yarn test:e2e`. Record the test count against the baseline measured before Task 1, **and say
  whether Task 5a ran**, so a lower count is explained rather than looking like lost tests.
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
- **The other templates.** The tab is built to list what api says is sendable, so a template added in
  notify-3, notify-4 or notify-6 should appear with no change here. **That is the design intent and Task 4's test should
  prove it** — a fixture with two sendable templates must render two radios without a code change.
- **Chase-specific UI.** notify-6 adds `chase-missing-documents`, but this plan renders it from the same
  availability, slots and defaults metadata as every other template. The only shared addition is decision 16's
  idempotency header; do not add a chase route or switch on its key.
- **Showing the sent email's content.** Decision 11. **No longer true as of 2026-09-19** — notify-5 serves it
  and decisions 12 to 15 render it on a per-email page. What is still not here: any *storage* of content in
  this repo, which decision 11's first sentence keeps.
- **Anything implying the applicant received or read the email.** Not deferred — **impossible**. notify-5's
  decision 10: there is no download concept anywhere in the Notify client, and delivery status needs
  callbacks that are a joint plan with `deed-poll-infra`. Decision 10's addition makes it a test.
- **A retry button.** Decision 10.
- **Welsh.** Bilingual templates are Notify's business; `src/locales/` covers the tab's own labels when the
  time comes.
- **Any change to the referrals tab.** The judge's direction is read through the emails payload, not by
  reaching into `referrals-admin-1`'s view models.
- **Tracking the applicant's reply to *Request confirmation to proceed*.** That process spans the
  awaiting-confirmation worklist and a referral outcome rather than the Email tab. Its standalone admin plan is
  [`notify-3b-admin-confirmation-tracking.md`](notify-3b-admin-confirmation-tracking.md).

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

   **ANSWERED 2026-09-19 — both halves, and not by amending notify-1.** By the time this was picked up
   notify-1 was already at task 5, so widening it mid-flight would have meant editing a plan under
   construction. Instead api took it as its own plan, `notify-5`, whose decisions 5 and 6 add history and
   slot defaults to this exact endpoint and cite this flag as the reason. **The outcome is what this flag
   asked for and the cost is lower**: additive to the response, no change to a plan in flight, and notify-5
   also solves the harder half nobody had costed — *what did the email actually say* — because
   `SendEmailResponse` turns out to return the rendered subject and body in the send acceptance, free. See
   decisions 8 and 12 to 15. **The one thing that did not survive the round trip:** the body is plain text,
   not HTML, so history cannot reuse decision 3's renderer.

2. **The preview renders HTML from Notify inside the admin page, and I have deliberately made that awkward.**
   A sandboxed `iframe` rather than `| safe`. It is slightly more work and it is the right default: that HTML
   carries text a caseworker typed, and it has passed through two services. If someone later "simplifies" it
   to `| safe` the reasoning is in decision 3 and in Task 5's test, which asserts the sandbox attribute
   precisely so the simplification fails a test rather than shipping.

3. **This plan cannot start until notify-1 is merged, and notify-1 cannot go green until notify-0 is done.**
   The chain is notify-0 → notify-1 → notify-2, and only the middle one is ralphex work. Worth knowing when
   planning the sprint: there is no way to parallelise notify-2 against notify-1, because the contract test's
   set equality means the spec refresh cannot be staged.

   **Updated 2026-09-19 — the chain gained a link, and it is worth the wait.** It is now
   **notify-0 → notify-1 → notify-5 → notify-2**. notify-5 is api-side and needs nothing from notify-0, so it
   can run while template authoring is still outstanding — it is the one plan in the series that can. Waiting
   for it buys this plan its content half and closes flag 1 properly. **Starting before it is still
   legitimate**: Task 0 records that notify-5 has not shipped, Task 5a is skipped, and Task 4's contingency
   covers the tab. The cost of that route is a second spec refresh later, which the contract test's set
   equality makes a whole task rather than a tidy-up — so if notify-5 is close, wait.

4. **api's Jenkins job could not build PR #24 or #25**, both times reporting *"This commit cannot be built"* —
   and #25 changed one markdown file, so it is not the content. notify-1 is the plan that will actually need
   a working CI signal. Worth fixing before it runs rather than during.

5. **The caseworker's sign-off is still undecided.** Every template ends `Kind regards,` with nothing after it.
   Options were their name from the token, a fixed team signature, or a typed field. I have not designed for
   it, because it is a content decision that changes the Notify template rather than this repo — but whoever
   authors `application-rejected` needs an answer, and the tab may need a third slot if it is typed.

   **More urgent than it was.** With decisions 12 to 15 the stored body goes on a screen, so a template
   ending `Kind regards,` followed by nothing is now something a caseworker will read back and query.
   notify-5's flag 6 raises the same point from the api side.

6. **Task 6's coverage target and the Task 5a addition.** This plan aimed at >90% and now has an extra page.
   That is a reason to check the target is still met, not a reason to move it — but if Task 0 skipped Task 5a
   because notify-5 had not shipped, the baseline comparison in Task 6 should say so rather than appearing to
   have lost tests.
