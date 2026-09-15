# Plan: Extend the mandatory HMCTS renovate preset

## Overview

This repo's **first master build has never succeeded**, and this is the only thing stopping it. Build #3
(2026-09-15 09:20, triggered by `#100` merging) failed inside `checkoutScm`, before any application code ran:

```
+ grep -iq 'local>hmcts/.github:renovate-config' .github/renovate.json
+ echo 'Renovate config should extend local>hmcts/.github:renovate-config'
+ exit 1

Please note Renovate config is now mandatory in every repo extending default org level config without using
enabledManagers. This change is enforced from 23/09/2023
```

The check is a literal `grep` for the string `local>hmcts/.github:renovate-config` in
`.github/renovate.json` or `renovate.json`. Our file extends `config:recommended` instead, so it fails.

**The fix is one array entry.** It is written as a plan rather than done ad hoc because adopting the org
preset **changes Renovate's behaviour**, and that consequence deserves recording rather than discovery next
Monday morning.

**Why this matters now.** `hmcts/deed-poll-infra` applied for the first time on 2026-09-15, so the AAT Key
Vault, Postgres and Redis exist. The remaining gate on a first deployment is that no component has ever
published an image or Helm chart — and a component's **first master build** is what publishes them. Nine
changes merged here this week with no automated checks at all, which also resolves once builds run.

### Source material — read these, do not re-derive them

| What | Where |
|---|---|
| The failing check itself | `warnAboutRenovateConfig.groovy` and `renovate-config-check.sh` in `hmcts/cnp-jenkins-library` |
| **What the preset actually does** | `hmcts/.github`, `renovate-config.json` — read it, do not assume |
| A repo of ours that already passes | `../deed-poll-infra/renovate.json` |
| The sibling repo with the same failure | `../deed-poll-web/.github/renovate.json` and its `docs/plans/02-renovate-config-org-preset.md` |
| CNP's own guidance | <https://hmcts.github.io/cloud-native-platform/guides/automated-dependency-updates.html> |

### Decisions already taken — implement these, do not revisit

1. **Add the preset; do not replace this file.** `deed-poll-infra`'s `renovate.json` is four lines because
   Terraform needs nothing else. This repo's config carries deliberate, commented rules — three custom
   managers, the `@types/node` ceiling, never-automerge-a-major — each with a stated reason. **Keep them all.**
2. **The preset goes first in `extends`.** Renovate merges in order and later entries win, so listing it
   first keeps our own overrides authoritative. That is the intent: adopt the org baseline, keep our rules.
3. **Keep `config:recommended` as well.** The preset extends `config:base`, the older name for broadly the
   same thing; dropping `config:recommended` is a behaviour change this plan is not making. Two overlapping
   presets are harmless — the check cares only that the org one is present.
4. **This repo's `customManagers` spelling is already correct** and must stay. `deed-poll-web` still uses
   the deprecated `regexManagers`/`fileMatch`; this repo uses `customManagers`/`managerFilePatterns`, which
   is the current API. **Do not "align" this file down to match web's.**

### Two consequences of adopting the preset — expected, not defects

Read `hmcts/.github`'s `renovate-config.json` before starting. Adopting it brings:

- **A schedule.** `"schedule": "after 7am and before 11am every weekday"`. Renovate currently opens PRs
  whenever it likes; afterwards only on weekday mornings. Also `"timezone": "Europe/London"` and a
  `dependencies` label on every PR.
- **A dependency dashboard issue** (`:dependencyDashboard`), which Renovate will open in this repo — a new
  GitHub issue appearing by itself. Expected.

There is a third worth knowing, specific to this repo: the preset sets `helmv3.bumpVersion: "patch"` and
`registryAliases` for both `hmctspublic` and `hmctsprod`. This repo has a real chart at
`charts/deed-poll-admin/`, so **Renovate may start bumping its `version:` on dependency updates.** Harmless
and arguably desirable, but it is a new behaviour on a tracked file.

None is a reason not to do this: the preset is mandatory and the build cannot pass without it.

### Constraints

- **No application code, no test changes, no dependency upgrades.** This plan edits exactly one file.
- **Never run bare `yarn test`.** It reports `0 successful, 8 total` / `Tests no tests` — nothing ran, so
  nothing failed. Use `yarn turbo test test:app --concurrency=1`.
