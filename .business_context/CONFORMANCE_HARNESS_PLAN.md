> **Preserved from the prototype, 2026-09-01.** This document lived only in `power_app_nest/`, which
> was gitignored and never committed, so deleting that directory at the end of Phase 4 would have
> destroyed it permanently. It is the design record for the 141 conformance tests now in
> `libs/deed-poll/src/conformance/`, and `MIGRATION_PLAN.md` cited it for two rule gaps.
>
> **Both of those gaps are now closed**, verified against the ported code on 2026-09-01:
>
> - **Gap 1, migrated-record relaxation** — `getFieldRules("Minor", migrated: true, …)` returns **0**
>   required fields where the non-migrated call returns 8. Implemented.
> - **Gap 2, the general Gazette-date gate** — with `publishToGazette: false`,
>   `dateNoticeSentToLondonGazette` is hidden for `Adult` as well as `DeedOfRelinquishment`, so it is
>   no longer relinquishment-only.
>
> The text below is the original, unedited. Read the two "gap" passages as history: they describe the
> prototype's state when the harness was planned, not the code's state now. The artefacts it reads
> from `dataverse_tables/` are preserved at `.business_context/dataverse_tables/`.

---

# Conformance Test Harness — Plan

**Purpose.** Turn the source-of-truth artifacts in `.business_context/dataverse_tables/`
into executable assertions against the ported Nest services, so that (a) the rules that were
ported are *pinned* to the source spec and cannot silently drift, and (b) the corners that
were only partially ported are surfaced as failing tests rather than latent divergences.

**Why this and not a fresh build.** The assessment (2026-08-03) found the data structure and
business logic *were* taken into account — schema maps all 5 tables and preserves Dynamics
integer values; `case-state.service.ts` and `deed-poll-validation.service.ts` cite the XAML
workflow filenames and port the cascade + 7 conditional rules. So this is a *verification*
harness, not a rebuild. It re-scopes the original Task 2 from "they didn't consider it" to
"prove what they did, and pin the gaps."

**Two known gaps this harness must express as tests (both real, both currently divergent):**

1. **Migrated-record relaxation is unimplemented.** `deedpoll/business_rules.md` (the
   "Make fields required…" rule) says a migrated record relaxes *all* type-required fields to
   optional. `getFieldRules()` takes only `type`; `migratedRecord` exists on the DTO but is
   read nowhere in the validator. A migrated record submit-validates as if everything is still
   required.
2. **General Gazette-date gate is only in the relinquishment branch.** The rule
   "if Publish to London Gazette = No, clear and hide Date Notice Sent" is enforced only for
   relinquishment. A normal case with publish=No does not hide/clear that date.

The harness should be written so these two produce **failing** tests on the current code
(documenting the gap), then the fixes turn them green — bug-first, per Steve's preference.

---

## Scope

**In scope — driven by `dataverse_tables/`:**

- `deedpoll/business_rules.md` → the two business-logic services:
  - "Set States based on Dates completed" → `CaseStateService.deriveState()` + `hasContradiction()`
  - "Make fields required…", "Show/mandate Urgency Reason", "Show Online Application ref…",
    "Show/hide Gazette date", "Deed of Relinquishment fields", "Minors fields",
    "Default Minor to Single" → `DeedPollValidationService.getFieldRules()`,
    `applyCreateDefaults()`, `validate()`
- `deedpoll/columns.html` (70 columns) + the 4 child `columns.html` → **schema-coverage test**:
  every *business* source column (excluding Dynamics system columns) maps to a Prisma field.
- `deedpoll/relationships.html` → the 3 business one-to-many relations exist as cascade relations.
- Child `business_rules.md` (notes, witnesses, document, document-type) → assert **empty**:
  a "no business rules" table means the harness has nothing to enforce there, and that fact
  is itself pinned (if a future artifact adds a rule, the assertion that the table is empty
  fails and forces someone to port it).

**Out of scope — flag, don't assert:** Gov.Pay, London Gazette batch export, Word/Outlook
templates, `-BROKEN`/`SUPERSEDED` reference flows, live Dataverse. (Same out-of-scope list as
the migration plan.) The reference-number *allocation* is already integration-tested and is a
deliberate improvement on source, so the harness pins the display-reference *format*, not the
racy read-max source algorithm.

---

## Design

Jest, same conventions as the existing `*.spec.ts` (plain `new Service()`, no Nest DI
container needed for the pure services). Three layers:

### Layer 1 — Structural conformance (`test/conformance/schema.conformance.spec.ts`)
- Parse each `columns.html` (cheerio is already transitively available; if not, a small regex
  over `<td>` cells — the tables are flat and regular).
- Maintain a **`SYSTEM_COLUMNS` allowlist** (CreatedBy, ModifiedOn, OwnerId, statecode, …) and
  a **`DERIVED_COLUMNS` allowlist** (DaysReceivedtoEnrolled etc. — computed, see `computed.ts`).
- Assert every remaining business column has a corresponding Prisma field (via a
  `SOURCE_COLUMN → prisma field` map kept in the test, so a genuinely new source column fails
  loudly rather than being silently ignored).
- Assert the 3 business relationships map to Prisma relations.

