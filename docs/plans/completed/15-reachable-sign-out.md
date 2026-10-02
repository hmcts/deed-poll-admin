# Plan 15: make sign-out reachable

## Implementation decisions — 2 October 2026

- Use the plan's recommended service-header placement in both app-owned layouts.
  A shared `layouts/account-navigation.njk` uses GOV.UK service navigation immediately
  after the existing header. Sign-out remains visible on mobile without opening a menu,
  and is independent of the development persona strip and its environment flag.
- Provide `Sign out` / `Allgofnodi` and the account navigation label through the shared
  locale files, included in the translation catalogue. Welsh copy remains subject to
  the service's normal translation review.
- **Session-timeout policy remains open.** The historical observation below does not
  mean there is no configured expiry: `src/app.ts` currently sets a 24-hour cookie
  lifetime, and refresh failure can end authentication. A business-defined inactivity
  timeout is a separate decision; this implementation changes neither mechanism.
- Leave the existing GET `/logout` route and starter library unchanged.

## Completion and validation — 2 October 2026

Implemented on `plan-15-reachable-sign-out` in isolated worktree
`/tmp/deed-poll-admin-plan15`; the original checkout's concurrent work is untouched.

- Six new layout regression assertions failed before the change and passed afterwards.
- `yarn lint`: passed (two pre-existing Biome configuration notices).
- `yarn turbo test test:app --concurrency=1`: all eight packages passed,
  **3,358 tests across 169 files**. Baseline: 3,349 passed and three skipped;
  the final run also exercised those three tests after local Redis became available.
- `yarn build`: passed for all eight packages.
- Chromium sign-out journey: passed, including both layouts, English/Welsh labels,
  keyboard activation, axe accessibility, the IDAM logout destination, and refusal
  of protected pages after logout. A temporary Playwright configuration ran the app
  on port 3301 with a matching IDAM callback because another service used port 3000.
- `yarn welsh:extract` adds the two shared strings to the catalogue. `yarn welsh:check`
  still reports the existing 474 identical English/Welsh strings; the new strings
  do not increase that count.

**Simulator limitation:** local IDAM advertises `/o/endSession` but does not implement
that endpoint. The browser test checks its destination and `post_logout_redirect_uri`,
then explicitly returns to the service and verifies login is required. Automatic
return and single sign-out with real IDAM remain a deployed-environment check.

## Historical overview

**The sign-out route exists, works, and nothing in the service links to it.** A caseworker can only reach it by
typing `/logout` into the address bar. Found 2026-09-23 when a tester could not switch account during local
testing and concluded, reasonably, that the feature had never been built.

This is a small change with one genuine design question behind it, and the question is worth answering before
the link is added rather than after.

## What is actually there — measured, 2026-09-23

`src/pages/logout.ts` is complete and its ordering is deliberate:

```
GET /logout → signOut(req)            destroy the local session first
            → endSessionUrl(...)      then redirect to IDAM's end_session_endpoint
            → res.redirect(away ?? "/")   or home, if IDAM advertises no such endpoint
```

Its docblock already argues the order: *"Local first: if the IDAM round trip fails or the browser abandons it,
the user is still signed out of this service, which is the half that matters."* That reasoning stands and this
plan does not touch it.

Verified against the running app: `GET /logout` answers **302** to
`http://localhost:5556/o/endSession?post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A3000%2F`. So the route,
the IDAM discovery and the post-logout redirect all work today.

`/logout` is in `require-auth`'s public allowlist, which is correct — signing out must not require a valid
session, or an expired one becomes unrecoverable without clearing cookies.

**The gap is exactly one thing: no template references it.** `grep -rn logout src/pages/**/*.njk` and the
starter's templates return nothing.

## The design question — answer this first

**Where does the link go, and does the answer change with the persona switcher?**

The obvious home is `layouts/app.njk`, which is where the *Dev only — Switch persona* strip is included (line
27) and is therefore already the place the app puts identity controls. But the switcher and sign-out are
opposites, and putting them side by side in a non-production environment invites the wrong click:

- **Switch persona** keeps the sitting going as somebody else. It is non-production only, gated on
  `PERSONA_SWITCHER_ENABLED` and an `ENVIRONMENT_NAME` allowlist.
- **Sign out** ends the sitting, *including at IDAM*, so the next sign-in is a full login.

A tester who means "become the judge" and hits sign-out pays an OIDC round trip and re-entry of credentials.
Not harmful, but it is the kind of adjacency that gets designed out rather than shipped and complained about.

**Recommendation:** put sign-out in the **service chrome for every environment** — the GOV.UK header or the
top-right of `layouts/app.njk`, where a caseworker expects it — and leave the persona strip where it is. They
then read as what they are: one is the service's, one is a development tool that happens to sit above it.

## The second question, which is the business's

**Is there a session timeout, and should there be?** Sign-out being unreachable has been survivable partly
because nothing else ends a session either. Worth knowing before this ships:

- `express-session-redis` holds the session; sessions observed surviving **30 hours** of local running.
- `refresh-middleware` signs a user out when the refresh fails, so an expired IDAM refresh token ends a
  session — but that is a token lifetime, not a service policy.
- A caseworker application on a shared machine in an office is the case a timeout exists for, and nobody has
  stated a requirement.

This plan does **not** add a timeout. It records that the question is open, because "add sign-out" will read
like session handling is now complete, and it will not be.

## Constraints

- **`layouts/app.njk` and `layouts/app-full-width.njk` are app-owned and must both change.**
  `src/pages/layouts/app.njk.test.ts` reads `src/pages/**` off the filesystem and fails any page extending
  anything else, so a link added to one layout and not the other is a page-by-page inconsistency the suite will
  not catch.
- **Do not put it in `libs/express-govuk-starter`.** That library is template-provided; an edit there is lost
  at the next re-scaffold with nothing failing. Same argument the persona switcher's layouts rest on.
- **Welsh:** the link is caseworker-facing, so it needs `en`/`cy` pairs like everything else. The persona
  switcher's English-only `COPY` const is the documented exception and must not be copied here.
- **`GET` is correct for this route and must stay.** It is not a state-changing write in the CSRF sense —
  `requireSameOrigin` gates `POST`/`PUT`/`PATCH`/`DELETE` only, and a sign-out that required a form post would
  be unreachable from an expired session, which is the state it most needs to work in.

## Validation Commands

Green before any task runs — verified 2026-09-23.

```bash
yarn lint                                    # EXIT 0 — 385 files, 1 warning (notify-2's unused UUID), 2 infos
npx turbo test test:app --concurrency=1      # EXIT 0 — 3,120 tests across 166 files, 8/8 packages
```

`yarn welsh:check` exits 1 by design and is **not** a gate — see plan 14's decision 6.

## Tasks

### Task 0: Answer the two questions above

- [x] Confirm where the link goes, and that the persona strip stays separate
- [x] Record the session-timeout answer, or record explicitly that it remains open

### Task 1: Add the link to both app layouts

- [x] `layouts/app.njk` and `layouts/app-full-width.njk`, with `en`/`cy` copy
- [x] Extend `layouts/app.njk.test.ts` so a layout **without** a sign-out link fails, the same sweep that
      already pins which layout a page may extend — otherwise the second layout can silently drift
- [x] Mark completed

### Task 2: An e2e assertion that it works from the UI

- [x] One journey: signed in, follow sign-out, land back unauthenticated, and a protected page then redirects
      to login. The route is already proven by curl; what is not proven is that a caseworker can *find and
      follow* it, which is the whole point of this plan
- [x] Mark completed

## Deliberately not in this plan

- **A session timeout.** See the second question; it needs a stated requirement.
- **Changing `logout.ts`.** It is correct, and its local-first ordering is reasoned at the call site.
- **Anything in the starter library.** See Constraints.
