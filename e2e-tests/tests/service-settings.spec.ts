import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { signInAsDeliveryManager } from "./idam-session.js";

// Run by `yarn test:gazette` against its own fresh mock, because saving the claim window is a write that must never
// land on a shared developer mock.
test("Delivery Manager opens the settings from the case list and changes the referral claim window", async ({ page }) => {
  await signInAsDeliveryManager(page);
  const settingsLink = page.getByRole("link", { name: "Service settings", exact: true });
  await settingsLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/deed-polls/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Service settings");
  await expect(page.getByLabel("Hours", { exact: true })).toHaveValue("168");
  await expect(page.getByLabel("Minutes", { exact: true })).toHaveValue("0");
  await expect(page.getByText("Changes take effect immediately for every case.", { exact: false })).toBeVisible();
  const staffLink = page.getByRole("link", { name: "Manage staff in Manage Case (opens in new tab)", exact: true });
  await expect(staffLink).toHaveAttribute("href", "https://manage-case.aat.platform.hmcts.net/staff");
  await expect(staffLink).toHaveAttribute("target", "_blank");
  await expect(staffLink).toHaveAttribute("rel", "noopener noreferrer");
  await accessible(page);

  await page.getByLabel("Hours", { exact: true }).fill("23");
  await page.getByLabel("Minutes", { exact: true }).fill("59");
  await page.getByRole("button", { name: "Save claim window", exact: true }).click();
  await expect(page.getByRole("link", { name: "The claim window must be at least 24 hours", exact: true })).toBeVisible();
  await expect(page.getByLabel("Hours", { exact: true })).toHaveValue("23");
  await expect(page.getByLabel("Minutes", { exact: true })).toHaveValue("59");
  await accessible(page);

  await page.getByLabel("Hours", { exact: true }).fill("24");
  await page.getByLabel("Minutes", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Save claim window", exact: true }).click();
  await expect(page).toHaveURL("/deed-polls/settings?saved=process-settings#process-settings");
  await expect(page.getByText("Claim window saved.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Hours", { exact: true })).toHaveValue("24");
  await expect(page.getByLabel("Minutes", { exact: true })).toHaveValue("30");
  await expect(page.locator("#process-settings")).toContainText("Last changed");
  await accessible(page);

  // New copy awaits translation, so only the translated chrome changes in Welsh; the saved value is the same.
  await page.goto("/deed-polls/settings?lng=cy");
  await expect(page.locator("#process-settings")).toContainText("Newidiwyd ddiwethaf");
  await expect(page.getByLabel("Minutes", { exact: true })).toHaveValue("30");
  await accessible(page);
});

async function accessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
