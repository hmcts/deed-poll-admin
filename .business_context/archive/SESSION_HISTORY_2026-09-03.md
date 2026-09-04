# Session history — the 2026-09-03 CI and branch work

Archived from `PROGRESS.md` on 2026-09-04, because every section here has been overtaken by events:

- **PR #47 merged** on 2026-09-04 at 06:14 (`953e1ac`). The analysis below of why its CI was red was
  correct and is kept for the reasoning, but the PR is no longer a live question. Steve's call on
  merging it as-is rather than slicing it is recorded in `WAYS_OF_WORKING.md`.
- **The 47 dead branches were deleted** on 2026-09-03, with their SHAs recorded first in
  `DELETED_BRANCHES.md` — which is the file to read if one ever needs recovering, not this one.
- **Master's CI is green** on everything except the Azure credentials.
- **Renovate PR #31 merged** on 2026-09-03.

Kept because the measurements are worth more than the conclusions, and because two of the corrections
here were expensive to arrive at: the `organization-secrets` endpoint, and the fact that `terraform
plan` fails at `azure/login` before it ever reaches the missing shared infrastructure.

---

## PR #47 and what CI actually says (2026-09-03)

**[PR #47](https://github.com/hmcts/deed-poll-admin/pull/47) is open for `feat/deed-poll-migration`** —
284 files, +24,922/−768. GitHub reports `mergeable=MERGEABLE` with `mergeStateStatus=UNSTABLE`: it
conflicts with nothing, and its checks fail.

**This is the first time CI has ever run against this branch**, and the result is the most useful thing
learned all day: **not one failure is in the branch's code.** `Build / Test / Test Changed Packages`
**passes**. Every failure is a repository-level prerequisite that has never been set up.

| Check | Why it fails | Already tracked as |
|---|---|---|
| `Build / Lint / Lint Changed Packages` | runs `yarn workspace @hmcts/postgres-prisma exec prisma validate`, which needs `DATABASE_URL`; the env is empty → `PrismaConfigEnvError` | the `DATABASE_URL` row in the credentials table, guessed there as "likely removable" — it is not removable while lint runs `prisma validate` |
| `Build & Publish` × 4 (api, web, crons, postgres) | `azure/login`: *"Not all values are present. Ensure 'client-id' and 'tenant-id' are supplied"* | `AZURE_CLIENT_ID` / `AZURE_TENANT_ID`, Phase 6 item 3 (federated credentials) |
| `Infrastructure / Terraform / Terraform Plan` | the same `azure/login` failure | ditto |
| `Security Scan / osv-scan` | *"Code Security must be enabled for this repository to use code scanning"* | **new — was not recorded anywhere.** A repository setting, not a credential. **Fixed** — see the visibility section |
| `SonarCloud Code Analysis` | ~~no `SONAR_TOKEN`~~ — **that was wrong**, see below | **Fixed** — it was the quality gate |

**A correction, because the first version of this section overstated it.** It said "the repository has no
secrets at all", from `gh api repos/hmcts/deed-poll-admin/actions/secrets` returning `total_count: 0`.
That call returns **repository** secrets only. There are **28 organisation secrets available to this
repo**, listed by `gh api repos/hmcts/deed-poll-admin/actions/organization-secrets` — and they include
`SONAR_TOKEN`, `REGISTRY_USERNAME`/`_PASSWORD`/`_LOGIN_SERVER`, `NPM_API_TOKEN` and `GITLEAKS_LICENSE`.

What is still true, and is what the Azure work rests on: **there is no `AZURE_CLIENT_ID` or
`AZURE_TENANT_ID` at either level**, nor `AZURE_CREDENTIALS_CFT_*`, nor `DATABASE_URL`. So the
federated-credentials request stands unchanged; only the Sonar diagnosis was wrong. Check
`organization-secrets` as well as `secrets` before concluding a secret is missing.

**Corrects a prediction made earlier in this session.** It was expected that `terraform plan` would fail
on `main.tf:15` / `keyvault.tf:4`, the `data` blocks reading a resource group and key vault that do not
exist. **It fails earlier than that, at Azure login**, so the missing shared infrastructure has not yet
been reached and remains unverified rather than confirmed. Terraform also logged *"No product name
provided and could not extract from Chart.yaml"*, which may be a second, separate configuration problem
and has not been investigated.

**`Deploy`, `Smoke Test` and `E2E` all report `skipping`** — the build failure gates them. So merging
would not currently produce a failed AAT deploy; it would stop before that. Good, but it also means the
deploy path stays untested.

**Master's pipeline has been failing all day, not just on this PR.** `Main` is `failure` on the merges of
#41, #43 and #44. These gaps are chronic — the pipeline has never been green, because the prerequisites
have never existed — so a red PR #47 is not evidence of anything wrong with the branch.

### So is it ready to merge?

The code is. Nothing in `feat/deed-poll-migration` is what makes CI red, and locally
`install --immutable`, `lint`, `build`, `test` (1542) and `test:e2e` (21) all pass. But **CI cannot go
green until platform onboarding happens**, which is Phase 6's external work — so "merge when CI is
green" and "merge when the gates clear" are the same statement. The recorded decision to wait therefore
still holds, and #47 is best treated as a review vehicle rather than something to merge now.


## Branch inventory

Taken 2026-09-03. **48 remote branches besides `master`; 6 relate to this codebase and 42 do not.**

Regenerate rather than trusting these numbers — they moved twice during the session as branches were
created and merged:

```sh
git fetch --prune origin
for b in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin \
             | sed 's|^origin/||' | grep -vE '^(HEAD|master|origin)$'); do
  git merge-base --is-ancestor "origin/${b}" origin/master 2>/dev/null && { echo "MERGED     $b"; continue; }
  mb=$(git merge-base "origin/${b}" origin/master 2>/dev/null)
  git rev-parse --verify -q "$mb" >/dev/null 2>&1 && echo "shares     $b" || echo "UNRELATED  $b"
done
```

### The 6 that relate to this codebase

| Branch | State | Disposition |
|---|---|---|
| `feat/deed-poll-migration` | 53 ahead, level with master, all five checks green | **the work.** Keep; still no PR by choice |
| `fix/lockfile-lodash-4.18.1` | shares history, 1 ahead, pre-rescaffold | delete — syncs `lodash 4.18.1` into a lockfile with no lodash, and touches `.pnp.cjs` / `.yarn/install-state.gz`, which this setup does not use |
| `chore/gitignore-safety-entries` | merged (#43) | delete |
| `fix/biome-manifest-lockfile-mismatch` | merged (#42) | delete |
| `fix/tsx-lockfile-sync` | merged (#44) | delete |
| `chore/rescaffold-monorepo-template` | merged (#23) | delete |

`renovate/tsx-4.x` was in this table as "merged broken"; it is merged (#41) and its branch is gone. The
lockfile it left behind is fixed by #44 — see ["Master's CI was red"](#masters-ci-was-red-twice-in-one-day).

### The 42 with no shared history, and what they actually are

**Corrects an earlier version of this section**, which said they were "branches inherited with the repo
from the template it was copied from". The *names* come from the old template, but the mechanism is
different and matters:

- **Each is a single orphan root commit** — no parent, message `Initialize <branch-name>`, all authored
  2026-08-20. So all 42 were produced by one bulk operation rather than carried over as real history.
  That is why `git merge-base` finds nothing: each is its own root.
- **Each holds a full tree snapshot** of the pre-rescaffold codebase — 2381 files on `timja-patch-1`,
  1331 on `update-axios`, 283 on `renovate/express-4.x`, 73 on a `snyk-upgrade-*` — including
  `.eslintrc.js`, `.eslintignore` and `.github/workflows/checks.yml`.
- **Those files are absent from master.** `82e8b0d` replaced the tree wholesale on 2026-08-21 and the
  repo moved from ESLint to Biome. So whatever each branch changed, it changed files that no longer
  exist, and there is no common base to diff against to recover the intent.

**Bot-named, 24** — disposable, since the bot re-raises anything still relevant:
`renovate/{babel-monorepo, chai-5.x-lockfile, codeceptjs-3.x-lockfile, cookie-parser-1.x,
eslint-config-prettier-8.x, express-4.x, major-eslint-monorepo, node-22.x-lockfile,
postcss-8.x-lockfile, require-directory-2.x}`, `renovate-label`,
`dependabot/npm_and_yarn/{azure/msal-node-2.9.2, braces-3.0.3, follow-redirects-1.15.6,
grpc/grpc-js-1.10.9, micromatch-4.0.8, phin-3.7.1, terser-5.15.0, webpack-5.94.0}`, and five
hash-suffixed `snyk-upgrade-*`.

**Human-named, 18:** `addsetup`, `adusumillipraveen-patch-1`, `fix-empty-preview-env`,
`fix-graceful-shutdown`, `fix/remove_localhost_private_key_from_vcs`, `follow-redirects`,
`info-provider-1.2.0`, `library-patch-fix-branch`, `switch-away-from-csurf-to-tiny-csrf`,
`task/jenkins-config`, `timja-patch-1`, `timja-patch-2`, `tooling-refresh`, `update-axios`,
`update-cnp`, `update-routeing`, `update-routeing-exports`, `webpackhash`.

**Check the PRs before deleting any of them.** Deleting a branch closes its PR, and since the tree each
targets is gone, **a PR body may be the only surviving statement of what the branch was for** — the
commit message is just `Initialize <name>`. That needs `gh`, whose token was invalid throughout this
session.

Two worth a look regardless of the rest:

- **`fix/remove_localhost_private_key_from_vcs`** — the name implies a private key was committed to the
  template at some point. Worth confirming it never reached *this* repo's history before the branch
  naming it disappears. Not checked.
- **`task/jenkins-config`** — relevant to ["The HMCTS Way documents the Jenkins pipeline
  only"](../PROGRESS.md#the-hmcts-way-documents-the-jenkins-pipeline-only--confirmed-not-inferred), since this repo
  deploys via GitHub Actions instead.

## Master's CI was red twice in one day

Both faults came from the Renovate batch merged on 2026-09-03, and **neither was visible to
`yarn test`** — which is the point worth carrying forward. `vitest` transpiles without typechecking, so
the suite cannot see a type error, and it never reaches an install failure at all.

| | Cause | Symptom | Fixed by |
|---|---|---|---|
| 1 | **#27** bumped `@biomejs/biome` to 2.5.12 in `package.json` but not `yarn.lock` (still 2.5.8) | `yarn install --immutable` fails in 0.1s | **#42**, reverting to 2.5.8 |
| 2 | **#35** bumped `pg` 8.21.0 → 8.23.0 and `@types/pg` 8.20.0 → 8.23.1 while `@prisma/adapter-pg` stayed 7.8.0 | `yarn build` fails, TS2345 at `libs/postgres-prisma/src/index.ts:24` | **#42**, reverting both |
| 3 | **#41** bumped `tsx` to 4.23.13 in `package.json` but not `yarn.lock` | `yarn install --immutable` fails again | **#44**, adding the lockfile entry |

**The biome one could not simply be relockfiled.** 2.5.12 was published seven hours earlier and Yarn 4's
`npmMinimalAgeGate` defaults to 1440 minutes, so resolution is refused — `YN0016: all versions
satisfying "2.5.12" are quarantined`. That is a supply-chain cooldown working as designed, not a
registry problem. Reverting was the immediate unblock; Renovate can raise it again past the gate.

**#3 was fixed forward rather than reverted**, because `tsx 4.23.13` was days old and therefore
resolvable — the gate did not explain that one, so Renovate's lockfile step is failing for its own
reason.

Two things follow, and the second matters more than any individual fix:

- **The `pg` root cause is unresolved and was misdiagnosed first.** It looked like duplicate
  `@types/pg` (the lockfile carried 8.15.5, 8.15.6, 8.20.0 and 8.23.1, and adapter-pg asks for
  `^8.16.0`). `yarn dedupe @types/pg` unified `*`, `^8.16.0` and `8.23.1` onto one 8.23.1 and **the
  build still failed**, so it is a real constraint. A `pg` bump needs `@prisma/adapter-pg` bumped with
  it and the pair tested together.
- **#27 broke install and merged before #31–#40, so CI could not have verified any of them.** Every PR
  after it would have failed at the install step. #35's build break landing is a direct consequence.
  **Two Renovate PRs in a row shipped a manifest change with no lockfile entry** — worth fixing the
  Renovate configuration rather than repairing instances by hand.

## Renovate PR #31 (checked, not merged)

**Checked 2026-09-03. It merges cleanly and clears 12 of the advisories. Not merged** — parked task 2
said report only, and it still stands as a decision for Steve.

**Mergeability is not in question at all: it is a fast-forward.** PR #31 is
`renovate/applicationinsights-3.x` at `c292fbc`, whose parent **is** current master `8bf8563`, so master
has not moved since the PR was cut and there is nothing to merge. Confirmed two ways —
`git merge-base --is-ancestor` says master is an ancestor of the PR head, and `git merge-tree` produces
a clean result tree with no conflicts. Both were run without touching any working tree, in throwaway
worktrees since removed.

It changes two files: `libs/cloud-native-platform/package.json` (`applicationinsights` 3.15.0 → 3.16.0)
and `yarn.lock`. Not lockfile-only, but a manifest bump is what a version update is.

**Measured, by running `yarn npm audit --all --recursive` against both trees** rather than reasoning
from the lockfile:

| | master `8bf8563` | PR #31 `c292fbc` |
|---|---|---|
| total | **28** (12 high, 16 moderate) | **16** (6 high, 10 moderate) |
| `protobufjs` | 11 | **0** |
| `@opentelemetry/propagator-jaeger` | 1 | **0** |
| `fast-uri` | 4 | 4 |
| `@hono/node-server`, `mysql2`, `qs` | 2 each | 2 each |
| `@opentelemetry/core`, `@types/config`, `deepmerge-ts`, `tsconfck`, `uuid`, `valibot` | 1 each | 1 each |

**The mechanism is not the one predicted, and is better.** The note here expected the bump to "carry
`protobufjs@8.0.1`" to a patched version. What actually happens is that `@opentelemetry/otlp-transformer`
goes 0.217.0 → 0.220.0 and **no longer depends on `protobufjs` 8.x at all**, so the exactly-pinned
`protobufjs@npm:8.0.1` entry disappears from the lockfile rather than being upgraded. That is why 12 clear
rather than 11 — `@opentelemetry/propagator-jaeger` goes with it. `@grpc/grpc-js` and
`@grpc/proto-loader` are unchanged, so they were never the problem.

### Three different advisory counts, and why none of them is drift

An earlier note in this session said Dependabot had "drifted to 22, up from the 20 recorded in
PROGRESS.md". **That comparison was wrong** — it put two different tools' numbers side by side as though
one had moved:

- **20** was `yarn npm audit` on 2026-08-23, recorded below.
- **28** is `yarn npm audit` today, on a **byte-identical lockfile** — master's `yarn.lock` last changed
  in `b4e77d4` on 2026-08-23 and has not been touched since. So nothing regressed and no dependency
  changed: **8 new advisories were published against packages that were already there.** That is the
  only thing that can have happened, and it is worth knowing as the background rate.
- **22** is GitHub Dependabot's own count, from the push warning. It groups and scopes differently from
  `yarn npm audit --all --recursive`, which counts every advisory against every package across all
  workspaces including dev dependencies. The two are not required to agree and comparing them tells you
  nothing.

**Compare like with like, and prefer `yarn npm audit` locally**, because it is the one that can be run
against an arbitrary tree — which is what made the before/after table above possible.

**`power_app_nest/` is not the source of any of this, verified again 2026-09-03.** It is untracked, **no
commit on any branch has ever touched the path**, and it is gitignored on this branch — so Dependabot
cannot see its `package-lock.json`, and master carries exactly one lockfile (root `yarn.lock`). This is
the third time that question has come up; the reasoning is below under "Dependency alerts on master" and
has not changed.

**Loose end 4 is still live and was re-confirmed while checking:** `power_app_nest/` is ignored only on
this branch. `git show origin/master:.gitignore` has no entry for it, so on master a stray `git add -A`
would still try to commit ~498M of `node_modules` and 57 document blobs.

