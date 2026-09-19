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
  connect — the same wall as `build.hmcts.net`. So the *runtime* behaviour can only be established by
  deploying and trying.
- **AMENDED 2026-09-19: `grant_type=password` will be REFUSED in AAT as the client is registered today, and
  this is a cross-repo change, not an unknown.** `idam-access-config`'s
  `apps/deed-poll/base/services.yaml:42` registers exactly two grant types for `deed-poll-admin`:
  `authorization_code` and `refresh_token`. The earlier version of this section called ROPC "unverified"
  because the network probe failed — but the registration was readable all along in the clone at
  `platops/idam-access-config`. **Check the registration before blaming the network.**

  It is a well-trodden request rather than an exotic one: `apps/pcs`, `apps/ia` and `apps/probate` all
  register `password`, and pcs's first client uses it as its *only* grant type. **Two traps in making the
  change, both stated by the files' own comments:**

  1. **It must go in `apps/deed-poll/aat/services.yaml`, not `base`.** The base file's comment says it
     "also covers production", so adding `password` there would enable ROPC on the **production** client.
  2. **An overlay replaces a list rather than appending to it** — the aat file says so explicitly about
     `redirect_uris`. So an overlay adding `grant_types: [password]` alone would *remove*
     `authorization_code`, and **normal sign-in in AAT would break entirely.** All three must be restated.
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
tests.

**Nothing in `deed-poll-api` changes, and that is a property of the design rather than an omission.** api
already derives roles from userinfo, so a genuine persona token authorises correctly with no api change. The
role-rewrite design this plan rejected would have needed one, or would simply not have worked.

**The AAT dependency chain is four items, two of them in the same review queue:**

| # | Dependency | Owner | State 2026-09-19 |
|---|---|---|---|
| 1 | `password` added to the aat client overlay | `hmcts/idam-access-config` | **not raised** — separate work after this plan, deliberately |
| 2 | `caseworker-deedpoll-judicial` role exists in AAT | `hmcts/idam-access-config#995` | **open** |
| 3 | admin can deploy to AAT at all | running-order step 5f | **unraised** |
| 4 | `deed-poll-api` deployed to AAT behind that address | `deed-poll-api` master | not building |

So expect Tasks 0–4 to complete and Task 6 to stay open for some time. "Done" for this feature means "local
half done, AAT half pending" until all four clear, and status reports should say it that way rather than
implying the feature is finished.

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

- [x] `yarn turbo test test:app --concurrency=1` and `yarn lint` green, totals recorded as this plan's
      baseline; `/o/userinfo` still returns roles for a `grant_type=password` token against the local
      simulator; the three personas are still seeded; `package.json`'s `start` still sets
      `NODE_ENV=production` — or STOPPED and reported with what differs

**Baseline, 2026-09-19.** Every finding this plan rests on still holds; nothing differs, so Task 1 proceeds.

| Check | Result |
|---|---|
| `yarn turbo test test:app --concurrency=1` | 8/8 tasks, **143 files / 2458 tests, all passing** — app 58/892, `@hmcts/deed-poll` 52/901, api-client 4/327, cloud-native-platform 10/140, starter 12/127, simple-router 4/41, session-postgres 2/23, session-redis 1/7 |
| `yarn lint` | exit **0** — 345 files checked, 2 warnings and 2 infos, all pre-existing (`noUndeclaredEnvVars` on `IDAM_SIMULATOR_URL` / `REDIS_URL`, both a test's or a script's own knob). Biome does not fail on warnings, so **a green lint here is exit 0 and not a clean report** — do not "fix" these two |
| `POST /o/token`, `grant_type=password`, judge | returns `access_token`, `id_token` **and `refresh_token`** — so the password grant supplies the replacement refresh token Task 3 needs, rather than Task 3 having to source one elsewhere |
| `GET /o/userinfo` with it | `{"sub":"judge@example.com","roles":["caseworker-deedpoll-judicial"],…}` — userinfo is still the authority |
| Access token claims | `sub, auth_level, …, grant_type, scope, realm, exp` — **no `roles`**, confirming a local role rewrite cannot reach api |
| `yarn idam:users` | all three seeded — `admin@example.com` = `caseworker-deedpoll-admin`, `caseworker@example.com` = **none**, `judge@example.com` = `caseworker-deedpoll-judicial` |
| `package.json` `start` | still `NODE_ENV=production node dist/server.js` — `NODE_ENV` still cannot gate this |

### Task 1: The environment gate, and the pipeline check that keeps production safe

Config flag through `config/` (`default.json` off, `custom-environment-variables.json` mapping, and
`production.json` pinning it off as defence in depth). A named allowlist of environments mirroring
`plain-http.ts`'s shape, keyed on the chart-injected environment name rather than `NODE_ENV`. Chart: off in
`values.yaml`, on in the aat and preview templates.

- [x] Flag defaults off; allowlist is a named set with a docblock saying why it is not a negation; `values.yaml`
      does not enable it; aat and preview do; `deployment-chart.test.ts` fails if the base ever enables it or a
      production template appears that does; both validation commands green

