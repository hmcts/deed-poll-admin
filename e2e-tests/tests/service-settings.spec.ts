import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { signInAsDeliveryManager } from "./idam-session.js";

// Run by `yarn test:gazette` against its own fresh mock, because every save here is a write that must never land on a
// shared developer mock. The mock starts with no Masters and api's seeded bank holidays.
test("Delivery Manager opens the settings from the case list and changes the referral process", async ({ page }) => {
  await signInAsDeliveryManager(page);
  const settingsLink = page.getByRole("link", { name: "Service settings", exact: true });
  await settingsLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/deed-polls/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Service settings");
  // Each section is a tab, in the page's order, and the page opens on the first.
  await expect(page.getByRole("tab")).toHaveText(["Referral process", "London Gazette recipient", "Masters", "Bank holidays", "Staff and access"]);
  await expect(page.getByRole("tab", { name: "Referral process", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Processing window", { exact: true })).toHaveValue("7");
  await expect(page.getByLabel("Reminder interval", { exact: true })).toHaveValue("48");
  await expect(page.locator("#afternoonWindowStart")).toHaveValue("14:00");
  await expect(page.locator("#process-settings .govuk-warning-text")).toContainText("Changes take effect immediately for every referral.");
  await page.getByRole("tab", { name: "Staff and access", exact: true }).click();
  const staffLink = page.getByRole("link", { name: "Manage staff in Manage Case (opens in new tab)", exact: true });
  await expect(staffLink).toBeVisible();
  await expect(staffLink).toHaveAttribute("href", "https://manage-case.aat.platform.hmcts.net/staff");
  await expect(staffLink).toHaveAttribute("target", "_blank");
  await expect(staffLink).toHaveAttribute("rel", "noopener noreferrer");
  await accessible(page);
  await page.getByRole("tab", { name: "Referral process", exact: true }).click();

  await page.getByLabel("Processing window", { exact: true }).fill("31");
  await page.locator("#afternoonWindowStart").fill("10:00");
  await page.getByRole("button", { name: "Save referral process", exact: true }).click();
  await expect(page.getByRole("link", { name: "Enter the processing window as a whole number of days from 1 to 30", exact: true })).toBeVisible();
  await expect(page.getByLabel("Processing window", { exact: true })).toHaveValue("31");
  await accessible(page);

  await page.getByLabel("Processing window", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save referral process", exact: true }).click();
  await expect(page.getByRole("link", { name: "The afternoon window must start after the morning window ends", exact: true })).toBeVisible();
  await expect(page.locator("#afternoonWindowStart")).toHaveValue("10:00");
  await accessible(page);

  await page.locator("#afternoonWindowStart").fill("13:45");
  await page.getByLabel("Referrals per Master in each window", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Save referral process", exact: true }).click();
  await expect(page).toHaveURL("/deed-polls/settings?saved=process-settings#process-settings");
  await expect(page.getByText("Referral process saved.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Processing window", { exact: true })).toHaveValue("10");
  await expect(page.getByLabel("Referrals per Master in each window", { exact: true })).toHaveValue("12");
  await expect(page.locator("#afternoonWindowStart")).toHaveValue("13:45");
  await expect(page.locator("#process-settings")).toContainText("Last changed");
  await accessible(page);

  // New copy awaits translation, so only the translated chrome changes in Welsh; the saved value is the same.
  await page.goto("/deed-polls/settings?lng=cy");
  await expect(page.locator("#process-settings")).toContainText("Newidiwyd ddiwethaf");
  await expect(page.getByLabel("Processing window", { exact: true })).toHaveValue("10");
  await accessible(page);
});

test("Delivery Manager adds a Master, marks them unavailable, and adds and removes a bank holiday", async ({ page }) => {
  await signInAsDeliveryManager(page);
  await page.goto("/deed-polls/settings");
  const masters = page.locator("#masters");
  const holidays = page.locator("#bank-holidays");
  await page.getByRole("tab", { name: "Bank holidays", exact: true }).click();
  await expect(holidays.getByRole("row", { name: /Christmas Day/ }).first()).toContainText("25-12-26");
  await page.getByRole("tab", { name: "Masters", exact: true }).click();
  await expect(masters.getByText("No Masters have been added.", { exact: true })).toBeVisible();

  await page.getByLabel("Full name", { exact: true }).fill("Master Example");
  await page.locator("#master-email").fill("master.example@example.com");
  await page.getByRole("button", { name: "Add Master", exact: true }).click();
  await expect(page).toHaveURL("/deed-polls/settings?saved=master-added#masters");
  await expect(page.getByText("Master added.", { exact: true })).toBeVisible();
  const row = masters.getByRole("row", { name: /Master Example/ });
  await expect(row).toContainText("master.example@example.com");
  await expect(row.getByRole("cell").nth(2)).toHaveText("Yes");
  await accessible(page);

  await page.getByLabel("Full name", { exact: true }).fill("Master Duplicate");
  await page.locator("#master-email").fill("master.example@example.com");
  await page.getByRole("button", { name: "Add Master", exact: true }).click();
  // A refused add renders at the form's address, whose fragment opens the Masters tab with the error in view.
  await expect(page).toHaveURL("/deed-polls/settings/masters#masters");
  await expect(page.getByRole("tab", { name: "Masters", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("link", { name: "Another Master already has this email address", exact: true }).click();
  await expect(page.locator("#master-email")).toBeFocused();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("Master Duplicate");
  await accessible(page);

  await page.goto("/deed-polls/settings");
  await page.getByRole("tab", { name: "Masters", exact: true }).click();
  await masters.getByRole("link", { name: "Change Master Example", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Change a Master");
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue("master.example@example.com");
  await accessible(page);
  await page.getByRole("radio", { name: "No", exact: true }).check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL("/deed-polls/settings?saved=master-changed#masters");
  await expect(page.getByText("Master’s details saved.", { exact: true })).toBeVisible();
  await expect(
    masters
      .getByRole("row", { name: /Master Example/ })
      .getByRole("cell")
      .nth(2)
  ).toHaveText("No");

  await page.getByRole("tab", { name: "Bank holidays", exact: true }).click();
  await page.locator("#bank-holiday-date-day").fill("4");
  await page.locator("#bank-holiday-date-month").fill("6");
  await page.locator("#bank-holiday-date-year").fill("2029");
  await page.locator("#bank-holiday-name").fill("Extra bank holiday");
  await page.getByRole("button", { name: "Add bank holiday", exact: true }).click();
  await expect(page).toHaveURL("/deed-polls/settings?saved=bank-holiday-added#bank-holidays");
  await expect(page.getByText("Bank holiday added.", { exact: true })).toBeVisible();
  await expect(holidays.getByRole("row", { name: /Extra bank holiday/ })).toContainText("04-06-29");
  await accessible(page);

  await holidays.getByRole("link", { name: "Remove Extra bank holiday 04-06-29", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Are you sure you want to remove this bank holiday?");
  await accessible(page);
  await page.getByRole("button", { name: "Remove bank holiday", exact: true }).click();
  await expect(page).toHaveURL("/deed-polls/settings?saved=bank-holiday-removed#bank-holidays");
  await expect(page.getByText("Bank holiday removed.", { exact: true })).toBeVisible();
  await expect(holidays.getByRole("row", { name: /Extra bank holiday/ })).toHaveCount(0);
});

async function accessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
