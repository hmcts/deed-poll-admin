# Plan: full-page document viewer throughout deed-poll admin

## Overview

Replace document links that take the reviewer out of the application with a shared, full-page viewer.
Caseworkers and judges retain their case or referral context while reading, changing pages, zooming,
rotating and moving between documents. Cover **every currently allowed upload type**: PDF, JPEG, PNG,
multi-page TIFF and Word DOCX. A PDF-only implementation does not complete this plan.

Steve approved the scope and the interactive design on 23 October 2026. The portable design reference is
[document-viewer.html](../prototypes/document-viewer.html). It contains fictional pages and simulated page
counts; use it as the interaction/layout reference, never as a document renderer or production fixture.

## Decisions (Steve, 2026-10-23)

These supersede anything below that says otherwise. The companion api plan records the same decisions.

1. **DOCX previews come from api, which converts through Docmosis Tornado.** Nothing changes here: the viewer
   renders the PDF api returns.
2. **Preview requests fit inside the 30 s gateways.** api's preview budget is 25 s (finding R03: both Application
   Gateways cut requests off at 30 s). The adapter's preview timeout must cover api's 25 s and still finish inside
   the frontend gateway's 30 s, so set it just above api's budget and below 30 s, never at api's old 45 s.
3. **Phased release.** PDF, JPEG, PNG and TIFF previews may be released before the DOCX converter is provisioned.
   Until then api answers a DOCX preview with the fixed 503 `PREVIEW_UNAVAILABLE`, and the viewer shows its
   preview-unavailable state with **Download original** still working. That state is a normal, tested outcome, not a
   failure to hide.
4. **No case reference for judges.** The judicial viewer shows no case reference: `JudicialApplicationView`
   deliberately excludes `referencenumber` (business decision, 2026-10-19). The caseworker viewer shows it. The
   prototype's "Case reference" in the judge journey is wrong on this point; follow this decision, not the mock-up.
5. **api audits a preview as `DOCUMENT_PREVIEWED`**, separately from `DOCUMENT_DOWNLOADED`. This app records nothing
   itself, but must not fetch a preview where a download is meant, or the reverse.
6. **The prototype is not to be changed.** It stays as approved, design-only.
7. **The viewer enforces a 100-page limit for every preview** (Steve, 2026-10-23: no uploaded document is expected
   to come near 50). api stopped parsing PDF originals and Docmosis output, because parsing is what a crafted PDF
   exploits to exhaust a pod's memory, so api counts pages only for the previews it builds (JPEG, PNG, TIFF frames)
   and the viewer must refuse the rest. Read `numPages` from PDF.js as soon as the document loads and before any
   page or thumbnail renders; over 100, destroy that document and show a fixed, localized "too large to preview"
   state with **Download original** still working. Take the number from the published `x-document-preview-limits`
   extension rather than restating it, and test it with a real PDF over the limit.

