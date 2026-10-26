# Draft upstream issue: `stopAtErrors` does not reject `RenderTask.promise`

**Status: drafted, not filed.** Filing it on [mozilla/pdf.js](https://github.com/mozilla/pdf.js/issues) is an external
action for Steve to take or approve. Once it is filed, add its link here. Once a release fixes it, re-apply the patch
to that release with `yarn patch` without the display hunks (`build/pdf.mjs`, `legacy/build/pdf.mjs`). The worker
hunks stay: they are this app's own, below, and dropping the whole patch would bring back an oversized image left out
of a page that reports itself drawn. Only if PDF.js also gains its own way to fail a page for an oversized image can
the patch go entirely, with a plain `pdfjs-dist` version in `package.json` (`yarn install` rewrites `yarn.lock`), and
the patch-resolution and worker-import checks in `src/document-viewer/pdfjs-assets.test.ts`, the `.yarn/patches/`
exception in `.gitignore` and the `pdfjs-dist` rule in `.github/renovate.json` removed with it.

Why this repository carries the patch: the document viewer fails a page whose image is over `maxImageSize`, so that
the page says it could not be shown in full rather than showing itself without the image as if it were complete
(plans `docs/plans/completed/20261025-document-viewer-incomplete-pages.md` and
`docs/plans/completed/20261025-document-viewer-oversized-image-only.md`). It does **not** use `stopAtErrors`: that
option is all of `ignoreErrors`, so it also turned a broken font or ToUnicode map, which PDF.js otherwise draws through
a fallback, into a page with its text missing, and an annotation's error into a silently absent stamp. The patch has
two parts:

- **Worker (downstream only, not part of this issue).** `buildPaintImageXObject` throws a dedicated
  `ImageTooLargeError` for an oversized image whatever `ignoreErrors` says, and the catches it can pass through (the
  XObject `Do`, `getOperatorList`'s outer catch, `handleTilingType`, the ExtGState SMask and the annotation
  operator-list catch) rethrow it instead of ignoring it. An annotation whose appearance fails also resets its streams,
  which PDF.js otherwise does only on success, so drawing the page again does not read an emptied appearance. Every other error keeps PDF.js's fallbacks. An upstream
  equivalent would be an option to treat an oversized image as a page error; it is not proposed here. An oversized
  image inside a Type3 glyph is still dropped, because `loadType3Data` catches every glyph error.
- **Display (the bug below).** Once the worker's operator list fails, the render must reject. Unpatched it resolves,
  which is the issue this draft describes, reproduced with upstream's own `stopAtErrors`.

The guard is `src/assets/js/document-viewer/pdf-document.test.ts`, which fails against the unpatched package. Because
only the unminified workers are patched, the viewer loads `legacy/build/pdf.worker.mjs`, not `pdf.worker.min.mjs`.

---

## Title

`stopAtErrors: true`: a page whose operator list fails still renders successfully (truncated), so the error never
reaches `RenderTask.promise`

## Version

`pdfjs-dist` 6.4.299 (build `d0991a0d5`), both `build/pdf.mjs` and `legacy/build/pdf.mjs`. Reproduced in Node
with the legacy build; the display code involved is the same in the browser build.

## Steps to reproduce

1. Build a two-page PDF. Page 1 paints an image XObject declaring `/Width 9000 /Height 9000` (81 megapixels; a
   one-byte stream is enough, because the size check reads only the declared dimensions) and then some text. Page 2
   is text only.
2. Open it with `getDocument({ data, stopAtErrors: true, maxImageSize: 64_000_000 })`.
3. `await page.render({ canvas, viewport }).promise` for page 1, then for page 2.

## Expected

Page 1's render rejects with the worker's error ("Image exceeded maximum allowed size and was removed."), since
`stopAtErrors` turns that warning into an error. Page 2 renders.

## Actual

Page 1's render **resolves**. The canvas holds only what preceded the image: with `stopAtErrors` the operator list is
cut off at the image, so the text after it is missing too, and the caller has no way to tell. Page 2 renders.

| | page 1 operators | page 1 render | page 2 |
|---|---|---|---|
| without `stopAtErrors` | 9 (image dropped, text kept) | resolves | renders |
| with `stopAtErrors: true` | 0 (truncated at the image) | **resolves** | renders |

`getOperatorList()` behaves the same way: it resolves with the truncated list.

## Where it happens

- Worker: `buildPaintImageXObject` (`pdf.worker.mjs`, around line 40137) checks the declared size against
  `maxImageSize`. With `ignoreErrors` (`!stopAtErrors`, `pdf.mjs` around line 21764) it warns and continues; with
  `stopAtErrors` it throws, the XObject handler (around 40980) rethrows, and the operator list stream errors
  (`sink.error`, around 71030).
- `Page.getOperatorList` sends `StartRenderPage` (around 65298) before it evaluates the content stream, so the
  render's `displayReadyCapability` has already resolved by the time the stream errors.
- Display: `PDFPageProxy._pumpOperatorList`'s rejection handler (`pdf.mjs` around 22475) sets
  `operatorList.lastChunk = true` and calls `operatorListChanged()` on every render task, which executes what arrived
  and completes the task successfully (`InternalRenderTask._next` → `callback()` with no error). Only after that does
  it call `displayReadyCapability.reject(reason)`, which does nothing on a settled promise.
- The truncated list also stays cached in `_intentStates`, so a later render of the same page (a zoom, a rotation)
  draws it again and resolves, even after the first render has been made to reject.

## Known limitations of our local patch

Our patch fails a page when `buildPaintImageXObject` refuses an image over `maxImageSize`, and rethrows that from the
annotation operator-list catch. Three paths still drop an oversized image silently in 6.4.299, and we have not patched
them:

1. An image's own `/SMask` or `/Mask` stream is constructed directly as a `PDFImage` without the size check, and a
   decode failure there is swallowed.
2. For a JPX image, `PDFImage` replaces the dictionary's `/Width`/`/Height` with the codestream's dimensions after the
   size check has passed, without checking `maxImageSize` again.
3. `loadType3Data` catches every glyph error, our dedicated one included, and substitutes an empty glyph.

An upstream fix that reports these as render failures (or exposes them through a public API) would let us drop the
patch entirely.

## Suggested fix

In `_pumpOperatorList`'s rejection handler, when `reason` is not an `AbortException`, fail each pending
`InternalRenderTask` with it (`internalRenderTask.cancel(reason)`, which rejects its capability and releases the
canvas) instead of calling `operatorListChanged()`, and drop the failed intent state so a later render asks the worker
again. This is what the downstream patch does:

```js
const failed = !(reason instanceof AbortException);
for (const internalRenderTask of intentState.renderTasks) {
  if (!failed) {
    internalRenderTask.operatorListChanged();
  } else if (internalRenderTask instanceof InternalRenderTask) {
    internalRenderTask.cancel(reason);
  }
}
if (failed && this._intentStates.get(cacheKey) === intentState) {
  this._intentStates.delete(cacheKey);
}
```

Without `stopAtErrors` nothing changes, because the worker does not error for the cases it ignores. Downstream, the same
handler is what turns the worker's `ImageTooLargeError` into a rejected render with `stopAtErrors` off.
