---
description: Implement a GitHub issue following the technical plan
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

# Quick Implement: $ARGUMENT

## Initialize Progress Tracking
Use TodoWrite to create this checklist:
```
- [ ] Execute implementation tasks
- [ ] Run tests and verify
```

## PHASE 1: Implementation
*Mark "Execute implementation tasks" as in_progress*

### Step 1.1: Execute Implementation [ISOLATED AGENT]

```
AGENT: full-stack-engineer
TASK: Implement the issue following the plan and completing all tasks
INPUT:
  - docs/tickets/$ARGUMENT/ticket.md
  - docs/tickets/$ARGUMENT/plan.md
  - docs/tickets/$ARGUMENT/tasks.md

PROMPT FOR AGENT:
"Implement issue #$ARGUMENT by following the technical plan and completing all tasks:

**STEP 1: Review Documentation**
1. Read docs/tickets/$ARGUMENT/ticket.md to understand the requirements
2. Read docs/tickets/$ARGUMENT/plan.md to understand the technical approach
3. Read docs/tickets/$ARGUMENT/tasks.md to see the task list

**STEP 2: Execute Implementation Tasks**
Work through each task in the Implementation Tasks section of tasks.md:
1. Implement the task following the technical plan
2. Write unit tests for new code (co-located .test.ts files)
3. After completing each task, use the Edit tool to update docs/tickets/$ARGUMENT/tasks.md
   - Change '- [ ]' to '- [x]' for the completed task
4. Continue until all Implementation Tasks are marked [x]

**STEP 3: Execute Testing Tasks**
Work through each task in the Testing Tasks section of tasks.md:
1. Write E2E tests if applicable (using Playwright in e2e-tests/)
2. Include accessibility checks with axe-core in E2E tests
3. After completing each task, update docs/tickets/$ARGUMENT/tasks.md
   - Change '- [ ]' to '- [x]' for the completed task
4. Continue until all Testing Tasks are marked [x]

**STEP 4: Run All Tests**
1. Run unit tests: yarn test
2. Run E2E tests: yarn test:e2e (if E2E tests were created)
3. Fix any failing tests
4. Ensure the app boots: yarn dev (verify it starts without errors, then stop it)

**STEP 5: Final Verification**
1. Verify all tasks in docs/tickets/$ARGUMENT/tasks.md are marked [x]
2. Ensure >80% test coverage on new code
3. Verify all tests are passing

**IMPORTANT NOTES:**
- Follow the @CLAUDE.md guidelines (use libs/ for features, not apps/)
- Update tasks.md as you complete each task to track progress
- Write comprehensive tests for all new functionality
- Fix any issues immediately before moving to the next task"

WAIT FOR AGENT TO COMPLETE
```
*Mark "Execute implementation tasks" as completed*

## PHASE 2: Verification
*Mark "Run tests and verify" as in_progress*

### Step 2.1: Final Test Run

```
EXECUTE VERIFICATION:
1. Run linting: yarn lint
2. Run unit tests: yarn test
3. Run E2E tests: yarn test:e2e (if they exist)
4. Verify app boots: yarn dev (check for 10 seconds, then stop)

IF ANY FAILURES:
  - Use full-stack-engineer agent to fix issues
  - Re-run failed tests
  - Repeat until all tests pass
```
*Mark "Run tests and verify" as completed*

## Output to User

Display the following message:

```
Implementation of issue #$ARGUMENT complete!

✅ All implementation tasks completed
✅ All testing tasks completed
✅ Tests passing
✅ Application verified

Task tracking: docs/tickets/$ARGUMENT/tasks.md

---

Next step: Run /qk-review $ARGUMENT to review the implementation
```