8. **The api contract comes from unmerged api PR #129** (hmcts/deed-poll-api, branch
   `feat/document-preview-rendering`, head `19bb0c2`). Steve, 2026-10-24: the pipeline is down out of hours, so the
   admin side starts before #129 merges, as admin's earlier refresh from api `693c242` did. The artifact is already
   generated, by `JAVA_TOOL_OPTIONS=-XX:UseSVE=0 TESTCONTAINERS_RYUK_DISABLED=true ./gradlew integration --tests
   '*OpenAPIPublisherTest*' --no-watch-fs` in a clean api worktree at that commit, at
   `/home/hmcts/.claude/jobs/c45dad71/tmp/openapi-pr129-19bb0c2.json` (raw SHA-256
   `351b6047e653a7ddad987efcc496e6933e8a5a1672e25b9d10d5fe8143afed45`). **Do not run the api build from this
   repository**: copy that file per `SPEC-PROVENANCE.md` (2-space JSON, then Biome), and record its provenance row
   as depending on the unmerged PR, as the `693c242` row did. Its parsed delta against admin's current copy (api
   `b335a72`) is exactly: two operations added, `GET /caseworker/cases/{id}/documents/{documentId}/preview` and
   `GET /judicial/referrals/{referralId}/documents/{documentId}/preview`, and one schema added,
   `DocumentPreviewError`; no other path, schema, component or top-level field changed. Re-measure and stop if
   yours differs. The producer's limits are in its `x-document-preview-limits` extension; its behaviour is described
   in api's `README.md` preview section and `docs/DOCUMENT-PREVIEW-SMOKE.md` (read them from that api worktree,
   `/Users/steve.newman/Documents/GitHub/deed-poll-admin-workspace/cft-workspace/.worktrees/deed-poll-api-document-preview`,
   read-only). Its preview error codes are `PREVIEW_INVALID_DOCUMENT` (422), `PREVIEW_LIMIT_EXCEEDED` (422),
   `PREVIEW_UNAVAILABLE` (503) and `PREVIEW_BUSY` (429 with `Retry-After`); a client must send
   `Accept: application/pdf` and read JSON error bodies. JPEG-compressed TIFFs and DOCX before Docmosis is
   provisioned are normal `PREVIEW_INVALID_DOCUMENT` / `PREVIEW_UNAVAILABLE` outcomes that the viewer must show as
   unavailable with **Download original**.

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
2. Show the document name, original format, the case reference in the caseworker context only (Decision 4), and
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

**Browsers in this devcontainer.** `npx playwright install` cannot download here: the proxy answers HTTP 400
(`GatewayExceptionResponse`), and retrying does not help. `~/.cache/ms-playwright` holds `chromium-1243` and
`chromium_headless_shell-1243`. If Playwright asks for a different build, symlink the cached one to the name it wants
(`ln -sfn ~/.cache/ms-playwright/chromium-1243 ~/.cache/ms-playwright/chromium-<wanted>`, and the same for
`chromium_headless_shell`) and record that in the execution notes; a green local run on a symlinked build does not
prove a browser-version-sensitive failure impossible. Never flush the shared Redis, and run the browser journeys on
their own isolated ports and Redis database, following the existing Gazette configuration.

## Implementation Steps

### Task 1: Reconcile the preview contract and extend the adapter/mock

**Files:** `libs/deed-poll-api-client/{openapi.json,SPEC-PROVENANCE.md}`,
`libs/deed-poll-api-client/src/api/{client.ts,wire.ts,contract.test.ts,client.test.ts}`,
`libs/deed-poll-api-client/src/mock/` and the package exports.

- [x] Check the producer prerequisite; record API source/artifact SHAs and the execution/review baseline.
      Regenerate the consumer artifact using `SPEC-PROVENANCE.md`; explain only the two preview additions
      and their documented headers/errors/limits. Preserve unrelated contract changes already merged.
- [x] Add failing adapter/contract tests for caseworker and judicial preview streams, encoded IDs, caller
      token propagation, MIME/header validation, byte limits, timeouts, cancellation and classified failures.
- [x] Add typed preview operations returning the existing streaming download shape where appropriate.
      Configure preview-specific patience to cover the producer deadline without weakening ordinary calls.
- [x] Extend the mock with both scoped operations and genuine small PDF previews for each allowed original
      MIME. Include a multi-page TIFF-equivalent preview and a multi-page DOCX-equivalent preview, with
      fixture provenance. Original `/file` responses retain original MIME/bytes. Model referral ownership.
- [x] Test wrong-case/referral/document access, missing files and converter failure against the mock; do not
      stub `fetch` or disguise unsupported DOCX/TIFF as a successful empty PDF. Run Validation Commands.

### Task 2: Build the shared viewer context and navigation model

**Files:** create `libs/deed-poll/src/document-viewer/view.ts` and its colocated tests; modify
`documents/service.ts`, `judicial/service.ts`, exports and their tests as needed;
create `src/document-viewer/context.ts` and tests.

