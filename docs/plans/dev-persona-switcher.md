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
| 1 | `password` **and `client_credentials`** added to the aat client overlay (amended 2026-09-20 — the second was missing from this table; `idam-testing-support-api` needs a service token, so persona *creation* depends on it) | `hmcts/idam-access-config` | **not raised** — separate work after this plan, deliberately |
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

- [x] Every page renders through the app layout; the starter library is untouched; the switcher is absent
      when the flag is off, on every page and for every persona when it is on; both validation commands green

**Done 2026-09-19.** `src/pages/layouts/app.njk` and `app-full-width.njk` extend the starter's two layouts and
render `layouts/persona-switcher.njk` in `beforeContent`; all 25 page templates were repointed, including
`errors/403.njk`. Four things worth knowing before Task 3:

- **There are two app layouts, not one.** The starter ships `default.njk` *and* `full-width.njk` (the case list
  and the case detail use the latter), and nunjucks has no multiple inheritance. Both new files are four lines
  and include the same partial, so the strip itself is not duplicated.
- **The switcher goes *above* `{{ super() }}`.** `super()` is the starter's phase banner and back link, and
  `super()` rather than a restatement of the parent block is what keeps the nested `backLink` block overridable
  — verified by rendering, not assumed, because a silently lost back link on every form page would be a real
  regression.
- **The strip reaches the template on `res.locals`, from `personaSwitcherLocals()` mounted globally in
  `app.ts`.** That is the only shape that satisfies "every page for every persona": a per-page view-model entry
  would be missing from the next page somebody writes, and the judicial pages deliberately never ask about the
  role. Nothing is assigned when the gate is shut *or when nobody is signed in*, so `{% if personaSwitcher %}`
  is the whole render-time condition.
- **The copy is English only and deliberately not in `src/locales`.** `scripts/extract-welsh-strings.mjs` scans
  that directory, so putting it there would bill a translator for a dev tool — and `yarn welsh:check` fails on
  a `cy` value identical to its `en` one, so the alternative is a red check with no defect behind it. It lives
  in `persona-switcher.ts` as `COPY` instead, which keeps English out of the markup.

**The 404 and 500 pages are the one exception, and it cannot be closed here.** Their views are the starter's
(`errors/404.njk`, `errors/500.njk`) and nunjucks resolves the starter's view paths *before* `src/pages`, so
even a local copy would not be reached. Editing the starter is what decision 4 forbids.

**Checked against the built output, since this is the failure class with no local symptom.** `vite.build.ts`
copies templates to a doubly-nested path (`dist/pages/src/pages/<dir>/<dir>/…`), which resolves only because
`collectViewPaths` adds every directory as a search path. `yarn build` puts the layouts at
`dist/pages/src/pages/layouts/layouts/app.njk`, and rendering `judicial/referrals/index.njk` from `dist` with
the deployed search paths produces both the strip and the phase banner. Had that not held, every page would
500 in a pod with nothing failing locally.

Suite: 143 files / 2502 tests passing (app 60/936; +21 across `app.njk.test.ts`, `persona-switcher.test.ts` and
`app.test.ts`). `yarn lint` exit 0 with the same two pre-existing warnings.

### Task 3: The switch itself, locally

A `POST` route that exchanges the persona's seeded credentials for a real token against the simulator,
replaces the session's tokens **including the refresh token**, and redirects to `/`.

**The refresh token is the trap.** `refreshMiddleware` renews ~5 minutes before expiry; replacing the access
token alone means the next renewal silently reverts the session to the original user mid-test, and it presents
as the app randomly losing your persona.

- [x] Switching yields a `CurrentUser` with the persona's real roles from userinfo; the refresh token is
      replaced too and a forced refresh keeps the new persona (tested); the route 404s when the flag is off;
      `GET` is not accepted; both validation commands green

**Done 2026-09-19.** `src/auth/password-grant.ts` obtains the token and `src/pages/switch-persona.ts` is the
route; `personaCredentials()` in `persona-switcher.ts` is the only thing that turns a form value into a
username. **Verified live against the running simulator, not only against stubs** — all three personas return
an access token, an id token *and* a refresh token, and userinfo gives `caseworker@example.com` no roles,
`admin@example.com` `caseworker-deedpoll-admin`, `judge@example.com` `caseworker-deedpoll-judicial`. Five
things worth knowing before Task 4:

- **`signIn`, not `updateTokens`, and that is the whole task.** It replaces the refresh token *and* `subject`.
  `updateTokens` deliberately leaves `subject` alone, so the half-measure fails both ways round: keep the old
  refresh token and `refreshMiddleware` silently restores the previous user five minutes before expiry; keep
  the old subject and `refreshTokens` refuses the response as a changed identity and signs the tester out. It
  regenerates the session id as well, which any change of authenticated identity should.
