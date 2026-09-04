
---

# Dependency alerts on master — the 2026-08/09 history

Archived from `PROGRESS.md` on 2026-09-04. **The numbers here are all superseded**: merging PR #47 put
the migration branch's lockfile on master and the open alert count fell to **3**, all of them pinned by
`prisma@7.10.0`. `PROGRESS.md` carries the current state.

Kept for two reasons. The reasoning about *why* counts moved is worth more than the counts, and the
correction at the top — a confident, wrong explanation that had to be retracted — is the single best
example in this repo of why a plausible cause is not evidence.

## Dependency alerts on master

**Resolved 2026-08-23** — [PR #36](https://github.com/hmcts/deed-poll-admin/pull/36) is merged
(`8bf8563`) and this branch has merged master to pick it up (`ce73cc5`). Kept for the reasoning, and
because the residue below is still live. History, in case the numbers are ever questioned again:

**Do not repeat the mistake this section replaces.** An earlier note in this file claimed the 97
Dependabot alerts were an artefact of the migration branch adding dependencies "to a tree that still
contains the old lockfile entries on master", and would "drop sharply once `power_app_nest/` is
deleted at the end of Phase 4". That is wrong in three ways, checked on 2026-08-23:

- **`power_app_nest/` has never been tracked.** Zero files on `origin/master`, and no commit on any
  branch has ever touched the path. Its dependencies were never in the tracked lockfile, so deleting
  the directory at the end of Phase 4 cannot change the alert count.
- **There is one tracked lockfile**, root `yarn.lock`, on both master and this branch.
- **Alerts are computed against the default branch.** This branch's lockfile change is not on
  master, so the count is master's and is unaffected by the migration either way.

The real cause of the 82 → 97 jump is the re-scaffold itself. `82e8b0d` (PR #23) replaced master's
`yarn.lock` wholesale with the template's, and it is the only change to that file on master since the
2026-08-20 Renovate bumps. The template pulls in `applicationinsights` (`libs/cloud-native-platform`),
and with it `@opentelemetry/otlp-transformer` → `@grpc/proto-loader` → `protobufjs`, plus
`@grpc/grpc-js`. That cluster alone accounts for 11 of the 41 high alerts and one of the two criticals.

Composition: 2 critical, 41 high, 49 medium, 5 low. Concentrated in a handful of transitive roots —
`protobufjs` 11, `tar` 5, `fast-uri` 5, `brace-expansion` 3.

Most of it is a stale-lockfile artefact rather than a dependency the workspace actually pins, because
the declared ranges already admit the patched versions:

| Package | Locked | First patched | Range in lockfile |
|---|---|---|---|
| `protobufjs` | 7.5.4 | 7.5.5 | `^7.5.3` — a refresh resolves it |
| `tar` | 7.5.9 | 7.5.21 | `^7.4.3` — a refresh resolves it |
| `@grpc/grpc-js` | 1.14.3 | 1.14.4 | `^1.14.3` — a refresh resolves it |
| `protobufjs` | 8.0.1 | 8.6.6 | pinned exact; needs its dependent bumped |

So this was fixable with a targeted `yarn up -R` and no manifest changes — it was **not** work to
defer to Phase 4.

**Remediated in [PR #36](https://github.com/hmcts/deed-poll-admin/pull/36)**, merged to master on
2026-08-23 from `chore/refresh-lockfile-security` — deliberately kept out of the re-platforming diff.
`yarn npm audit --all --recursive` went from 99 advisories (2 critical, 41 high, 51 moderate, 5 low) to
20 (0 critical, 7 high, 13 moderate), lockfile-only, with lint, build and test clean. This branch
merged master at `ce73cc5` and audits at the same 20; `libs/deed-poll` is unchanged at 441 tests.

The 20 that remain are pinned by their dependents rather than by us, so each needs the dependent
bumped. **11 of them are a single `protobufjs@8.0.1`**, pinned exactly by the OpenTelemetry stack under
`applicationinsights`; Renovate PR #31 (`applicationinsights` 3.16.0) should carry it. Two are not
vulnerabilities at all — `@types/config` is a stub package that `config` supersedes (delete the
dependency from `apps/api` to clear it), and `tsconfck` is merely flagged unmaintained.

**The figure 20 is as of 2026-08-23 and is now 28 on the same unchanged lockfile** — see
["Renovate PR #31"](SESSION_HISTORY_2026-09-03.md#renovate-pr-31-checked-not-merged) above, which measures both and explains why that
is new advisories rather than any change here. The `protobufjs` reasoning held up; PR #31 clears 12 rather
than 11, and by removing the dependency instead of upgrading it.