- [x] Add failing cases for caseworker/judicial context, selector membership/order, current selection,
      previous/next boundaries, zero/one/many documents and titles with unsafe characters.
- [x] Compose the context from one existing case or referral read. Judicial context uses only its published
      application/document projection. Preserve API order and existing availability facts; a metadata flag
      does not prove bytes still exist. An unknown selection is refused rather than silently substituted.
- [x] Build same-origin scoped view/preview/original-download URLs and fixed context return paths with the
      existing path helpers. Keep raw IDs only in domain calls; reject empty/dot-only IDs before I/O.
- [x] Add domain preview operations through `callApi`; keep binary authorization independent of the selector
      and avoid per-document metadata calls or a system-user fallback.
- [x] Test encoded delimiter IDs, forged selections/return destinations, absent application projections,
      expired access and independent contexts for concurrent tabs. Run Validation Commands.

### Task 3: Add the protected viewer, preview and original-download routes

**Files:** create scoped `view.ts`, `preview.ts`, `download.ts` and colocated tests under both existing
document route directories; create `src/document-viewer/page.ts`, `content.ts`, `preview-response.ts`
and their tests; create `src/pages/document-viewer.njk` and its template tests.

- [x] Test both scopes through the real app middleware as well as handler doubles: anonymous access,
      judicial-area refusal, correct caller propagation and safe parameter handling.
- [x] Render the shared full-width shell with real context, bilingual content, document selector, distinct
      page/document controls, thumbnails region, document status and a working return link. Escape names.
- [x] Add scoped binary proxies using the published preview operation. Force original-download disposition
      to attachment in the new download route while retaining original MIME/name/bytes and containment.
      Keep legacy `/file` handlers and consumers unchanged.
- [x] Distinguish viewer-context failure from preview-resource failure. Clear unavailable content, preserve
      safe navigation and show localized fixed errors; do not call a document failure a withdrawn referral.
- [x] Provide native navigation/download without JavaScript. A selector GET may redirect only to a document
      in the authorized context; no conversion job or business mutation is started by form/navigation GETs.
- [x] Verify header policy separation, streaming cancellation, no public route holes and no duplicated
      downloads/audit-provoking binary preloads during shell rendering. Run Validation Commands.

### Task 4: Package and implement the real page renderer

**Files:** `package.json`, `yarn.lock`, `vite.build.ts`, `src/assets/js/index.ts`;
create app-owned `src/assets/js/document-viewer/` renderer modules and tests;
read `libs/express-govuk-starter/src/helmet/helmet-middleware.ts` and its tests for existing policy;
prefer a narrowly scoped app-owned configuration rather than changing the vendored starter.

- [x] Pin a maintained PDF.js version and its matching worker, checking its license/security guidance at
      execution time. Serve worker, fonts and any CMaps from built app assets in development and production.
- [x] Write renderer tests with real small PDFs for actual page counts, text layers, intrinsic page sizes,
      orientation and malformed/truncated/oversized content. A fake renderer is insufficient acceptance.
- [x] Load only the chosen authorized preview. Enforce response/byte limits, use cancelable loading/render
      tasks and discard stale generations after fast document switches, failures or teardown.
- [x] Render the selected page, readable text layer where present and lazy low-resolution thumbnails.
      Bound canvas pixels and released resources; never render every full-size page simultaneously.
- [x] Keep document scripting, XFA, executable links and editable forms disabled. Verify the actual worker
      under the app CSP without weakening original binary containment or adding global unsafe policies.
- [x] Verify built/hashed asset resolution and Docker packaging with the existing build/pipeline checks.
      Run focused browser rendering checks and Validation Commands.

### Task 5: Implement the approved controls and per-document state

**Files:** viewer client modules/tests, `src/assets/css/components/_document-viewer.scss`,
`src/assets/css/index.scss`, the shared template/content and browser fixtures.

- [x] Test and implement previous/next page, validated page jump, page totals and clickable actual thumbnails;
      enforce one-page and first/last boundaries without relying on disabled styling alone.
