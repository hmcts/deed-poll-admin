# Plan: check an upload in the browser before sending it, and handle a gateway failure on the form

## Overview

On 2026-11-19, during the Power App migration, a Word-produced PDF containing JavaScript could not be uploaded
to prod admin, either by the migration tool or from a browser. Front Door answered **502
`OriginConnectionAborted`**. Its WAF had **allowed** the request (`DeedPollAdminUploadAllow`), but its origin, the
hub's Palo Alto firewall (`firewall-prod-int-palo-cftprod`), reset the connection: PDFs with scripts commonly match
its threat signatures. The request never reached admin, so the caseworker saw Front Door's generic error page.
deed-poll-api would have refused that file anyway (`UploadContentPolicy`: scripts, launch actions, embedded files,
rich media and XFA are refused). So nothing extra got in; the only problem was the experience.

The platform's firewall stays as it is; in CFT, services work with it rather than being exempted from it. This
plan makes admin handle the case well:

1. **Check the file in the browser before sending it**, with the same rules the api applies to the content, and
   show the api's own message on the form. A file the api would refuse never leaves the browser.
2. **Send the form from the browser in the background**, so that a failure in front of admin (a 5xx with no
   admin answer, or no connection at all) is shown on the form in this service's words, not on Front Door's page.
3. **Show help text** for the refusals a caseworker can do something about (scripts, macros, attached files),
   saying to ask the applicant for a clean copy first.

With no JavaScript, the page is exactly what it is today: a plain form post, checked by the server.

The api companion is **deed-poll-api#176** (`fix/upload-refusal-messages`), which rewords the five file-content
refusals in GOV.UK style. The rules are unchanged. This plan shows those same words in the browser.

## Dependencies and reconciliation gate

Implement after **deed-poll-api#176 is merged**. Task 0 checks the five messages in api `origin/master`'s
`src/main/java/uk/gov/hmcts/reform/deedpoll/domain/documents/UploadContentPolicy.java` and copies them exactly.
**Stop** if #176 is not merged, or if `UploadContentPolicy`'s or `DocxContentPolicy`'s **rules** differ from the
port described in Decision 2 below. A rule change means this plan's port is out of date and needs revising before
any code is written.

No OpenAPI change: messages are not part of the published contract.

## User journey

1. A caseworker opens **Upload a document** on a case and chooses a file.
2. They press **Upload**.
3. **If the file is one the api would refuse on its content** (wrong content for its type, password-protected,
   old `.doc`, a PDF with scripts or attached files, a Word document with macros, embedded objects or links to
   templates, empty, or over 25 MB), the page shows the GOV.UK error summary and the file field's error, in the
   api's words, without sending anything. For scripts, macros and attached files, help text says what to do.
