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
  mfa_required: false               # Using existing caseworker accounts
  self_registration_allowed: false  # Caseworkers only
```

## Test Users

Test users are created programmatically via **`idam-testing-support-api`**:

1. Authenticate using client credentials (our client ID/secret)
2. Call `POST /test/idam/users` with email, password, roles
3. Users auto-cleanup after 3 hours in AAT
4. Can retrieve activation emails via `GET /test/idam/notifications/latest/:email`

No manual test user setup needed — all done via API after client registration.

## Vault Configuration

Client secret stored at: `deed-poll-{env}/idam-client-secret`

Where `{env}` is `aat`, `perftest`, `prod`, etc. Already wired in `apps/web/helm/values.yaml`.

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
