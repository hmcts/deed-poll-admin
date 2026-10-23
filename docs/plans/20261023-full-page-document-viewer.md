# Plan: full-page document viewer throughout deed-poll admin

## Overview

Replace document links that take the reviewer out of the application with a shared, full-page viewer.
Caseworkers and judges retain their case or referral context while reading, changing pages, zooming,
rotating and moving between documents. Cover **every currently allowed upload type**: PDF, JPEG, PNG,
multi-page TIFF and Word DOCX. A PDF-only implementation does not complete this plan.

Steve approved the scope and the interactive design on 23 October 2026. The portable design reference is
[document-viewer.html](../prototypes/document-viewer.html). It contains fictional pages and simulated page
counts; use it as the interaction/layout reference, never as a document renderer or production fixture.

## Context

Reviewed default-branch baselines:

- Admin: `e9dd6a1dfbf9a3a831168d3f04ccdbf8e852ec24`.
- API: `3891c2ad77557b1f156ff88c4c4235e275e8b663`.

The authoring checkout is the older `fix/api-transport-tls` branch. Execute in a clean feature worktree
from the intended integration branch, record its starting SHA as the Ralphex review base, and recheck the
inventory there. Preserve other work. Read `CLAUDE.md` and `.claude/rules/frontend.md`, `backend.md`,
`testing.md` and `e2e-testing.md` before implementation.

Existing entry points and building blocks:

| Area | Source |
|---|---|
| Caseworker document links | `src/pages/deed-polls/detail.njk`; `src/pages/deed-polls/[id].ts` |
| Judicial links and document list | `src/pages/judicial/referrals/[referralId].ts`; `referral.njk` beside it |
| Existing original-file routes | `src/pages/deed-polls/[id]/documents/[documentId]/file.ts`; `src/pages/judicial/referrals/[referralId]/documents/[documentId]/file.ts` |
| Shared response containment | `src/document-response.ts` and its tests |
| Domain/adapter boundary | `libs/deed-poll/src/documents/service.ts`, `judicial/service.ts`, `api/deed-poll-api.ts`; `libs/deed-poll-api-client/src/api/client.ts` |
| Contract provenance and mock | `libs/deed-poll-api-client/SPEC-PROVENANCE.md`, `openapi.json`, `src/mock/server.ts` |
| Layout, assets and strings | `src/pages/layouts/app-full-width.njk`, `src/assets/js/index.ts`, `vite.build.ts`, `scripts/extract-welsh-strings.mjs` |

There are currently two document-viewing entry points: case details and judicial referral details.
Inventory again at execution time and include any additional document links found. Generated deeds use
the same viewer when listed as supporting documents. Correspondence wording previews are not file previews.

## Dependencies and reconciliation gate

Implement the companion API plan first:
[document-preview-rendering](../../../deed-poll-api/docs/plans/20261023-document-preview-rendering.md).
It supplies authenticated PDF preview streams for all five allowed MIME types, with multi-page TIFF and
DOCX pagination handled on the backend. The existing `/file` operations return originals and do not
provide this conversion contract.

The planned API additions are:

```http
GET /caseworker/cases/{id}/documents/{documentId}/preview
GET /judicial/referrals/{referralId}/documents/{documentId}/preview
```

These are proposed operations until the API publishes them. Before Task 1, require the reviewed API
implementation and generated OpenAPI artifact, including preview limits, headers and errors. Stop and
report the missing dependency if they are absent. Do not invent an API, edit the producer's spec here,
or use browser Word pagination as a substitute for accurate preview page counts.

Execute/review the API and admin changes as separate repositories and branches. Ralphex's admin review
does not review an uncommitted sibling API diff. Converter provisioning and deployed acceptance belong
to Post-Completion, not automatable task checkboxes.

## Agreed user experience

1. Open the viewer in the current app tab from every authorized document link. Retain the application
   header, account navigation, persona strip where enabled, session warning and Welsh language support.
2. Show the document name, original format, case reference when already disclosed in that context, and
   **Back to case** or **Back to referral**. Return to the same document section and restore the opener's
   position where the browser supports it; a concrete return link always works without browser Back.
3. Offer a document selector, **Document N of M**, **Previous document** and **Next document**. Use only
   the documents supplied by that authorized case/referral read, in its existing order.