4. Otherwise the form is sent in the background:
   - **Accepted:** the browser goes to the case's documents, as today.
   - **Refused by admin or the api:** the form shows the error and the caseworker's other choices, as today.
   - **The session has ended:** the page reloads, which takes them through sign-in as today. The file has to be
     chosen again; browsers never keep a file selection.
   - **No answer from admin** (a 5xx without admin's JSON, or a network failure): the form stays, with the error
     *"The file could not be uploaded. Try again. If it is a PDF or Word document, it may contain scripts, macros
     or attached files"* and the help text.

## Decisions — implement these, do not revisit

### 1. The browser check is a usability shortcut; the api's check stays the control

Never relax, skip or replace a server check because the browser checked. The api's `UploadContentPolicy` remains
authoritative, and admin's server-side `upload-policy.ts` checks (type, size, name) stay as they are. If the
browser and the api ever disagree, the api wins and the form shows its answer.

### 2. Port the api's content rules exactly, and only those

Put the port in **`libs/deed-poll/src/documents/upload-content-check.ts`** (new). It is a pure function over the
file's bytes and its declared MIME type, with **no dependencies**, so deed-poll-web can copy it later
(deed-poll-web#87). It returns `undefined` (accept) or `{ field: "file", message, help }`, where `help` is
`"resave"` or absent.

**The declared type is the browser's `file.type`,** because that is what admin sends: `src/documents/upload.ts`
uses multer's `file.mimetype`, and `libs/deed-poll/src/documents/service.ts` passes it to the api, which checks
the content against it. Use the same type the server will see; do not sniff a different one.

Rules, from `UploadContentPolicy.verify` and `DocxContentPolicy`, in this order. The first match wins:

| Condition | Message (Task 0's constants) | `help` |
|---|---|---|
| empty, over `MAX_UPLOAD_BYTES`, or `file.type` not in `ALLOWED_UPLOAD_MIME_TYPES` | `MISMATCH` | — |
| `application/pdf` not starting with `%PDF-` | `MISMATCH` | — |
| PDF name token `Encrypt` (scan below) | `ENCRYPTED` | — |
| PDF name token in `JavaScript`, `JS`, `Launch`, `EmbeddedFile`, `RichMedia`, `XFA` | `ACTIVE_PDF` | `resave` |
| `image/jpeg` not starting `FF D8 FF`; `image/png` not starting `89 50 4E 47 0D 0A 1A 0A`; `image/tiff` not starting `49 49 2A 00` or `4D 4D 00 2A` | `MISMATCH` | — |
| DOCX type starting with the OLE signature `D0 CF 11 E0 A1 B1 1A E1` | `WORD_FORMAT` | — |
| DOCX type not starting `50 4B 03 04` | `MISMATCH` | — |
| DOCX zip part name (lower-cased, with a leading `/`) ends `/vbaproject.bin`, contains `/activex/`, or starts `/word/embeddings/` | `UNSAFE_WORD` | `resave` |
| `[Content_Types].xml` content type containing `vbaproject`, `macroenabled` or `activex` | `UNSAFE_WORD` | `resave` |
| any `.rels` relationship with `TargetMode="External"` and a `Type` ending `/attachedTemplate`, `/oleObject` or `/frame` | `UNSAFE_WORD` | `resave` |

**The PDF name scan is a direct port of `UploadContentPolicy.verifyPdf`:**
- walk the bytes; at each `/`, read a name until a delimiter (`0`, `9`, `10`, `12`, `13`, `32`, or one of
  `()<>[]{}/%`);
- decode `#xx` hex escapes;
- keep at most 32 bytes, and ignore a name longer than 32;
- compare as US-ASCII.

**No decompression** of PDF streams, exactly as the api does.

**DOCX reading:** parse the zip's **central directory** for part names (find the end-of-central-directory record,
then read the entries). For `[Content_Types].xml` and the `.rels` parts only, inflate the entry with the browser's
`DecompressionStream("deflate-raw")`, or read it directly if it is stored. **If `DecompressionStream` is
unavailable, skip those two checks**; the api still catches them. Cap what you inflate: skip an entry over 1 MiB
expanded, and stop reading after 2 MiB in total. **Do not** port `DocxContentPolicy`'s package-structure and
zip-bomb checks (main part, entry counts, expansion ratio); leave them to the api. A zip the browser cannot parse
is **accepted** by the browser and left to the api, rather than refused with a guess.

### 3. The help text, and when it shows

Help text, in `en` and copied into `cy`, for `help === "resave"` and for the gateway fallback:

> *"Ask the applicant for a copy without them if you can. If you save a new copy yourself (for example, Print then
> Save as PDF), check every page is complete and readable before you upload it, and keep the original."*

Show it under the file field's error, as GOV.UK inset text or a paragraph inside the field's form group. Show it
**only** for those cases, never for a size or type refusal. Server-rendered refusals show the same help when the
api's field message is `ACTIVE_PDF` or `UNSAFE_WORD`: compare with Task 0's constants.

### 4. Background submission with a JSON contract; plain form posting is unchanged

The script intercepts `submit` on the upload form only, and sends a `fetch` POST to the form's `action` with
`new FormData(form)`, `redirect: "manual"`, and header **`Accept: application/json`**.

The upload route (`src/pages/deed-polls/[id]/documents/upload.ts`) answers a request that `Accept`s
`application/json` like this:
- **success:** `200 {"location": "<the same case documents href it redirects to today>"}`;
- **refusal:** `400 {"field", "message", "help"?}`, with the same field and message the HTML re-render would show.

Every other request keeps today's behaviour exactly: a redirect, or the `400` HTML re-render.

The script handles each answer:
- `200` with JSON: `window.location.assign(location)`.
- `400` with JSON: render the error summary, the field error and any help on the current page, keeping the form's
  values. Reuse the template's markup classes; don't invent new components.
- `opaqueredirect` (the auth middleware redirecting to `/login` when the session has gone): `location.reload()`.
- **An answer from admin that isn't JSON and isn't 5xx** (the abuse limits' `errors/429`, a 403 or 404 page):
  show admin's own page exactly as a plain form post would, by replacing the document with the response's HTML
  (`document.open()`, `write`, `close()`). These come from `mountAbuseLimits` (the in-flight cap and the limiter,
  which `app.ts` mounts before the router and before multer) and from the error handler. They already say what's
  wrong, and the "may contain scripts" guess would be false.
- **A 5xx, or a rejected `fetch`:** the gateway fallback message (Decision 3) on the file field, with the help. Never
  navigate to a 5xx response.

While sending, disable the Upload button and set `aria-busy` on the form, and restore both afterwards. Move focus
to the error summary when one is shown, as govuk-frontend does.

**This JSON is a deliberate, narrow exception to CLAUDE.md's "this app exposes no JSON API".** It is one page
answering its own form's background submission through content negotiation on the same route, not an endpoint
for anyone else. It needs no OpenAPI entry, no new path, and nothing beyond `{location}` or `{field, message, help}`.
Do not generalise it into an API, and do not add it to other routes.

The same-origin guard (`src/auth/same-origin.ts`) needs no change: a same-origin `fetch` sends
`Sec-Fetch-Site: same-origin`. No CSRF token change either: the form has none today.

### 5. Where the script lives

**`src/assets/js/upload-precheck.ts`** (new), started from **`src/assets/js/index.ts`** after `initAll()`, like
`initDocumentTypeAutocomplete`. It is a no-op unless the upload form is present. Mark the form in
`src/pages/deed-polls/document-upload.njk` with `data-module="app-upload-precheck"` and select it by that
attribute. The page must still work exactly as today with JavaScript off.

### 6. Copy, Welsh and logging

- **Copy:** the new strings (`gatewayFallback`, `resaveHelp`) go in the route's `en` object. `cy = { ...en }`
  stays, as everywhere in this repo pending translation. The script reads them from `data-*` attributes rendered
  by the template, never from strings hard-coded in the script.
- **Logging:** log nothing about the file: no name, size, bytes or which rule matched. The server keeps its
  existing logging.

## Layers

1. **Domain** (`libs/deed-poll`): the message constants; `upload-content-check.ts` and its tests.
2. **Route:** the JSON answers for `Accept: application/json`; help on server-rendered refusals.
3. **Template:** the `data-module` attribute, the `data-*` copy, and the help-text slot.
4. **Browser:** `upload-precheck.ts`, wired from `index.ts`, and its tests (jsdom).
5. **E2E:** a private-port Playwright config and spec.

## Validation Commands

```bash
yarn lint
npx turbo test test:app --concurrency=1
```

**Verified green on this branch before Task 1 (2026-11-19, admin `origin/master` `17b28c7`):**
- `yarn lint`: exit 0.
- `npx turbo test test:app --concurrency=1`: `8 successful, 8 total`. App: 174 files passed, 4 skipped; 3,467
  tests passed, 93 skipped. Libraries: `@hmcts/deed-poll` 1,779 (77 files); `@hmcts/deed-poll-api-client` 1,550
  (23); `cloud-native-platform` 156 (13); `express-govuk-starter` 136 (13); `express-session-postgres` 85 (2);
  `simple-router` 45 (4); `express-session-redis` 7 (1).
- `yarn welsh:check`: 1,102 strings, 878 still identical in `cy`.

Task 4 measures against these.

**Keep these out of this section:**
- **`yarn welsh:check`** exits 1 on `master` (the repo-wide `cy = { ...en }` state). A gate that starts red fails
  every task. Task 4 records the count moving by exactly this plan's new keys.
- **`yarn test:e2e`** and **`yarn test:upload`** need a running app and mock. Task 4 runs them by hand. They
  **cannot start their `webServer`s from inside a worktree if the main checkout owns the docker containers**:
  start Redis and the IDAM simulator as the README says. **If ports 3220 or 3320 are already held, they belong to
  another agent: do not kill them; wait, or report and stop.**
- **A bare `yarn test` is not a substitute.** It reports `0 successful, 8 total` while running nothing.

## Constraints

- **Run every build and test in the foreground**, with a 600000 ms timeout, never in the background. Check
  `pgrep -f 'turbo|vitest|playwright'` first and wait if one is running. If a run outlives the cap, stop and record
  it rather than starting a second over it.
- **Never move `libs/*/dist` aside**, and never `rm -rf` a shared cache. To prove a clean build, use a fresh
  `git worktree add --detach` + `yarn install --immutable` + `yarn turbo build build:app --force`.
- **No new dependencies.** Zip and inflate use the platform (`DataView`, `DecompressionStream`).
- **Do not edit deed-poll-api.** If its rules differ from Decision 2, stop (see the reconciliation gate).
- Commit after each task, with a message saying what changed and why.

## Tasks

### Task 0: Reconcile with deed-poll-api#176, and record baselines

- [ ] Confirm deed-poll-api#176 is merged:
  `git -C ../deed-poll-api fetch origin && git -C ../deed-poll-api log --oneline origin/master -- src/main/java/uk/gov/hmcts/reform/deedpoll/domain/documents/UploadContentPolicy.java | head -3`.
  If not merged, stop.
- [ ] Read api `origin/master`'s `UploadContentPolicy.java` and `DocxContentPolicy.java`. Confirm the rules match
  Decision 2's table and scan. Stop on any difference.
- [ ] In **`libs/deed-poll/src/documents/upload-policy.ts`**, add the five exported constants
  `UPLOAD_CONTENT_MISMATCH`, `UPLOAD_CONTENT_ENCRYPTED`, `UPLOAD_CONTENT_WORD_FORMAT`, `UPLOAD_CONTENT_ACTIVE_PDF`
  and `UPLOAD_CONTENT_UNSAFE_WORD`, copied **character for character** from api's `MISMATCH`, `ENCRYPTED`,
  `WORD_FORMAT`, `ACTIVE_PDF` and `UNSAFE_WORD`. Give them a comment naming the api file and #176.
- [ ] In `libs/deed-poll/src/documents/upload-policy.test.ts`, add a test pinning each constant's exact text.
- [ ] Re-measure the baselines in "Validation Commands" if master has moved since 2026-11-19 (`17b28c7`), and
  update them there.

### Task 1: The content check (domain)

- [ ] Create **`libs/deed-poll/src/documents/upload-content-check.ts`**, exporting
  `checkUploadContent(bytes: Uint8Array, declaredType: string, size: number): Promise<UploadContentRefusal | undefined>`,
  per Decision 2. Export it from `libs/deed-poll/src/index.ts`.
- [ ] Create `upload-content-check.test.ts`, building fixtures **in the test** from bytes (no binary files committed):
  - **PDF:** clean; `/JS`; `/JavaScript`; `/Launch`; `/EmbeddedFile`; `/RichMedia`; `/XFA`; `/Encrypt`;
    `/Encrypt` before `/JS` (`ENCRYPTED` wins); `#4A#53` (escaped `JS`) refused; `/JSX`, `/JavaScriptX` and a
    33-byte name **accepted**; a name next to each delimiter; a missing `%PDF-` prefix.
  - **Images:** a good and a bad prefix for each of the three types.
  - **DOCX:** a minimal valid zip built in the test (stored entries); `word/vbaProject.bin`; `word/activeX/x.xml`;
    `word/embeddings/oleObject1.bin`; a macro-enabled content type in `[Content_Types].xml`; an external
    `attachedTemplate`, `oleObject` and `frame` in a `.rels`; the same relationships with `TargetMode="Internal"`
    **accepted**; an OLE prefix (`WORD_FORMAT`); a non-zip (`MISMATCH`); a deflated `.rels` (via
    `CompressionStream("deflate-raw")` where the test runtime has it; otherwise mark that case skipped and say why);
    an unparseable zip **accepted**.
  - **Any type:** empty; one byte over `MAX_UPLOAD_BYTES` (pass `size`, don't allocate 25 MB); a type not allowed.
  - Assert `help === "resave"` exactly for `ACTIVE_PDF` and `UNSAFE_WORD`.
- [ ] Validation Commands green.

### Task 2: The route's JSON answers, and help on server-rendered refusals

- [ ] In **`src/pages/deed-polls/[id]/documents/upload.ts`**, when the request `Accept`s `application/json`
  (`req.accepts(["html", "json"]) === "json"`), answer per Decision 4. Leave every other path unchanged.
- [ ] Add `resaveHelp` and `gatewayFallback` to `en` (Decision 3 and the user journey's wording). Pass the help to
  the template when the rendered `file` message is `UPLOAD_CONTENT_ACTIVE_PDF` or `UPLOAD_CONTENT_UNSAFE_WORD`.
- [ ] Route tests (follow the existing ones beside this route, or the nearest page tests):
  - JSON success → `200` with `location`; JSON refusal → `400` with field and message, and help for active content;
  - an HTML request → today's redirect and re-render, unchanged;
  - a server-rendered `ACTIVE_PDF` refusal shows the help;
  - a size refusal doesn't.
- [ ] Validation Commands green.

### Task 3: The browser script and the template

- [ ] **`src/pages/deed-polls/document-upload.njk`:** add `data-module="app-upload-precheck"` to the form,
  `data-*` attributes carrying `gatewayFallback`, `resaveHelp` and the error summary title, and a help slot under
  the file field. Render it server-side when the route passes help. No visual change otherwise.
- [ ] **`src/assets/js/upload-precheck.ts`** (new), per Decisions 4 and 5: on submit, read
  `file.arrayBuffer()` and run `checkUploadContent(bytes, file.type, file.size)`. If refused, render the errors and
  don't send. Otherwise `fetch` and handle each answer. Wire `initUploadPrecheck()` in `src/assets/js/index.ts`
  after `initAll()`.
- [ ] **`src/assets/js/upload-precheck.test.ts`** (jsdom; follow `document-type-autocomplete.test.ts`), with
  `fetch` mocked:
  - a refused PDF never calls `fetch` and shows the summary, field error and help;
  - a clean file calls `fetch` with `Accept: application/json` and `redirect: "manual"`;
  - `200` JSON → `location.assign`; `400` JSON → errors rendered, help only for active content;
  - `opaqueredirect` → `reload`;
  - a `502` HTML answer and a rejected `fetch` → the fallback with help;
  - a `429` HTML answer (admin's `errors/429`) → that page is shown, and the fallback is not;
  - the button is disabled while sending and restored after;
  - with no form on the page, nothing happens.
- [ ] Validation Commands green.

### Task 4: End to end, and measurements

- [ ] Create **`e2e-tests/playwright.upload.config.ts`** on private ports: mock `3220`, app `3320`, Redis
  `redis://127.0.0.1:6379/6`, `IDAM_REDIRECT_URI` `http://localhost:3320/oauth2/callback`, modelled on
  `playwright.document-viewer.config.ts`. Add `"test:upload"` to the root `package.json`, like
  `"test:document-viewer"`.
- [ ] Create **`e2e-tests/tests/upload-precheck.spec.ts`**, signing in as the existing specs do, e.g.
  `deed-polls.spec.ts`:
  - uploading a generated PDF containing `/JS` shows the error and help, and sends no request (assert with
    `page.on("request")`);
  - a clean PDF uploads and lands on the case's documents;
  - with `page.route` answering the upload POST `502` with an HTML body, the form shows the fallback and stays on
    the page.
- [ ] Run `yarn test:upload` and `yarn test:e2e` by hand (see Validation Commands for the port and container
  caveats), and record the results here.
- [ ] Record `yarn welsh:check`'s counts. The strings and the still-identical count should each rise by exactly the
  new keys.
- [ ] Record final `yarn lint` and `npx turbo test test:app --concurrency=1` totals against Task 0's baselines.

## Not in this plan

- **Any change to the platform** (Front Door, App Gateway, the firewall). Platform Ops are being asked to confirm
  the cause; nothing here depends on their answer.
- **deed-poll-web:** deed-poll-web#87 will reuse `upload-content-check.ts`.
- **Cleaning or re-saving files for the user.** We reject; we don't sanitise (see #87 for the reasons).