- [x] Add 25–300% zoom, percentage display, fit width, fit whole page and quarter-turn rotation. Respect
      intrinsic rotation/aspect ratio and viewport/device-pixel changes without modifying original bytes.
- [x] Add the selector, Document N of M and separate previous/next document controls. Keep per-document page,
      zoom mode/value and rotation within the visit; clamp state when a newly loaded preview has fewer pages.
- [x] Preserve context on return/reopen and keep direct links/reloads safe. Capture only minimal scoped
      opener navigation state; preserve ordinary browser history and keep independent tabs independent.
- [x] Exercise rapid switching during fetch/render, restoring a prior document, destroyed workers and
      predictable focus/status announcements. No old page may remain under the new document's heading.
- [x] Implement the approved responsive layout and thumbnail toggle using app-owned styles. Keep controls
      available while scrolling and reachable by keyboard at narrow widths/200% browser zoom. Run Validation Commands.

### Task 6: Integrate every entry point, language and failure state

**Files:** caseworker/judicial detail handlers, templates and tests; `src/document-viewer/content.ts`;
`scripts/extract-welsh-strings.mjs` and extractor tests; session/asset integration tests as needed.

- [x] Re-inventory document links and route each existing viewing action to the scoped viewer, including
      generated deeds. Keep explicit original-download actions clearly labelled and direct.
- [x] Add the shared content module to Welsh extraction and test that every viewer label, error and dynamic
      page/document-count sentence is collected. Preserve both languages and existing extractor conventions.
- [x] Cover loading, missing file, lost referral access, 401, 403, timeout, damaged PDF and failed DOCX/TIFF
      conversion with useful localized messages, safe retry/selection/return actions and no fabricated counts.
- [x] Preserve the existing idle/absolute timeout and logout behaviour. Viewing must not add an automatic
      keepalive, suppress the session warning or retain buffers/state across logout/persona changes.
- [x] Verify no source bytes, filenames, credentials or converter prose enter error logs/telemetry; raw
      source names remain escaped presentation. Test the no-JS navigation/download path.
- [x] Run focused integration/template/extractor tests and Validation Commands; record counts and baselines.

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

**Task 1, 2026-10-24.** Review base (worktree `feat/full-page-document-viewer` start) `05a99499d705b0137b5dfdb0b24cc809d9e6d6ff`,
merge base with `origin/master` `300a189`. Producer: api PR #129 head `19bb0c2` (unmerged), artefact SHA-256
`351b6047…afed45`, copied per `SPEC-PROVENANCE.md` and parsed equal to it; delta re-measured as exactly the two preview
operations plus `DocumentPreviewError` (57 operations, 41 paths, 61 schemas). Adapter: `previewDocument` /
`previewJudicialDocument` stream the download shape plus `contentLength`, send `Accept: application/pdf`, wait up to
27 s (`PREVIEW_TIMEOUT_MS`, a ceiling that a configured timeout can only shorten), refuse a non-PDF or over-limit 200 as
`invalid-response` and error a body that runs past `DOCUMENT_PREVIEW_LIMITS.maxOutputBytes`. A refusal is
`{ kind: "preview-refused", code, retryAfterSeconds }` only when the code arrives on its published status. `ApiConfig`
gained an optional caller `signal`. The mock builds real synthetic PDFs (`src/mock/document-preview.ts`, sources in
`preview-sources.ts`): PDF passthrough, one page for JPEG/PNG, one per TIFF frame, three for DOCX; scenarios
`preview-converter-unavailable` and `preview-busy`. A malformed `Content-Length` is refused by undici before the
adapter sees it, so no branch handles one. Validation: `yarn lint` and `yarn build` clean; serial suite all green with
no skips and the four Redis session suites run: deed-poll-api-client 1110, deed-poll 1479, app 2713, express-govuk-starter 132,
cloud-native-platform 156, express-session-postgres 85, simple-router 45, express-session-redis 7.