4. Separately offer **Previous page**, a labelled editable page number, **of N**, **Next page**, actual
   page thumbnails, zoom out/in and percentage, **Fit to width**, **Fit whole page**, and 90-degree rotation.
   Default to fit width. Disable unavailable boundary controls, including page controls for one-page images.
5. Display one selected page at a time, with scrolling within the page and a toolbar that remains available.
   Thumbnails can be hidden. Preserve each document's page, zoom mode/value and rotation during the visit.
6. **Download original** downloads the original bytes and filename as an attachment, including DOCX/TIFF.
   Rotation and other viewer controls alter presentation only.
7. All five source formats have real previews. JPEG/PNG yield one page; TIFF retains every frame; DOCX
   uses a generated, paginated PDF. Page counts come from the preview document, not extensions or sample data.

Annotations, editing, redaction, OCR, search, printing, side-by-side review and persistent user preferences
are outside this agreed slice. No JavaScript support must still leave usable document navigation, return
navigation and original download, with an explanation that interactive preview requires JavaScript.

## Development Approach

1. Use TDD for behaviour and permission/error boundaries. Complete and validate each task before the next.
   New/changed behaviour gets colocated tests. Record local task commits and the review base; do not run
   Ralphex, publish a PR, merge or deploy merely because this planning document exists.
2. Keep the adapter -> `callApi` -> domain -> page architecture. No database, conversion service credential,
   CDAM URL or API base URL belongs in the frontend or a page handler. `Caller` remains `{ accessToken }`.
3. Use two thin sets of page routes sharing app-owned viewer code, not a generic unscoped document URL:
   `/deed-polls/{id}/documents/{documentId}/view` and
   `/judicial/referrals/{referralId}/documents/{documentId}/view`, with scoped `/preview` and `/download`
   siblings. Retain existing `/file` behaviour for existing consumers. Judicial URLs never acquire a case ID.
4. A context read supplies the selector, title and return link; it is not an extra permission pre-read for
   a binary request. Every binary request independently uses the API's current authorization. Do not issue
   per-document metadata reads or load all document binaries to populate the selector.
5. Use pinned, locally served PDF.js and its matching worker with vanilla TypeScript. Render PDF previews
   supplied by API for every format. Do not introduce Angular or copy the Angular HMCTS media-viewer into
   this Express app. Official reference: <https://mozilla.github.io/pdf.js/examples/>.
6. Follow the approved mock-up using app-owned SCSS with GOV.UK typography, spacing and accessible controls.
   Extend `layouts/app-full-width.njk`; preserve actual layout blocks after inspecting the executing baseline.
   Keep helpers outside `src/pages`, where the file router would discover them as routes.
7. Keep originals, preview responses and trusted viewer HTML distinct. Preserve binary `no-store`, `nosniff`
   and sandbox containment. Do not forward the binary CSP onto the HTML shell, embed raw DOCX/HTML, enable
   PDF scripting/XFA/actions, add `unsafe-eval`, use an external viewer/CDN, or put tokens into browser code.
   Scope any required worker/font policy to the viewer and verify it in a browser.
8. Bound preview bytes, render dimensions, thumbnails and concurrent work using the producer's documented
   limits. Disable PDF range requests for this first full-response contract. Abort obsolete fetches, cancel
   renders and destroy prior PDF workers/documents on switch, navigation, logout and failure. A late response
   must never display the previous document beneath the newly selected name.
9. Keep per-document presentation state in the viewer's memory, scoped to the current case/referral. Do not
   store document content, names or credentials in local/session storage, Redis, telemetry or URLs. A small
   validated current-page/zoom fragment is acceptable; document switching replaces history rather than
   inserting every page or zoom action into browser history. Return paths are built from trusted context
   using `casePath`, `referralPath` and `pathSegment`, never an arbitrary `returnTo`.
10. A preview 404 is a document-unavailable state inside the viewer, not evidence that the referral left the
    shared pool. Clear the old canvas and preserve safe navigation. A referral-context 404 retains the existing
    non-enumerating unavailable screen. Reauthentication, forbidden, timeout and conversion failures retain
    their correct meanings; never expose provider prose, file contents or another judge's identity.

## Validation Commands

