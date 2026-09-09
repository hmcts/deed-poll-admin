# Conformance harness — what it still proves, and where the structural half went

This directory is the correctness argument for the Dynamics → app migration: it turns the
source-of-truth Dataverse exports in `.business_context/dataverse_tables/` into executable
assertions, so a rule that was ported cannot silently drift and a column that was dropped cannot
be dropped quietly. `.business_context/CONFORMANCE_HARNESS_PLAN.md` is its design record.

## The decision — task 7 of `docs/plans/02-dal-cutover-to-api.md`, 2026-09-09

The harness had five layers. The cutover to `deed-poll-api` left this repo storing nothing, so
one of the five lost its subject and four did not. **The structural layer is retired here and
lives in api; the four rule layers stay.** Neither half was deleted silently — this file is the
record the plan asked for, and it is the thing to read before touching either half.

### Layer 1, structural — retired here, re-pointed in api

Removed: `schema.conformance.test.ts` and `artifacts.ts` (the fixture loader, which only that
layer used — no test in this directory reads the filesystem any more).

Its home is `deed-poll-api`, commit `9db5fe3` ("port the conformance harness against the vendored
Dataverse exports"):

| | |
|---|---|
| Dataverse exports → ported fields | `src/test/java/uk/gov/hmcts/reform/deedpoll/conformance/DataverseSchemaConformanceTest.java` |
| Ported schema → live tables | `src/test/java/uk/gov/hmcts/reform/deedpoll/db/SchemaConformanceTest.java` |
| The exports themselves, vendored | `src/test/resources/reference/dataverse_tables/` |
| This directory's originals, vendored as the port's reference | `src/test/resources/reference/ts/conformance/` |

Three reasons it belongs there and not here, in the order that decided it:

1. **api owns the columns.** The question the layer asks is "does the store carry every business
   column the source had". This repo has no store — asking it here would be asking a presentation
   layer about someone else's schema.
2. **api's version is strictly stronger, not merely equivalent.** The TypeScript layer asserted
   only that its `DEEDPOLL_MAP` *had a key* for each source column; it never checked that the
   field name the map claimed actually existed, so a typo or a rename left a column looking
   accounted for while nothing carried it. api's `everyMappedFieldExistsInTheReferenceModel()`
   closes that (its own docblock says so: "Not a port — an addition"), and
   `db.SchemaConformanceTest` continues the chain to the live Flyway schema. Source → schema →
   database is a chain this repo could not have completed.
3. **The obvious local alternative would have been weaker AND wrong.** Re-pointing the map at the
   api client's published wire shape looks tempting — `libs/deed-poll-api-client/openapi.json` is
   right here — but api deliberately does not publish everything it stores. The document storage
   key is the worked example: the wire carries `hasFile`, not the key (see
   `documents/documents-view.ts`). Absence from the wire is not absence from the store, so such a
   harness would have had to encode api's *publication* policy to avoid failing on a column that
   is in fact carried. That is a test of the wrong thing.

### Layers 2a, 2b, 2c and 3 — stay

`state-cascade`, `field-rules`, `conditional-gates` and `enum-values` assert against code that is
still in this repo and still load-bearing: `deed-poll/case-state.ts`,
`deed-poll/deed-poll-validation.ts` and `deed-poll/enums/dynamics-values.ts`. `edit-view.ts` reads
the field-rule matrix directly and every page renders from these enums, so the rules are applied
here whatever api also does with them.

api carrying the same rules is not a reason to stop pinning this end. Both ends enforcing a rule
is the arrangement `documents/upload-policy.ts` already has, on purpose: a client that applies the
rule gives the caseworker a better answer than a 400 from api, and a rule applied in two places
needs pinning in two places. These layers follow their subject — retire them here when the local
matrix goes, not before.

## The caveat that travels with the harness

**The `deedpoll/columns.html` export is alphabetically truncated at A–R.** It declares
"Total columns: 70" but lists only as far as "Refund Reference", so Type, State, Urgency, Section,
Retain Permanently and every other post-R column is absent from it. Structural coverage is
therefore **forward only** — every column the export lists must map to a ported field — and the
export **must never be read as a complete column set**. A green run proves nothing was dropped
from what the export reaches; it says nothing about what it does not reach. api carries this
caveat in `DataverseSchemaConformanceTest`'s docblock and asserts the truncation directly, so a
fuller export trips a test rather than passing unnoticed.

It matters here too, and in a way worth stating plainly: the columns the truncation hides are
`Type`, `State` and `Urgency` — precisely the columns the four remaining layers drive their rules
from. The structural half never covered them. So the two halves were always complementary rather
than overlapping, and the rule layers staying here is not a duplicate of what api now runs.

`business_rules.md` is not truncated; the rule layers transcribe from it and cite it per file.

## Test arithmetic

141 conformance tests → **63**. The 78 that went are all layer 1, of which 72 were one
`it()` per artifact column, the other six being the relationship shape, the truncation guard and
the four child tables' empty `business_rules.md`. 63 is the same figure `.business_context/ORIGINAL_PLAN_2026-08-21.md`
recorded for the prototype's four passing suites, which is a coincidence of arithmetic rather
than evidence of anything.
