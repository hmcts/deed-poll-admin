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

- [ ] Record the execution baseline in the execution notes.
- [ ] Add the failing renderer test with the oversized-image fixture, then implement. Run focused tests and all
      Validation Commands, and record the results.

### Task 2: Browser evidence and hand off

**Files:** `e2e-tests/tests/document-viewer.spec.ts`, mock preview fixtures, `README.md`/`docs/DEPLOYMENT.md` where
they describe viewer states, this plan.

- [ ] Extend the existing journeys as described, run `yarn test:document-viewer` and `yarn welsh:check`, and record
      both. Document the new state beside the existing ones. **Reference this plan by its `docs/plans/completed/`
      path**, since that is where it will be once the run ends.
- [ ] Run all Validation Commands; record final commits and counts, and hand off to the Ralphex review phases.

## Acceptance Criteria

- An embedded image over `maxImageSize` never results in a silently partial page: that page shows the localized
  "could not be shown in full" state with **Download original**, and other pages still render.
- All Validation Commands, `yarn test:document-viewer` and the extractor pass, with no new failures or skips.

## Execution notes

(Record baseline, red/green evidence and final results here.)

## Post-Completion

Publishing, merging and deployment are separate from this plan. The Welsh language owner confirms the new sentence's
Welsh, together with the `src/locales/cy.ts` aria-label change from the viewer plan.