Run from the admin repository root before implementation and after each implementation task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Reuse local Redis or start the existing Redis service. Record baseline and final failures, skips and counts;
confirm session-store tests actually ran. Follow the repository formatting rules and inspect formatting
diffs for unrelated changes. Quote test paths containing `[id]`/`[referralId]`/`[documentId]` during red/green.

At acceptance also run `yarn test:coverage`, `yarn welsh:extract`, `yarn welsh:check` and the new browser journeys
through the installed Playwright workspace. Record any existing untranslated-Welsh baseline separately;
no newly added viewer prose may silently disappear from extraction. Use a fresh local mock/Redis/IDAM fixture
following the existing isolated Gazette/session configurations. Run real PDF.js and its real worker, not
the illustrative prototype. Browser tests use synthetic local files; no AAT calls in automated suites.

## Implementation Steps

### Task 1: Reconcile the preview contract and extend the adapter/mock

**Files:** `libs/deed-poll-api-client/{openapi.json,SPEC-PROVENANCE.md}`,
`libs/deed-poll-api-client/src/api/{client.ts,wire.ts,contract.test.ts,client.test.ts}`,
`libs/deed-poll-api-client/src/mock/` and the package exports.

- [ ] Check the producer prerequisite; record API source/artifact SHAs and the execution/review baseline.
      Regenerate the consumer artifact using `SPEC-PROVENANCE.md`; explain only the two preview additions
      and their documented headers/errors/limits. Preserve unrelated contract changes already merged.
- [ ] Add failing adapter/contract tests for caseworker and judicial preview streams, encoded IDs, caller
      token propagation, MIME/header validation, byte limits, timeouts, cancellation and classified failures.
- [ ] Add typed preview operations returning the existing streaming download shape where appropriate.
      Configure preview-specific patience to cover the producer deadline without weakening ordinary calls.
- [ ] Extend the mock with both scoped operations and genuine small PDF previews for each allowed original
      MIME. Include a multi-page TIFF-equivalent preview and a multi-page DOCX-equivalent preview, with
      fixture provenance. Original `/file` responses retain original MIME/bytes. Model referral ownership.
- [ ] Test wrong-case/referral/document access, missing files and converter failure against the mock; do not
      stub `fetch` or disguise unsupported DOCX/TIFF as a successful empty PDF. Run Validation Commands.

### Task 2: Build the shared viewer context and navigation model

**Files:** create `libs/deed-poll/src/document-viewer/view.ts` and its colocated tests; modify
`documents/service.ts`, `judicial/service.ts`, exports and their tests as needed;
create `src/document-viewer/context.ts` and tests.

- [ ] Add failing cases for caseworker/judicial context, selector membership/order, current selection,
      previous/next boundaries, zero/one/many documents and titles with unsafe characters.
- [ ] Compose the context from one existing case or referral read. Judicial context uses only its published
      application/document projection. Preserve API order and existing availability facts; a metadata flag
      does not prove bytes still exist. An unknown selection is refused rather than silently substituted.
- [ ] Build same-origin scoped view/preview/original-download URLs and fixed context return paths with the
      existing path helpers. Keep raw IDs only in domain calls; reject empty/dot-only IDs before I/O.
- [ ] Add domain preview operations through `callApi`; keep binary authorization independent of the selector
      and avoid per-document metadata calls or a system-user fallback.
- [ ] Test encoded delimiter IDs, forged selections/return destinations, absent application projections,
      expired access and independent contexts for concurrent tabs. Run Validation Commands.

### Task 3: Add the protected viewer, preview and original-download routes

**Files:** create scoped `view.ts`, `preview.ts`, `download.ts` and colocated tests under both existing
document route directories; create `src/document-viewer/page.ts`, `content.ts`, `preview-response.ts`
and their tests; create `src/pages/document-viewer.njk` and its template tests.

- [ ] Test both scopes through the real app middleware as well as handler doubles: anonymous access,
      judicial-area refusal, correct caller propagation and safe parameter handling.
- [ ] Render the shared full-width shell with real context, bilingual content, document selector, distinct
      page/document controls, thumbnails region, document status and a working return link. Escape names.
- [ ] Add scoped binary proxies using the published preview operation. Force original-download disposition
      to attachment in the new download route while retaining original MIME/name/bytes and containment.
      Keep legacy `/file` handlers and consumers unchanged.