**Done 2026-09-19.** `src/auth/persona-switcher.ts` holds the gate: `PERSONA_SWITCHER_ENVIRONMENTS`
(`development`, `test`, `aat`, `preview`) **and** `personaSwitcher.enabled`, both of which must agree. Two
things worth knowing before Task 2 uses it:

- **The environment name needed inventing.** Nothing carried it, so `values.yaml` now sets
  `ENVIRONMENT_NAME: "{{ .Values.global.environment }}"` and `config` maps it, defaulting to `development`.
  It is deliberately not `ENVIRONMENT`: the per-environment templates go through `envsubst`, which would
  expand a bare `${ENVIRONMENT}` to the empty string — the accident `values.yaml`'s `ingressHost` comment
  records.
- **`__format: "json"` in `custom-environment-variables.json` is load-bearing, and the flag is checked
  `=== true`.** Without the format, config hands back the *string* `"false"` from
  `PERSONA_SWITCHER_ENABLED: "false"` — truthy, so the values file that turns the switcher off would turn it
  on. Verified against the real package: `PERSONA_SWITCHER_ENABLED=true` arrives as a boolean.
- **The flag is still off in `development`,** so `yarn dev` shows no switcher until Task 3 opts the dev
  script in. `config/production.json` pins it off as well, which changes nothing on its own — an env var
  beats any config file — but keeps the intent readable next to the other production pins.

`src/deployment-chart.test.ts` (now 20 tests) asserts the base is off, and cross-checks the templates against
the allowlist imported from `persona-switcher.ts` rather than restating it: a `values.prod.template.yaml`
enabling the flag fails, and so does a template enabling it for an environment the runtime would refuse. It
reads the chart directory rather than the `TEMPLATES` list, so a values file added later is covered without an
edit. Suite: 143 files / 2481 tests passing (app 59/915); `yarn lint` exit 0 with the same two pre-existing
warnings.

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

## The IDAM registration change is NOT a task in this plan — removed 2026-09-19 on Steve's call

It was briefly Task 5a. **It is out, and it happens after this plan**, for a reason worth keeping: it is a PR
into `hmcts/idam-access-config`, another team's repo and another team's review queue, and an agent run should
not open one. It also carries two traps that want a human reading the diff rather than a checkbox:

- **`apps/deed-poll/aat/services.yaml`, NOT `base`** — base covers production, and ROPC on the production
  client is not something a test tool is entitled to ask for.
- **Restate all three grant types** (`authorization_code`, `refresh_token`, `password`). An overlay replaces
  a list rather than appending to it, so omitting `authorization_code` **breaks normal sign-in in AAT**.

Precedent to cite when it is raised: `apps/pcs`, `apps/ia` and `apps/probate` all register `password`, and
pcs's first client uses it as its only grant type.

**What this means for the tasks below:** Task 5 still builds the AAT path in *this* repo's code, because that
is admin's work and nothing about it is blocked. What it cannot do is *work* in AAT until the registration
lands, so Task 5 must degrade visibly rather than fail, and Task 6's verification stays open until then.
Do not raise the IDAM PR from this plan, and do not treat its absence as a reason to skip Task 5.

### Task 5: The AAT path

Create-on-demand persona users through `test-users.ts`, plus the token exchange the IDAM registration change enables. Handle the
three-hour cleanup and the judicial role's absence before `#995` by degrading the affected option with a
reason shown, never by offering a persona that cannot work.

**Degrade the same way while the IDAM registration change is outstanding**: if the client is not registered for `password`, the
switcher must say so rather than offering options that fail at IDAM.

- [ ] Personas resolve in AAT without fixed accounts; an unavailable persona is disabled with its reason
      stated; an unregistered grant type is reported as such rather than surfacing as a login failure; no real
      user's credentials are read anywhere; both validation commands green

### Task 6: Verify in AAT — CANNOT be completed locally

- [ ] After a successful AAT deploy: each available persona switches and api authorises accordingly; recorded
      with the date and the environment. **Do not tick this from a development machine.**

## Open questions — flagged, NOT answered here

1. ~~**If AAT refuses `grant_type=password`, what replaces it?**~~ **Answered 2026-09-19 and promoted to
   separate follow-up work** — it is refused, because the client is registered for `authorization_code` and `refresh_token`
   only, and the fix is a named PR in `hmcts/idam-access-config`. The question that remains is narrower:
   **if IdAM declines to register `password` for this client**, the options are a browser-driven flow the
   tester completes once per persona, or accepting local-only and dropping Task 5. Worth asking in that
   PR body rather than after a refusal.
2. **Should the switcher offer a fourth "no session" option** to test the anonymous path, now that `/` routes
   personas? Cheap to add, easy to forget.
3. **Preview environments point their api at AAT** (`values.preview.template.yaml`), so a preview switcher
   writes to AAT data as a judge. Acceptable, or should preview be excluded from the allowlist?