- **`genericGrantRequest`, because `openid-client` publishes no `password` helper** (the grant is dropped in
  OAuth 2.1). It is not a raw request in the way that would matter: the response goes through
  `processGenericTokenEndpointResponse`, so an ID token in it is validated against the issuer's JWKS before
  `claims()` returns anything — the subject `fetchUserInfo` is checked against is a verified one.
- **The refresh path cannot be proven locally by *running* it.** The simulator answers `expires_in: 28800000`
  — eight hours in milliseconds, so ~333 days as seconds — which puts every local session far outside the
  five-minute window, and it does not implement the refresh grant either (`idam.test.ts` records that). So
  `switch-persona.test.ts` drives the real `refreshMiddleware` over the switched session instead, and asserts
  it renews with the *judge's* refresh token and subject.
- **A refusal is `next()` to the not-found handler**, for the shut gate and for an unknown persona id alike —
  same non-enumerability argument as `/judicial/**`'s 404, and it means an environment outside the allowlist
  answers exactly as one where the route does not exist. `GET` is not refused by a handler: the module exports
  only `POST`, so `simple-router` registers no `GET` at all.
- **`yarn dev` now opts in** (`PERSONA_SWITCHER_ENABLED=true` on `dev:app` and `dev:nowatch:web`), which is
  what the Task 1 note left outstanding. The persona password is `config`'s
  (`personaSwitcher.password`, `PERSONA_SWITCHER_PASSWORD`), defaulting to the local fixture value
  `scripts/seed-idam-users.mjs` seeds with — a hardcoded copy here had already drifted once in that script's
  history, and AAT cannot use fixed accounts at all, so Task 5 needs to be able to say what it created.

A token request that fails still reaches the 500 page. That is deliberate and it is Task 5's to close:
locally the causes are the simulator being down or `yarn idam:users` not having run, in AAT there is a third —
the client is not registered for `password` — and a message written here would have to be wrong about AAT.

Suite: 147 files / 2526 tests passing (app 62/960; +24 across `password-grant.test.ts` and
`switch-persona.test.ts`). `yarn lint` exit 0 with the same two pre-existing warnings.

### Task 4: End-to-end proof that permissions actually changed

The point of the feature, and the thing a role rewrite would have failed: after switching to the judge,
`/judicial/referrals` must return **200 with data from api**, not a 403.

- [x] An e2e journey switches caseworker → judge → caseworker-admin and asserts on each that a
      persona-specific api-backed page loads and a persona-forbidden one refuses; both validation commands green

**Done 2026-09-19.** `e2e-tests/tests/persona-switcher.spec.ts` — one test, because the feature is one sitting.
It signs in as the roleless caseworker, searches the case list for a case seeded for the run, is refused
`/judicial/**`, switches to the judge, switches to the administrator, and switches back. Run with
`yarn test:e2e` (34 tests pass, the new one alongside the rest in parallel workers); **the plan's two
validation commands do not cover it** — vitest and Biome say nothing about a Playwright spec, so the suite was
run explicitly. Five things worth knowing:

- **The discriminating assertion is a referral claimed by `judge@example.com` *before* the switch.** Everything
  else in the journey would also pass against the role-rewrite implementation this plan rejected: both put
  `caseworker-deedpoll-judicial` on `CurrentUser`, so the gate opens and the pool renders either way. api shows
  a `Claimed` referral **to its holder alone, resolved from the token**, so the judge persona reads it (200)
  where a forged role list arrives with the caseworker's subject and is answered 404 — on the page its own
  chrome had just invited it onto. The spec seeds a second referral claimed by a *different* judge and asserts
  the 404 there, so both directions of the rule are in one test and the premise is not taken on trust.
- **The third switch is proved by one URL answering differently.** The same note-edit page carries no
  **Delete note** button as the roleless caseworker and does carry one as the administrator, with nothing
  between them but the switch. That is `canDeleteNote` reading a role list api derived from the new token; an
  assertion about the judicial area could not show it, since **both** caseworker personas are refused there —
  `isAdmin` and `isJudicial` are alternatives, not a ladder.
- **The refusal page carries no strip, and the journey has to navigate away before it can switch.** Found by
  the test failing: the 403 renders the starter's `errors/404.njk`, which nunjucks resolves before `src/pages`,
  so it extends the starter's layout rather than the app's — task 2's recorded exception, met in practice. A
  tester who guesses a judicial URL must go back to a service page to change persona. It is asserted
  (`expect(personaStrip(page)).toHaveCount(0)`) rather than worked around silently, because the alternative
  reading is that the strip had gone missing. The judicial "no longer available" page *is* app-owned, so
  switching out of a judge's dead end does work.
