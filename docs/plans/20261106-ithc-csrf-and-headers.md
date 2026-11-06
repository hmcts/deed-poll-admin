# Plan: ITHC findings — CSRF hardening, POST sign-out, Permissions-Policy, no X-Frame-Options

> **Decided by Steve, 2026-11-06.** Implement as written; do not revisit the decisions below. The evidence for each
> finding is in the workspace note `.context/deed-poll-ithc-csrf-and-headers-2026-11-06.md`. The CSP
> `'unsafe-inline'` style finding is **out of scope** here and gets its own plan and PR.

## Overview

Cyberfort's ITHC report (ITHC frozen at admin `4554c22`, code unchanged on master `845e1a5`) raised CSRF on
four POST routes and two header issues. Four changes, one PR:

1. **CSRF (option A):** `requireSameOrigin()` refuses a state-changing request from a **signed-in** session that
   carries neither `Sec-Fetch-Site` nor an `Origin` naming this host. Today it lets those through
   (`src/auth/same-origin.ts`, the `origin === undefined || origin === "null"` branch).
2. **Sign-out becomes a POST.** `GET /logout` no longer signs anyone out.
3. **The starter's empty `_csrf` input is removed** from the cookie-preferences form.
4. **Headers:** add a deny-all `Permissions-Policy` from the app, and stop sending `X-Frame-Options` (the CSP's
   `frame-ancestors 'self'` already covers framing).

**Not in scope:** a synchronizer token (Steve chose option A; a token is a follow-up only if the retest still flags
CSRF); the CSP style change; deed-poll-web; Front Door.

## Context

Read `CLAUDE.md` first, especially "Security events", "Session writes" and the "Personas and role gating"
paragraph on `requireSameOrigin`. Then read in full:

- `src/auth/same-origin.ts` and `src/auth/same-origin.test.ts`: the guard and its measurement table. **Do not
  change it to an `Origin`-only check**: under `Referrer-Policy: no-referrer` this app's own forms send
  `Origin: null`, so a modern browser's evidence is `Sec-Fetch-Site`, and only a request with *neither* is new to
  refuse.
- `src/app.ts`: the guard is mounted at about line 165, **after** the session middleware (about line 127) and
  **before** `requireAuth()` (231), the abuse limits (266) and the router (268). It therefore sees `req.session`.
- `src/auth/session.ts`: `sessionUser(req)` (about line 244) is how "signed in" is read. Use it; don't
  re-derive it.
- `src/pages/logout.ts` (today a `GET`), `src/pages/layouts/account-navigation.njk` (the header's Sign out item,
  a `govukServiceNavigation` link), `src/pages/layouts/session-timeout.njk` (about line 20, the "Sign out now"
  link), and `src/auth/require-auth.ts`, `src/auth/refresh-middleware.ts` and `src/auth/session-lifetime.ts`, which
  each list `/logout` as a path.
- `libs/express-govuk-starter/src/helmet/helmet-middleware.ts` (`configureHelmet`) and
  `libs/express-govuk-starter/src/cookies/views/cookie-preferences.njk` (about line 43, the empty `_csrf`).
  **The starter is template-provided**: edit it only where this plan says, and record each edit in
  `CLAUDE.md` so a re-scaffold does not silently undo it.
- `src/analytics.test.ts`: it pins the exact CSP header. Extend it rather than duplicating it.
- `e2e-tests/tests/sign-out.spec.ts` and `e2e-tests/tests/session-timeout.spec.ts`: they find "Sign out" by
  `getByRole("link", …)`, and will need `button`.

## Decisions (Steve, 2026-11-06 — implement, do not revisit)

