# IDAM registration — PR to idam-access-config

Updated 2026-09-03. Registration is via PR to `hmcts/idam-access-config`, not an email request. The
configuration below follows the standard OIDC pattern from the CFT IDAM developer guide.

> **2026-09-17: #993 has since MERGED (2026-09-16), so the `deed-poll-admin` client and the
> `caseworker-deedpoll-admin` role are now live upstream.** Everywhere below that says #993 is "open and
> unmerged" is a 2026-09-10 snapshot and is stale. The merged `base/roles.yaml` also grew an
> `environment_exclusions: [demo, ithc, perftest, prod]` block (the vaults exist only for AAT). A separate
> **judicial** role for the referrals feature is prepared as a second PR — see
> [`JUDICIAL_ROLE_REGISTRATION.md`](JUDICIAL_ROLE_REGISTRATION.md).

> **The hostnames in this document are wrong, and the PR carrying them has to be corrected before it
> merges. Corrected 2026-09-10 by plan 03 task 4.**
>
> Every `deed-poll-deed-poll-admin-staging-web.aat.platform.hmcts.net` below — and the "the doubled segment
> is deliberate — per platform pattern" note near the end — came from reading
> `helm/deed-poll-admin/values.template.yaml`'s
> `${TEAM_NAME}-{{ .Release.Name }}-web.${ENVIRONMENT}.platform.hmcts.net` as if both variables expanded to
> the product name and the environment. Neither does. `helmInstall` exports exactly `NAMESPACE`,
> `SERVICE_NAME`, `IMAGE_NAME`, `SERVICE_FQDN` and `INGRESS_IP`, so `ENVIRONMENT` was unset and `envsubst`
> replaced it with an empty string — a doubled dot, not an environment. `TEAM_NAME` is
> `TeamConfig.getName(product)`, a team *display* name looked up in `cnp-jenkins-config/team-config.yml`
> (pcs's is `"Possession Claim Service"`, spaces included) that falls back to the constant `pleaseTagMe` for
> a product the file does not list — and `deed-poll` is not listed. So the host that template actually
> rendered was nearer `pleaseTagMe-deed-poll-admin-staging-web..platform.hmcts.net`. It was never a pattern;
> it was two undefined variables.
>
> **The chart now uses `${SERVICE_FQDN}` in AAT and preview and a stable service host elsewhere, so the
> hosts to register are:**
>
> | Where | Host |
> |---|---|
> | `base/services.yaml` | `https://deed-poll-admin.<<ENV>>.platform.hmcts.net/oauth2/callback` |
> | `aat/services.yaml` | `https://deed-poll-admin-staging.aat.platform.hmcts.net/oauth2/callback` and `http://localhost:3000/oauth2/callback` — **not** the base entry as well |
>
> `SERVICE_FQDN` is `azPrivateDns.getHostName(aksServiceName)` where `aksServiceName` is
> `${product}-${component}-${imageTag}`, which is why AAT's is `deed-poll-admin-staging`. An environment
> overlay *replaces* `redirect_uris` rather than appending to them — `apps/pcs/aat` restating
> `pcs.aat.platform.hmcts.net`, which its own `base` already produces from `<<ENV>>`, is what shows this,
> and it is not verified in that repo's tooling. Normally that means an overlay has to restate the base
> entry or it silently drops it; here it deliberately does not, because **in AAT this app serves only on
> `${SERVICE_FQDN}`**, so `deed-poll-admin.aat…` would be registered surface nothing uses.
> `post_logout_redirect_uris` take the same hosts without the `/oauth2/callback`.
>
> **#993 was corrected on its own branch on 2026-09-10 and now states all of this. It is still open and
> unmerged**, so nothing is registered yet. Three corrections went in, all of which fail the same silent way
> — on IDAM's own page after a successful login, where nothing in this repo logs anything:
>
> 1. **AAT's host** → `deed-poll-admin-staging.aat.platform.hmcts.net`, replacing the hand-rolled host.
> 2. **Everything else** → one templated `https://deed-poll-admin.<<ENV>>.platform.hmcts.net/oauth2/callback`
>    in `base/services.yaml`. `<<ENV>>` substitutes inside a redirect URI — `apps/pt`, `apps/pcs`, `apps/fis`,
>    `apps/disposer`, `apps/sptribs` and `apps/financial-remedy` all rely on it — and that repo's README says
>    `base/` reaches **every** environment including production. So the four near-identical env folders
>    collapsed to `base` plus an `aat` overlay, and `base`'s `redirect_uris: []  # Production TBD` was wrong
>    rather than pending: the chart does state a production host, and it is that expression. `localhost` stays
>    in the `aat` overlay only, because a loopback redirect on the production client would let anyone holding
>    an authorization code redirect it to a listener on their own machine.
> 3. **The vault secret name** → `<<vault.admin-idam-client-secret>>`. The PR had
>    `<<vault.idam-client-secret>>`, which is not what this chart reads. The component-prefixed name is the
>    one to keep — three components share the one `deed-poll-<<ENV>>` vault, `deed-poll-web` will need its
>    own client, and `apps/pcs` names its two `pcs-api-idam-secret` / `pcs-frontend-idam-secret` for exactly
>    that reason. It is also the name `hmcts/deed-poll-infra` documents.
>
> The `aat` overlay deliberately does *not* restate `base`'s entry, unlike `apps/pcs/aat`: an overlay replaces
> the list rather than appending to it, and in AAT the app serves only on `${SERVICE_FQDN}`. #993's description
> asks IDAM to correct that reading if it is wrong.
>
> **Once #993 merges, changing a host takes a second PR.** The chart side is
> `charts/deed-poll-admin/values.yaml` and `values.aat.template.yaml`, and `src/deployment-chart.test.ts` pins
> it; nothing mechanically checks the two against each other, so treat a change to either as a change to both.
>
> **Preview is still an open question, not a solved one.** The "AAT auto-adds `https://allow-pr-redirects`
> and IDAM rewrites `pr-[0-9]+` hostnames" claim below is unverified, and `idam-access-config` registers
> nothing for `pcs-frontend`'s preview environments at all — so either IDAM permits a pattern that repo does
> not show, or pcs preview sign-in does not work. Ask; do not invent a wildcard.

**The PR is raised — 2026-09-03**, by Steve, outside the devcontainer (pushing to `hmcts` needs SAML SSO
authorization that is not available here). **The six files it carries are committed verbatim at
[`idam-pr/`](idam-pr/)** — `base/services.yaml`, `base/roles.yaml` and the aat/demo/ithc/perftest
overrides — so the request itself is a record rather than prose describing one. That directory is the
artefact; this document is the reasoning behind each value. Where the two disagree, the YAML is what was
submitted.

**This document is now the record of what was asked for, not a task.** Keep it as the reference to check
what IDAM actually provisions against what was requested. Nothing here is an open question — see that
section below — but three things are unverified rather than settled, and all three fail quietly:

1. **The role string.** `caseworker-deedpoll-admin` follows the convention but has never been seen on a
   real IDAM token. Wrong, and it reads as "nobody can edit privacy" rather than as an error.
2. **CFT IDAM's `/o/userinfo` shape**, which is assumed to match the simulator's `IdamUserInfo`.
3. **PKCE and client-secret enforcement.** `rse-idam-simulator` checks neither — it has no
   `code_challenge` handling, and `getOpenIdToken` takes `client_secret` and never reads it — so local
   runs prove this client's half and nothing about the issuer's. Real IDAM is expected to enforce both,
   which is an expectation to confirm by observation, not a question that was asked.

**Production redirect URIs are deliberately empty** in `idam-pr/apps/deed-poll/base/services.yaml` and
must be added before any production deployment. Nothing enforces that — IDAM refuses an unregistered
`redirect_uri`, and the refusal lands on IDAM's own page after a successful login, where no request
reaches our logs.

**Nothing in Phase 5 can be verified against real IDAM until this is merged and deployed.** The flow
itself is built and works — see "What is already done" below — so this is a configuration handshake, not
a design question.

---

## The configuration for idam-access-config

**This is what `hmcts/idam-access-config#993` carries as of 2026-09-10, not a proposal.** Two files, plus
`base/roles.yaml`. The original submission is snapshotted at [`idam-pr/`](idam-pr/) and now differs from
this — see the banner above for the three corrections and the folder collapse.

`apps/deed-poll/base/services.yaml`:

```yaml
services:
  deed-poll-admin:
    client_id: deed-poll-admin
    vault: deed-poll-<<ENV>>
    client_secret: <<vault.admin-idam-client-secret>>   # component-prefixed; the vault is shared
    hmcts_access:
      idam_frontend: HMCTS_ACCESS      # Professional-facing service
      mfa_required: false               # Existing caseworker accounts
      self_registration_allowed: false  # Caseworkers only, no self-reg
      sso_providers:
        - moj                           # HMCTS caseworker SSO
    oauth2:
      required_issuer: IDAM
      grant_types:
        - authorization_code
        - refresh_token                 # For session refresh without re-authentication
      scopes:
        - openid
        - profile
        - roles
        - offline_access                # Required for refresh_token grant
      # What the chart renders from `global.environment` in every environment this folder reaches,
      # production included. No localhost here — see the banner. Preview is unresolved, not covered.
      redirect_uris:
        - https://deed-poll-admin.<<ENV>>.platform.hmcts.net/oauth2/callback
    oidc:
      post_logout_redirect_uris:
        - https://deed-poll-admin.<<ENV>>.platform.hmcts.net/
```

`apps/deed-poll/aat/services.yaml` — AAT alone, because it is the only environment where the chart uses the
`${SERVICE_FQDN}` the pipeline computes. It replaces the list above rather than adding to it:

```yaml
services:
  deed-poll-admin:
    client_id: deed-poll-admin
    oauth2:
      redirect_uris:
        - http://localhost:3000/oauth2/callback
        - https://deed-poll-admin-staging.aat.platform.hmcts.net/oauth2/callback
    oidc:
      post_logout_redirect_uris:
        - http://localhost:3000/
        - https://deed-poll-admin-staging.aat.platform.hmcts.net/
```

## Answered questions (from idam-access-config repo patterns):

**Preview environment redirect URIs**: ~~AAT automatically adds `https://allow-pr-redirects` to all
services' `redirect_uris`. IDAM internally rewrites URLs containing `pr-[0-9]+`, so PR-specific
redirects work without manual registration. No action needed.~~ **This was never verified and does not
belong under "answered".** `idam-access-config` registers nothing for `pcs-frontend`'s previews either, so
either IDAM permits a pattern that repo does not show or preview sign-in does not work there. #993's
description asks IDAM directly. The hostname in the struck-through claim was also the hand-rolled one.

**Role naming**: Based on `hmcts/idam-access-config` patterns (adoption, CCD, XUI), recommend
`caseworker-deedpoll-admin` following the `caseworker-{product}-{subrole}` convention. This is the name
that:
- Goes in the YAML roles config
- Must match `libs/deed-poll/src/auth/roles.ts` hardcoded value
- Test users get assigned via `role_names` field
- Fails closed if wrong — nobody can edit privacy

**API separate registration**: Other services (adoption, CCD) register APIs separately. For example,
adoption has `adoption-cos-api` and `adoption-web` as distinct clients. However, this may not be needed
if the API only validates tokens issued to the web client (as ours does). Suggest starting with web-only
registration; add API registration if token validation requires it.

**Role naming confirmed**: `caseworker-deedpoll-admin` follows HMCTS IDAM conventions. Products with
hyphens in folder names remove the hyphen in role names: `private-law` → `caseworker-privatelaw-*`,
`money-claims` → `caseworker-cmc-*`. Our `deed-poll` → `caseworker-deedpoll-admin` matches this pattern.

**`tokenName` claim confirmed present**: IDAM access tokens include `tokenName: "access_token"` and ID
tokens include `tokenName: "id_token"` (verified in `hmcts/rse-idam-simulator` source). Our check in
`apps/api/src/auth/idam.ts` to refuse ID tokens as bearer credentials will work against real IDAM.

**`post_logout_redirect_uris` registration**: Added to `oidc:` section. Optional but recommended — other
services (divorce, civil) register them. AAT auto-adds `https://allow-pr-redirects` for PR environments.

## Open questions for IDAM team:

None — all questions answered by examining `hmcts/idam-access-config` patterns and
`hmcts/rse-idam-simulator` source code.

## Issuer URLs per environment

Our code uses OIDC discovery, so we need the base URL per environment:

- **Local**: `http://localhost:5556/o` (rse-idam-simulator)
- **AAT**: `https://hmcts-access.aat.platform.hmcts.net`
- **Production**: `https://hmcts-access.service.gov.uk`

These are set via `IDAM_ISSUER_URL` environment variable, wired through Helm values per environment.

## Notes on the configuration

---

**Client ID and vault path**: The client secret goes to `deed-poll-{env}/admin-idam-client-secret`, which is
the name `charts/deed-poll-admin/values.yaml` reads and the one `hmcts/deed-poll-infra` documents. It is
component-prefixed because the vault is shared with `deed-poll-web` and `deed-poll-api`; `apps/pcs` prefixes
its two the same way. #993 originally said `idam-client-secret` and was corrected — see the banner.

**Product code**: `deed-poll-admin` per `{product}-{component}` naming. Product is `deed-poll`,
component is `admin` — used consistently in Helm annotations, vault names, and image paths.

**Hostnames**: ~~`deed-poll-deed-poll-admin-{release}-web.{env}.platform.hmcts.net`. The doubled segment
is deliberate — product `deed-poll` then component `admin` per platform pattern, not a typo.~~
**Wrong, and superseded 2026-09-10 — see the banner at the top of this file.** The doubled segment was an
unset `${ENVIRONMENT}` expanding to nothing, and the leading segment was `${TEAM_NAME}`, which is a team
display name and not the product. The hosts to register are
`deed-poll-admin.<<ENV>>.platform.hmcts.net` and, for AAT, `deed-poll-admin-staging.aat.platform.hmcts.net`.

**Why `refresh_token` grant and `offline_access` scope**: Allows the service to refresh access tokens
before they expire, keeping users logged in without re-authentication. More importantly, gives IDAM
centralized control over access revocation — if a user's access is revoked, the next token refresh
fails and they're logged out immediately, rather than lingering until session expiry.

**Why `HMCTS_ACCESS` and `mfa_required: false`**: Professional-facing service for existing caseworkers.
They use their existing IDAM accounts (no self-registration), no MFA required.

**Why `sso_providers: [moj]`**: HMCTS caseworkers authenticate via MOJ SSO. This allows them to use their
existing enterprise credentials rather than separate IDAM passwords.

**The role name**: `caseworker-deedpoll-admin` (kebab-case, no spaces) following patterns from
`hmcts/idam-access-config`. Updated in `libs/deed-poll/src/auth/roles.ts` to match. If this doesn't
match the registered name, every caseworker resolves to no roles, which fails closed (nobody can edit
privacy).

**Why `post_logout_redirect_uris`**: Directs users back to the service root after logout completes at
IDAM. Optional but recommended — ensures users see a clean logged-out state rather than being left at
IDAM's end-session page.

## Folder structure for the PR

**See [`idam-pr/`](idam-pr/), which holds the submitted files themselves.** The prose that used to be
here has been removed rather than kept alongside them: it listed only `base/` and `aat/` where the PR
carries four environment overrides, so it had already drifted from what was sent, and two copies of the
same YAML can only ever disagree. [`idam-pr/README.md`](idam-pr/README.md) explains the three things
about the contents that are not self-evident — the deliberately empty production URIs, the doubled
hostname segment, and why `demo`/`ithc`/`perftest` are there at all.

## What is already implemented

The registration is a config change, not a build — the flow is complete:

- Authorization code flow with PKCE, `state`, and ID-token validation against issuer's JWKS
  (`apps/web/src/auth/idam.ts`), using OIDC discovery not hardcoded endpoints.
- **Refresh token support** (`apps/web/src/auth/refresh-middleware.ts`): automatically refreshes access
  tokens 5 minutes before expiry, keeping sessions alive without re-authentication. If refresh fails
  (revoked/expired), forces re-login immediately.
- Bearer-token validation in API (`apps/api/src/auth/idam.ts`): signature against JWKS via `jose`'s
  `createRemoteJWKSet`, then `iss`, `aud`, `exp`, with roles from `/o/userinfo`.
- Session-backed sign-in with session-id regeneration on login (`apps/web/src/auth/session.ts`).
- `requireAuth` mounted globally with public allowlist — new pages are protected by default.
- Logout: local session destruction then IDAM's `end_session_endpoint` with `id_token_hint`.
- Config wired through environment variables: `IDAM_ISSUER_URL`, `IDAM_CLIENT_ID`,
  `IDAM_CLIENT_SECRET`, `IDAM_REDIRECT_URI`, `IDAM_SCOPE`.
- Verified end-to-end against `hmcts/rse-idam-simulator` via `docker compose` — roles from
  `/o/userinfo`, not ID token. **Not verified**: PKCE challenge and client_secret enforcement (simulator
  accepts but doesn't validate either). `state`, single-use codes, and bearer-gated `/o/userinfo` were
  verified.

**What local testing cannot verify**: The real role name (`deedpoll-admin` is a placeholder), and
whether CFT IDAM's `/o/userinfo` matches the simulator's `IdamUserInfo` shape. Both fail closed if wrong
— wrong role means "nobody can edit privacy", not an error.
