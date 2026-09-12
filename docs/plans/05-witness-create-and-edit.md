# Plan 05: let caseworkers add and amend witnesses

## Overview

A case's witnesses render on the detail page today and **there is no way to add or change one**. That is the
only place in this app where data is displayed and cannot be entered.

`detail.njk:122-131` shows why it looks finished when it is not: the witnesses subgrid renders each witness as a
summary list of name, address and occupation — and unlike the notes subgrid immediately above it, **no row links
anywhere and there is no Add button.** Compare:

| Subgrid | `detail.njk` | Row link | Add button |
| --- | --- | --- | --- |
| Notes | 75–120 | `/notes/{id}/edit` (line 98) | line 120, deliberately outside the count check |
| **Witnesses** | **122–131** | **none** | **none** |
| Documents | 133–175 | file download (151) | line 175 |

The business document gives **both roles** "Create, view and edit witness records"
(`deed-poll-api/docs/Deed Poll Power App Permissions Summary.docx`, capability matrix: "Add and edit witnesses
✓ ✓").

### Sequencing — the api gate is released

**`deed-poll-api#8` merged on 2026-09-12** (`ee5cc86`), so the four routes exist and this plan is unblocked:

```
GET    /caseworker/cases/{id}/witnesses
POST   /caseworker/cases/{id}/witnesses
GET    /caseworker/cases/{id}/witnesses/{witnessId}
PATCH  /caseworker/cases/{id}/witnesses/{witnessId}
```

**Neither write is role-gated at the api end**, deliberately — both roles have create and edit. So this plan adds
no permission check either; that is plan 06's job and deletion only.

**There is no `DELETE` yet**, by design. api's `witness-delete.md` adds it along with the Administrator gate. So
if a template or handler here wants a delete, it is out of scope — do not call an operation that does not exist.

**Deletion is plan 06**, and depends on this one plus api's `witness-delete.md`.

### What already exists, and what was deleted

Less to build than it looks:

- `libs/deed-poll/src/witnesses/service.ts` exists with `findWitnesses` and `findWitness`.
- A `witnesses` tab is already declared — `libs/deed-poll/src/deed-poll/form-fields.ts:320`, `subgrid: "witnesses"`.
- **`libs/deed-poll/src/witnesses/schemas.ts` used to exist and is recoverable verbatim.** It was removed in the
  DAL cutover (`#80`, commit `5dc0d08`). Get it back with:
  `git show 5dc0d08^:libs/deed-poll/src/witnesses/schemas.ts`
  It already has `createWitnessSchema` (max 100 / 250 / 100 plus a `declarant` boolean, matching the source
  columns) and `updateWitnessSchema` as its `.partial()`. **Restore it rather than retyping it.**
- `createWitness`, `updateWitness` and `removeWitness` also existed in that service at `5dc0d08^` — but they
  called Prisma directly, so only their *signatures* are worth copying, not their bodies.
- **No witness page has ever existed.** `git log --all --diff-filter=D` over the witness page paths returns
  nothing, so the pages and templates are genuinely new work.

## The thing that will quietly become untrue

**`libs/deed-poll/src/witnesses/service.ts`'s docblock is a careful, correct explanation that this plan
falsifies.** It currently says witnesses are *"Read-only, and deliberately so"*, that api has no witness write
endpoints, that the write functions *"are gone… rather than being left as functions that could only fail"*, and
that *"this app's edit form renders witnesses as a managed list with zero editable fields"*.

Every clause of that becomes false. **Rewrite it in the same task that adds the writes** — do not leave a
docblock explaining why the code beneath it does not do the thing it now does. It is the most likely thing in
this plan to be missed, because nothing fails if it is.

## Decisions taken — implement these, do not revisit

1. **Both roles may add and amend. No permission check anywhere in this plan.** The role split is deletion only
   (plan 06). Adding a gate here would remove a capability caseworkers are meant to have.
2. **Mirror the notes pages exactly.** `src/pages/deed-polls/[id]/witnesses/new.ts` and
   `.../[witnessId]/edit.ts`, with colocated `.test.ts` files, and templates `witness-form.njk` /
   `witness-edit.njk` beside the note ones in `src/pages/deed-polls/`. Same `GET` / `POST` / `rerender` shape.
3. **Validate in the page handler with `safeParse`**, per `.claude/rules/backend.md`, so the form re-renders with
   errors against fields. The service takes the schema's inferred type.
4. **Render `declarant`.** The subgrid currently shows three of the four business fields; `declarant` — declarant
   versus ordinary witness — is the fourth and is meaningful. Add it to the summary list and to both forms.
5. **Detail-page labels go inline in `src/pages/deed-polls/[id].ts`**, beside `addNote` (line 33),
   `amendNoteHint` (39) and `witnessAddress` (41). That is the existing pattern for this page; follow it rather
   than inventing a second one.
6. **Entry points mirror notes:** each witness row links to its edit page, and an **"Add a witness" button sits
   outside the `case.witnesses.length` check** — a case with no witnesses is exactly when it is needed. That
   comment is already in the file at line 119 for notes; the same reasoning applies.
7. **Do not add witness fields to the case edit form.** `form-fields.ts:320` keeps the witnesses tab a subgrid
   with `sections: []`. Witnesses are a child entity with their own pages, as notes are. Putting them in the case
   patch would give them two save paths — the same reasoning `form-fields.ts:86-87` records for "Refer to Master?".

## Open questions — flagged, NOT answered here

- **Welsh.** The detail page's labels are inline English strings in `[id].ts`, not keys in `src/locales/cy.ts`.
  So new witness labels are English-only **like every other label on that page**. This plan does not introduce
  the gap and does not fix it; if Welsh is required for witnesses it is required for the whole detail page and is
  its own piece of work. Flagged so a reviewer does not read decision 5 as a shortcut.
- **Minimum witnesses / declarant cardinality.** No artefact states either rule — see
  `deed-poll-api/docs/plans/witness-create-and-edit.md`. This plan enforces neither. It matters more for plan 06.

## Constraints

- **No `prisma.*`, no migration, no JSON route.** There is no database in this repo. Every write goes through
  `libs/deed-poll-api-client`.
- **An operation must exist in `openapi.json` before it exists in `client.ts`.** `contract.test.ts` fails
  otherwise. Order: refresh `openapi.json` from api → `client.ts` → mock → service → page.
- **`Caller` is `{ accessToken }` and nothing else.** Never pass a user name or an admin flag.
- **Mock the adapter, not `fetch`**, per `.claude/rules/testing.md`, spreading the original module so the enum
  arrays survive.
- **Never run bare `yarn test` to judge this work.** Turbo fans 8 packages across 14 CPUs and the vitest fork
  workers never respond: `0 successful, 8 total`, `Tests no tests`. **Nothing ran, so nothing failed.** Use
  `yarn turbo test test:app --concurrency=1`.
- **`yarn lint` is a single `biome check .`**, not a fan-out. It exits 0 today with two pre-existing
  `noUndeclaredEnvVars` warnings (`src/server.ts:3`, `src/session-store.test.ts:32`) and a stale `biome.json`
  schema notice. Leave those alone; do not let the count grow.

## Validation Commands

**These run after every task, so everything here must be green after every task — not only at the end.**

```bash
yarn lint
yarn turbo test test:app --concurrency=1
yarn build
```

**Never bare `yarn test`** — see the constraint above; it reports success having run nothing.
**Verified green 2026-09-12 at `c0c4c1c`:** lint exits 0 (two pre-existing warnings), tests 8 of 8 tasks with
1,281 total (1,278 passed, 3 skipped), build 8 of 8.

Deliberately **not** here: `yarn test:e2e`, test-count comparisons, and the `git grep` assertion. e2e needs Docker,
a seeded IDAM simulator and a browser install, so it cannot be a per-task gate; the rest are only true once the
plan is finished. All of them live in the final task.

## Tasks

### Task 1: Restore the schemas

`git show 5dc0d08^:libs/deed-poll/src/witnesses/schemas.ts > libs/deed-poll/src/witnesses/schemas.ts`, then check
the limits still match api (100 / 250 / 100) rather than assuming.

- [x] `schemas.ts` restored from `5dc0d08^` and its caps re-checked against api — verbatim, and byte-identical to
      api's own `src/test/resources/reference/ts/witnesses/schemas.ts`. `WitnessSchemas.java` confirms the caps
      (`MAX_WITNESS_NAME_LENGTH` 100, `MAX_WITNESS_ADDRESS_LENGTH` 250, `MAX_WITNESS_OCCUPATION_LENGTH` 100), all
      four fields required on create, `partial()` on patch, `declarant` a boolean and not a truthy string, and no
      trim. `schemas.test.ts` restored from the same commit, and the `witnesses/schemas.js` export restored to
      `libs/deed-poll/src/index.ts` where it sat at `5dc0d08^`

### Task 2: Client operations

**Get the spec from api rather than hand-editing `openapi.json`.** api generates it at `/v3/api-docs` and its
`OpenAPIPublisherTest` writes it to `/tmp/openapi-specs.json` during the integration stage. So, from the sibling
clone:

```bash
cd ../deed-poll-api && TESTCONTAINERS_RYUK_DISABLED=true ./gradlew integration
cp /tmp/openapi-specs.json <this repo>/libs/deed-poll-api-client/openapi.json
```

**Do not hand-write the witness paths into `openapi.json`.** `contract.test.ts` pins `client.ts` against that
file, so a hand-edit that drifts from what api actually serves produces a green contract test against a fiction —
the exact failure mode api's own `OpenAPIPublisherTest` docblock describes for the template's version.

Two things that will otherwise look like problems:

- **The spec contains 18 operations, not 17.** Seventeen are `/caseworker/**`; the eighteenth is `GET /`. api's
  test asserts the *caseworker* count, so both numbers are correct and neither is a bug.
- The file may already exist at `/tmp/openapi-specs.json` from an earlier run. It is in `/tmp`, so **do not trust
  a stale one** — check it contains `/caseworker/cases/{id}/witnesses` before copying, and regenerate if not.

Then add `createWitness` and `updateWitness` to `src/api/client.ts`, the wire types to `wire.ts`, and the
operations to `src/mock`. Let `contract.test.ts` pin them. Wire types stay unexported from the package index.

Refreshing the whole spec also picks up the **`DELETE` on notes** and anything else that landed in api since this
snapshot was taken — that is intended, not scope creep. If `contract.test.ts` then complains about an operation
this plan did not add, that is a pre-existing drift it has just surfaced: **report it, do not paper over it.**

- [x] `openapi.json` refreshed **from api's generated spec**, both operations in `client.ts` and the mock,
      `contract.test.ts` green. Taken from `/tmp/openapi-specs.json` after checking it carries
      `/caseworker/cases/{id}/witnesses` and that its witness descriptions match `OpenAPIWriteBodies.java`
      at api's clean `ee5cc86` — not hand-edited. Against the old snapshot the only differences are the 71
      witness keys and springdoc renumbering two note `operationId`s (`create_1`→`create_2`,
      `update_1`→`update_2`), so **there was no pre-existing drift to report**.
      **Four client functions, not two.** `contract.test.ts` compares operations in both directions, so the
      two witness GETs api now serves need adapter functions too — `listWitnesses` and `getWitness` beside
      `createWitness` and `updateWitness`, with `CreateWitnessRequest` / `UpdateWitnessRequest` in
      `WIRE_SCHEMAS` and the caps, the required set and "declarant is a boolean, not a truthy string" pinned
      against the spec. The mock serves all four (no `DELETE`, and a test asserts it answers 405), and
      `SPEC-PROVENANCE.md` records the new commit and the 17 caseworker operations

### Task 3: Service writes, and the docblock

Add `createWitness` and `updateWitness` to `libs/deed-poll/src/witnesses/service.ts`, each one line through
`callApi`, mirroring `notes/service.ts:42,53`. **Rewrite the docblock** per "The thing that will quietly become
untrue".

- [x] Both writes added, and the docblock no longer claims witnesses are read-only. `createWitness` and
      `updateWitness` are one `callApi` line each, aliasing the client operations as `notes/service.ts`
      does (`apiCreateWitness` / `apiUpdateWitness`), and the DTO goes on the wire unchanged — the patch
      partial is passed through rather than defaulted, because api leaves an omitted field as stored.
      **`removeWitness` is deliberately still absent**: there is no `DELETE` to call, so it would be a
      function that could only fail. The docblock now records that the writes are api's (`ee5cc86`), that
      neither is role-gated at either end, that the *reads* still come off the case on purpose even though
      api publishes the two witness GETs (one case call already carries them, and it is what keeps the
      cross-case scoping), and that the absent author parameter is because `deedpoll_witness` has no author
      columns at all — a different reason from notes. Service tests for both writes added while the docblock
      was being rewritten, including `declarant: false` surviving as a patch field rather than being dropped
      as falsy, and `getCase` asserted un-called on the update path so no scoping pre-read creeps back

### Task 4: The pages and templates

`witnesses/new.ts` and `witnesses/[witnessId]/edit.ts`, plus `witness-form.njk` and `witness-edit.njk`. `GET`
renders, `POST` validates with `safeParse` and re-renders with field errors on failure.

- [x] Both pages and both templates, validating with `safeParse`. `witnesses/new.ts` and
      `witnesses/[witnessId]/edit.ts` beside the note pages, rendering `deed-polls/witness-form` and
      `deed-polls/witness-edit`, each `GET` / `POST` / `rerender` as the note pages are. Four decisions
      worth knowing, all recorded at their call sites:
      **`declarant` is radios, not a checkbox.** An unchecked checkbox posts nothing, which is
      indistinguishable from a question nobody answered, so it would record "ordinary witness" on the
      caseworker's behalf. The handler compares the body to the two literals rather than coercing —
      `Boolean("false")` is true, so a coercion would make every witness a declarant, which is api's own
      emphasis in `wire.ts` — and anything else stays `undefined` so the schema rejects it and the error
      lands on the radios.
      **A blank field is accepted**, because `createWitnessSchema` has caps and no minimum and api stores
      `""`. A local required rule would refuse a body api accepts and would put a business rule in a page
      handler; if witnesses need mandatory fields it is `WitnessSchemas` that says so first.
      **The caps in the messages are read off the schema** (`shape.witnessName.maxLength`), not restated,
      so a message and the rule it explains cannot drift. Zod's own wording is developer-facing, so a
      schema rejection is rendered in the page's copy while api's is rendered in api's — the same split
      the note forms make.
      **The edit page validates with `createWitnessSchema`, not the partial**: the form posts all four
      controls every time, so the partial would accept a body missing a field the form always sends. It
      re-reads the witness on the rerender path too, so the 404 for another case's witness holds there and
      not only on `GET`. No delete button and no permission check anywhere — there is no `DELETE` to call,
      and both roles may amend. 29 colocated page tests, and both templates smoke-rendered against the
      real GOV.UK macros to confirm every error-summary `href` resolves to a control id
      (`#declarant` is the first radio)

### Task 5: Wire up the subgrid

In `detail.njk:122-131`: link each row to its edit page, add `declarant` to the summary list, and add the "Add a
witness" button **outside** the length check. Add the labels to `[id].ts` per decision 5.

- [x] Row links, `declarant` shown, and the Add button outside the length check. The witness **name** is the
      row's handle and so carries the link, the same shape as a note's code cell — href on the uuid, a
      `govuk-visually-hidden` suffix (`amendWitnessHint`) so the link text survives out of context. A witness
      name is nullable on the wire and `createWitnessSchema` sets no minimum, so a nameless witness falls back
      to `unnamedWitness` rather than rendering an anchor with nothing in it to click — that is the one label
      the plan did not anticipate. `declarant` is a **row as well as the existing tag**: the tag only appears
      when true, so its absence could not say whether the answer was no, and `declarant` is a non-null boolean
      on the wire so there is always one of the two to state. The Add button sits after `{% endif %}`, with the
      same comment the notes button carries. Six labels added inline in `[id].ts` per decision 5 — `addWitness`,
      `amendWitnessHint`, `witnessDeclarant`, `unnamedWitness`, `yes`, `no` — English-only like the rest of that
      page. **No template-rendering test exists in this repo**, so the subgrid was smoke-rendered against the
      real GOV.UK macros with a declarant, a nameless non-declarant and an empty list (the Add button survives
      all three), and `[id].test.ts` gained a test pinning the six labels non-empty, because a deleted label
      renders a blank button and an unreadable link with nothing failing. The journey itself is task 6's e2e

### Task 6: Tests

- Unit: both schemas — each field at its limit and one over, and `declarant` required on create but optional on
  patch
- Service: create and update, adapter mocked, asserting the `Caller` is passed and the DTO is forwarded unchanged
- Pages: `GET` renders; `POST` valid creates and redirects; `POST` invalid re-renders **with the error against
  the field**; a witness id from another case gives 404 (api answers it — do not add a scoping pre-read)
- Page tests must cover the `rerender` path as well as `GET`, which is the gap `04-hide-note-delete-from-caseworkers.md`
  task 3 had to close
- e2e: one happy-path journey in `e2e-tests/tests/` — add a witness, amend it, see it on the detail page

- [ ] Unit, service, page (`GET` *and* rerender) and one e2e journey

### Task 7: Full validation

- [ ] `yarn lint` — exits 0, still exactly the two pre-existing warnings and the schema notice, none from new files
- [ ] `yarn turbo test test:app --concurrency=1` — **8 of 8 tasks**, count above the **1,281 baseline**
      (1,278 passed + 3 skipped, verified 2026-09-12 at `c0c4c1c`). The 3 skips are the Redis session round trip
      and are skipped on master too
- [ ] `yarn build` — 8 of 8
- [ ] **e2e, which needs setting up from cold and is easy to misread as a code failure:**
      1. `docker compose up -d` — redis on 6379, IDAM simulator on 5556 (a JVM; `curl 127.0.0.1:5556/health` → 200 when ready)
      2. **`yarn idam:users`** — a fresh simulator has an empty user store, and the failure mode is that the
         journey parks on the login page and Playwright reports `toHaveURL` timing out against `/deed-polls`,
         which reads as a broken login rather than an unseeded one
      3. `yarn playwright install chromium` if the Playwright version moved — 1.63.0 needs
         `chromium_headless_shell-1243` and **master currently ships no matching browser**
      4. `REDIS_URL=redis://127.0.0.1:6379 yarn test:e2e` — `127.0.0.1`, never `localhost`, which resolves to
         `::1` first while Docker publishes IPv4 only
      Baseline **20 passed**. The two Azure warnings on startup (`ENOTFOUND deed-poll-aat.vault.azure.net`,
      `/mnt/secrets does not exist`) are expected locally
- [ ] `git grep -n 'Read-only, and deliberately so' -- libs/deed-poll/src/witnesses/` returns **nothing**
- [ ] Mark completed

## Deliberately not in this plan

- **Deleting a witness.** Plan 06, which needs api's gate first.
- **Any permission check.** Both roles have create and edit.
- **Witness fields on the case edit form.** Decision 7.
- **Welsh for the detail page.** See the open questions — pre-existing and page-wide.
- **A minimum-witness or declarant-cardinality rule.** Neither is stated by any artefact.
