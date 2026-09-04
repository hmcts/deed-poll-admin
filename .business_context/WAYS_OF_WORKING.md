# Ways of working

Written 2026-09-03 after a 63-commit session, to be read at the start of the next one. **Deliberately
short** — it argues that documents get ignored past a certain length, so it had better not be long.

Updated 2026-09-04: the two open decisions at the bottom are now settled.

---

## Start of session checklist

1. **`gh auth login -h github.com`.** Everything before this was slower and worse: CI failures were being
   *inferred* when they could have been *read*. The productivity difference either side of it was stark.
2. **`docker compose up -d`** if the `ccd` schema tests or e2e are in scope, and recreate the yarn shim —
   `test:e2e` cannot start without it. See the environment notes in `PROGRESS.md`.
3. **Ask for the decisions up front.** Not as they block work. Four service decisions had sat unanswered
   for weeks and took ten minutes once asked.
4. **Read `PROGRESS.md`'s "Pick up here" section only.** The rest is reference, not briefing.

## The one rule that would have prevented most of last session's errors

**Read the thing you are editing against, before editing.**

Four separate errors, one cause. Each was a single tool call away from being avoided:

| Error | What went unread |
|---|---|
| Three attempts at a 2-line change to `job.osv-scanner.yml` — first used the action Google says not to call directly with an invalid flag, then stripped permissions a nested reusable workflow requires and broke the whole run at startup | The reusable workflow's `inputs` and its job-level `permissions` |
| Asked for a `Contributor` grant on a shared HMCTS repo that was not needed — an over-grant | The real `app-registrations.yaml`, which no entry scopes to a subscription |
| "The repository has no Actions secrets at all" — written into two committed documents, and a whole SonarCloud diagnosis built on it | `actions/organization-secrets`, which lists 28 including `SONAR_TOKEN` |
| Predicted `terraform plan` would fail on the missing resource group | The job log — it failed earlier, at `azure/login` |

**It paid on 2026-09-04.** Three traps caught by reading the thing first, each of which would otherwise
have shipped: `"node": { "enabled": true }` in `renovate.json` is the **Travis** manager, not Node
version management; migrating `regexManagers` renames the manager `regex` → `custom.regex`, so a
`matchManagers` rule silently stops matching; and `cnp-module-key-vault`'s `team-access.tf` creates its
access policy *unconditionally*, so an empty `product_group_name` fails the apply rather than being
skipped. The `terraform-deploy` action source also killed a plan that looked obviously right — its state
key ignores `working-directory`, so two Terraform roots in one repo destroy each other.

## Working agreements

- **`cd` explicitly in every shell command.** Working directory resets between tool calls. A
  `git add -A` ran in `cft-workspace` instead of `deed-poll-admin` and swept up uncommitted work that
  was not mine to commit. Nothing published, but it should not have been possible. **Still biting** — two
  commands on 2026-09-04 ran in the wrong directory and failed confusingly, one of them looking for a
  `renovate.json` that exists in *both* repos. Write `cd <absolute path> && …` every time rather than
  relying on the previous call.
- **If a validator exists, run it rather than eyeballing the config.**
  `renovate-config-validator --strict` and `terraform validate` each caught things careful reading had
  already missed, and each was one command. Neither had ever been run in this repo. The corollary:
  fetching the real binary is usually worth it — `terraform` was a 32M download and it turned an
  unverifiable PR into a checked one.
- **One "make it green" pass, not several.** Master was repaired three times in a day, each fix
  revealing the next breakage. `install --immutable` → `lint` → `build` → `test`, *then read every red
  check*, finds all of them at once.
- **Measure before acting on a recorded cause.** A plausible note is not evidence. Loose end 16 (the
  unbounded `pg.Pool`) described last session's e2e hang exactly, and was measured innocent — 3
  connections against a max of 10. The real cause was elsewhere.
- **Record corrections in place rather than quietly fixing them.** Loose end 16 now says "measured
  innocent, do not reach for this first". That is worth more than the fix was.
- **Split work for review as you go.** Pulling the CI repair out into #48 and #58 worked well: small,
  single-purpose, merged same day. The migration itself did not get that treatment — see below.

## The two decisions, both settled 2026-09-04

**1. PR #47 was merged as-is** — 292 files, unsliced. Steve's call: the divergence was costing more than
the review would have bought. The lesson from the CI split still stands for the *next* large piece of
work, though: #48, #58, #63 and #64 were each small, single-purpose and merged the same day, and #64 in
particular carried an architectural decision worth someone's attention that would have been invisible
inside a 292-file diff.

**2. `PROGRESS.md` was pruned**, 2,297 → ~1,800 lines. The Phase 3 slice detail, the superseded
2026-09-03 CI sections and the dependency-alert history are in [`archive/`](archive/). **Nothing was
deleted** — every range was moved verbatim and the links pointing into it were repointed. Keep it this
way: when a section stops being briefing and becomes history, move it out rather than letting it
accumulate. That is the whole argument of this file applied to its neighbour.

## One thing still open

**Master is unprotected**, deliberately, for speed while the migration finishes — Steve's call on
2026-09-04, with protections to follow. The reason that is a trade rather than a hazard is #63: majors no
longer automerge, so the exposure is patch and minor bumps only. **Revisit when Track A goes green**, and
note the two facts that made it risky in the first place, in case they recur: `automerge: true` had no
update-type bound, and nothing required a check to pass.
