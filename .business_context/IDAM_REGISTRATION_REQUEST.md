# IDAM registration request — draft for Steve to send

Drafted 2026-09-01. **Nothing in Phase 5 can be verified against real IDAM until this is answered**, so
it wants sending before the remaining Phase 5 work rather than at the end of it. The flow itself is
built and works — see "What is already done" below — so this is a configuration handshake, not a
design question.

Send to whoever owns CFT IDAM service registration (IDAM support / the `#idam` channel). Two of the
answers, the client secret and the role name, are the ones that block.

---

## The message

> **Subject: New OIDC client registration for deed-poll-admin (caseworker back-office)**
>
> Hello,
>
> We are building `deed-poll-admin`, a new caseworker back-office replacing a Dynamics 365
> application for deed poll enrolment. It is a Node/Express service on the
> `hmcts/expressjs-monorepo-template` stack, and we need an OIDC client registered so caseworkers can
> sign in with their IDAM accounts.
>
> We have implemented the authorization code flow with PKCE, per
> `docs/reference/standards/authentication-and-authorization.md`, using `openid-client` and OIDC
> discovery — so we read your endpoints from `/.well-known/openid-configuration` rather than hardcoding
> them.
>
> Could you please confirm or provide:
>
> 1. **Client ID and secret** for a confidential client. We have assumed a client id of
>    `deed-poll-admin`; happy to take whatever you prefer.
> 2. **Registered redirect URIs.** The path is `/oauth2/callback` on the web app. Our hostnames are
>    `<team>-<release>-web.<env>.platform.hmcts.net`, where the release name is `deed-poll-admin-staging`
>    on our main branch and `deed-poll-admin-pr-<n>` for a pull request:
>    - local: `http://localhost:3000/oauth2/callback`
>    - AAT: `https://deed-poll-deed-poll-admin-staging-web.aat.platform.hmcts.net/oauth2/callback`
>    - preview: `https://deed-poll-deed-poll-admin-pr-<n>-web.preview.platform.hmcts.net/oauth2/callback`
>    - production: to follow
>
>    **How should we handle the preview ones?** Every pull request gets its own hostname, so there is no
>    fixed URI to register — and without something, no preview environment can log in at all. The
>    platform docs point at `hmcts/chart-idam-pr` for exactly this, but that chart is archived and
>    states it has done nothing since IDAM 8.2 in February 2023, which we read as IDAM having taken the
>    job over. So: is there a wildcard or pattern registration we should ask for
>    (`deed-poll-deed-poll-admin-pr-*-web.preview.platform.hmcts.net`), or another mechanism teams use
>    now? We would rather match what everyone else does than invent something.
>
>    *(Our product is `deed-poll` and this component is `admin`, per the `{product}-{component}` repo
>    naming convention — hence the doubled segment in the hostnames, which is the platform's pattern and
>    not a typo.)*
> 3. **Issuer URL per environment**, for discovery.
> 4. **Scopes.** We currently request `openid profile roles` and read the user's roles and name from
>    `/o/userinfo` after the code exchange, rather than from the ID token — matching what
>    `rse-idam-simulator` returns. Is `roles` the right scope for that, and is anything else needed?
> 5. **The role name for our privileged users.** The service has exactly one privileged role, ported
>    from the Dynamics security role "Deed Poll Admin User". It gates one thing: whether a caseworker
>    may set a case's privacy to Private. Everyone else has read/write on everything else. We have used
>    the placeholder `deedpoll-admin`. What should it actually be, and how do we get it assigned?
> 6. **The `aud` claim on access tokens, and whether we need a second client for the API.** Our backend
>    validates the bearer token itself — signature against your JWKS, plus `iss`, `exp` and `aud` — and
>    refuses a token whose `aud` is not one we expect, so that a token issued to another CFT service
>    cannot be replayed against us. Today we expect `aud` to be the web client's id. Is that right, and
>    would you rather the API were a separately registered client?
> 7. **Whether `tokenName` is present on your access tokens.** We use it to refuse an ID token
>    presented as a bearer credential, since both carry the same `aud`. We only check it when present,
>    so no answer breaks us — we would just like to know whether the check is doing anything.
> 8. **Whether you enforce PKCE and the client secret** at the token endpoint. We send both. The local
>    simulator verifies neither, so we have not been able to prove our end is correct against anything.
> 9. **Whether we need S2S** at this stage. Our API is not yet called by another CFT service; S2S
>    becomes relevant when we integrate with CDAM for document storage, which is later work.
> 10. **`post_logout_redirect_uri`.** We send the user to your `end_session_endpoint` with
>    `id_token_hint` and a `post_logout_redirect_uri` of the service root. Does that need registering
>    too?
>
> Happy to jump on a call if that is quicker.
>
> Thanks,
> Steve

