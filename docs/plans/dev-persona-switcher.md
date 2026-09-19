# Plan: the persona switcher — test all three personas without signing out

## Overview

A **non-production** control that lets one person exercise the service as a caseworker, a caseworker-admin
and a judge in a single sitting, without logging out and back in. Today that round trip is why nobody does
it, and the referrals feature is the first one whose behaviour genuinely differs across three personas
(`admin-1` the caseworker tab, `admin-2` the returned-for-action count, `admin-3` the judicial screen).

Enabled in **every environment except production**, gated from the Helm chart, with a pipeline check that
fails the build if the production path ever ships it on.

## The finding that shapes the whole plan: changing your role does not change your permissions

**Verified against the running local stack on 2026-09-19, not assumed.** The obvious implementation — a
dropdown that rewrites `CurrentUser.roles` — produces a UI that lies.

`callerFromRequest` (`src/auth/current-user.ts:35`) sends the session's access token to api, and **api derives
roles from `/o/userinfo` using that token**, not from anything this app holds. `src/auth/idam.ts:135` states
it: *"Roles and name come from userinfo, not from the ID token… Reading the token would have yielded no roles
at all against real IDAM."* api's `IdamAccessTokenValidator` docblock refers to the same "userinfo lookup"
downstream.

So a local role rewrite gives the judicial nav and chrome, and then **api 403s every `/judicial/**` call**,
because the token still identifies a caseworker. That is worse than not having the feature: it looks exactly
like a defect in the screens you were trying to test.

**So the switcher swaps identity, not roles.** It obtains a genuine token for the persona's own user, and
everything downstream follows for free — api authorises correctly, and because api stamps `createdBy` /
`claimedBy` / `decidedBy` from the token, the audit trail is right too. A role rewrite would have quietly
attributed a judge's direction to whoever was signed in.

Evidence, all captured locally:

| Step | Result |
|---|---|
| `POST /o/token`, `grant_type=password`, on `rse-idam-simulator` | returns a real access token |
| `GET /o/userinfo` with it | `{"sub":"judge@example.com","roles":["caseworker-deedpoll-judicial"],…}` |
| Access token itself | carries **no** roles — which is why userinfo is the authority at both ends |
| Personas already seeded (`scripts/seed-idam-users.mjs`) | `admin@example.com` = `caseworker-deedpoll-admin`, `caseworker@example.com` = **no roles**, `judge@example.com` = `caseworker-deedpoll-judicial` |

Note the middle one: **a plain caseworker holds no role at all.** "Caseworker" is the absence of a role, not
a role, so the UI must not imply there is one to select.

## The second finding: `NODE_ENV` cannot gate this

`package.json:33` — `"start": "NODE_ENV=production node dist/server.js"`. **Every deployed pod runs as
`NODE_ENV=production`, AAT and preview included.** So any `NODE_ENV`-based test either enables this in
production or disables it everywhere it is wanted. There is no third outcome.

The gate must therefore come from the chart, per environment. That is also the only shape a pipeline check
can assert, which is what makes the required check possible at all.

**And it must be an allowlist, not a negation.** `libs/deed-poll/src/auth/plain-http.ts:20-30` is the
repo's standing rule for exactly this class of gate — `PLAIN_HTTP_ENVIRONMENTS = new Set(["development",
"test"])`, with the docblock saying **"Do not convert this to a negation"**, because `!== "production"` lets
a thing through in aat and preview unnoticed. The same reasoning applies here in mirror image: the allowlist
names the environments where the switcher is permitted, so adding an environment is a deliberate edit rather
than an inherited default.

## Decisions — implement these, do not revisit

1. **Switch identity, not roles.** Obtain a real token for the persona's user and replace the session's
   tokens with it. Never synthesise a role list.
2. **Enabled by an environment allowlist, defaulting to off.** `values.yaml` — the base, which a future
   production deploy inherits — leaves it off. `values.aat.template.yaml` and
   `values.preview.template.yaml` turn it on explicitly. No negation of `production` anywhere.
3. **Two independent controls plus a test.** The chart flag, the runtime allowlist, and a
   `deployment-chart.test.ts` assertion that the base never enables it. Each catches a different mistake:
   a wrong values file, a wrong environment name, and a well-meaning future edit.
4. **The layout is app-owned** (option A, Steve's call 2026-09-19). A new `src/pages/layouts/app.njk`
   extends the starter's layouts and renders the switcher in `beforeContent`; page templates change their
   `extends` line. The starter in `libs/express-govuk-starter` is template-provided and a re-scaffold
   overwrites it, so nothing app-specific goes in there.
5. **It looks like a dev tool, not like service navigation.** A phase-banner-style strip, visually obvious,
   never mistakable for part of the service in a screenshot. This is deliberately *not* `govukServiceNavigation`
   — adopting that is loose end 15 and is separate work (`src/pages/index.ts:13-16`).
6. **`POST`, never a `GET` link.** A crafted URL must not be able to change somebody's persona. The control
   is a form with a real submit button, so it works without JavaScript per the repo's progressive-enhancement
   rule; an `onchange` auto-submit may enhance it where JS is available.
7. **It appears for every persona, including the judge.** A switcher only on the caseworker chrome is a trap
   door you cannot climb back out of.
8. **Switching redirects to `/`**, so `index.ts`'s persona routing decides the new home rather than this
   feature second-guessing it.

## The AAT half, and what is honestly unverifiable from here

Steve's call (2026-09-19) is to build both halves in one plan. The local half is verified above. The AAT half
rests on one assumption this devcontainer **cannot test**, and the plan must not pretend otherwise:

- **AAT IDAM is unreachable from the devcontainer.** Probed 2026-09-19:
  `idam-web-public.aat.platform.hmcts.net` answers **504** through the proxy and `idam-api.aat…` fails to
  connect — the same wall as `build.hmcts.net`. So whether `grant_type=password` is permitted there can only
  be established by deploying and trying.
- **The seeded users are local fixtures.** AAT needs real test users. `src/auth/test-users.ts` can create,
  read and delete them via `idam-testing-support-api` — but it **obtains no user token**, so it is half the
  mechanism. AAT test users are also **cleaned up after three hours**, so AAT cannot use fixed persona
  accounts; it must create on demand and cope with a user vanishing mid-session.
- **The judicial role does not exist in AAT until `idam-access-config#995` merges** (open as at 2026-09-19).
  So the judge persona — the main reason for the feature — cannot be exercised in AAT before then.
