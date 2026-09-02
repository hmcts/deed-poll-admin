import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE, DEPLOYED_STACK_SKIP_REASON, RUNS_AGAINST_DEPLOYED_STACK } from "./idam-session.js";

// Phase 5 mounted `requireAuth` globally in apps/web, and `/onboarding` is not on its public
// allowlist — so every goto in this file was redirecting to `/login`. Signing in is the fix rather
// than opening the paths up: an internal caseworker service behind login is the intended behaviour,
// and onboarding is not special. Nothing else in the file changed.
test.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);
test.use({ storageState: ADMIN_STORAGE_STATE });

// **Sequential within this file, overriding the config's `fullyParallel`.** Two reasons, and both are
// about the fact that one storageState file means one server-side session:
//
//  1. This form keeps its answers IN the session, so run in parallel the four tests below wrote over
//     each other and the summary page showed whichever name landed last.
//  2. The alternative — signing in per test for a session each — put five concurrent logins on the
//     stack and exposed a connection-pool stall that hung the callback for 30s. See loose end 16; the
//     pool is a real issue but it is not this spec's to fix, and provoking it here only produced a
//     flake that looked like a broken login.
//
// `default` rather than `serial`: sequential in one worker, but a failure does not skip the tests
// after it. Nothing here depends on a previous test having run.
test.describe.configure({ mode: "default" });

