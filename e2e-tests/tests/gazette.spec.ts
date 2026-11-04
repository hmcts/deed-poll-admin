import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { signInAsAdmin, signInAsCaseworker, signInAsDeliveryManager, signInAsJudge, signInAsTeamLeader } from "./idam-session.js";

const MOCK = "http://localhost:3216";
const READY = "/deed-polls/gazette";
const HISTORY = `${READY}/history`;
const SETTINGS = "/deed-polls/settings";

test("Delivery Manager follows the empty and populated Gazette worklist, application details and paginated history", async ({ page, request }) => {
  test.slow();
  await signInAsDeliveryManager(page);
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

for (const [role, signIn] of [
  ["Team leader", signInAsTeamLeader],
  ["legacy admin", signInAsAdmin],
  ["ordinary caseworker", signInAsCaseworker],
  ["judge", signInAsJudge]
] as const) {
  test(`${role} sees no Gazette count or settings links and is refused all Gazette and settings pages`, async ({ page }) => {
    await signIn(page);
    await page.goto("/deed-polls?filter=readyForPublication");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deed poll cases");
    await expect(page.getByText("All applications", { exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "View London Gazette applications" })).toHaveCount(0);
    await expect(page.getByText(/Applications ready for the London Gazette:/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Service settings" })).toHaveCount(0);
    for (const path of [
      SETTINGS,
      `${SETTINGS}/gazette-recipient`,
      READY,
      HISTORY,
      `${READY}/settings`,
      `${READY}/batch`,
      `${READY}/requests`,
      `${READY}/requests/00000000-0000-4000-8000-000000000001`
    ]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(403);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
      await expect(page.locator("main")).not.toContainText("GazetteJourney");
      await accessible(page);
    }
  });
}

test("Delivery Manager sets and changes the Gazette recipient, with validation and stale-edit protection", async ({ page, context }) => {
  await signInAsDeliveryManager(page);
  await page.goto(READY);
  await page.getByRole("link", { name: "London Gazette recipient", exact: true }).click();
  await expect(page).toHaveURL(`${SETTINGS}#gazette-recipient`);
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
  // The old address, kept as a redirect for anything that still links to it.
  await stale.goto(`${READY}/settings`);
  await expect(stale).toHaveURL(`${SETTINGS}#gazette-recipient`);
  await page.getByLabel("Recipient email address", { exact: true }).fill("new-gazette@example.com");
  await page.getByRole("button", { name: "Save recipient", exact: true }).click();
  await stale.getByLabel("Recipient email address", { exact: true }).fill("stale@example.com");
  await stale.getByRole("button", { name: "Save recipient", exact: true }).click();
  await expect(stale.getByRole("link", { name: "Reload recipient settings", exact: true })).toBeVisible();
  await expect(stale.getByRole("button", { name: "Save recipient", exact: true })).toHaveCount(0);
  await accessible(stale);
  await stale.close();
  await page.goto(`${SETTINGS}?lng=cy`);
  await page.getByRole("tab", { name: "Derbynnydd y London Gazette", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Derbynnydd y London Gazette" })).toBeVisible();
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

test("Delivery Manager checks every request outcome and the full membership of an older send", async ({ page, request }) => {
  test.slow();
  const explanations = {
    Preparing: "The request is being prepared.",
    Sending: "The email is being sent.",
    Sent: "The email has been accepted for sending.",
    NotSent: "The email was not sent.",
    Uncertain: "The email may have been sent."
  };
  for (const [index, state] of Object.keys(explanations).entries()) {
    const batchId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const seeded = await request.post(`${MOCK}/__mock/gazette-requests`, {
      data: {
        status: {
          batchId,
          state,
          submittedAt: "2026-10-01T12:00:00",
          submittedBy: "Request administrator",
          caseCount: 1,
          recipientEmail: "gazette@example.com",
          recipientRevision: 1,
          adultCount: 1,
          minorCount: 0
        },
        cases: [{ caseId: `request-case-${index}`, referenceNumber: `<frozen-${index}>` }]
      }
    });
    expect(seeded.status(), await seeded.text()).toBe(201);
  }
  await signInAsDeliveryManager(page);
  await page.goto(READY);
  await page.getByRole("link", { name: "Gazette requests", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await accessible(page);
  for (const [index, [state, explanation]] of Object.entries(explanations).entries()) {
    const batchId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    await page.goto(`${READY}/requests/${batchId}`);
    await expect(page.getByText(explanation, { exact: false })).toBeVisible();
    await expect(page.getByRole("cell", { name: `<frozen-${index}>`, exact: true })).toBeVisible();
    await expect(page.locator("main form")).toHaveCount(0);
    await page.getByRole("link", { name: "Refresh status", exact: true }).click();
    await expect(page.getByText(explanation, { exact: false })).toBeVisible();
    await accessible(page);
    if (state === "Uncertain") {
      await page.goto(`${READY}/requests/${batchId}?lng=cy`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cais Gazette");
      await expect(page.getByText("Canlyniad ansicr", { exact: true })).toBeVisible();
      await accessible(page);
    }
  }
  const legacy = "00000000-0000-4000-8000-000000000099";
  const seed = await request.post(`${MOCK}/__mock/gazette-batches`, {
    data: {
      id: legacy,
      sentAt: "2026-10-08T12:00:00",
      sentBy: "Legacy sender",
      referenceNumbers: Array.from({ length: 101 }, (_, n) => `LEGACY-${String(n + 1).padStart(3, "0")}`)
    }
  });
  expect(seed.status()).toBe(201);
  await page.goto(`${HISTORY}?lng=en`);
  await page.locator("tbody tr").first().getByRole("link", { name: "View request and all application references" }).click();
  await expect(page).toHaveURL(`${READY}/requests/${legacy}`);
  await expect(page.getByText("Some details were not recorded for older sends.")).toBeVisible();
  for (let n = 0; n < 4; n++) await page.getByRole("link", { name: "Next page" }).click();
  await expect(page.getByText("101 to 101 of 101 applications", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "LEGACY-101", exact: true })).toBeVisible();
  await accessible(page);
});

test("Delivery Manager completes mandatory reviews and confirms Gazette requests, recovering a lost response without a second send", async ({
  page,
  request
}) => {
  test.slow();
  await signInAsDeliveryManager(page);
  await page.goto(`${SETTINGS}#gazette-recipient`);
  await page.getByLabel("Recipient email address", { exact: true }).fill("reviewed-gazette@example.com");
  await page.getByRole("button", { name: "Save recipient", exact: true }).click();
  const explanations = {
    Sent: "The email has been accepted for sending.",
    Preparing: "The request is being prepared.",
    Sending: "The email is being sent.",
    NotSent: "The email was not sent.",
    Uncertain: "The email may have been sent."
  };
  for (const [index, [state, explanation]] of Object.entries(explanations).entries()) {
    const references = [`SEND-${state}-ADULT`, ...(state === "Sent" ? ["SEND-Sent-MINOR"] : [])];
    for (const [group, reference] of references.entries()) {
      const seeded = await request.post(`${MOCK}/__mock/cases`, {
        data: {
          type: group === 0 ? "Adult" : "Minor",
          state: "Enroled",
          publishToLondonGazette: true,
          dateNoticeSentToLondonGazette: null,
          dateEnroled: "2020-01-01T00:00:00",
          displayReference: reference,
          oldForename: "Former",
          oldMiddleName: "OldMiddle",
          oldSurname: "Applicant",
          newForename: "New",
          newMiddleName: "NewMiddle",
          newSurname: "Applicant"
        }
      });
      expect(seeded.status()).toBe(201);
    }
    await page.goto(`${READY}/batch`);
    for (const reference of references) {
      await expect(page.getByRole("checkbox", { name: `Select ${reference}`, exact: true })).toBeDisabled();
      await page.getByRole("button", { name: `Review application ${reference}`, exact: true }).click();
      await expect(page.getByText("Former OldMiddle Applicant", { exact: true })).toBeVisible();
      if (index === 0) {
        await page.getByRole("button", { name: "Complete review", exact: true }).click();
        await expect(page.getByRole("link", { name: "Complete all five checks before selecting this application", exact: true })).toBeVisible();
        await accessible(page);
      }
      for (const box of await page.locator('input[name="checks"]').all()) await box.check();
      await page.getByRole("button", { name: "Complete review", exact: true }).click();
      await page.getByRole("checkbox", { name: `Select ${reference}`, exact: true }).check();
    }
    await page.getByRole("button", { name: "Check selected applications", exact: true }).click();
    await expect(page.getByText("reviewed-gazette@example.com", { exact: true })).toBeVisible();
    for (const reference of references) await expect(page.getByRole("listitem").filter({ hasText: reference })).toBeVisible();
    await accessible(page);
    const confirmationForm = await page.locator('input[name="journey"]').inputValue();
    if (index === 0) {
      await page.getByRole("button", { name: "Confirm and send email", exact: true }).click();
      await expect(page.getByRole("link", { name: "Confirm the recipient and applications before sending", exact: true })).toBeVisible();
    }
    expect((await request.post(`${MOCK}/__mock/gazette-outcome`, { data: { state, loseResponse: state === "Sent" || state === "Uncertain" } })).status()).toBe(
      200
    );
    await page.getByRole("checkbox", { name: "I confirm that these reviewed applications should be sent to this recipient.", exact: true }).check();
    // A duplicated confirmation tab can post the same request while the original submits.
    const duplicate =
      state === "Sending" ? page.request.post(`${READY}/batch`, { form: { journey: confirmationForm, action: "send", confirmed: "yes" } }) : null;
    await page.getByRole("button", { name: "Confirm and send email", exact: true }).click();
    if (state === "Sent" || state === "Uncertain") {
      await expect(page.getByRole("button", { name: "Check request status", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Confirm and send email", exact: true })).toHaveCount(0);
      await accessible(page);
      await page.getByRole("button", { name: "Check request status", exact: true }).click();
    }
    await expect(page).toHaveURL(/\/deed-polls\/gazette\/requests\/[a-f0-9-]+$/);
    const statusUrl = page.url();
    if (duplicate) expect((await duplicate).url()).toBe(statusUrl);
    await expect(page.getByText(explanation, { exact: false })).toBeVisible();
    await expect(page.locator("main form")).toHaveCount(0);
    await accessible(page);
    if (state === "Sent") {
      // Reposting the old confirmation after acceptance cannot send another email, even if the browser missed the redirect.
      const repeat = await page.request.post(`${READY}/batch`, { form: { journey: confirmationForm, action: "send", confirmed: "yes" } });
      expect(repeat.status()).toBe(400);
      expect(await repeat.text()).toContain("has changed since it was reviewed");
      await page.goto(HISTORY);
      await expect(page.locator("tbody tr").filter({ hasText: "SEND-Sent-ADULT" })).toHaveCount(1);
    }
    if (state === "Uncertain") {
      await page.goto(`${statusUrl}?lng=cy`);
      await expect(page.getByText("Canlyniad ansicr", { exact: true })).toBeVisible();
      await accessible(page);
      await page.goto(`${READY}/batch?lng=cy`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Adolygu ceisiadau ar gyfer y London Gazette");
      await page.getByRole("button", { name: `Adolygu’r cais ${references[0]}`, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cwblhau rhestr wirio’r cais");
      await accessible(page);
    }
  }
});