- [ ] Distinguish viewer-context failure from preview-resource failure. Clear unavailable content, preserve
      safe navigation and show localized fixed errors; do not call a document failure a withdrawn referral.
- [ ] Provide native navigation/download without JavaScript. A selector GET may redirect only to a document
      in the authorized context; no conversion job or business mutation is started by form/navigation GETs.
- [ ] Verify header policy separation, streaming cancellation, no public route holes and no duplicated
      downloads/audit-provoking binary preloads during shell rendering. Run Validation Commands.

### Task 4: Package and implement the real page renderer

**Files:** `package.json`, `yarn.lock`, `vite.build.ts`, `src/assets/js/index.ts`;
create app-owned `src/assets/js/document-viewer/` renderer modules and tests;
read `libs/express-govuk-starter/src/helmet/helmet-middleware.ts` and its tests for existing policy;
prefer a narrowly scoped app-owned configuration rather than changing the vendored starter.

- [ ] Pin a maintained PDF.js version and its matching worker, checking its license/security guidance at
      execution time. Serve worker, fonts and any CMaps from built app assets in development and production.
- [ ] Write renderer tests with real small PDFs for actual page counts, text layers, intrinsic page sizes,
      orientation and malformed/truncated/oversized content. A fake renderer is insufficient acceptance.
- [ ] Load only the chosen authorized preview. Enforce response/byte limits, use cancelable loading/render
      tasks and discard stale generations after fast document switches, failures or teardown.
- [ ] Render the selected page, readable text layer where present and lazy low-resolution thumbnails.
      Bound canvas pixels and released resources; never render every full-size page simultaneously.
- [ ] Keep document scripting, XFA, executable links and editable forms disabled. Verify the actual worker
      under the app CSP without weakening original binary containment or adding global unsafe policies.
- [ ] Verify built/hashed asset resolution and Docker packaging with the existing build/pipeline checks.
      Run focused browser rendering checks and Validation Commands.

### Task 5: Implement the approved controls and per-document state

**Files:** viewer client modules/tests, `src/assets/css/components/_document-viewer.scss`,
`src/assets/css/index.scss`, the shared template/content and browser fixtures.

- [ ] Test and implement previous/next page, validated page jump, page totals and clickable actual thumbnails;
      enforce one-page and first/last boundaries without relying on disabled styling alone.
- [ ] Add 25–300% zoom, percentage display, fit width, fit whole page and quarter-turn rotation. Respect
      intrinsic rotation/aspect ratio and viewport/device-pixel changes without modifying original bytes.
- [ ] Add the selector, Document N of M and separate previous/next document controls. Keep per-document page,
      zoom mode/value and rotation within the visit; clamp state when a newly loaded preview has fewer pages.
- [ ] Preserve context on return/reopen and keep direct links/reloads safe. Capture only minimal scoped
      opener navigation state; preserve ordinary browser history and keep independent tabs independent.
- [ ] Exercise rapid switching during fetch/render, restoring a prior document, destroyed workers and
      predictable focus/status announcements. No old page may remain under the new document's heading.
- [ ] Implement the approved responsive layout and thumbnail toggle using app-owned styles. Keep controls
      available while scrolling and reachable by keyboard at narrow widths/200% browser zoom. Run Validation Commands.

### Task 6: Integrate every entry point, language and failure state

**Files:** caseworker/judicial detail handlers, templates and tests; `src/document-viewer/content.ts`;
`scripts/extract-welsh-strings.mjs` and extractor tests; session/asset integration tests as needed.

- [ ] Re-inventory document links and route each existing viewing action to the scoped viewer, including
      generated deeds. Keep explicit original-download actions clearly labelled and direct.
- [ ] Add the shared content module to Welsh extraction and test that every viewer label, error and dynamic
      page/document-count sentence is collected. Preserve both languages and existing extractor conventions.
- [ ] Cover loading, missing file, lost referral access, 401, 403, timeout, damaged PDF and failed DOCX/TIFF
      conversion with useful localized messages, safe retry/selection/return actions and no fabricated counts.
- [ ] Preserve the existing idle/absolute timeout and logout behaviour. Viewing must not add an automatic
      keepalive, suppress the session warning or retain buffers/state across logout/persona changes.