- **admin cannot deploy to AAT at all yet**: running-order step 5f, the `deed-poll-api` `.internal` address,
  is unraised, and admin's readiness probe includes api. So the AAT half is untestable until that clears.

**Consequence for this plan:** Task 5 builds the AAT path and Task 6 verifies it *in AAT*, after a successful
deploy. Task 6 cannot be completed from a development machine and must not be ticked on the basis of unit
tests. If ROPC turns out to be refused in AAT, the fallback is recorded in Open Questions rather than guessed
at here.

## Security posture — state it plainly

This is a **privilege-escalation mechanism by design**. Locally that is harmless. In AAT it is a real one, in
a shared environment whose api is also the target of every preview PR build. That is an acceptable trade for a
test environment and it is Steve's decision, but it is the reason for decisions 2, 3 and 6 and the reason the
pipeline check is mandatory rather than nice to have.

Three things it must never do: read a real user's credentials, mint a token for a user it was not explicitly
configured to offer, or leave the production path one config edit away from working.

## Validation Commands

**These run after every task, so everything here must be green after every task — not only at the end.**

```bash
yarn turbo test test:app --concurrency=1
yarn lint
```

(The `yarn` prefix is required — `turbo` is not on PATH, only `node_modules/.bin/turbo`. Never bare
`yarn test`, which reports a false failure here — [[deed-poll-admin-yarn-test-false-red]].)

## Tasks

### Task 0: Record the baseline and confirm the findings still hold — STOP if not

- [ ] `yarn turbo test test:app --concurrency=1` and `yarn lint` green, totals recorded as this plan's
      baseline; `/o/userinfo` still returns roles for a `grant_type=password` token against the local
      simulator; the three personas are still seeded; `package.json`'s `start` still sets
      `NODE_ENV=production` — or STOPPED and reported with what differs

### Task 1: The environment gate, and the pipeline check that keeps production safe

Config flag through `config/` (`default.json` off, `custom-environment-variables.json` mapping, and
`production.json` pinning it off as defence in depth). A named allowlist of environments mirroring
`plain-http.ts`'s shape, keyed on the chart-injected environment name rather than `NODE_ENV`. Chart: off in
`values.yaml`, on in the aat and preview templates.

- [ ] Flag defaults off; allowlist is a named set with a docblock saying why it is not a negation; `values.yaml`
      does not enable it; aat and preview do; `deployment-chart.test.ts` fails if the base ever enables it or a
      production template appears that does; both validation commands green

### Task 2: The app-owned layout

`src/pages/layouts/app.njk` extending the starter layouts, rendering the switcher in `beforeContent`; page
templates repointed. No edit to `libs/express-govuk-starter`.

- [ ] Every page renders through the app layout; the starter library is untouched; the switcher is absent
      when the flag is off, on every page and for every persona when it is on; both validation commands green

### Task 3: The switch itself, locally

A `POST` route that exchanges the persona's seeded credentials for a real token against the simulator,
replaces the session's tokens **including the refresh token**, and redirects to `/`.

**The refresh token is the trap.** `refreshMiddleware` renews ~5 minutes before expiry; replacing the access
token alone means the next renewal silently reverts the session to the original user mid-test, and it presents
as the app randomly losing your persona.

- [ ] Switching yields a `CurrentUser` with the persona's real roles from userinfo; the refresh token is
      replaced too and a forced refresh keeps the new persona (tested); the route 404s when the flag is off;
      `GET` is not accepted; both validation commands green

### Task 4: End-to-end proof that permissions actually changed

The point of the feature, and the thing a role rewrite would have failed: after switching to the judge,
`/judicial/referrals` must return **200 with data from api**, not a 403.

- [ ] An e2e journey switches caseworker → judge → caseworker-admin and asserts on each that a
      persona-specific api-backed page loads and a persona-forbidden one refuses; both validation commands green

### Task 5: The AAT path

Create-on-demand persona users through `test-users.ts`, plus whatever token exchange AAT permits. Handle the
three-hour cleanup and the judicial role's absence before `#995` by degrading the affected option with a
reason shown, never by offering a persona that cannot work.

- [ ] Personas resolve in AAT without fixed accounts; an unavailable persona is disabled with its reason
      stated; no real user's credentials are read anywhere; both validation commands green

### Task 6: Verify in AAT — CANNOT be completed locally

- [ ] After a successful AAT deploy: each available persona switches and api authorises accordingly; recorded
      with the date and the environment. **Do not tick this from a development machine.**

## Open questions — flagged, NOT answered here

1. **If AAT refuses `grant_type=password`, what replaces it?** Options are an IDAM-side change, a browser-
   driven flow the user completes once per persona, or accepting local-only and reverting Task 5. Not
   guessable from here — it needs one AAT attempt.
2. **Should the switcher offer a fourth "no session" option** to test the anonymous path, now that `/` routes
   personas? Cheap to add, easy to forget.
3. **Preview environments point their api at AAT** (`values.preview.template.yaml`), so a preview switcher
   writes to AAT data as a judge. Acceptable, or should preview be excluded from the allowlist?