**Task 2, 2026-10-24.** Domain: `libs/deed-poll/src/document-viewer/view.ts` builds `DocumentViewerContext` from the one
case or referral read (`buildCaseViewerContext`: the case's `hasFile` documents with `displayReference`;
`buildReferralViewerContext`: `application.documents`, `caseReference` always `null`), in api's order, with
position/total/previous/next and a format key per allowed MIME (`null` otherwise). An unknown or file-less selection
throws `NotFoundError` with a fixed message naming no id. Previews: `previewDocument` (documents service) and
`previewReferralDocument` (judicial service) go through a new `callPreviewApi` seam beside `callApi`, which maps api's
four refusal codes to `DocumentPreviewRefusedError(code, retryAfterSeconds)`, everything else through `callApi`'s
mapping, and passes an optional caller `AbortSignal`; no pre-read, no download fallback. App:
`src/document-viewer/context.ts` builds scope base/return paths with `casePath`/`referralPath` (fixed `#documents`
anchor, no `returnTo`) and `/view`, `/preview`, `/download` paths through `pathSegment`; a route must call
`caseViewerScope`/`referralViewerScope` and `documentPaths` before any read. The judicial referral page has no
`#documents` id yet; Task 6 adds it with the entry points. Validation: lint and build clean; serial suite green, no
skips, Redis suites ran: deed-poll-api-client 1110, deed-poll 1517, app 2733, express-govuk-starter 132,
cloud-native-platform 156, express-session-postgres 85, simple-router 45, express-session-redis 7.

**Task 3, 2026-10-24.** Routes: `view`, `preview` and `download` under both `deed-polls/[id]/documents/[documentId]/` and
`judicial/referrals/[referralId]/documents/[documentId]/`; legacy `file.ts` routes untouched. Each builds its paths with
`caseViewerScope`/`referralViewerScope` + `documentPaths` before any read. Shell: `src/document-viewer/page.ts`
(`showViewer`) renders `src/pages/document-viewer.njk` (extends `app-full-width.njk`) from one case or referral read, with
`en`/`cy` from `src/document-viewer/content.ts` (`cy` mirrors `en` until Task 6 adds the module to extraction). The
selector is a GET form back to the current view; `?document=` 303-redirects only to a document in the context, and
anything else (forged id, URL, array, object) is the fixed `NotFoundError`. Page/zoom/rotate controls and thumbnails are
rendered hidden and disabled for Task 4/5; the status region carries the no-JS sentence and the renderer's fixed
messages travel as `data-message-*`. The shell carries the preview URL only as `data-preview-url`: no `src`, preload or
embed, and its handler calls no preview or download. Preview relay (`src/document-viewer/preview-response.ts`): fixed
`attachment; filename="preview.pdf"`, `default-src 'none'; sandbox`, nosniff, no-store and api's length, whatever api
sent; api's four refusals keep their status (422/422/503/429 + `Retry-After`) as JSON `{ code }`; a 404 on either scope is
`{ code: "DOCUMENT_UNAVAILABLE" }`, never the referral-unavailable page; 401/403/timeouts go to `domainErrorHandler`; an
unfinished response close aborts the api read. Download: `sendDownload` in `src/document-response.ts` forces
`attachment` keeping api's filename, type and policy. Judicial view: a referral 404 is the existing unavailable page, a
document absent from a visible referral is the shared 404. `src/document-viewer/routes.test.ts` drives all six routes
through the real `requireAuth`, `requireJudicial` and `domainErrorHandler` over HTTP. Validation: lint and build clean;
serial suite green, no skips, Redis suites ran: deed-poll-api-client 1110, deed-poll 1517, app 2827,
express-govuk-starter 132, cloud-native-platform 156, express-session-postgres 85, simple-router 45, express-session-redis 7.

