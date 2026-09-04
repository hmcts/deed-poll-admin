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

## Merging, and clearing things down

Added 2026-09-04 at Steve's request, after a day where the work was good and the *flow* of it was not.
Every rule here was earned by something that happened that day.

- **Merge each decision before starting the next.** #67 stayed open for a whole session and accumulated
  **17 commits** covering four unrelated decisions — the Spring Boot rewrite, the repo layout, the
  citizen scoping and the Ralphex plan. It should have been four PRs, each merged as it was settled. The
  agreement above already said this; it was not followed because appending to an open PR is always the
  path of least resistance in the moment.
- **Never stack a branch on an unmerged PR.** #66 was stacked under #67. Squash-merging #66 gave master
  the same content under a new SHA, so #67 immediately went `CONFLICTING` and needed a rebase that then
  got stuck. **If stacking is unavoidable, merge the parent with a merge commit rather than a squash.**
- **A squash-merged branch never looks merged to git.** `git branch -d` refuses and
  `git rev-list --count master..branch` says 1, and neither means unmerged work. The test is
  `git diff --quiet <branch> <squash-commit>`. Run it before reaching for `-D`; see
  `DELETED_BRANCHES.md`.
- **Merge before handing something to someone else to use.** Steve twice opened a file that only existed
  on an unmerged branch, and copied the Ralphex plan into the new repo two commits before it was
  finished. If a document is about to be acted on, it belongs on `master` first.
- **Ask where an answer belongs before writing it down.** `DEED_POLL_API_PLAN.md` reached 900 lines by
  accretion — each question answered by appending, until it covered payment reconciliation, WAF policy
  and CAPTCHA accessibility, and had to be split into two documents. One question, one home.
- **`git pull --ff-only origin master` fails in this clone** with *"Cannot fast-forward to multiple
  branches"*, despite entirely ordinary config. Cause unknown after checking remotes, refspec and
  `branch.master.merge`. Use `git fetch origin && git merge --ff-only origin/master`, which always works.
  Recorded because it cost time twice in one day.

## The two decisions, both settled 2026-09-04

Compressed once settled, because this file's own argument applies to it too.

1. **PR #47 was merged as-is**, 292 files unsliced — the divergence cost more than the review would have
   bought. The slicing lesson still stands for the *next* large piece of work.
2. **`PROGRESS.md` was pruned** 2,297 → ~1,800 lines, with history moved verbatim to
   [`archive/`](archive/) rather than deleted. **When a section stops being briefing and becomes history,
   move it out.**

## One thing still open

**Master is unprotected**, deliberately, for speed while the migration finishes — Steve's call on
2026-09-04, with protections to follow. The reason that is a trade rather than a hazard is #63: majors no
longer automerge, so the exposure is patch and minor bumps only. **Revisit when Track A goes green**, and
note the two facts that made it risky in the first place, in case they recur: `automerge: true` had no
update-type bound, and nothing required a check to pass.
