/**
 * Management information, end to end in a browser (plan `docs/plans/completed/20261103-mi-dashboard-page.md`).
 *
 * A Team leader opens the page from the case list, changes the period, sees the four tables and downloads one CSV;
 * a caseworker is refused the page and its downloads.
 *
 * **Read-only, so it stays in `yarn test:e2e`.** The mock's figures are a fixed function of the range asked for and
 * nothing here writes, so it is safe on the shared developer mock. It signs itself in, as `referral-queue.spec.ts`
 * does, so it also runs under a config with no setup project.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { DEPLOYED_STACK_SKIP_REASON, RUNS_AGAINST_DEPLOYED_STACK, signInAsCaseworker, signInAsTeamLeader } from "./idam-session.js";

const PAGE_PATH = "/deed-polls/management-information";
const SECTION_HEADINGS = ["Cases received and open", "How long each stage took", "Referral outcomes", "Time from receipt to completion"];
// The same WCAG scope every other journey checks.
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BOM = "\uFEFF";
/**
 * The one waived axe finding, and it is govuk-frontend's: `radios.mjs` sets `aria-expanded` on a radio with a
 * conditional reveal, which ARIA 1.2 does not allow on `role="radio"` (see `deed-polls.spec.ts`'s
 * `UPSTREAM_RADIO_REVEAL`). Waived by rule and element, so the same rule on anything else still fails.
 */
const UPSTREAM_RADIO_REVEAL = ["aria-allowed-attr: #period-6"];

test.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);

test("a Team leader changes the period, sees the tables and downloads a CSV", async ({ page }) => {
  // Arrange
  await signInAsTeamLeader(page);

  // Act: from the case list's link, onto the default view.
  await page.getByRole("link", { name: "Management information", exact: true }).click();

  // Assert: last 30 days, weekly, with every section's table.
  await expect(page).toHaveURL(PAGE_PATH);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Management information");
  await expect(page.getByLabel("Last 30 days")).toBeChecked();
  await expect(page.locator("#range-summary")).toContainText("grouped by week");
  await expectSections(page);
  await expectNoAccessibilityViolations(page);

  // Act: the last year, which groups by month unless told otherwise.
  const defaultRange = await page.locator("#range-summary").textContent();
  await page.getByLabel("Last year").check();
  await page.getByRole("button", { name: "Show figures" }).click();

  // Assert
  await expect(page).toHaveURL(/[?&]period=year(&|$)/);
  await expect(page.getByLabel("Last year")).toBeChecked();
  await expect(page.locator("#range-summary")).toContainText("grouped by month");
  await expect(page.locator("#range-summary")).not.toHaveText(defaultRange ?? "");
  await expectSections(page);
  await expectNoAccessibilityViolations(page);

  // Act: one section's CSV.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download cases received and open (CSV)" }).click()]);

  // Assert: the A8 filename, a BOM and the header row.
  expect(download.suggestedFilename()).toMatch(/^deed-poll-mi-volume-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
  expect(text.startsWith(BOM)).toBe(true);
  const [header, ...rows] = text.slice(BOM.length).trimEnd().split("\r\n");
  expect(header).toMatch(/^Period start,Period end,/);
  expect(header).toContain("Open at end");
  expect(rows.length).toBeGreaterThan(0);
});

test("a caseworker is refused the page and its downloads", async ({ page }) => {
  // Arrange
  await signInAsCaseworker(page);

  // Assert: no link on the case list.
  await expect(page.getByRole("link", { name: "Management information", exact: true })).toHaveCount(0);

  for (const path of [PAGE_PATH, `${PAGE_PATH}/volume.csv`]) {
    // Act
    const response = await page.goto(path);

    // Assert: the standard 403, on the view that says nothing about what was refused.
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  }
});

async function expectSections(page: Page): Promise<void> {
  for (const heading of SECTION_HEADINGS) {
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }
  await expect(page.getByRole("table", { name: "Cases received and open" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Referral outcomes" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Time from receipt to completion" })).toBeVisible();
  expect(await page.locator("#stage-durations table").count()).toBeGreaterThan(1);
}

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  // One finding per element, so the waiver never covers another element reported under the same rule.
  const findings = results.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target}`));
  expect(findings.filter((finding) => !UPSTREAM_RADIO_REVEAL.includes(finding))).toEqual([]);
}