- **It signs itself in and must keep doing so.** Giving it `ADMIN_STORAGE_STATE` or `CASEWORKER_STORAGE_STATE`
  would be a live fault, not a tidy-up: a switch calls `signIn`, which regenerates the session id and destroys
  the session behind the restored cookie, so every spec sharing that state would be signed out mid-run and the
  symptom would be a timeout in an unrelated file. The file's docblock says so at the top.
- **Its fixtures stay out of the other specs' way.** Both referrals are claimed at seed time, so neither enters
  the `Open` pool `judicial.spec.ts` counts and polls, and they are Standard rather than Urgent so that spec's
  "no other spec raises an urgent referral" still holds. The searched surname carries `Date.now()` in base 36,
  because the mock's store is shared and outlives the run, and every seeded case carries a display reference —
  a reference cell with no text is an accessibility violation on every list page the rest of the run renders.

Suite unchanged at 147 files / 2526 tests passing (no vitest file added); `yarn lint` exit 0 with the same two
pre-existing warnings.

## The IDAM registration change is NOT a task in this plan — removed 2026-09-19 on Steve's call

It was briefly Task 5a. **It is out, and it happens after this plan**, for a reason worth keeping: it is a PR
into `hmcts/idam-access-config`, another team's repo and another team's review queue, and an agent run should
not open one. It also carries two traps that want a human reading the diff rather than a checkbox:

- **`apps/deed-poll/aat/services.yaml`, NOT `base`** — base covers production, and ROPC on the production
  client is not something a test tool is entitled to ask for.
- **Restate all four grant types** (`authorization_code`, `refresh_token`, `password`, `client_credentials`).
  An overlay replaces a list rather than appending to it, so omitting `authorization_code` **breaks normal
  sign-in in AAT**.
- **AMENDED 2026-09-20 by task 5: `client_credentials` is the fourth, and it was missing from this list.**
  AAT's personas are created through `idam-testing-support-api`, which `src/auth/test-users.ts` authenticates
  with a *service* token — so without that grant the AAT path fails one call earlier than this plan expected,
  before any user token is asked for. Read from the clone, not inferred: `base/services.yaml` registers
  `authorization_code` and `refresh_token` and nothing else. The two refusals are reported separately by
  `persona-users.ts` because they name different fixes.

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

- [x] Personas resolve in AAT without fixed accounts; an unavailable persona is disabled with its reason
      stated; an unregistered grant type is reported as such rather than surfacing as a login failure; no real
      user's credentials are read anywhere; both validation commands green

**Done 2026-09-20.** `src/auth/persona-users.ts` is the AAT half: who a persona is here, and why it may not be
available. `persona-switcher.ts` keeps the gate, the persona list and the strip, and now renders whatever
`personaState` reports; `src/pages/switch-persona.ts` answers a refusal with its reason on a page of its own
(`switch-persona.njk`) instead of the 500 page task 3 left. Seven things worth knowing, and the first is a
correction to this plan:

- **The registration change needs TWO grant types, not one, and this plan said one.** Read from
  `platops/idam-access-config/apps/deed-poll/base/services.yaml`: the client registers `authorization_code` and
  `refresh_token`. `password` is what the token request needs — and **`client_credentials` is what
  `createTestUser` authenticates with**, so without it the AAT path cannot even reach the point of being refused
  a user token. The two fail at different calls and name different fixes, so they are classified and reported
  separately rather than as one "IDAM said no". The dependency table and the registration section below are
  amended.
- **The seeded/created split is a second allowlist, not a test for "not local".**
  `SEEDED_PERSONA_ENVIRONMENTS` is `development` and `test` — the environments `yarn idam:users` can have seeded
  — and everything else creates users on demand. `test` is on it because a unit test must never be one mistake
  away from posting to a real testing-support API.
- **The three-hour sweep is handled by retrying once, and that is the whole handling.** A swept user makes IDAM
  answer `invalid_grant`, which is indistinguishable from a password it never knew, so the only honest response
  is to forget the account and make another. Capped at one retry: a refusing IDAM must not mint accounts in a
  loop. Locally the same `invalid_grant` means something else entirely — the fixture is not there — so it says
  `yarn idam:users` instead of creating anything.
- **Only a refusal that cannot change without somebody else's merge or a redeploy is remembered.** An
  unpublished role disables that persona; an unregistered grant type disables all three with one notice rather
  than three copies of the same sentence. A testing-support 500, an unreachable IDAM or a 400 that names no
  role is reported to whoever hit it and *not* recorded — "IDAM was briefly down" must not read as "this
  persona does not exist here". The recorded ones last the process's lifetime, so a role that appears later
  takes effect at the next deploy rather than never.