- [ ] Verify no source bytes, filenames, credentials or converter prose enter error logs/telemetry; raw
      source names remain escaped presentation. Test the no-JS navigation/download path.
- [ ] Run focused integration/template/extractor tests and Validation Commands; record counts and baselines.

### Task 7: Verify the complete staff and judicial journeys

**Files:** create `e2e-tests/tests/document-viewer.spec.ts`, an isolated viewer Playwright configuration
following existing patterns, and synthetic fixtures in the client mock/test directories.

- [ ] Build one complete caseworker journey and one complete judicial journey, following the repo's minimum
      E2E-test rule. Include all five source types, actual multi-page PDF preview bytes, document switching,
      page jump/thumbnails, zoom/fit/rotation, preserved position, return navigation and original downloads.
- [ ] Include keyboard use, axe checks, Welsh controls/counts, the existing session warning and a narrow
      viewport within those journeys. Assert behaviour, not exact colours, margins or font sizes.
- [ ] Prove original DOCX/TIFF downloads have their original file type/bytes rather than preview PDFs.
      Exercise permission/error/race matrices in focused integration tests rather than multiplying E2E journeys.
- [ ] Run lint, production build, full serial suite, coverage and the isolated browser journeys. Capture
      real test counts/skips and worker/CSP results; investigate new failures before moving on.
- [ ] Verify all Acceptance Criteria against the implementation diff and prepare the review-base/handoff
      notes for Ralphex's subsequent review phases. Do not start those phases inside this task or claim
      that local/mock evidence establishes deployed converter acceptance.

### Task 8: Document the viewer and implementation evidence

**Files:** `README.md`, `docs/DEPLOYMENT.md`, `CLAUDE.md` where a new cross-file invariant needs recording,
and this plan's Execution notes; update existing packaging/extractor tests if their contracts changed.

- [ ] Document viewer entry points, all formats, original downloads, limits, errors, worker asset handling
      and the API/converter deployment dependency. Keep the approved prototype clearly labelled design-only.
- [ ] Record starting/implementation SHAs, API/spec provenance, changed files, all-format fixture provenance,
      test results and translation baseline. Leave review results pending until Ralphex's later review
      phases run, then append their evidence; do not mark AAT acceptance from mock runs.
- [ ] Recheck documentation paths/commands and relevant packaging/extractor tests. Run Validation Commands
      after any code/test corrections; do not add tests that merely assert prose in this planning file.

## Acceptance Criteria

- Every existing authorized document-viewing action opens the same app-owned full-page experience.
- PDF, JPEG, PNG, all pages of TIFF and paginated DOCX previews work; originals remain downloadable unchanged.
- Page counts/thumbnails derive from real preview bytes; page controls and document controls are distinct.
- Users can change documents, retain each document's presentation state and return to their case/referral.
- Both scopes retain authorization, independent binary checks, audit behaviour and safe failure semantics.
- No-JS navigation/download works; keyboard, screen-reader text, responsive layout, Welsh and session controls
  are exercised. Scanned documents are not claimed to have searchable/selectable text without OCR.
- Original containment, browser/server resource limits and stale-response cleanup are verified.
- Producer/API, adapter/mock, full build/tests and two complete browser journeys are reviewed independently.

## Execution notes

Planning only, 23 October 2026. The approved static mock-up was browser-checked for interaction and layout.
That is not implementation, real file conversion, an app test run or Ralphex execution. All task checkboxes
are intentionally open. Append implementation evidence here; preserve earlier decisions and corrections.

## Post-Completion

Review/merge the API first and provision its approved conversion endpoint/credentials through the appropriate
infrastructure repositories. In AAT use synthetic documents of every allowed type, including a genuine
multi-page TIFF and court-generated DOCX. Check Word pagination/fonts visually, original download equality,
staff/judicial denial, separate API replicas, and converter outage/cancellation. No embedded credentials,
new public sharing or deployment is authorized by authoring these plans. Confirm Welsh wording with the
language owner and perform human keyboard/screen-reader acceptance. Deploy admin after the API and converter
acceptance, then exercise both UI entry points. Keep publication/merging/deployment separate from local
Ralphex execution. Move this plan to `docs/plans/completed/` after implementation and review.
