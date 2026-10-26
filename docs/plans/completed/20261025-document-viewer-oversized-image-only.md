# Plan: fail a page only for an oversized image, and keep PDF.js's other fallbacks

## Overview

A focused Copilot review of the incomplete-page fix (`docs/plans/completed/20261025-document-viewer-incomplete-pages.md`;
workspace `local-notes/deed-poll-admin/document-viewer-incomplete-review.jsonl`) found two **MEDIUM** defects, both
caused by turning on PDF.js's `stopAtErrors`:

1. **Broken fonts now lose text silently.** With `stopAtErrors`, an empty or broken `FontFile` or a malformed
   `ToUnicode` makes `loadFont` (`legacy/build/pdf.worker.mjs` ≈40655-40661) resolve an `ErrorFont` whose
   `charsToGlyphs()` returns `[]`. The page renders "successfully" with that text missing. Before, PDF.js fell back
   to a substitute font or mapping and the text showed.
2. **An oversized image inside an annotation appearance still vanishes.** The annotation evaluator rejects under
   `stopAtErrors`, but the catch at `pdf.worker.mjs` ≈65339-65345 replaces that annotation's whole operator list
   with `null`, and the page completes. With `AnnotationMode.ENABLE`, a stamp or signature appearance holding an
   oversized image disappears without the per-page message.

**Decision (Steve's option 1 of 2026-10-25, narrowed on Arbor's recommendation):** `stopAtErrors` is too blunt,
because it changes PDF.js's handling of many unrelated errors. Instead:

- **Turn `stopAtErrors` off again**, so fonts, ToUnicode, colour spaces, shadings, patterns, ExtGState and text
  content keep PDF.js's normal fallbacks exactly as before the incomplete-page fix.
- **Patch the worker's image-size check** (`buildPaintImageXObject`, ≈40137) so an image whose declared
  `/Width × /Height` exceeds `maxImageSize` **always** throws one dedicated, recognisable error (for example a
  subclass or a fixed message the display side can identify), whatever `ignoreErrors` says. That is the only
  behaviour that changes.
- **Patch the annotation operator-list catch** (≈65339-65345) so that dedicated error is rethrown instead of the
  annotation being replaced by `null`; any other annotation error keeps today's behaviour.
- **Keep the existing display-layer patch** in `PDFPageProxy._pumpOperatorList`, so that error makes the page's
  render reject and the viewer shows its per-page "could not be shown in full, download the original" state.
- Update the patch in `.yarn/patches/` (same version, 6.4.299), in **both** the legacy and modern builds the app and
  its tests load, worker included. Keep each hunk minimal and commented with a pointer to the upstream issue draft.
  Update `docs/pdfjs-render-error-upstream-issue.md` to describe the narrowed behaviour.

## Context