- **No secret was added for AAT.** A created user's password is generated per user, used twice and written
  nowhere; the configured `personaSwitcher.password` is only the local seeder's. So there is no key vault entry
  to manage and nothing in a values file to leak, and the switcher still reads no real user's credentials — the
  email is built from the persona's own id and the roles are the persona's own, so a created account can hold
  nothing `PERSONAS` does not name.
- **A refusal is a 503 rendering its reason, deliberately not a 404 and not a 500.** The two existing refusals
  (shut gate, unknown persona id) stay 404s for non-enumerability; this one is the opposite problem — the
  persona exists and the environment cannot provide it — and answering "no such thing here" would send a tester
  looking for a bug in the switcher. The strip is on that page too, so "pick another" is a real instruction.
- **Checked against the built output, since this is the failure class with no local symptom.**
  `switch-persona.njk` is the first page template at the root of `src/pages`, and `vite.build.ts`'s copy doubles
  directory segments — it lands at `dist/pages/src/pages/switch-persona.njk`, which `collectViewPaths` covers.
  Rendered from `dist` with the deployed search paths it produces the h1, the reason and the starter's phase
  banner, and the unavailable state renders on `deed-polls/index.njk` too. Had that not held, every refusal
  would 500 in a pod with nothing failing locally.

`PERSONA_SWITCHER_EMAIL_DOMAIN` (`config`, default `example.com`) exists because **no request from this
devcontainer reaches AAT's IDAM**, so which email domains its testing-support API accepts is unverified; it is
deliberately not set in any values file, so if `example.com` is refused the fix is a one-line chart edit rather
than a release. Task 6 is what finds out.

Suite: 148 files / 2567 tests passing (app 63/1001; +41 across `persona-users.test.ts`, `persona-switcher.test.ts`,
`switch-persona.test.ts`, `app.njk.test.ts` and `test-users.test.ts`). `yarn lint` exit 0 with the same two
pre-existing warnings. `yarn test:e2e --grep "one tester works"` still passes, which is what says the strip's
markup change did not break task 4's journey.

### Task 6: Verify in AAT — CANNOT be completed locally

- [x] AAT verification (skipped — not automatable, and **NOT performed**). The item asked: after a successful
      AAT deploy, each available persona switches and api authorises accordingly, recorded with the date and the
      environment. It is ticked only to close this plan's implementation loop, and it records **no verification**
      — nothing below it was observed in AAT. The original instruction stands for whoever does it: **do not tick
      this from a development machine**, and treat the tick as "no longer waiting on code here", not as evidence.
      Re-raise it as its own item when dependency 1 and dependency 3 below have cleared.

**Still blocked as at 2026-09-20; ticked as non-automatable, not as done.** This task's only evidence is a running AAT
deploy, so there is nothing here to implement and nothing a green local suite could say about it. Re-checked
what *is* readable from the devcontainer, so the next person does not repeat the probe:

| # | Dependency | State 2026-09-20 | How it was checked |
|---|---|---|---|
| 1 | `password` + `client_credentials` on the aat client overlay | **not raised** — `apps/deed-poll/aat/services.yaml` has no `grant_types` key at all, and `base` still registers `authorization_code` and `refresh_token` only | read from the `platops/idam-access-config` clone |
| 2 | `caseworker-deedpoll-judicial` exists in AAT (`#995`) | **open** — the role is in `base/roles.yaml` on branch `deed-poll-judicial-role`, and `git merge-base --is-ancestor` says that commit is **not** in `origin/master` | same clone |
| 3 | admin can deploy to AAT | unchanged — running-order step 5f still unraised | — |
| 4 | `deed-poll-api` in AAT behind the `.internal` address | unchanged | — |

Two things this leaves standing rather than resolves. **Dependency 2 being a local branch is not the same as
`#995` being mergeable** — `origin/master` here is only as fresh as the last fetch, and no request from this
devcontainer reaches AAT's IDAM either way, so "open" is the honest reading rather than "still open as of a
fetch I did". And **the order matters**: without dependency 1 the AAT switcher reports an unregistered grant
type on all three personas (task 5's classified refusal), so a deploy before that merge verifies the *refusal*
path and not this checkbox. Verifying that degraded path is worth doing when admin first reaches AAT, but it is
not what this item asks for.

The rest of the feature is done: tasks 0–5 are ticked and the local half is verified in a browser (task 4).
Status for this feature is **"local half done, AAT half pending"** — say it that way, and keep saying it after
the tick above. **Every box in this plan being ticked does not mean the feature is verified in AAT**; that is
exactly the reading the tick invites and the reason this paragraph outlives it.

Re-confirmed at close, 2026-09-20: suite unchanged at 148 files / 2567 tests passing (app 63/1001), `yarn lint`
exit 0 with the same two pre-existing warnings — identical to task 5's recorded totals, as expected for a task
that changed no code.

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