**Task 4, 2026-10-24.** PDF.js: `pdfjs-dist` 6.4.299 (latest, Apache-2.0, published 2026-10-03; no advisory in `yarn npm
audit`), exact pin, a **devDependency** because vite bundles it, so `yarn workspaces focus --production` leaves it and its
optional native `@napi-rs/canvas` out of the image. The **legacy** build is used in the browser and in the Node tests
alike: the modern build needs `Uint8Array.prototype.toHex` and refuses to load under Node 24, and one build in both
places means the tests parse with the code that ships. Worker: `pdf.worker.min.mjs?url`, a hashed same-origin asset
(`dist/assets/assets/pdf.worker.min-<hash>.mjs`); `experimental.renderBuiltUrl: relative` in `vite.build.ts` was needed
because the default base produced `/assets/pdf.worker…`, a 404 that the dev middleware hid. Data: `standard_fonts/`,
`cmaps/` and only the two `*_nowasm_fallback.js` decoders are copied to `dist/assets/pdfjs/` (`PDFJS_ASSET_PATH`);
`src/document-viewer/pdfjs-assets.ts` serves the same paths in development. **`useWasm: false`**: PDF.js 6 decodes
CCITT/JBIG2 and JPX through WebAssembly, which would need `'wasm-unsafe-eval'`; the JS fallbacks need nothing, so the
CSP is unchanged (no helmet edit, `src/analytics.test.ts` untouched). Options: no range/stream/auto-fetch, XFA off, no
annotation layer (links and fields inert, appearances drawn), no scripting manager, `maxImageSize` 64 MP, password
PDFs refused as damaged. Renderer (`src/assets/js/document-viewer/`): `fetch-preview` (Accept PDF, `redirect: manual`,
`data-max-bytes` checked on the declared length and while streaming, statuses/codes to fixed message keys),
`pdf-document` (`numPages` read on open, over `data-max-pages` destroyed before any page), `preview-loader`
(generations: abort, destroy, `stale`), `page-geometry` (canvas ≤ 16.7 MP, density lowered rather than refused),
`render-page` (cancellable canvas + PDF.js `TextLayer`, `release` zeroes the canvas and cleans the page), `thumbnails`
(lazy via IntersectionObserver, one at a time, ≤ 40,000 px each), `viewer` (fit width, teardown on `pagehide`, reload
on a back-forward restore). `index.ts` imports it dynamically only where the viewer exists, so no other page loads
PDF.js. Page and document controls stay Task 5's. Tests: 45 renderer tests with real generated PDFs
(`test-pdfs.ts`: page counts 1/3/100/101, portrait/landscape sizes, `/Rotate 90`, text and empty text, script + link +
form field not executed, garbage/truncated/empty, abort, closed document, stale generations); `pdfjs-assets.test.ts`
pins the paths, the refusal of `.wasm`/`quickjs`, the pin and the fallback names against the worker. Browser
(throwaway Playwright script, isolated mock :3218, app :3318, Redis db 3, cached Chromium 1243 symlinked as 1248 per
the note above), against both the vite middleware and the built `dist` (`VITE_MIDDLEWARE=false`): PDF (3 pages, text
layer "Statutory declaration page 1"), landscape PDF, 4-frame TIFF and 3-page DOCX previews drew page 1 at the frame's
width with every thumbnail; 101 pages showed the too-large sentence, a damaged PDF and `preview-converter-unavailable`
DOCX the unavailable one, `preview-busy` the busy one; a navigation mid-load ended on the second document; a real
dedicated worker ran from the hashed URL; a CCITT G4 image decoded through `jbig2_nowasm_fallback.js` (200) and drew;
no `securitypolicyviolation`. Two pre-existing build defects seen, not changed: GOV.UK fonts and crest are copied to
`dist/assets/{fonts,images}/node_modules/…` (404 at `/assets/fonts/…` in a built run) and the layout requests
`/@vite/client` without the middleware. Validation: lint and build clean; serial suite green, no skips, Redis suites
ran: deed-poll-api-client 1110, deed-poll 1517, app 2878, express-govuk-starter 132, cloud-native-platform 156,
express-session-postgres 85, simple-router 45, express-session-redis 7.