### Layer 2 — Rule conformance (`test/conformance/rules.conformance.spec.ts`)
Encode each row of `deedpoll/business_rules.md` as a table-driven case. One `describe` per
named rule; the "Further business rule context" IF/THEN blocks become the parameter table.
- **State cascade**: a truth table of {which dates set} → expected state, covering all 8 branches
  *and* the ordering quirk (referred+signature-received → AwaitingEnrolment, not ReferredToMaster).
  Plus the contradiction case (returned+enroled → `hasContradiction` true).
- **Required-by-Type × Migrated**: the full matrix from lines 21–65, including
  `migratedRecord=true → all optional` (**this is gap #1 — expected to fail until fixed**).
- **Conditional gates**: urgency-reason, online-ref, Gazette-date (**Gazette general case is
  gap #2 — expected to fail until fixed**), relinquishment hide/mandate, minor hide/mandate,
  minor→Single default, relinquishment refer-to-master + publish defaults.

### Layer 3 — Enum-value conformance (`test/conformance/enums.conformance.spec.ts`)
- Cross-check `enums/dynamics-values.ts` integer maps against the option-set values documented
  in the schema comments / any option-set export. Pins the "preserve Dynamics integer" promise.

### Shared fixture loader (`test/conformance/artifacts.ts`)
- One module that reads the `dataverse_tables/` files (path resolved relative to repo root,
  guarded like `nunjucks.setup.ts` does for the project root). Exposes parsed columns,
  relationships, and a helper to assert a child table's `business_rules.md` is empty.
- Keeps the tests declarative and means a re-export of the artifacts only touches this file.

---

## Execution plan (small pieces, in order)

1. **Fixture loader + schema conformance (Layer 1).** Lowest risk, no code changes; establishes
   the artifact-reading pattern. ~1 spec file.
2. **State-cascade conformance (Layer 2a).** Pure, already well-covered — mostly re-expressing
   existing coverage against the source truth table. Should be green immediately.
3. **Field-rules conformance incl. migrated-record (Layer 2b).** Writes the failing test for
   gap #1. Green after implementing `migratedRecord` in `getFieldRules()`.
4. **Conditional-gates conformance incl. Gazette (Layer 2c).** Writes the failing test for
   gap #2. Green after adding the general publish→hide/clear gate.
5. **Enum-value conformance (Layer 3).** Independent; can slot in any time.
6. **Child-table empty-rules assertions + wire into `jest.config.js`.** Decide whether
   conformance runs in the default unit run or a dedicated `jest-conformance.json` project
   (recommend a separate project so a spec-vs-code divergence is visibly its own signal).

Steps 3 and 4 each pair a failing test with a small service fix — those are the only code
changes; everything else is test-only. Run `npx tsc --noEmit` and the full Jest suite after
each step (watch off under Jest — the chokidar gotcha).

**Open question for Steve before step 3/4:** do you want the two gap fixes applied as part of
this harness work (bug-first: red test → fix → green), or should the harness land red and the
fixes be a separate follow-up? Default assumption is fix-as-we-go unless you say otherwise.

---

## Status — DONE (2026-08-03, fix-as-we-go)

All six pieces landed. `npm run test:conformance` → 5 suites, 131 tests green;
`npm run test` (unit) → 153 green; `npx tsc --noEmit` clean. Integration + e2e were not
run to green here because Postgres (localhost:5432) is not running in this environment —
those suites fail at `PrismaClientInitializationError` before any assertion, unrelated to
these changes (no schema/migration/.env/config touched).

- **Fixture loader** `test/conformance/artifacts.ts` — regex grid parser (no HTML dep
  installed); resolves artifacts via `nest-cli.json` probe. Throws on unexpected cell counts.
- **Layer 1** `schema.conformance.spec.ts` — forward column coverage per table, 3 child
  relations, child-table empty-rules assertions, truncation guard.
- **Layer 2a** `state-cascade.conformance.spec.ts` — full cascade truth table + order quirks
  + contradiction. Green against existing code (no fix needed).
- **Layer 2b** `field-rules.conformance.spec.ts` — per-type matrix + **gap #1 fix**:
  `getFieldRules(type, migrated)` now relaxes the required set when Migrated Record = Yes.
- **Layer 2c** `conditional-gates.conformance.spec.ts` — urgency/online gates + **gap #2 fix**:
  general publish-to-Gazette hide (`getFieldRules(..., publishToGazette)`) + write-path clear
  (`applyGazetteGate()`, wired into `create`/`update`).
- **Layer 3** `enum-values.conformance.spec.ts` — Dynamics integer preservation + reverse-map
  losslessness.
- Runs under a dedicated `test/jest-conformance.json` project, `npm run test:conformance`.

**Finding recorded during the run:** `deedpoll/columns.html` is alphabetically TRUNCATED —
70 rows ending at "Refund Reference"; post-R columns (Type, State, Urgency, Section, Retain
Permanently) are absent from the extract. Coverage is therefore FORWARD-only and the
truncation guard asserts the gap so a fuller future extract trips it. If a complete
`deedpoll` column export is provided, extend `DEEDPOLL_MAP` in schema.conformance.spec.ts.
