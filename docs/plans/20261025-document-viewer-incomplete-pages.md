# Plan: a page PDF.js cannot draw in full says so, rather than showing part of it

## Overview

A direct Copilot review of the full-page document viewer (`docs/plans/completed/20261023-full-page-document-viewer.md`;
workspace `local-notes/deed-poll-admin/document-viewer-direct-review.jsonl`) found one **MEDIUM** defect and otherwise
no issues:

- `src/assets/js/document-viewer/pdf-document.ts` sets PDF.js's `maxImageSize` (64 megapixels) but not
  `stopAtErrors`, and logging is silenced (`verbosity: 0`). PDF.js 6.4.299 then **silently drops** any embedded image
  over the limit and draws the rest of the page. A valid PDF of a large high-resolution scan can show a judge or
  caseworker a blank or partial page as if it were complete, with no unavailable state and no prompt to download the
  original. For evidence, that is worse than an error.

**Decision (Steve, 2026-10-25, on Arbor's recommendation):** set `stopAtErrors: true`, so a page PDF.js cannot render
completely fails loudly, and show a fixed, localized per-page message such as "This page could not be shown in full.
Download the original to see it." with **Download original** available. Other pages of the same document stay
viewable. Do not remove `maxImageSize` (that would push unbounded decoded images into the browser's memory).

## Decision 2 (Steve, 2026-10-25): patch pdfjs-dist's display layer

Task 1's first attempt found that `stopAtErrors` alone does not make a render reject in `pdfjs-dist` 6.4.299: the
display side completes the render successfully with a truncated operator list, which is worse than today (see the
Task 1 notes below). Steve chose **option 1**:

- **Patch `pdfjs-dist` with `yarn patch`, same version (6.4.299).** In `PDFPageProxy._pumpOperatorList`'s error
  path, when `reason` is not an `AbortException` (or `RenderingCancelledException`), fail each pending render task
  with it (`internalRenderTask.callback(reason)`, or the equivalent the source supports) instead of completing it, in
  **both** the legacy and modern builds the app or its tests load. Keep the patch minimal and commented with a link to
  the upstream issue text. Commit the `.yarn/patches/` file and the `package.json`/`yarn.lock` resolution Yarn writes.
  This plan's "no new dependency" stands; the "do not touch `pdfjs-dist`" rule is lifted for this patch only.
- **A guard test** that fails if the patch is lost, for example after a Renovate bump that changes the version and so
  drops the patch: load the oversized-image fixture with the real `pdfjs-dist` under `stopAtErrors` and assert the page
  render **rejects** (and page 2 still renders). It must fail against the unpatched package.
- **Renovate:** add a `.github/renovate.json` package rule for `pdfjs-dist` so a bump is not automerged, with a
  description saying the patch must be re-applied or dropped once upstream fixes the swallowed error.
- **Upstream issue text, drafted not filed:** write it to `docs/pdfjs-render-error-upstream-issue.md` (title, version,
  minimal reproduction using the fixture, the source locations from the Task 1 notes, expected vs actual). Filing it
  on GitHub is an external action Steve takes or approves separately.
- Then implement the per-page state as the Development Approach describes, on top of the patched behaviour.

## Context

Branch `feat/full-page-document-viewer`. Read `CLAUDE.md`, `.claude/rules/frontend.md`, `testing.md`,
`e2e-testing.md` and the completed viewer plan's Decisions section first (in particular decision 7, the 100-page
limit, and decision 3, the unavailable state with **Download original**). Files:
`src/assets/js/document-viewer/pdf-document.ts` and the renderer modules beside it, their tests, the shared viewer
content (`src/document-viewer/content.ts`), the template, the Welsh extractor scope, and the browser fixtures. Record
the execution baseline (this branch's HEAD) for Ralphex review.

## Development Approach

1. **Fail loudly.** Pass `stopAtErrors: true` in the PDF.js document options, keeping `maxImageSize`,
   `isEvalSupported: false`, the disabled scripting/XFA/range settings and every other existing option. Confirm in
   the installed `pdfjs-dist` 6.4.299 source (read-only) which errors `stopAtErrors` turns from "skip and continue"
   into a rejected render, and that an oversized image is one of them. Record the evidence in the execution notes.
2. **A per-page state, not a document failure.** A page render (or thumbnail render) that rejects because of this
   shows a fixed, localized message in place of that page, says the page could not be shown in full, and offers
   **Download original** (the existing scoped download link). Page navigation, thumbnails for other pages, zoom and
   document switching keep working. Never leave a partially drawn canvas visible: clear it. Announce the state through
   the existing live status region. A thumbnail that fails shows a neutral placeholder, not a partial image.
3. **Distinguish it from the existing states:** a preview that cannot load at all (api refusal, damaged PDF, over 100
   pages) keeps its existing document-level unavailable state. This new state is for a document that loads but has a
   page that cannot be drawn completely.
4. **Welsh:** the new sentence(s) live in the shared viewer content module as an `en`/`cy` pair, with the `cy`
   copy in English (never write Welsh), and must be picked up by `scripts/extract-welsh-strings.mjs`; `yarn welsh:check`
   must change only by the new strings.
5. **Tests first, with real bytes:**
   - a renderer test with a real generated PDF whose page embeds an image over `maxImageSize` (generated reproducibly,
     kept small on disk, with provenance like the existing fixtures). It must show the page-level state and no drawn
     page, while another page of the same document renders;
   - a browser check in the existing `document-viewer.spec.ts` journeys (not a new journey): open such a document,
     see the page-level message and **Download original**, move to another page and see it render. Run it through
     `yarn test:document-viewer`.
6. **Out of scope:** api, the 100-page limit, the other viewer states, the prototype, `pdfjs-dist`'s version, and
   anything outside the viewer. No new dependency. Local task commits; publishing is separate.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

At the end also run `yarn test:document-viewer` (its own ports, 3219 and 3319, and Redis database 4) and
`yarn welsh:check` (exits 1 by design; record its counts).

Use installed dependencies and local Redis. Never flush Redis: it is shared. Record actual counts, failures and
skips. Run every build and test command in the foreground and wait for it: a backgrounded build ends the session and
the next one builds over it.

**Browsers in this devcontainer.** `npx playwright install` cannot download here (the proxy answers HTTP 400). The
cached `chromium-1243` is already symlinked as `chromium-1248`. Do not try to download a browser.

## Implementation Steps

### Task 1: stopAtErrors and the per-page state

**Files:** `src/assets/js/document-viewer/pdf-document.ts`, the page/thumbnail renderer modules, their tests,
`src/document-viewer/content.ts`, the viewer template, fixtures.

- [x] Record the execution baseline in the execution notes.
- [x] Add the failing renderer test with the oversized-image fixture, then implement. Run focused tests and all
      Validation Commands, and record the results.

### Task 2: Browser evidence and hand off

**Files:** `e2e-tests/tests/document-viewer.spec.ts`, mock preview fixtures, `README.md`/`docs/DEPLOYMENT.md` where
they describe viewer states, this plan.

- [x] Extend the existing journeys as described, run `yarn test:document-viewer` and `yarn welsh:check`, and record
      both. Document the new state beside the existing ones. **Reference this plan by its `docs/plans/completed/`
      path**, since that is where it will be once the run ends.
- [x] Run all Validation Commands; record final commits and counts, and hand off to the Ralphex review phases.

## Acceptance Criteria

- An embedded image over `maxImageSize` never results in a silently partial page: that page shows the localized
  "could not be shown in full" state with **Download original**, and other pages still render.
- All Validation Commands, `yarn test:document-viewer` and the extractor pass, with no new failures or skips.

## Execution notes

(Record baseline, red/green evidence and final results here.)

**Baseline:** `105e58ce3c7892d00dcffb59a468c7d2509c56da` (`docs: link the completed viewer plan from CLAUDE.md`).

**Task 1 blocked (2026-10-25): `stopAtErrors` does not make a render reject in `pdfjs-dist` 6.4.299, so the plan's
mechanism does not work as written. Nothing was committed apart from these notes; a decision is needed.**

What the worker does is as the plan assumed. `buildPaintImageXObject` (`legacy/build/pdf.worker.mjs` ≈40137) weighs
the image's *declared* `/Width × /Height` against `maxImageSize` before reading any of its data. With `ignoreErrors`
(the default, `!stopAtErrors`, `pdf.mjs` 21764) it warns "Image exceeded maximum allowed size and was removed." and
carries on. With `stopAtErrors` it throws, the XObject handler (≈40980) rethrows, and the page's operator list fails
(`sink.error`, ≈71030). The same switch also governs undecodable inline images, colour spaces, shadings, patterns,
ExtGState, font files, ToUnicode, `getTextContent` and sub-streams.

The display side swallows that error. `Page.getOperatorList` sends `StartRenderPage` (≈65298) **before** it
evaluates the content stream, so the render's `displayReadyCapability` has already resolved by then. When the
stream then errors, `PDFPageProxy._pumpOperatorList` (`pdf.mjs` ≈22475) sets `operatorList.lastChunk = true` and calls
`operatorListChanged()` on every render task. That draws what arrived and completes the render **successfully**
(`InternalRenderTask._next` → `callback()` with no error). Only after that does it call
`displayReadyCapability.reject(reason)`, which does nothing on a settled promise. `getOperatorList()` behaves the
same way: its `opListReadCapability` resolves with the truncated list before the reject.

Measured in Node with the plan's fixture: page 1 paints a 9,000-pixel-square image (81 MP) under its text, and page 2
is text only. The image stream is one byte, which is enough because the check reads only the declared size.

| | page 1 ops | page 1 render | page 2 |
|---|---|---|---|
| today (no `stopAtErrors`) | 9 (image dropped, text kept) | resolves | renders |
| `stopAtErrors: true` | **0** (truncated at the image) | **resolves** | renders |

So `stopAtErrors` alone makes the defect **worse**: everything after the first error is dropped too, and the
page still reports success. The viewer cannot tell, because no public API exposes the error.

Options for the decision:

1. **Patch `pdfjs-dist`'s display layer** (`yarn patch`, same version): in `_pumpOperatorList`'s error path, when
   `reason` is not an `AbortException`, fail each render task with it (`internalRenderTask.callback(reason)`)
   instead of completing it. With `stopAtErrors` the page's render then rejects, and the per-page state can be built
   as planned. It is small and testable with this fixture, but it is a patched dependency to carry through every
   Renovate bump, and the plan currently rules out touching `pdfjs-dist`.
2. **Reach into PDF.js internals** (`page._intentStates`, or wrapping `_pumpOperatorList`) to see the error.
   Unpatched, but it relies on private API that can change in any release. Not recommended.
3. **Raise it upstream** and keep today's behaviour until PDF.js rejects the render. The defect stays open
   meanwhile.

Recommendation: option 1, together with an upstream issue so the patch can be dropped later.

**Task 1 done (2026-10-25), on Decision 2.**

- **Fixture.** `test-pdfs.ts` gained `image: [width, height]` on a page: a one-byte `/DeviceGray` image XObject
  declaring that size, painted under the page's text. Generated in the test, nothing checked in. Each page now owns
  three objects (page, content, image or `null`).
- **Red.** With the fixture (page 1: 9,000 square, page 2: text), `pdf-document.test.ts`'s new guard failed with
  "promise resolved instead of rejecting", both before and after adding `stopAtErrors: true`, which confirms the
  Task 1 notes against the unpatched package.
- **Patch.** `yarn patch` on `pdfjs-dist@npm:6.4.299`, applied to `build/pdf.mjs` and `legacy/build/pdf.mjs` (the
  minified builds are not loaded by the app or its tests). In `_pumpOperatorList`'s rejection handler a reason that is
  not an `AbortException` now calls `cancel(reason)` on each `InternalRenderTask` (rejecting its promise and
  releasing the canvas) instead of `operatorListChanged()`. A second red test found that the truncated operator list
  stayed cached in `_intentStates`, so drawing the page again (zoom, rotate, return, or its thumbnail) resolved
  blank; the patch therefore also deletes the failed intent state, so a later render asks the worker again and fails
  again. Committed as `.yarn/patches/pdfjs-dist-npm-6.4.299-98d54b4097.patch` with the `package.json`/`yarn.lock`
  resolution. `.gitignore` now ignores `.yarn/*` except `.yarn/patches/`. `pdfjs-assets.test.ts` pins the
  resolution as the patch protocol over an exact version, and checks that the patch file exists.
- **Renovate.** A `pdfjs-dist` rule with `automerge: false`, its description saying the patch must be re-applied or
  dropped.
- **Upstream text.** `docs/pdfjs-render-error-upstream-issue.md`, drafted, **not filed**.
- **Per-page state.** `stopAtErrors: true` in `pdf-document.ts` (`maxImageSize` and every other option kept).
  `renderPage` answers `incomplete` when the render rejects after the page was read, with the canvas zero-sized and
  the sheet emptied; a page that cannot be read stays `failed` (the document's unavailable state). The viewer
  releases the page, puts `messages.pageIncomplete` in the existing `role="status"` region and shows a new hidden
  `data-viewer-page-download` link (the scoped download path, updated on document switch). It keeps `opened`, so
  page navigation, zoom, rotation, thumbnails and document switching keep working, and the next draw clears the
  state. A thumbnail that is incomplete gets a grey `app-document-viewer__thumbnail-placeholder`.
- **Tests.** `render-page.test.ts` (new) drives `renderPage` against real PDF.js and the fixture with a minimal DOM
  stand-in whose canvas is PDF.js's Node canvas: ordinary page rendered, oversized page `incomplete` with a 0×0 canvas
  and empty sheet, the next page still rendered, the same page `incomplete` again when redrawn, a missing page
  `failed`. Two of its tests fail with the pre-change `render-page.ts`. `pdf-document.test.ts`: oversized render
  rejects and page 2 renders; repeated and concurrent renders of the page all reject; a 4,960 × 7,016 image (A4 at
  600 dpi) still draws. Content and template tests cover the sentence and the hidden link.
- **Validation.** `yarn lint`: 576 files, no fixes. `yarn build`: 8/8 tasks. `yarn turbo test test:app
  --concurrency=1 --force` with `REDIS_URL=redis://127.0.0.1:6379`: 8/8 tasks; root 148 files / 2,999 tests,
  deed-poll 69 / 1,520, api client 17 / 1,112, starter 12 / 132, cloud-native-platform 13 / 156, session-postgres
  2 / 85, session-redis 1 / 7, simple-router 4 / 45; no failures, no skips. `yarn welsh:check`: 793 strings, 575
  identical in cy (568 prose, 7 not prose), against 792 / 574 / 567 / 7 without the change: exactly the new
  sentence, which is also the one new row in `.business_context/welsh-translation-request.csv`.
- **Not run here:** `yarn test:document-viewer` (Task 2).

**Task 2 done (2026-10-25).**

- **Browser check.** The judge's journey in `e2e-tests/tests/document-viewer.spec.ts` (not a new journey) gained a
  fifth document, "High resolution scan": `testPdf` with page 1 painting a 9,000-pixel-square image (81 MP, over the
  64 MP `maxImageSize`) and page 2 text only. The mock previews a PDF as its stored bytes, so no mock change was
  needed. The journey sees page 1's sentence in the document page region with no canvas and no text layer, a grey
  placeholder for thumbnail 1 and a drawn thumbnail 2, passes axe, downloads the original from the page-level
  **Download original** (bytes and filename), moves to page 2 and sees it drawn with the sentence and link hidden, and
  returns to page 1 through its thumbnail to find it refused again rather than a cached blank page. `expectOriginal`
  takes an optional scope, because on that page two **Download original** links are visible.
- **Red.** With `stopAtErrors: false` (rebuilt, then restored) the judge's journey failed at the sentence
  (`toBeVisible`: element not found) and the caseworker's passed.
- **`yarn test:document-viewer`:** 2 passed, no skips (caseworker 7.3 s, judge 3.2 s).
- **`yarn welsh:check`:** exits 1 by design; 793 strings, 575 identical in cy (568 prose, 7 not prose), the same as
  after Task 1: the browser check adds no strings.
- **Docs.** README's document viewer section has a bullet for the page state beside the existing errors, linking this
  plan's `docs/plans/completed/` path, and its `yarn test:document-viewer` paragraph names the new document.
  `docs/DEPLOYMENT.md` describes no viewer states, so it is unchanged.
- **Validation.** `yarn lint`: 576 files, no fixes. `yarn build`: 8/8 tasks. `yarn turbo test test:app
  --concurrency=1 --force` with `REDIS_URL=redis://127.0.0.1:6379`: 8/8 tasks; root 148 files / 2,999 tests,
  deed-poll 69 / 1,520, api client 17 / 1,112, starter 12 / 132, cloud-native-platform 13 / 156, session-postgres
  2 / 85, session-redis 1 / 7, simple-router 4 / 45; no failures, no skips.
- **Commits.** Baseline `105e58c`; Task 1 `b6ff76b`; Task 2 `e6ac7dc`. Ready for the
  Ralphex review phases.
- **Review phase (2026-10-25).** `b743cb0`: CLAUDE.md records that `stopAtErrors` is the whole of `ignoreErrors` and
  that `@napi-rs/canvas` is an optional dependency, and the patch-resolution check now requires the patch file. The
  next iteration's fixes: a redraw of the same page (resize, zoom, density) no longer re-announces its sentence, a
  failed text layer is documented as incomplete, the overlapping-render guard test renders twice in one tick, the
  browser journey zooms on the incomplete page and checks the next document hides the page-level link, and the
  patch's removal steps are listed in full.

## Post-Completion

Publishing, merging and deployment are separate from this plan. The Welsh language owner confirms the new sentence's
Welsh, together with the `src/locales/cy.ts` aria-label change from the viewer plan.
