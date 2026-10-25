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

- [ ] Record the execution baseline in the execution notes.
- [ ] Add the failing tests from the Development Approach, then narrow the patch and remove `stopAtErrors`. Run the
      red check against the unpatched package, focused tests and all Validation Commands, and record the results.

### Task 2: Record and hand off

**Files:** `CLAUDE.md`, `docs/pdfjs-render-error-upstream-issue.md`, `README.md`/`docs/DEPLOYMENT.md` where they
describe the viewer states, this plan.

- [ ] Update the docs as described. Run `yarn test:document-viewer`, `yarn welsh:check` and all Validation Commands;
      record final commits and counts, and hand off to the Ralphex review phases.

## Acceptance Criteria

- An oversized image, in page content or in an annotation appearance, fails that page's render and shows the per-page
  state; the next page renders.
- Broken fonts and malformed ToUnicode render with PDF.js's fallback, with no per-page state and no text lost.
- `stopAtErrors` is off; the guard tests still fail against the unpatched package.
- All Validation Commands, `yarn test:document-viewer` and the extractor pass, with no new failures or skips.

## Execution notes

(Record baseline, red/green evidence and final results here.)

## Post-Completion

Publishing, merging and deployment are separate from this plan. Filing the upstream issue remains Steve's decision.