**Task 5, 2026-10-24.** Controls live in `src/assets/js/document-viewer/viewer.ts`, and every rule they obey is in the
DOM-free `presentation.ts` (61 tests): page clamping and a digits-only page jump (` 2 ` accepted; `2.5`, `1e0`,
full-width digits and pages outside 1..N refused and the input restored), 25–300% zoom stepping to the next whole ten
from whatever a fit gave, fit width / fit whole page (both clamped to the same range), quarter turns on top of the
page's own `/Rotate`, the URL fragment (`#page=2&zoom=width|page|NN&rotate=0|90|180|270`, accepted only in exactly that
shape and clamped once the real page count is known) and the history-state map. **Documents switch in place**:
the selector form is intercepted and the no-JS neighbour links (`data-viewer-no-js`) are swapped for previous/next
document buttons that are disabled at either end. Each `<option>` carries that document's server-built view, preview
and download paths, format and "Document N of M" words, so the client composes no path. A switch updates the heading,
`<title>`, format, download link and form action, empties the frame, then replaces the history entry's URL and loads
the new preview through the existing generation loader. History never gains an entry. Per-document page/zoom/rotation
lives in memory and in `history.state` as `[id, fragment]` pairs only, and in the open document's fragment, so a reload,
a bookmark and browser Back from the case all restore it, and each tab keeps its own. Nothing is in local/session
storage. **Opener position:** `Referrer-Policy: no-referrer` means the viewer cannot know its opener, so it does not
guess. The return link stays the concrete `#documents` path, and ordinary browser Back restores the opener's scroll,
because switching never adds history. Thumbnails are now buttons marked `aria-current="page"` (bold text and a 4px border,
not colour alone). Page changes are announced in a visually hidden live region ("Page 2 of 3"), document changes as
"name. Document N of M". A control disabled by its own press (last page, zoom limit, last document) hands focus to its
partner, or to the `tabindex="-1"` heading. A fit redraws on a frame resize (`ResizeObserver`, `scrollbar-gutter:
stable` against a scrollbar feedback loop) and on a device-pixel-ratio change (re-armed `matchMedia`). Content gained
`pageTotal` / `pageStatus` with `{total}`/`{page}` placeholders (`cy` still mirrors `en`, Task 6). Styles
(`_document-viewer.scss`): toolbar groups after the prototype, sticky from the tablet breakpoint; below it buttons keep
their own width (GOV.UK makes them full width, which stacked twelve controls into a 480px sticky bar), the toolbar
scrolls away, the frame is 55vh so toolbar and frame fit on screen together, and thumbnails start hidden (beside them a
fitted page hit the 25% floor at 320px). The page frame is `tabindex="0"` so it scrolls from the keyboard.
`src/assets/**` is excluded from `tsconfig.app.json`, so `yarn build` does not typecheck the client. The viewer
modules were typechecked separately with a throwaway DOM-lib tsconfig: clean apart from the test files' Node imports.
Browser (throwaway Playwright script, not committed; isolated mock :3218, app :3318 on Redis db 3, cached Chromium
1248 symlink from Task 4): 37 checks passed against real PDF.js. They covered page buttons and boundaries, keyboard
focus hand-off, refused jumps, thumbnails, zoom stepping and both limits, fit whole page inside the frame height, rotation
of canvas and text layer, in-place switching with no old page under the new heading and an unchanged `history.length`,
restore on return to a document, reload, the selector to a four-frame TIFF, a one-page PNG with all page controls disabled,
fragment clamping and malformed-fragment rejection, a damaged preview disabling the controls, and rapid switching past
two held previews ending on the last document only. They also covered the `#documents` return link, browser Back
restoring zoom, 320px / 640×450 (200%) / 1024px layouts (no control off screen, no sideways scroll, sticky or fitting
toolbar, thumbnail toggle), Tab order through the toolbar to the frame, and no CSP violations or console errors.
Validation: lint and build clean; serial suite green, no skips, Redis suites ran: deed-poll-api-client 1110, deed-poll
1517, app 2946, express-govuk-starter 132, cloud-native-platform 156, express-session-postgres 85, simple-router 45,
express-session-redis 7.

