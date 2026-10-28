import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { signInAsDeliveryManager } from "./idam-session.js";

// Run by `yarn test:gazette` against its own fresh mock, because saving the referral process is a write that must never
// land on a shared developer mock.
test("Delivery Manager opens the settings from the case list and changes the referral process", async ({ page }) => {
  await signInAsDeliveryManager(page);
  const settingsLink = page.getByRole("link", { name: "Service settings", exact: true });
  await settingsLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/deed-polls/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Service settings");
  await expect(page.getByLabel("Processing window", { exact: true })).toHaveValue("7");
  await expect(page.getByLabel("Reminder interval", { exact: true })).toHaveValue("48");
  await expect(page.locator("#afternoonWindowStart")).toHaveValue("14:00");
  await expect(page.getByText("Changes take effect immediately for every referral.", { exact: true })).toBeVisible();
  const staffLink = page.getByRole("link", { name: "Manage staff in Manage Case (opens in new tab)", exact: true });
  await expect(staffLink).toHaveAttribute("href", "https://manage-case.aat.platform.hmcts.net/staff");
  await expect(staffLink).toHaveAttribute("target", "_blank");
  await expect(staffLink).toHaveAttribute("rel", "noopener noreferrer");
  await accessible(page);

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

async function accessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
