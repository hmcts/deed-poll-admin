---
description: Review implementation and provide feedback
argument-hint: <issue-number>
allowed-tools:
  - Task
  - TodoWrite
  - Bash
  - Read
  - Write
  - Glob
  - Grep
---

# Quick Review: $ARGUMENT

## Initialize Progress Tracking
Use TodoWrite to create this checklist:
```
- [ ] Perform code review
- [ ] Generate review report
```

## PHASE 1: Code Review
*Mark "Perform code review" as in_progress*

### Step 1.1: Execute Review [ISOLATED AGENT]

```
AGENT: code-reviewer
TASK: Review the implementation changes and provide comprehensive feedback
INPUT:
  - docs/tickets/$ARGUMENT/ticket.md
  - docs/tickets/$ARGUMENT/plan.md
  - docs/tickets/$ARGUMENT/tasks.md
  - All changed files (via git diff)

PROMPT FOR AGENT:
"Review the implementation for issue #$ARGUMENT and provide detailed feedback.

**STEP 1: Analyze Changes**
1. Run: git diff --name-only to see all changed files
2. Run: git diff to see the actual changes
3. Read docs/tickets/$ARGUMENT/ticket.md to understand the requirements
4. Read docs/tickets/$ARGUMENT/plan.md to understand the intended approach
5. Read docs/tickets/$ARGUMENT/tasks.md to verify all tasks were completed

**STEP 2: Review Categories**
Perform a comprehensive review covering:

**Security Review:**
- Input validation and sanitization
- Authentication and authorization
- Data protection (no sensitive data in logs)
- SQL injection prevention (Prisma usage)
- XSS prevention (proper escaping)

**Accessibility Review:**
- WCAG 2.2 AA compliance
- Proper GOV.UK component usage
- Semantic HTML and ARIA labels
- Keyboard navigation support
- Screen reader compatibility

**Code Quality Review:**
- TypeScript type safety (no 'any' types)
- Proper error handling
- Following @CLAUDE.md guidelines (libs/ structure)
- Code organization and maintainability
- Naming conventions and clarity

**Testing Review:**
- Unit test coverage (>80% on business logic)
- E2E tests for user journeys
- Accessibility tests included
- Test quality and realistic scenarios

**Performance Review:**
- Database query efficiency (N+1 queries, indexes)
- Mobile-first responsive design
- Asset optimization
- No blocking operations

**GOV.UK Standards Review:**
- Design System component usage
- One thing per page pattern
- Progressive enhancement (works without JS)
- Plain English content

**STEP 3: Generate Review Report**
Create a review report at docs/tickets/$ARGUMENT/review.md with the following structure:

# Code Review: Issue #$ARGUMENT

## Summary
[Brief overview of the changes and overall assessment]

## 🚨 CRITICAL Issues
[List any critical issues that MUST be fixed before deployment]
- Each issue with file:line reference
- Impact description
- Specific solution required

## ⚠️ HIGH PRIORITY Issues
[List high priority issues that SHOULD be fixed]
- Impact on user experience or performance
- Recommended improvements

## 💡 SUGGESTIONS
[List suggestions for improvement]
- Potential enhancements
- Refactoring opportunities
- Documentation improvements

## ✅ Positive Feedback
[List things done well]
- Good practices followed
- Quality implementations
- Effective solutions

## Test Coverage Assessment
- Unit tests: [assessment]
- E2E tests: [assessment]
- Accessibility tests: [assessment]
- Coverage percentage: [if available]

## Acceptance Criteria Verification
[Check each acceptance criterion from ticket.md]
- [ ] Criterion 1: [Status and notes]
- [ ] Criterion 2: [Status and notes]
...

## Next Steps
- [ ] Address critical issues
- [ ] Fix high priority items
- [ ] Consider suggestions
- [ ] Re-run tests after fixes

## Overall Assessment
[APPROVED / NEEDS CHANGES / MAJOR REVISIONS REQUIRED]

---

**IMPORTANT:**
- Be specific with file and line references
- Provide constructive, actionable feedback
- Acknowledge good work alongside issues
- Focus on user impact, not just code style
- Verify all acceptance criteria are met"

WAIT FOR AGENT TO COMPLETE
```
*Mark "Perform code review" as completed*

## PHASE 2: Present Review to User
*Mark "Generate review report" as in_progress*

### Step 2.1: Display Review Summary

```
ACTION: Read the review report and present key findings to the user

1. Read docs/tickets/$ARGUMENT/review.md
2. Display a summary of:
   - Overall assessment
   - Number of critical issues
   - Number of high priority issues
   - Number of suggestions
   - Acceptance criteria status

3. Show the full review report location
```
*Mark "Generate review report" as completed*

## Output to User

Display the following message:

```
Code review complete for issue #$ARGUMENT!

📊 Review Summary:
[Display counts of critical/high priority/suggestions]

Overall Assessment: [APPROVED/NEEDS CHANGES/MAJOR REVISIONS REQUIRED]

Full review report: docs/tickets/$ARGUMENT/review.md

---

[If APPROVED]
✅ Ready to commit and create PR!
- Commit: git add . && git commit -m "Implement issue #$ARGUMENT"
- Create PR: gh pr create

[If NEEDS CHANGES or MAJOR REVISIONS REQUIRED]
⚠️  Please address the issues identified in the review report, then re-run /qk-review $ARGUMENT
```
