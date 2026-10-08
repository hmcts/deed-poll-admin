import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { signInAsAdmin, signInAsCaseworker } from "./idam-session.js";

const MOCK = "http://localhost:3216";
const READY = "/deed-polls/gazette";
const HISTORY = `${READY}/history`;

test("admin follows the empty and populated Gazette worklist, application details and paginated history", async ({ page, request }) => {
  test.slow();
  await signInAsAdmin(page);
  await expect(page.getByText("Applications ready for the London Gazette: 0", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View London Gazette applications" }).click();
  await expect(page.getByText("There are no applications ready for the London Gazette.")).toBeVisible();
  await accessible(page);
  await page.getByRole("link", { name: "Send history", exact: true }).click();
  await expect(page.getByText("No notices have been sent to the London Gazette.")).toBeVisible();
  await accessible(page);

  const firstId = await seedGazette(request);
  await page.goto("/deed-polls");
  await expect(page.getByText("Applications ready for the London Gazette: 26", { exact: true })).toBeVisible();
  const readyLink = page.getByRole("link", { name: "View London Gazette applications" });
  await readyLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(READY);
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await expect(page.locator("tbody tr").first()).toContainText("KBDP2026-00001");
  await expect(page.locator("tbody tr").first().getByText("Private", { exact: true })).toBeVisible();
  await expect(page.getByText("1 to 25 of 26 applications", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await accessible(page);
  await page.getByRole("link", { name: "KBDP2026-00001", exact: true }).click();
  await expect(page).toHaveURL(`/deed-polls/${firstId}`);
  await expect(page.locator("main")).toContainText("GazetteJourney");
  await page.goBack();
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page.getByText("26 to 26 of 26 applications", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("KBDP2026-00026");

  await page.getByRole("link", { name: "Send history", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  const newest = page.locator("tbody tr").first();
  await expect(newest.getByRole("cell").nth(0)).toContainText("26 September 2026");
  await expect(newest.getByRole("cell").nth(1)).toHaveText("Gazette <administrator>");
  await expect(newest.getByRole("cell").nth(2)).toHaveText("101");
  await expect(newest.getByRole("listitem")).toHaveCount(100);
  await expect(newest.getByRole("listitem").first()).toHaveText("<reference-001>");
  await expect(newest.getByText("Only some application references are shown.")).toBeVisible();
  await accessible(page);
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page.getByText("26 to 26 of 26 sends", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("Only some application references are shown.")).toHaveCount(0);
  await page.getByRole("link", { name: "Applications ready for the London Gazette", exact: true }).click();
  await expect(page).toHaveURL(READY);

  // This test owns its login/session; changing locale cannot affect another spec's saved session.
  await page.goto(`${READY}?lng=cy`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ceisiadau sy’n barod ar gyfer y London Gazette");
  await expect(page.getByText("1 i 25 o 26 o geisiadau", { exact: true })).toBeVisible();
  await accessible(page);
  await page.getByRole("link", { name: "Hanes anfon", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hanes anfon i’r London Gazette");
  await expect(page.getByText("Dim ond rhai cyfeirnodau ceisiadau sy’n cael eu dangos.")).toBeVisible();
  await accessible(page);
});

test("non-admin sees no Gazette count or link and is refused all Gazette pages", async ({ page }) => {
  await signInAsCaseworker(page);
  await expect(page.getByRole("link", { name: "View London Gazette applications" })).toHaveCount(0);
  await expect(page.getByText(/Applications ready for the London Gazette:/)).toHaveCount(0);
  for (const path of [READY, HISTORY, `${READY}/settings`]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await expect(page.locator("main")).not.toContainText("GazetteJourney");
    await accessible(page);
  }
});

test("admin sets and changes the Gazette recipient, with validation and stale-edit protection", async ({ page, context }) => {
  await signInAsAdmin(page);
  await page.goto(READY);
  await page.getByRole("link", { name: "London Gazette recipient", exact: true }).click();
  await expect(page.getByText("The recipient email address has not been set.")).toBeVisible();
  await page.getByRole("button", { name: "Save recipient", exact: true }).click();
  await expect(page.getByRole("link", { name: "Enter the London Gazette recipient email address", exact: true })).toBeVisible();
  await accessible(page);
  await page.getByLabel("Recipient email address", { exact: true }).fill("gazette@example.com");
  await page.getByRole("button", { name: "Save recipient", exact: true }).click();
  await expect(page.getByText("Recipient email address saved.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Recipient email address", { exact: true })).toHaveValue("gazette@example.com");
  await accessible(page);
  const stale = await context.newPage();
  await stale.goto(`${READY}/settings`);
  await page.getByLabel("Recipient email address", { exact: true }).fill("new-gazette@example.com");
  await page.getByRole("button", { name: "Save recipient", exact: true }).click();
  await stale.getByLabel("Recipient email address", { exact: true }).fill("stale@example.com");
  await stale.getByRole("button", { name: "Save recipient", exact: true }).click();
  await expect(stale.getByRole("link", { name: "Reload recipient settings", exact: true })).toBeVisible();
  await expect(stale.getByRole("button", { name: "Save recipient", exact: true })).toHaveCount(0);
  await accessible(stale);
  await stale.close();
  await page.goto(`${READY}/settings?lng=cy`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Derbynnydd y London Gazette");
  await expect(page.getByLabel("Cyfeiriad e-bost y derbynnydd", { exact: true })).toHaveValue("new-gazette@example.com");
  await accessible(page);
});

async function seedGazette(request: APIRequestContext): Promise<string> {
  let firstId = "";
  for (let n = 1; n <= 26; n++) {
    const date = String(n).padStart(2, "0");
    const response = await request.post(`${MOCK}/__mock/cases`, {
      data: {
        type: "Adult",
        state: "Enroled",
        newForename: "Ada",
        newSurname: "GazetteJourney",
        displayReference: `KBDP2026-${String(n).padStart(5, "0")}`,
        dateReceived: "2026-01-01T00:00:00.000",
        dateEnroled: `2026-02-${date}T00:00:00.000`,
        privacy: n === 1 ? "Private" : "Normal",
        publishToLondonGazette: true
      }
    });
    expect(response.status(), await response.text()).toBe(201);
    if (n === 1) firstId = (await response.json()).id;
    const batch = await request.post(`${MOCK}/__mock/gazette-batches`, {
      data: {
        sentAt: `2026-09-${date}T12:00:00.000`,
        sentBy: "Gazette <administrator>",
        referenceNumbers: Array.from({ length: n === 26 ? 101 : 1 }, (_, i) => `<reference-${String(101 - i).padStart(3, "0")}>`)
      }
    });
    expect(batch.status(), await batch.text()).toBe(201);
  }
  return firstId;
}

async function accessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