test.describe("Onboarding Form - Happy Path Journey", () => {
  test("should complete the full onboarding journey successfully", async ({ page }) => {
    // Start page
    await page.goto("/onboarding/start");

    // Verify start page loads correctly
    await expect(page).toHaveTitle(/Onboarding form example/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Start the form
    await page.getByRole("button", { name: /start now/i }).click();

    // Name page
    await expect(page).toHaveURL("/onboarding/name");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/name/i);

    await page.getByLabel(/first name/i).fill("John");
    await page.getByLabel(/last name/i).fill("Smith");
    await page.getByRole("button", { name: /continue/i }).click();

    // Date of birth page
    await expect(page).toHaveURL("/onboarding/date-of-birth");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/date of birth/i);

    // Verify date fields are on the same row
    const dateFieldsContainer = page.locator(".govuk-date-input");
    await expect(dateFieldsContainer).toBeVisible();

    await page.getByLabel(/day/i).fill("15");
    await page.getByLabel(/month/i).fill("6");
    await page.getByLabel(/year/i).fill("1990");
    await page.getByRole("button", { name: /continue/i }).click();

    // Address page
    await expect(page).toHaveURL("/onboarding/address");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/address/i);

    await page.getByLabel(/address line 1/i).fill("123 Main Street");
    await page.getByLabel(/address line 2/i).fill("Apt 4B");
    await page.getByLabel(/town or city/i).fill("London");
    await page.getByLabel(/postcode/i).fill("SW1A 1AA");
    await page.getByRole("button", { name: /continue/i }).click();

    // Role page
    await expect(page).toHaveURL("/onboarding/role");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/role/i);

    // Select a predefined role first
    await page.getByRole("radio", { name: /Frontend Developer/i }).check();
    await page.getByRole("button", { name: /continue/i }).click();

    // Summary page
    await expect(page).toHaveURL("/onboarding/summary");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Check your answers/i);

    // Verify all entered data is displayed
    await expect(page.getByText("John")).toBeVisible();
    await expect(page.getByText("Smith")).toBeVisible();
    await expect(page.getByText("15 June 1990")).toBeVisible();
    await expect(page.getByText("123 Main Street")).toBeVisible();
    await expect(page.getByText("Apt 4B")).toBeVisible();
    await expect(page.getByText("London")).toBeVisible();
    await expect(page.getByText("SW1A 1AA")).toBeVisible();
    await expect(page.getByText(/Frontend Developer/i)).toBeVisible();

    // Verify change links are present
    await expect(page.getByRole("link", { name: /change.*name/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /change.*date of birth/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /change.*address/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /change.*role/i })).toBeVisible();

    // Submit the form
    await page.getByRole("button", { name: /submit/i }).click();

    // Confirmation page - should now have confirmation ID in URL
    await expect(page).toHaveURL(/\/onboarding\/confirmation\/c[a-z0-9]{20,}/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Onboarding complete/i);
    await expect(page.getByText(/Your reference number/i)).toBeVisible();

    // Verify confirmation panel is displayed
    await expect(page.locator(".govuk-panel--confirmation")).toBeVisible();

    // Verify confirmation ID is displayed (should be a CUID format)
    const confirmationPanel = page.locator(".govuk-panel--confirmation");
    const panelText = await confirmationPanel.textContent();
    expect(panelText).toMatch(/Your reference number/i);
    // Check that there's some kind of ID displayed (CUID format starts with 'c')
    expect(panelText).toMatch(/c[a-z0-9]{20,}/i);

    // Also verify the ID in the URL matches what's displayed
    const url = page.url();
    const confirmationIdFromUrl = url.split("/").pop();
    expect(panelText).toContain(confirmationIdFromUrl);
  });

  test('should handle "Other" role selection with text input', async ({ page }) => {
    // Complete the form up to the role page
    await page.goto("/onboarding/start");
    await page.getByRole("button", { name: /start now/i }).click();

    // Fill name page
    await page.getByLabel(/first name/i).fill("Jane");
    await page.getByLabel(/last name/i).fill("Doe");
    await page.getByRole("button", { name: /continue/i }).click();

    // Fill date of birth
    await page.getByLabel(/day/i).fill("20");
    await page.getByLabel(/month/i).fill("3");
    await page.getByLabel(/year/i).fill("1985");
    await page.getByRole("button", { name: /continue/i }).click();

    // Fill address
    await page.getByLabel(/address line 1/i).fill("456 Test Avenue");
    await page.getByLabel(/town or city/i).fill("Manchester");
    await page.getByLabel(/postcode/i).fill("M1 2AA");
    await page.getByRole("button", { name: /continue/i }).click();

    // Now on role page, select "Other" option
    await page.getByRole("radio", { name: /other/i }).check();

    // Verify the conditional text field appears
    const otherRoleInput = page.getByLabel(/please specify/i);
    await expect(otherRoleInput).toBeVisible();

    // Fill in custom role
    await otherRoleInput.fill("Product Manager");
    await page.getByRole("button", { name: /continue/i }).click();

    // Should proceed to next page successfully
    await expect(page).toHaveURL("/onboarding/summary");
  });

  test("should include accessibility checks throughout the journey", async ({ page }) => {
    const pagesToTest = ["/onboarding/start", "/onboarding/name", "/onboarding/date-of-birth", "/onboarding/address", "/onboarding/role"];

    for (const pageUrl of pagesToTest) {
      await page.goto(pageUrl);

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .exclude(".govuk-footer__link") // Known template issue
        .exclude(".language") // Known template issue
        .exclude("#roleType-4") // Known GOV.UK Frontend issue with aria-expanded on radio buttons with conditional reveals
        .analyze();

      if (accessibilityScanResults.violations.length > 0) {
        console.log(`Accessibility violations found on ${pageUrl}:`);
        accessibilityScanResults.violations.forEach((violation) => {
          console.log(`- ${violation.id}: ${violation.description}`);
          console.log(`  Impact: ${violation.impact}`);
          console.log(`  Affected nodes: ${violation.nodes.length}`);
        });
      }

      expect(accessibilityScanResults.violations).toEqual([]);
    }
  });

  test("should support keyboard navigation throughout the form", async ({ page }) => {
    await page.goto("/onboarding/start");

    // Focus the start button directly (there may be skip links or other focusable elements)
    await page.getByRole("button", { name: /start now/i }).focus();
    await expect(page.getByRole("button", { name: /start now/i })).toBeFocused();
    await page.keyboard.press("Enter");

    // Name page - keyboard navigation
    await expect(page).toHaveURL("/onboarding/name");
    // Focus the first name field directly
    await page.getByLabel(/first name/i).focus();
    await expect(page.getByLabel(/first name/i)).toBeFocused();

    await page.keyboard.type("John");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel(/last name/i)).toBeFocused();

    await page.keyboard.type("Smith");

    // Find continue button and press Enter
    // Focus directly on the continue button
    await page.getByRole("button", { name: /continue/i }).focus();
    await expect(page.getByRole("button", { name: /continue/i })).toBeFocused();
    await page.keyboard.press("Enter");

    // Verify we moved to the next page
    await expect(page).toHaveURL("/onboarding/date-of-birth");
  });
});
