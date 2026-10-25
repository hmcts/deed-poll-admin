# Draft upstream issue: `stopAtErrors` does not reject `RenderTask.promise`

**Status: drafted, not filed.** Filing it on [mozilla/pdf.js](https://github.com/mozilla/pdf.js/issues) is an external
action for Steve to take or approve. Once it is filed, add its link here. Once a release fixes it, drop
`.yarn/patches/pdfjs-dist-npm-6.4.299-*.patch`, restore a plain `pdfjs-dist` version in `package.json` (`yarn install`
rewrites `yarn.lock`), and remove the patch-resolution check in `src/document-viewer/pdfjs-assets.test.ts`, the
`.yarn/patches/` exception in `.gitignore` and the `pdfjs-dist` rule in `.github/renovate.json`.

Why this repository carries the patch: the document viewer opens every preview with `stopAtErrors: true`, so that a
page PDF.js cannot draw in full says so rather than showing part of itself as if it were complete (plan
`docs/plans/completed/20261025-document-viewer-incomplete-pages.md`). Unpatched, that state is never reached. The
guard is `src/assets/js/document-viewer/pdf-document.test.ts`, which fails against the unpatched package.

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

Without `stopAtErrors` nothing changes, because the worker does not error for the cases it ignores.
