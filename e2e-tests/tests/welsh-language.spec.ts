import { expect, test } from "@playwright/test";

// Retargeted from `/`, which used to render the template's marketing home page and now redirects to
// the case list. The accessibility statement is the replacement because this test needs a page that is
// BOTH public — the toggle has to work before sign-in — and genuinely translated. The deed-poll pages
// are neither: they need a session, and their `cy` still holds English by the migration plan's
// decision, so asserting Welsh on one would assert nothing.
const PAGE = "/accessibility-statement";

test.describe("Welsh Language Support", () => {
  test("should switch to Welsh and back to English", async ({ page }) => {
    // Start with English version
    await page.goto(PAGE);

    // Verify English content is displayed
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Accessibility statement/);

    // Look for the language toggle link
    const languageToggle = page.locator(".language");
    await expect(languageToggle).toBeVisible();
    await expect(languageToggle).toContainText("Cymraeg");

    // Click the language toggle to switch to Welsh
    await languageToggle.click();

    // Verify URL has Welsh parameter
    await expect(page).toHaveURL(/.*\?lng=cy/);

    // Verify Welsh content is displayed
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Datganiad hygyrchedd/);

    // Verify language toggle now shows English option
    await expect(languageToggle).toContainText("English");

    // Check footer links are in Welsh
    const cookiesLink = page.locator('.govuk-footer a[href="/cookies"]');
    await expect(cookiesLink).toContainText("Cwcis");

    // Click language toggle to switch back to English
    await languageToggle.click();

    // Verify URL has English parameter
    await expect(page).toHaveURL(/.*\?lng=en/);

    // Verify English content is restored
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Accessibility statement/);
    await expect(languageToggle).toContainText("Cymraeg");

    // Check footer links are back in English
    await expect(cookiesLink).toContainText("Cookies");
  });
});
