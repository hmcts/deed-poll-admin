# IDAM Integration Summary

Notes from working through the CFT IDAM OpenID Connect Developer Guide (2026-09-02).

## Registration Process

Client registration is via **PR to `hmcts/idam-access-config`**, not email/Slack request. See
`IDAM_REGISTRATION_REQUEST.md` for the full configuration.

## Integration Pattern

Following the recommended standard OIDC pattern:
- **Entrypoint**: `hmcts-access` (OIDC discovery from `/.well-known/openid-configuration`)
- **Flow**: `authorization_code` with PKCE for browser authentication
- **Library**: `openid-client` (ESM, maintained by `jose` author)
- **Tokens**: ID token + access token + refresh token
- **User data**: Roles and name from `/o/userinfo`, not ID token (CFT IDAM's ID tokens are thin)

## Grant Types and Scopes

```yaml
grant_types:
  - authorization_code    # Browser-based user authentication
  - refresh_token         # Silent token refresh without re-authentication

scopes:
  - openid               # Required for OIDC
  - profile              # User name and details
  - roles                # User roles from /o/userinfo
  - offline_access       # Required for refresh_token grant
```

**Why refresh tokens**: Shorter session lifetimes + centralized revocation. If IDAM revokes access, the
next refresh fails and the user is logged out immediately, rather than lingering until session expiry.

## Service Configuration

```yaml
hmcts_access:
  idam_frontend: HMCTS_ACCESS      # Professional-facing
  mfa_required: false               # MFA is enforced upstream by MOJ SSO; see below
  self_registration_allowed: false  # Caseworkers only
```

## How staff authenticate (OWASP plan 03, Task 9)

Answered by Steve Newman on 2026-10-15, for OWASP finding M8 (`mfa_required: false`):

| Question | Answer |
|---|---|
| (a) Can an HMCTS Access username/password login complete for this client? | No. `@justice.gov.uk` accounts are always sent through MOJ SSO; there is no password sign-in for this client |
| (b) Does MOJ SSO (Entra) enforce MFA for these staff? | Yes, always, and staff cannot bypass it |
| (c) What does `mfa_required: true` do, and does it affect the AAT `password` grant? | Moot: the flag stays `false` (plan 03 decision 3) |
| (d) Does end-session revoke the refresh token? | Yes. No separate revoke call is needed (plan 03 Task 12 dropped) |
| (e) How long is an IDAM / HMCTS Access session? | 8 hours, shorter than this app's 10-hour absolute limit. A missed end-session hop could allow a silent sign-in for at most 8 hours |

On the strength of these, Steve accepted the M8 risk the same day: the client keeps `mfa_required: false` in
every environment. The record, its compensating controls and its voiding conditions are
[ADR-0010 in deed-poll-documentation](https://github.com/hmcts/deed-poll-documentation/blob/main/decisions/0010-staff-mfa-is-enforced-by-moj-sso.md).
**The acceptance is void if production is added to the client without a review, or if the H1 role gate is not
in place before production.** AAT testing-support personas still sign in by password without MFA, on test data
only.

## Test Users

Test users are created programmatically via **`idam-testing-support-api`**:

1. Authenticate using client credentials (our client ID/secret)
2. Call `POST /test/idam/users` with email, password, roles
3. Users auto-cleanup after 3 hours in AAT
4. Can retrieve activation emails via `GET /test/idam/notifications/latest/:email`

No manual test user setup needed — all done via API after client registration.

## Vault Configuration

Client secret stored at: `deed-poll-{env}/admin-idam-client-secret`

Where `{env}` is `aat`, `perftest`, `prod`, etc. Wired in `charts/deed-poll-admin/values.yaml`, aliased to
`IDAM_CLIENT_SECRET`. The name is component-prefixed because the vault is shared with `deed-poll-web` and
`deed-poll-api`; `hmcts/deed-poll-infra` deliberately does not provision the value, which comes from IDAM.

## Open Questions

See `IDAM_REGISTRATION_REQUEST.md` for the full list. Critical ones:

1. **Preview redirect URI pattern** — how to handle `pr-<n>` hostnames
2. **Role name** — `deedpoll-admin` is a placeholder; need the real CFT role name
3. **Separate API client** — or is web client ID sufficient for bearer token `aud`?

## Implementation Status

✅ Authorization code flow with PKCE
✅ Token refresh (5-minute expiry window)
✅ Session-based authentication
✅ Bearer token validation in API
✅ Logout with `end_session_endpoint`
✅ Tested against `rse-idam-simulator`

⏳ Real IDAM verification (blocked on registration)
