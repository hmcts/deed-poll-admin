---
paths: e2e-tests/**/*.ts
---

# E2E Testing with Playwright

## Minimize Test Count

**Create the minimum number of tests.** Each test should represent a complete end-to-end user journey. Do NOT create separate tests for individual validations, accessibility checks, or Welsh translations. Instead, include all validations, accessibility checks, and Welsh translations within the journey test itself.

**Key Principle:** One test per user journey, not one test per validation or feature.

✅ **Good - Minimum tests, each covering complete journey:**
```typescript
// One test for the subscription journey - includes validations, Welsh, accessibility
test('user can subscribe to updates', async ({ page }) => {
  await page.goto('/subscribe');

  // Test validation along the journey
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter your email')).toBeVisible();

  // Test Welsh translation along the journey
  await page.getByRole('link', { name: 'Cymraeg' }).click();
  await expect(page.getByText('Rhowch eich e-bost')).toBeVisible();

  // Test accessibility along the journey
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // Complete the journey
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Subscription confirmed')).toBeVisible();
});

// Separate test only for a DIFFERENT user journey (e.g., unsubscribe)
test('user can unsubscribe', async ({ page }) => {
  await page.goto('/unsubscribe');
  // ... complete unsubscribe journey with validations, Welsh, accessibility
});
```

❌ **Bad - Too many separate tests:**
```typescript
test('shows validation error for email', async ({ page }) => { /* ... */ });
test('shows validation error for name', async ({ page }) => { /* ... */ });
test('Welsh translation works on subscribe page', async ({ page }) => { /* ... */ });
test('accessibility passes on subscribe page', async ({ page }) => { /* ... */ });
test('user completes subscription', async ({ page }) => { /* ... */ });
```

## Test Organization

- Location: `e2e-tests/`
- Naming: `*.spec.ts`

### What to Include in Each Journey Test
1. Complete user journey from start to finish
2. All relevant validation checks encountered in the journey
3. Welsh translation checks at key points
4. Accessibility checks at key points
5. Keyboard navigation where relevant
6. Successful completion of the journey

### Example Pattern

```typescript
test('user can complete journey', async ({ page }) => {
  // 1. Test main journey
  await page.goto('/start');
  await page.getByRole('button', { name: 'Start now' }).click();

  // 2. Test Welsh
  await page.getByRole('link', { name: 'Cymraeg' }).click();
  expect(await page.getByRole('heading', { level: 1 })).toContainText('Dechrau nawr');

  // 3. Test accessibility inline
  const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScanResults.violations).toEqual([]);

  // 4. Test keyboard navigation
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');

  // 5. Continue journey...
});
```

## Correct Selectors (Priority Order)

1. `getByRole()` - Preferred for accessibility
2. `getByLabel()` - For form inputs
3. `getByText()` - For specific text
4. `getByTestId()` - Last resort only

## DO NOT Test

- Font sizes
- Background colors
- Margins/padding
- Any visual styling
- UI design aspects

## Coverage Expectations

- E2E tests: Cover critical user journeys
- Accessibility: Test inline with journeys (not separately)

## Running Tests

```bash
yarn test:e2e                   # Run E2E tests
```
