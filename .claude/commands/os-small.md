---
description: Quick autonomous implementation of a small GitHub issue
argument-hint: <issue-number>
allowed-tools:
  - Task
  - TodoWrite
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# One Shot Small: $ARGUMENT

## Initialize TodoWrite Progress Tracking
Use TodoWrite to create this checklist:
```
- [ ] Retrieve GitHub issue and setup branch
- [ ] Implement feature with tests
- [ ] Run quality checks
```

## PHASE 1: Setup
*Mark "Retrieve GitHub issue and setup branch" as in_progress*

### Step 1.1: GitHub Issue and Git Setup
```
EXECUTE:
1. Fetch issue: gh issue view $ARGUMENT --json number,title,body,labels
2. git stash
3. git checkout master
4. git pull
5. Derive branch name:
   TITLE=$(gh issue view $ARGUMENT --json title -q .title)
   CLEAN=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '-' | cut -c1-50)
   BRANCH="feature/$ARGUMENT-${CLEAN}"
6. git checkout -b $BRANCH
7. mkdir -p docs/tickets/$ARGUMENT

ACTIONS:
- Write GitHub issue content to docs/tickets/$ARGUMENT/ticket.md (including title, state, body)
- Create docs/tickets/$ARGUMENT/tasks.md with simple structure:

## Implementation Tasks
- [ ] Implement feature
- [ ] Write unit tests
- [ ] Create E2E tests (if applicable)

VERIFY: Branch created, documentation present
```
*Mark "Retrieve GitHub issue and setup branch" as completed*

## PHASE 2: Implementation
*Mark "Implement feature with tests" as in_progress*

### Step 2.1: Parallel Implementation [EXECUTE IN PARALLEL]

```
LAUNCH 2 AGENTS IN PARALLEL:

AGENT 1: full-stack-engineer
PROMPT FOR AGENT:
"Quick implementation of issue #$ARGUMENT:
1. Read docs/tickets/$ARGUMENT/ticket.md
2. Implement the feature following CLAUDE.md guidelines
3. Write unit tests (co-located .test.ts files)
4. Ensure >80% test coverage on new code
5. Update docs/tickets/$ARGUMENT/tasks.md marking implementation tasks as [x]
Keep it simple and focused."

AGENT 2: test-engineer
PROMPT FOR AGENT:
"Create E2E tests for issue #$ARGUMENT if applicable:
1. Read docs/tickets/$ARGUMENT/ticket.md
2. If user journey involved, create E2E test in e2e-tests/
3. Include accessibility checks with axe-core
4. If no E2E test needed, mark task as N/A
5. Update docs/tickets/$ARGUMENT/tasks.md
DO NOT run tests yet."

WAIT FOR BOTH AGENTS TO COMPLETE
```
*Mark "Implement feature with tests" as completed*

## PHASE 3: Quality Checks
*Mark "Run quality checks" as in_progress*

### Step 3.1: Run Tests
```
EXECUTE IN SEQUENCE:
1. yarn lint
2. yarn dev (verify boots - kill after 10 seconds)
3. yarn test
4. yarn test:e2e

IF FAILURES:
  - Fix e2e tests with test-engineer, everything else with full-stack-engineer agent
  - Re-run failed tests
  - Repeat until passing

VERIFY: All checks pass
```
*Mark "Run quality checks" as completed*

## COMPLETION CHECK
```
FINAL VALIDATION:
- Feature implemented
- Tests passing (lint, unit, e2e)
- Tasks.md reflects completion
- No obvious quality issues
```

## Success Output
"Quick implementation of issue #$ARGUMENT complete:
- ✅ Feature implemented
- ✅ Tests written and passing
- ✅ Quality checks passed

Documentation: docs/tickets/$ARGUMENT/
Branch: feature/$ARGUMENT-[name]

Ready for PR creation or manual review."