**Task 6, 2026-10-24.** Inventory: still exactly two document links (case details' documents tab and the judicial
referral's document list); generated deeds are rows in the same supporting-documents list, so they are covered by
it. Correspondence previews are not file previews. Both now open the scoped viewer, with the paths built in the handler
by `caseViewerScope`/`referralViewerScope` + `documentPaths` (`viewHref` on the case page, `href` on the referral).
**Download original** stays in the viewer as a direct attachment link, and the legacy `/file` routes are unchanged for
existing consumers. The referral page's documents heading gained `id="documents"`, which the viewer's return link
already named; the case page's tab panel already had it. Welsh: `src/document-viewer` is on the extractor's
`INCLUDE`, `cy` keeps the repo's `{ ...en }` mirror, and the script gained `--out=<file>` so
`src/welsh-extractor.test.ts` can compare every key of the viewer's `en` with the extracted rows (49, the
"Document N of M" function and both `{page}`/`{total}` sentences included) without writing the tracked CSV.
`welsh:check` baseline 743 strings / 525 identical, now 792 / 574: exactly the 49 viewer strings, all awaiting
translation. `.business_context/welsh-translation-request.csv` was regenerated. That also brought in rows other
features had changed without re-running the extractor (6 rows gone, the rest new). Failure states: the renderer shows
**Try again** beside `busy` and `failed` (a timeout, api down or a 5xx relay answer), and **Sign in again** (a link to
the document's own view, so `requireAuth` sends the reader through sign-in and back) beside `signedOut`. Neither
action appears for `unavailable`, `tooLarge` or `forbidden`, which another request would not change. The selector,
the document buttons and the return link stay usable in every state, and the page total is empty whenever no
preview is open, so no count is ever invented. A preview 404 is the document-unavailable sentence and a lost
referral on the view is the existing unavailable page (both pinned in Task 3). New route tests over HTTP: a preview
403 answers 403 on the 404 view, a 401 signs out on `errors/401`, and a timeout reaches the fault handler as a 500,
never `DOCUMENT_UNAVAILABLE`. Logs: `callPreviewApi` now replaces api's message with
`document preview failed (<kind> <status>)` and drops field errors, because api's error prose (a converter's words,
a file name) otherwise reached `forbidden:` and 500 log lines. Pinned in `documents/service.test.ts`. No viewer route or
relay logs anything itself. `src/assets/js/document-viewer/viewer.test.ts` scans the renderer sources: no
`/session/` request, keep-alive or timer, no storage or cookie API, no `console`/`trackEvent`/`sendBeacon`, and a
`pagehide` teardown, which logout and a persona switch both trigger by navigating away. The session warning still
renders on the viewer (template test with a `sessionClock`). The no-JS path is the plain links, the GET selector and the
download link (template and route tests from Task 3). Viewer client typechecked separately (throwaway DOM tsconfig):
clean. Validation: lint and build clean; serial suite green, no skips, Redis suites ran: deed-poll-api-client 1110,
deed-poll 1520, app 2973, express-govuk-starter 132, cloud-native-platform 156, express-session-postgres 85,
simple-router 45, express-session-redis 7.

## Post-Completion

Review/merge the API first and provision its approved conversion endpoint/credentials through the appropriate
infrastructure repositories. In AAT use synthetic documents of every allowed type, including a genuine
multi-page TIFF and court-generated DOCX. Check Word pagination/fonts visually, original download equality,
staff/judicial denial, separate API replicas, and converter outage/cancellation. No embedded credentials,
new public sharing or deployment is authorized by authoring these plans. Confirm Welsh wording with the
language owner and perform human keyboard/screen-reader acceptance. Deploy admin after the API and converter
acceptance, then exercise both UI entry points. Keep publication/merging/deployment separate from local
Ralphex execution. Move this plan to `docs/plans/completed/` after implementation and review.