| # | Decision |
|---|---|
| D1 | **Option A for CSRF.** In `crossSiteRefusal`, when `Sec-Fetch-Site` is absent **and** `Origin` is absent or `"null"`, refuse **if `sessionUser(req)` is defined** (signed in). An anonymous request in that state is still allowed (no session to ride, and `requireAuth` already refuses an anonymous non-GET outside the public paths). Every existing outcome is kept unchanged: `same-origin`/`none` allowed; `same-site`/`cross-site`/unrecognised refused; a cross-host `Origin` refused; a same-host `Origin` allowed. |
| D2 | The new refusal is a `ForbiddenError` like the others, with `reason: "same-origin"` and a new bounded detail **`fetchSite: "absent"`**, so `src/errors.ts` emits `csrf.refused` exactly as for the other refusals. Add `"absent"` to whatever type bounds `fetchSite` (`ForbiddenDetails` in `@hmcts/deed-poll` and the `SecurityEventProperties` value, if either is a closed union). The log text is fixed prose, e.g. `"with no fetch metadata from a signed-in session"`. Nothing the sender chose is logged. |
| D3 | **Sign-out is `POST /logout`**, with the same body as today's GET handler: event, `signOut`, `Clear-Site-Data: "cache"`, redirect to IDAM's end-session URL or `/signed-out`. **`GET /logout` signs nobody out.** It renders a small page, "Sign out", with one POST form and button, so old bookmarks and any external link still work without a state change on GET. Keep `/logout` in `require-auth.ts`, `refresh-middleware.ts` and `session-lifetime.ts` as it is: those lists are by path, not method. |
| D4 | **The header's Sign out item becomes a form.** `govukServiceNavigation` takes only links, so `account-navigation.njk` renders the same service-navigation markup by hand, with the Sign out item as `<form method="post" action="/logout">` and a `<button>` styled to look like the navigation link (one small BEM class in the app's SCSS, `app-service-navigation__button`; no inline style). The session-timeout dialog's "Sign out now" becomes the same kind of form and button. Text and Welsh are unchanged. |
| D5 | **Remove the `_csrf` input** from `libs/express-govuk-starter/src/cookies/views/cookie-preferences.njk` (one line). Nothing reads it. |
| D6 | **Permissions-Policy from the app, not the starter and not Front Door.** A new `src/permissions-policy.ts` exports a middleware that sets exactly: `accelerometer=(), autoplay=(), bluetooth=(), browsing-topics=(), camera=(), display-capture=(), fullscreen=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), xr-spatial-tracking=()`. It is mounted in `src/app.ts` straight after `configureHelmet(...)` (about line 95), so every response carries it, errors included. Admin's browser code uses none of these (checked 2026-11-06: no camera, microphone, geolocation, fullscreen, clipboard or print API in `src/assets`). |
| D7 | **No X-Frame-Options.** `configureHelmet` passes `xFrameOptions: false` to `helmet(...)` (a starter edit, recorded in `CLAUDE.md`). CSP's `frame-ancestors 'self'` stays exactly as it is (helmet's default directive). Internal app on MoJ devices: Steve accepted losing it for CSP-less browsers. |
| D8 | **Every test that POSTs through the app as a signed-in session sends `Sec-Fetch-Site: same-origin`**, as a real browser does. If an existing test fails under D1, fix the **test's request**, never the guard. Known candidates: `src/auth/session-lifecycle.test.ts`, `src/auth/session-lifetime-idam-outage.test.ts`, `src/documents/upload.test.ts`, `src/pages/deed-polls/[id]/documents/upload.test.ts`, `src/rate-limit/routes.test.ts` and `src/rate-limit/upload-in-flight.test.ts`. Check each, and change only those that actually fail. |

## Development Approach

- Tests first in every task (red, then green), colocated with the code.
- Run every build and test command in the **foreground**. Never move `dist` aside; use `--force`.
- Local only, against the api-client **mock**. Never run `az` or `kubectl`, and never sign in to a deployed environment.
- Before a Gradle- or Turbo-heavy command, check `pgrep -f 'vitest|turbo|playwright'`, and wait if another build is running.
- Copy goes in `en`/`cy` pairs, with `cy` mirroring `en` until translated (it adds to `yarn welsh:check`'s identical
  count; that's expected, and not a gate).
- Playwright: run changed specs on a **temporary private-port config** (copy `e2e-tests/playwright.config.ts`, change
  the ports, delete the copy afterwards), never the default config, which reuses whatever holds 3000/3200.

## Validation Commands

Run the full set before Task 1 and in the final task. After each other task, run format, lint, build and the touched
packages' tests.

```bash
yarn biome format --write .
yarn lint
yarn build --force
REDIS_URL=redis://127.0.0.1:6379 yarn turbo test test:app --concurrency=1 --force
```

If Redis is not up on 127.0.0.1:6379, run `docker start deed-poll-redis` first. Never drop `REDIS_URL` to make the tests
pass. Never quote bare `yarn test`. **Baseline (2026-11-06, admin `845e1a5`, local Redis on 6379):** format, lint and `build --force` clean; tests
**7,231 passed, 0 failed, 0 skipped**: `//:test:app` 3,478, `@hmcts/deed-poll` 1,779, `@hmcts/deed-poll-api-client` 1,549,
`cloud-native-platform` 156, `express-govuk-starter` 132, `express-session-postgres` 85, `simple-router` 45,
`express-session-redis` 7.

## Implementation Steps

### Task 1: CSRF — refuse a signed-in request with no fetch metadata

- [x] Failing tests first in `src/auth/same-origin.test.ts`:
  - signed in, with no `Sec-Fetch-Site` and no `Origin`, is refused with a `ForbiddenError` (`reason: "same-origin"`, `fetchSite: "absent"`);
  - signed in, with no `Sec-Fetch-Site` and `Origin: null`, is refused the same way;
  - anonymous (no `sessionUser`) in both cases is still allowed;
  - signed in with `Sec-Fetch-Site: same-origin`, or `none`, is allowed;
  - signed in with no `Sec-Fetch-Site` and a same-host `Origin` is allowed;
  - every existing case keeps its outcome.
- [x] Implement D1/D2 in `src/auth/same-origin.ts`, importing `sessionUser` from `./session.js`. Add `"absent"` to the
      bounded `fetchSite` type(s), and extend `src/errors.ts`'s tests so the refusal emits `csrf.refused` with
      `fetchSite: "absent"`.
- [x] Run the full app tests, and apply D8 to any test that now fails. Update the guard's docblock (the measurement
      table and the "neither header" paragraph) to say signed-in requests are refused.
      (Done 2026-11-06: `//:test:app` 3,489 passed with Redis; no unit test needed D8. `fetchSite` is a plain `string`
      in both types, so there was no union to extend. `e2e-tests/tests/gazette.spec.ts` posts twice through
      `page.request` as a signed-in session, so both now send `sec-fetch-site: same-origin`. That suite is not run here.)