---

## Notes for whoever sends this

**The product code is settled: `deed-poll-admin`.** Per `docs/how-to/new-component/github-repo.md` an
HMCTS repo is named `{product}-{component}`, so that decomposes to product `deed-poll`, component
`admin` — which is what the repo already assumed everywhere (`annotations.team: deed-poll`, the
`hmctsprod.azurecr.io/deed-poll/…` image path, the `deed-poll-{env}` shared vault, `aadIdentityName`).
So the hostnames above are final and this no longer blocks sending the request.

Worth knowing: key vaults are `{product}-{component}-{env}` and cannot exceed 24 characters, so
`{product}-{component}` must be ≤ 15. `deed-poll-admin` is **exactly 15**, and
`deed-poll-admin-perftest` is exactly 24 — it fits, with no room to append anything later.

**The hostnames were wrong in an earlier draft of this file**, and the way they were wrong is worth
knowing because it is easy to repeat. `apps/web/helm/values.yaml` declares
`ingressHost: deed-poll-admin-web.<env>...`, which looks authoritative — but
`helm/deed-poll-admin/values.template.yaml` **overrides** it with
`${TEAM_NAME}-{{ .Release.Name }}-web.${ENVIRONMENT}...`, and `TEAM_NAME` comes from
`annotations.team` in `Chart.yaml` while `RELEASE_NAME` is `<chart name>-pr-<n>` or
`<chart name>-<change id>`. The subchart value is the one you would read first and the one that never
applies. `IDAM_REDIRECT_URI` is now set beside the `ingressHost` it has to match, in the root
templates, and `assertIdamSettings` refuses to start if it is still localhost — because the failure it
prevents happens on IDAM's page, after a successful login, where no request reaches our logs.

**The role name is the answer with the most downstream reach.** `deedpoll-admin` appears in
`libs/deed-poll/src/auth/roles.ts` and is the only value `userFromClaims` recognises. Changing it is a
one-line change plus its tests, but it has to be the real string or every caseworker resolves to no
roles — which fails closed, so the symptom will be "nobody can edit privacy" rather than an error.

## What is already done

So the reply is a config change, not a build:

- Authorization code flow with PKCE, `state`, and ID-token validation against the issuer's JWKS
  (`apps/web/src/auth/idam.ts`), using discovery rather than hardcoded endpoints.
- Bearer-token validation in the API (`apps/api/src/auth/idam.ts`): signature against your JWKS via
  `jose`'s `createRemoteJWKSet`, then `iss`, `aud` and `exp`, with roles from `/o/userinfo`.
- Session-backed sign-in with session-id regeneration on login, in `apps/web/src/auth/session.ts`.
- `requireAuth` mounted globally with a public allowlist, so a new page is protected by default.
- Logout, local first then IDAM's `end_session_endpoint`.
- Config wired through `config/custom-environment-variables.json`, so all five values arrive as
  environment variables: `IDAM_ISSUER_URL`, `IDAM_CLIENT_ID`, `IDAM_CLIENT_SECRET`,
  `IDAM_REDIRECT_URI`, `IDAM_SCOPE`.
- Verified end to end against `hmcts/rse-idam-simulator` built from source and run via
  `docker compose` — including that roles arrive from `/o/userinfo` rather than the ID token.
  **Two exceptions, both worth confirming at your end:** the client sends a correct S256 PKCE
  challenge and a `client_secret`, and the simulator verifies neither, so nothing local proves they
  are enforced — hence question 8. `state`, single-use codes and bearer-gated `/o/userinfo` are
  enforced by it and were verified.

**What the stub cannot tell us**, now that `rse-idam-simulator` has answered the rest: whether the role
string is really `deedpoll-admin`, and whether CFT IDAM's `/o/userinfo` matches the simulator's
`IdamUserInfo` shape. Both fail closed if wrong — a wrong role string reads as "nobody can edit
privacy", not as an error, which is why question 5 matters most.