Branch `feat/full-page-document-viewer`. Read `CLAUDE.md`'s "Document viewer" section and both completed viewer
plans first. Files: `.yarn/patches/pdfjs-dist-npm-6.4.299-98d54b4097.patch` (regenerate it with `yarn patch` /
`yarn patch-commit` rather than hand-editing), `src/assets/js/document-viewer/pdf-document.ts` and its tests,
`render-page.ts`, `thumbnails.ts`, the test PDF builder (`test-pdfs.ts`) and fixtures. Record the execution baseline
(this branch's HEAD) for Ralphex review.

## Development Approach

1. **Tests first, with real generated PDFs** (reproducible, small on disk, with provenance):
   - main-content oversized image: the page render rejects with the dedicated error, the viewer shows the per-page
     state, and the next page renders;
   - **an oversized image inside an annotation appearance** (for example a `/Stamp` annotation whose `/AP /N` form
     XObject paints a 9,000 × 9,000 image), rendered with the annotation mode the viewer uses: same per-page state;
   - **a page with a broken embedded font** (an empty or truncated `FontFile2`) and one with a malformed `ToUnicode`:
     the page renders **without** the per-page state and its text still draws through PDF.js's fallback, exactly as
     on unpatched `pdfjs-dist` with `stopAtErrors` off (assert the operator list carries the text-showing operators,
     or compare against the unpatched baseline);
   - the existing guard tests still fail against the unpatched package (record the red run: reverse the patch in
     `node_modules`, run, re-apply).
2. Remove `stopAtErrors: true` from `pdf-document.ts` and any comment or doc that depends on it; keep `maxImageSize`,
   `isEvalSupported: false` and every other option.
3. Confirm in the 6.4.299 source (read-only) that no other path catches the dedicated error and completes the page
   silently (for example form XObjects, patterns or type3 glyphs that paint an image); patch or test any you find,
   recording what you checked.
4. **Docs:** `CLAUDE.md`'s "Document viewer" section and the plan-linked docs say the viewer fails a page only for an
   oversized image, keeps PDF.js's other fallbacks, and why `stopAtErrors` is deliberately off. Reference this plan by
   its `docs/plans/completed/` path.
5. **Out of scope:** api, other viewer states, the 100-page limit, the prototype, `pdfjs-dist`'s version, anything
   outside the viewer. No new dependency. Local task commits; publishing is separate.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

At the end also run `yarn test:document-viewer` (its own ports, 3219 and 3319, Redis database 4) and `yarn welsh:check`
(exits 1 by design; record its counts). Never flush Redis: it is shared. Record actual counts, failures and skips. Run
every build and test command in the foreground and wait for it: a backgrounded build ends the session and the next one
builds over it. `npx playwright install` cannot download here; the cached `chromium-1243` is already symlinked as
`chromium-1248`. Do not try to download a browser.

## Implementation Steps

### Task 1: Narrow the patch and turn stopAtErrors off

**Files:** `.yarn/patches/…`, `package.json`/`yarn.lock` if `yarn patch-commit` rewrites them,
`src/assets/js/document-viewer/pdf-document.ts`, `render-page.ts`, `thumbnails.ts`, their tests, `test-pdfs.ts`,
fixtures.

- [x] Record the execution baseline in the execution notes.
- [x] Add the failing tests from the Development Approach, then narrow the patch and remove `stopAtErrors`. Run the
      red check against the unpatched package, focused tests and all Validation Commands, and record the results.

### Task 2: Record and hand off

**Files:** `CLAUDE.md`, `docs/pdfjs-render-error-upstream-issue.md`, `README.md`/`docs/DEPLOYMENT.md` where they
describe the viewer states, this plan.

- [x] Update the docs as described. Run `yarn test:document-viewer`, `yarn welsh:check` and all Validation Commands;
      record final commits and counts, and hand off to the Ralphex review phases.

## Acceptance Criteria

- An oversized image, in page content or in an annotation appearance, fails that page's render and shows the per-page
  state; the next page renders.
- Broken fonts and malformed ToUnicode render with PDF.js's fallback, with no per-page state and no text lost.
- `stopAtErrors` is off; the guard tests still fail against the unpatched package.
- All Validation Commands, `yarn test:document-viewer` and the extractor pass, with no new failures or skips.

## Execution notes

**Baseline:** `4f989fb160fa78e7548f9a91394920e529ee551d` (this branch's HEAD before Task 1).

**Task 1.**

- Fixtures (`test-pdfs.ts`, generated at test time, nothing on disk): `stamp` (a `/Stamp` annotation whose `/AP /N`
  form XObject paints an image of the given declared size) and `font` (`emptyFontFile`: a TrueType font whose
  `FontFile2` has no bytes; `malformedToUnicode`: Helvetica with a ToUnicode stream that `usecmap`s a CMap that does
  not exist). `OBJECTS_PER_PAGE` went from 3 to 9, `null` where a page has no stamp or font.
- Red before any change (old patch, `stopAtErrors: true`): `pdf-document.test.ts` 3 failed / 17 passed. The stamp
  page resolved instead of rejecting, and both broken-font pages drew 0 of 14 glyphs. Both review defects reproduced.
- With `stopAtErrors` removed and the old patch: both font tests passed; the 5 oversize tests failed, because
  PDF.js's default `ignoreErrors` swallows the size check.
- Worker patch (legacy and modern `pdf.worker.mjs`): a top-level `class ImageTooLargeError extends Error {}`;
  `buildPaintImageXObject` always throws it for `w * h > maxImageSize`; it is rethrown, not ignored, at the five
  catches it can pass through: the XObject `Do` catch, `getOperatorList`'s outer catch (inline images and nested form
  XObjects), `handleTilingType` (images in a tiling pattern), the ExtGState catch (an SMask's form) and the
  annotation operator-list catch. The display-side `_pumpOperatorList` hunk is unchanged apart from its comment.
- **The browser now loads the unminified worker** (`viewer.ts`: `pdf.worker.mjs?url`, was `pdf.worker.min.mjs?url`).
  The minified workers are a few lines of hundreds of kilobytes each, so patching them made a 4.5 MB patch file.
  Now the browser runs the same file the Node tests do, which the old arrangement did not guarantee. Cost: 2.42 MB
  against 1.32 MB raw, 514 KB against 392 KB gzipped, for one cached same-origin asset.
  `pdfjs-assets.test.ts` pins the import and that the file carries the patch. The built
  `dist/assets/assets/pdf.worker-<hash>.mjs` contains `ImageTooLargeError` (7 occurrences). The `.min.mjs` files are
  unpatched and unused.
- Patch regenerated with `yarn patch pdfjs-dist@npm:6.4.299` (original package) plus the old hunks, then
  `yarn patch-commit`. Same file name, 9.8 KB; `package.json` unchanged; `yarn.lock` updated the resolution hash.
  (`yarn patch --update` stacks a second patch over the first, so it was not used.)
- Source check (6.4.299 legacy worker, read-only): every `ignoreErrors` catch was read. Fonts, ToUnicode,
  CIDToGIDMap, encodings, colour spaces, shadings, marked content, text content, sub-streams and font paths cannot
  carry an image error and keep their fallbacks. **One gap is left, and it is unchanged by this plan:**
  `loadType3Data` evaluates each Type3 glyph with `ignoreErrors: false` and catches every error into an empty glyph,
  and `loadFont` then wraps a Type3 load error in a plain `Error` and resolves an `ErrorFont`. So an oversized image
  inside a Type3 glyph procedure is dropped silently, with or without `stopAtErrors`, as before. Not patched: it
  would take two more hunks for a construct no scanner or converter produces. The stamp test covers the nested-form
  path; the tiling-pattern and SMask rethrows are patched but not covered by a fixture.
- Red against the unpatched package (patch reversed in `node_modules/pdfjs-dist` with `patch -R`, then re-applied):
  `pdf-document`, `render-page` and `pdfjs-assets` tests: 7 failed / 27 passed. The failures were every oversize
  guard (main content, stamp, repeat renders, `renderPage`'s incomplete states) and the worker-import guard. The
  broken-font tests pass unpatched, as they should: they pin the absence of `stopAtErrors`.
- Green: viewer and asset suites 229 passed; `yarn lint` clean (576 files); `yarn build` 8/8 tasks;
  `yarn turbo test test:app --concurrency=1 --force` with `REDIS_URL` set: 8/8 tasks, 0 failed, 0 skipped (app
  148 files / 3006 tests; deed-poll 1520; api-client 1112; cloud-native-platform 156; express-govuk-starter 132;
  express-session-postgres 85; simple-router 45; express-session-redis 7).

**Task 2.**

- Docs: `CLAUDE.md`'s "Document viewer" bullet on the patch now says only an oversized image fails a page, lists the
  catches the worker patch rethrows at, why `stopAtErrors` is deliberately off, the unminified worker, `yarn patch` on
  the original package rather than `--update`, and the Type3 gap. `README.md`'s incomplete-page entry names the
  oversized image (page content or a stamp/signature) as the only trigger and links both plans.
  `docs/DEPLOYMENT.md`'s Assets entry notes the unminified worker's size. `docs/pdfjs-render-error-upstream-issue.md`
  now describes the two-part patch: the worker hunks are downstream only, and the issue itself (display side,
  reproduced with upstream `stopAtErrors`) is unchanged. Still not filed.
- `yarn lint` clean (576 files); `yarn build` 8/8; `yarn turbo test test:app --concurrency=1 --force` with
  `REDIS_URL` set: 8/8 tasks, 0 failed, 0 skipped (app 148 files / 3006 tests; deed-poll 1520; api-client 1112;
  cloud-native-platform 156; express-govuk-starter 132; express-session-postgres 85; simple-router 45;
  express-session-redis 7).
- `yarn test:document-viewer`: 2 passed (caseworker and judge journeys), 0 skipped. Only GOV.UK Frontend's
  `mid-grey` deprecation warnings in the web-server output.
- `yarn welsh:check`: 793 strings, 575 still identical in cy (568 prose, 7 not prose), unchanged by this plan.
- Final commits: `c14cd8d` (Task 1) and this task's docs commit. Ready for the Ralphex review phases.

## Post-Completion

Publishing, merging and deployment are separate from this plan. Filing the upstream issue remains Steve's decision.
