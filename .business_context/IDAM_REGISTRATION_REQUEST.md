# IDAM registration — PR to idam-access-config

Updated 2026-09-03. Registration is via PR to `hmcts/idam-access-config`, not an email request. The
configuration below follows the standard OIDC pattern from the CFT IDAM developer guide.

**The PR is raised — 2026-09-03**, by Steve, outside the devcontainer (pushing to `hmcts` needs SAML SSO
authorization that is not available here). It carries the 6 files described under "Folder structure for
the PR" below: `base/services.yaml`, `base/roles.yaml`, and the aat/demo/ithc/perftest overrides.

**This document is now the record of what was asked for, not a task.** Keep it as the reference to check
IDAM's answers against — in particular the two open questions below, and the two things only real IDAM
can settle (whether the role string really is `caseworker-deedpoll-admin`, and whether CFT IDAM's
`/o/userinfo` matches the simulator's `IdamUserInfo` shape). Both fail closed, so a wrong answer shows up
as "nobody can edit privacy" rather than as an error.

**Nothing in Phase 5 can be verified against real IDAM until this is merged and deployed.** The flow
itself is built and works — see "What is already done" below — so this is a configuration handshake, not
a design question.

---

## The configuration for idam-access-config

Add this to the appropriate services file in `hmcts/idam-access-config`:

```yaml
services:
  deed-poll-admin:
    client_id: deed-poll-admin
    vault: deed-poll-<<ENV>>
    client_secret: <<vault.idam-client-secret>>
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
      redirect_uris:
        - http://localhost:3000/oauth2/callback  # Local development
        - https://deed-poll-deed-poll-admin-staging-web.aat.platform.hmcts.net/oauth2/callback
        # Preview: AAT auto-adds https://allow-pr-redirects which IDAM rewrites for pr-* hostnames
        # Production TBD
    oidc:
      post_logout_redirect_uris:
        - http://localhost:3000/             # Local development
        - https://deed-poll-deed-poll-admin-staging-web.aat.platform.hmcts.net/
        # Preview: AAT auto-adds https://allow-pr-redirects (same as redirect_uris)
        # Production TBD
```

## Answered questions (from idam-access-config repo patterns):

**Preview environment redirect URIs**: AAT automatically adds `https://allow-pr-redirects` to all
services' `redirect_uris`. IDAM internally rewrites URLs containing `pr-[0-9]+`, so PR-specific
redirects (`deed-poll-deed-poll-admin-pr-123-web.preview.platform.hmcts.net/oauth2/callback`) work
without manual registration. No action needed.

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

**Client ID and vault path**: Following the standard pattern. The client secret will be stored at
`deed-poll-{env}/idam-client-secret` (already wired in `apps/web/helm/values.yaml`).

**Product code**: `deed-poll-admin` per `{product}-{component}` naming. Product is `deed-poll`,
component is `admin` — used consistently in Helm annotations, vault names, and image paths.

**Hostnames**: `deed-poll-deed-poll-admin-{release}-web.{env}.platform.hmcts.net`. The doubled segment
is deliberate — product `deed-poll` then component `admin` per platform pattern, not a typo.

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

Following `hmcts/idam-access-config` repo conventions, create:

```
apps/
  deed-poll/
    base/
      services.yaml      # Configuration above (with prod redirect URIs)
      roles.yaml         # Role definition below
    aat/
      services.yaml      # AAT overrides: localhost + staging redirect URIs
```

**`apps/deed-poll/base/services.yaml`**: The configuration above, with production redirect URIs added
when known.

**`apps/deed-poll/base/roles.yaml`**:
```yaml
roles:
  caseworker-deedpoll-admin:
    name: caseworker-deedpoll-admin
    description: Deed poll admin caseworkers who can set case privacy to Private
    managed_by:
      - ccd-admin
```

**`apps/deed-poll/aat/services.yaml`**: Override redirect URIs for AAT to include localhost:
```yaml
services:
  deed-poll-admin:
    client_id: deed-poll-admin
    oauth2:
      redirect_uris:
        - http://localhost:3000/oauth2/callback
        - https://deed-poll-deed-poll-admin-staging-web.aat.platform.hmcts.net/oauth2/callback
    oidc:
      post_logout_redirect_uris:
        - http://localhost:3000/
        - https://deed-poll-deed-poll-admin-staging-web.aat.platform.hmcts.net/
```

## Notes for raising the PR

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
