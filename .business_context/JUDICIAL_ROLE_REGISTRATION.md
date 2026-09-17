# IDAM registration — the judicial role (idam-1 of the referrals feature)

Prepared 2026-09-17. This is the "idam-1" piece of the in-app referrals-to-the-judiciary feature (seven
plans across api/idam/admin — see the api plans in `deed-poll-api/docs/plans/referrals-api-*.md` and the
workspace memory `deed-poll-referrals-feature`). It is config-only and too small to warrant a ralphex run,
so it is a prepared PR rather than a plan.

## What it is

One new role added to `hmcts/idam-access-config`, `apps/deed-poll/base/roles.yaml`:

```yaml
  caseworker-deedpoll-judicial:
    environment_exclusions: [demo, ithc, perftest, prod]   # identical to the admin role, same reasons
    name: caseworker-deedpoll-judicial
    description: Deed poll judiciary who direct referred applications from the shared referral pool
    managed_by:
      - ccd-admin
```

The claim value **`caseworker-deedpoll-judicial`** follows the `caseworker-{product}-{subrole}` convention
(`deed-poll` → `deedpoll`, exactly as `caseworker-deedpoll-admin` did) and is the string
`deed-poll-api`'s `Role.JUDICIAL` is compiled against — api-2 adds
`JUDICIAL("caseworker-deedpoll-judicial")` to the `Role` enum, and api-3 gates its `/judicial/**` HTTP
surface on it. If the registered string differs from that literal, every judicial token resolves to no
judicial role and the judicial screen is inaccessible — it fails closed, the same way the admin role does.

## Two things that are deliberately NOT here

- **No `services.yaml` change — no new IDAM client.** The judiciary use a role-gated screen *inside*
  `deed-poll-admin` (admin-3 — "NOT a separate app"), so they authenticate through the existing
  `deed-poll-admin` client and are distinguished only by the role on their token. A judicial client would
  only be needed if the judiciary got their own front-end origin, which the feature deliberately avoids.
- **No new redirect URIs, vault entries, or SSO config.** All inherited from the merged `deed-poll-admin`
  client (#993).

## The one correctness constraint

`roles.yaml` carries `environment_exclusions: [demo, ithc, perftest, prod]` because the
`deed-poll-<<ENV>>` Key Vaults exist only for AAT (demo/ithc/perftest) and prod roles are painful to change
once created. The file's own comment states **roles and services exclusions are kept in step by hand**. The
judicial role therefore carries the *identical* exclusion list. If the admin role's exclusions ever change,
change this role's to match in the same PR.

## Status and how to finish it

- **PR #993 (the admin client + role) is MERGED** — it merged 2026-09-16 (the `idam-pr/` snapshot and the
  older banner in `IDAM_REGISTRATION_REQUEST.md` predate the merge and say "open and unmerged"; that is
  stale). So the judicial role is a **fresh, second PR**, not an amendment to #993.
- The change is committed locally on branch **`deed-poll-judicial-role`** in the
  `platops/idam-access-config` clone (commit `445e849`, 13-line addition to `base/roles.yaml`). That clone
  is gitignored and on a named volume, so the branch is **not durable** — this file is the durable record.
- **The push and PR must be done from Steve's machine, not the devcontainer** — pushing to `hmcts` needs
  SAML SSO that is not available here (the same reason #993 was raised from outside the container). To
  finish, from the `platops/idam-access-config` clone:

  ```
  git push -u origin deed-poll-judicial-role
  gh pr create --repo hmcts/idam-access-config --base master \
    --title "Add caseworker-deedpoll-judicial role for deed-poll" \
    --body "The judiciary direct referred applications from a shared pool via a role-gated screen in deed-poll-admin (no new client). deed-poll-api gates its /judicial/** surface on this claim value. Same environment_exclusions as caseworker-deedpoll-admin."
  ```

## What local testing cannot verify

Same caveat as the admin role: the real claim value is unconfirmed until seen on a live token, and it fails
closed if wrong (a judge sees no judicial screen rather than an error). `rse-idam-simulator` can issue a
token carrying `caseworker-deedpoll-judicial` for local end-to-end testing of the api gate and the admin
screen before the real role exists.