### Task 2: Sign-out is a POST

- [x] Failing tests first, in `src/pages/logout.test.ts` and `src/pages/logout-idam-outage.test.ts`:
  - `POST /logout` does everything `GET` does today (event, sign-out, `Clear-Site-Data`, redirect);
  - `GET /logout` renders the confirmation page with a POST form, signs nobody out, emits no `auth.logout` and
    leaves the session in place.
- [x] Implement D3: move the handler body to `POST` in `src/pages/logout.ts`, and add `GET` plus `src/pages/logout.njk`
      (extending `layouts/app.njk`, en/cy content in the handler).
- [x] Implement D4 in `src/pages/layouts/account-navigation.njk` and `src/pages/layouts/session-timeout.njk`, with the SCSS
      class in the app's stylesheet. Extend or add template tests: the header carries a POST form to `/logout`, not
      a link, and so does the timeout dialog. Check `src/pages/layouts/app.njk.test.ts` and any test that matched
      `href="/logout"`.
- [x] Update `e2e-tests/tests/sign-out.spec.ts` and `e2e-tests/tests/session-timeout.spec.ts` to find the **button**
      ("Sign out" / "Sign out now"), and run both on a private-port config.
      (Done 2026-11-06. **Deviation, found by the e2e run:** helmet's default CSP is `form-action 'self'`, which a browser
      applies to every redirect a form submission follows, so the POST's redirect to IDAM's end-session page was
      blocked and the browser stayed on the page, already signed out here. `configureHelmet` gained a
      `formActionSources` option (a starter edit for Task 4's list), and `app.ts` passes the IDAM issuer's origin, so
      the CSP's `form-action` is now `'self' <issuer origin>`; `src/analytics.test.ts` pins it. The header's form also
      made thirteen template tests that count a page's forms or buttons fail, so they strip it through
      `withoutSignOutForm` (`src/express-doubles.ts`); `cookie-management.spec.ts` scopes its `form` to `main`.
      `scripts/extract-welsh-strings.mjs`'s `INCLUDE` now takes a file, for `src/pages/logout.ts`.)

### Task 3: Headers — Permissions-Policy on, X-Frame-Options off, empty `_csrf` gone

- [ ] Failing tests first:
  - `src/permissions-policy.test.ts`: the exact D6 header value;
  - `src/analytics.test.ts`: a real `createApp()` response carries that `Permissions-Policy`, carries **no**
    `X-Frame-Options`, and keeps the CSP exactly as pinned, `frame-ancestors 'self'` included;
  - check a 404 response carries `Permissions-Policy` too.
- [ ] Implement D6 (`src/permissions-policy.ts`, mounted in `src/app.ts`) and D7 (`xFrameOptions: false` in
      `libs/express-govuk-starter/src/helmet/helmet-middleware.ts`, with its own test in the starter's
      `helmet-middleware.test.ts`).
- [ ] Implement D5. Add or extend a starter template test so the cookie-preferences form renders no `_csrf` input, and
      check the cookie-preferences save still works (`/cookies/save-preferences` tests).

### Task 4: Documentation and final verification

- [ ] `CLAUDE.md`:
  - in "Security events" / the CSRF paragraph, say that a signed-in request with no fetch metadata is refused
    (`fetchSite: "absent"`);
  - add a short "Sign-out is a POST" note to "Deployment and sessions";
  - add a "Starter edits" line listing `xFrameOptions: false`, the `formActionSources` option (Task 2) and the
    removed `_csrf`, so a re-scaffold doesn't undo them; and note that `form-action` names IDAM's issuer origin.
- [ ] Full Validation Commands, forced; record counts against the baseline. `git status` clean apart from the task
      commits. Run `sign-out.spec.ts` and `session-timeout.spec.ts` once more on a private-port config.

## After merge (manual, NOT ralphex)

In AAT, as a signed-in caseworker:
- Sign out from the header works, and so does Sign out now from the timeout dialog.
- `GET /logout` shows the confirmation page.
- `curl -I` on a page shows `Permissions-Policy` and no `X-Frame-Options`.
- A POST with a valid session cookie and **no** `Sec-Fetch-Site`/`Origin` is 403. A normal form save in the browser
  still works.

Then ask Cyberfort to retest CSRF and the two headers.

## Execution notes

- 2026-11-06: plan written from admin master `845e1a5` (cft-workspace-11). Launch with
  `ralphex -t -b origin/master docs/plans/20261106-ithc-csrf-and-headers.md` (tasks only). **Steve, 2026-11-06: the
  external review runs only after the build has completed**, so the full Validation Commands are run and green
  before `ralphex -r -b origin/master docs/plans/completed/20261106-ithc-csrf-and-headers.md`.
