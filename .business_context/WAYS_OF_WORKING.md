# Ways of working

Written 2026-09-03 after a 63-commit session, to be read at the start of the next one. **Deliberately
short** — it argues that documents get ignored past a certain length, so it had better not be long.

Two things to decide together are at the bottom.

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

## Working agreements

- **`cd` explicitly in every shell command.** Working directory resets between tool calls. A
  `git add -A` ran in `cft-workspace` instead of `deed-poll-admin` and swept up uncommitted work that
  was not mine to commit. Nothing published, but it should not have been possible.
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

## Two things to decide together

**1. PR #47 is 292 files and +25,768 lines. That is not reviewable.** It will be rubber-stamped or
ignored, and neither is review. The CI split proved the pattern works. Decide whether real review on the
migration matters, because at this size it will not happen — and if it does matter, the branch needs
slicing before anyone is asked to look.

**2. `PROGRESS.md` is 2,291 lines**, which is past the length where a handover gets read — the exact
failure it exists to prevent. Proposal: archive the Phase 3 slice-by-slice detail, which has done its
job, and keep decisions, traps, current state and the loose ends. Roughly halves it without losing
anything load-bearing.
