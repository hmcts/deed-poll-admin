# What was submitted to hmcts/idam-access-config

The six files under `apps/` are the IDAM client registration for `deed-poll-admin`, as raised to
[`hmcts/idam-access-config`](https://github.com/hmcts/idam-access-config) on **2026-09-03**. The paths
here mirror the target repo, so `apps/deed-poll/base/services.yaml` in this directory is
`apps/deed-poll/base/services.yaml` there.

**This is a record, not a task, and not a live copy.** It exists because the only account of what was
asked for otherwise lived in `/tmp`, and a `/tmp` that survived one session is not a record. Read it to
answer "what did we actually request?" when IDAM's provisioning is compared against it. The rationale
behind each value is in [`../IDAM_REGISTRATION_REQUEST.md`](../IDAM_REGISTRATION_REQUEST.md); this
directory is the artefact, that document is the argument.

**It will not track the upstream repo.** If IDAM amend the config on merge, or a later change is made
there, this copy becomes a snapshot of the original request rather than current state — which is what it
is for. Do not edit these files expecting anything to happen; a change to the real registration is
another PR to `idam-access-config`.

## What is in each file

| File | What |
|---|---|
| `apps/deed-poll/base/services.yaml` | the client: `authorization_code` + `refresh_token`, scopes `openid profile roles offline_access`, `HMCTS_ACCESS` frontend, `moj` SSO, MFA off, secret at `deed-poll-<<ENV>>/idam-client-secret` |
| `apps/deed-poll/base/roles.yaml` | the one privileged role, `caseworker-deedpoll-admin`, managed by `ccd-admin` |
| `apps/deed-poll/{aat,demo,ithc,perftest}/services.yaml` | per-environment `redirect_uris` and `post_logout_redirect_uris` — `localhost:3000` for local development plus that environment's hostname |

## Three things about the contents worth knowing before reading them

- **`redirect_uris` and `post_logout_redirect_uris` are empty in `base/`, on purpose.** They are
  production's, and the production hostname is not settled. **This is the gap that bites silently:**
  IDAM refuses a `redirect_uri` it does not hold, and the refusal renders on IDAM's own page *after* a
  successful login — so no request reaches our logs and nothing in this repo fails. It has to be added
  before a production deploy, and nothing will remind you.

- **The doubled segment in the hostnames is correct.**
  `deed-poll-deed-poll-admin-staging-web.aat.platform.hmcts.net` reads like a mistake and is not:
  `helm/deed-poll-admin/values.template.yaml` builds the host as
  `${TEAM_NAME}-{{ .Release.Name }}-web.${ENVIRONMENT}…`, where `TEAM_NAME` is `deed-poll` from
  `annotations.team` and the release is `deed-poll-admin-staging`. See "The deployed redirect URI was
  wrong" in [`../PROGRESS.md`](../PROGRESS.md) — the subchart's own `ingressHost` is the value you read
  first and the one that never applies.

- **`demo`, `ithc` and `perftest` are speculative.** The GitHub Actions pipeline deploys to preview (per
  PR) and AAT (on main) only, so those three hostnames follow the same pattern but have never been
  rendered from a real chart, let alone deployed. Registering them costs nothing and saves a second PR
  if those environments are ever used; do not read their presence as evidence anything deploys there.

**Preview environments need no entry here** — AAT adds a `https://allow-pr-redirects` wildcard covering
the per-PR hostnames, which is why `deed-poll-deed-poll-admin-pr-<n>-web.preview…` appears in none of
these files.