- **Valid JSON matters more than tidiness.** A malformed `renovate.json` fails the same build differently.
- The check accepts `.github/renovate.json` **or** `renovate.json`. Ours is at `.github/renovate.json`;
  leave it there and do not add a second one.

## Validation Commands

```bash
yarn lint
yarn turbo test test:app --concurrency=1
yarn build
```

> Every task. **None of them reads `renovate.json`**, so this plan must not change their result — they are
> the guard against a task straying beyond its scope, not proof the fix works. The baseline at `2a6b441`
> (plan 08's merge) was **1,639 unit tests, 8 of 8 tasks**, `lint` exit 0 with two pre-existing
> `noUndeclaredEnvVars` warnings, `build` 8 of 8. **Compare totals, not passed counts** — the three Redis
> session tests skip when no cache is reachable and pass when one is.
>
> Proof the fix works is Task 2's `grep`, which is exactly what the pipeline runs.

## Tasks

### Task 1: Extend the org preset

- [ ] In `.github/renovate.json`, change `"extends": ["config:recommended"]` to:

      ```json
      "extends": [
        "local>hmcts/.github:renovate-config",
        "config:recommended"
      ]
      ```

      Preset first, per decision 2. **Change nothing else in the file** — not `automerge`, not
      `customManagers`, not `packageRules`, not `constraints`
- [ ] Confirm the file is still valid JSON:
      `node -e "JSON.parse(require('fs').readFileSync('.github/renovate.json','utf8')); console.log('valid')"`
- [ ] Confirm nothing else was lost:
      `node -e "const c=require('./.github/renovate.json'); console.log(c.customManagers.length, c.packageRules.length)"`
      must print `3 5` — the counts on `master` before this change. **Three custom managers, not two:**
      `.nvmrc`, Dockerfiles, and GitHub Actions
- [ ] Run the validation commands
- [ ] Mark completed

### Task 2: Prove it passes the check the pipeline actually runs

- [ ] Run the pipeline's own test verbatim — this is the whole point of the plan:

      ```bash
      grep -iq 'local>hmcts/.github:renovate-config' .github/renovate.json && echo PASS || echo FAIL
      ```

      It must print `PASS`
- [ ] Run the other branch of the same script, which decides *whether* the check applies:
      `grep -iq enabledManagers .github/renovate.json && echo "skipped" || echo "check applies"`.
      Expect **`check applies`** — we are passing the check, not opting out of it. If a task ever makes this
      print `skipped`, it has taken the wrong route: `enabledManagers` narrows Renovate to named managers and
      would silently stop most updates
- [ ] Record in this plan that the fix is **unverified against a real build**, and that this is expected:
      `build.hmcts.net` is behind Azure AD App Proxy and unreachable from the devcontainer, so triggering and
      reading the master build is Steve's. **Do not attempt it**
- [ ] Mark completed

### Task 3: Check the third custom manager still makes sense

This repo has a manager `deed-poll-web` does not: "Update Node.js version in GitHub Actions". **This repo
has no `.github/workflows/`** — it was deleted when all four repos moved to the Jenkins CNP pipeline. So the
manager may now match nothing.

- [ ] Confirm whether any file it could match exists:
      `ls -la .github/workflows/ 2>/dev/null || echo "no workflows directory"`
- [ ] If there is nothing for it to match, **leave it in place and record that** in this plan rather than
      deleting it. Two reasons: a manager matching nothing is inert, not harmful; and `docs/PIPELINES.md`
      notes the Playwright suite still wants a pipeline stage, so a workflow could return. Deleting it would
      be a silent behaviour change on a file this plan is otherwise leaving alone
- [ ] Note the finding either way, with the manager's index, so a future tidy-up has the evidence
- [ ] Mark completed

## Deliberately not in this plan

- **The ACR registry nagger.** It fails `deed-poll-api`, not this repo — this repo's Dockerfile and chart
  already use `hmctsprod.azurecr.io`. It has its own plan there.
- **Deleting the GitHub Actions custom manager.** See Task 3.
- **Dropping `config:recommended`,** or otherwise tuning what the preset brings in. Decision 3.
- **Reconciling the schedule, the dashboard issue, or Helm chart version bumping.** Expected consequences,
  documented above.
- **Triggering or verifying the master build.** Not possible from here.
