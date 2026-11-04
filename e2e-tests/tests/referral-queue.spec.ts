/**
 * The Referrals screen, end to end in a browser — plan Fa1 (`docs/plans/20261030-fa1-referral-queue-screen.md`).
 *
 * A Team leader checks queued referrals, sends them to Masters inside a referral window and reassigns one outside
 * it, and the window's cap refuses a selection with no room for it.
 *
 * **On a mock of its own (`yarn test:referrals`), never the shared developer mock.** The referral clock and the
 * window's cap are the whole service's: these journeys move the clock *out* of a window and lower the cap, which
 * would refuse every send a parallel worker makes on the shared mock. The other specs only ever move the clock into
 * an open window (`openWindowWithRoom` in `./masters.ts`), so they stay in `yarn test:e2e`.
 *
 * **It signs itself in**, as `document-viewer.spec.ts` does, because its config has no setup project: a setup run
 * here would rewrite the shared `.auth/` sessions for another app's port.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";
import { CASEWORKER_EMAIL, DEPLOYED_STACK_SKIP_REASON, RUNS_AGAINST_DEPLOYED_STACK, signInAsTeamLeader } from "./idam-session.js";
import { bearer, type Master, newMaster } from "./masters.js";

// The config hands DEED_POLL_API_URL to the app it starts, not to this process, so the default is its mock's port.
const MOCK_API_URL = process.env.DEED_POLL_API_URL ?? "http://localhost:3218";

const QUEUE_PATH = "/deed-polls/referrals";

const DELIVERY_MANAGER = { sub: "e2e.referrals.delivery-manager", roles: ["caseworker-deedpoll-delivery-manager"] };

test.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);

test("a Team leader checks queued referrals, sends two to Masters inside a window, and reassigns one outside it", async ({ page, request }) => {
  test.slow();

  // Arrange: two Masters of this run's own and two queued referrals, one urgent, raised by a caseworker.
  const first = await newMaster(request, "Queue first", MOCK_API_URL);
  const second = await newMaster(request, "Queue second", MOCK_API_URL);
  const standard = await queuedReferral(request, { urgent: false });
  const urgent = await queuedReferral(request, { urgent: true });
  await moveClock(request, "closed");
  await signInAsTeamLeader(page);

  // ── the case list's link, and the queue outside a window ─────────────────────────────────────────────────────
  // Just after the morning window closes, so the next to open is the afternoon one.
  await page.getByRole("link", { name: "Referrals", exact: true }).click();
  await expect(page).toHaveURL(QUEUE_PATH);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Referrals");
  await expect(page.getByText(/^Referrals can be sent from 14:00 /)).toBeVisible();
  await expect(page.getByRole("table", { name: "Sent to each Master in this window" })).toHaveCount(0);

  // api's order, urgent first and tagged, never re-sorted here.
  const toSend = page.locator("#to-send tbody tr");
  await expect(toSend).toHaveCount(2);
  await expect(toSend.nth(0)).toContainText(urgent.reference);
  await expect(toSend.nth(0)).toContainText("Urgent");
  await expect(toSend.nth(1)).toContainText(standard.reference);
  await expect(toSend.nth(1)).toContainText("Applicant is a minor: Court Order");
  await expectNoAccessibilityViolations(page);

  // ── the check view ───────────────────────────────────────────────────────────────────────────────────────────
  await page.getByRole("link", { name: urgent.reference, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check referral");
  await expect(page.getByText("Hearing listed on Friday.")).toBeVisible();
  await expect(page.locator(".govuk-summary-list__row", { hasText: "Display reference" })).toContainText(urgent.reference);
  await expect(page.locator("main form")).toHaveCount(0);
  await expectNoAccessibilityViolations(page);
  await page.getByRole("link", { name: "Back to referrals" }).first().click();
  await expect(page).toHaveURL(QUEUE_PATH);

  // ── a selection with no Master is refused beside its row ─────────────────────────────────────────────────────
  await selectFor(page, urgent.reference).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("Choose a Master for this referral");
  await expect(selectFor(page, urgent.reference)).toBeChecked();
  await expectNoAccessibilityViolations(page);

  // ── reviewed outside a window: no Send ───────────────────────────────────────────────────────────────────────
  await chooseMaster(page, urgent.reference, first);
  await selectFor(page, standard.reference).check();
  await chooseMaster(page, standard.reference, second);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check the referrals before sending");
  await expect(page.getByText("Go back to the referrals and send them once the window opens.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send referrals" })).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // ── inside the window ────────────────────────────────────────────────────────────────────────────────────────
  await moveClock(request, "open");
  await page.goto(QUEUE_PATH);
  await expect(page.getByText("This morning’s window closes at 10:30.")).toBeVisible();
  await expect(page.getByText(/^0 of \d+ referrals sent\.$/)).toBeVisible();
  await expect(mastersTable(page)).toBeVisible();
  await expectNoAccessibilityViolations(page);

  await selectFor(page, urgent.reference).check();
  await chooseMaster(page, urgent.reference, first);
  await selectFor(page, standard.reference).check();
  await chooseMaster(page, standard.reference, second);
  await page.getByRole("button", { name: "Continue" }).click();

  const reviewed = page.locator("tbody tr");
  await expect(reviewed).toHaveCount(2);
  await expect(reviewed.filter({ hasText: urgent.reference })).toContainText(first.name);
  await expect(reviewed.filter({ hasText: standard.reference })).toContainText(second.name);
  await expect(page.getByText("This sends 2 referrals.")).toBeVisible();
  await expect(page.getByText(/^2 of \d+ will have been sent this morning\.$/)).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await page.getByRole("button", { name: "Send referrals" }).click();

  // The banner from api's answer, and the counts moved.
  await expect(page).toHaveURL(/\/deed-polls\/referrals\?sent=2&masters=2/);
  await expect(page.getByRole("alert")).toContainText("2 referrals sent to 2 Masters.");
  await expect(page.getByText(/^2 of \d+ referrals sent\.$/)).toBeVisible();
  await expect(mastersTable(page).locator("tr", { hasText: first.name })).toContainText("1");
  await expect(mastersTable(page).locator("tr", { hasText: second.name })).toContainText("1");
  await expect(page.getByText("There are no referrals waiting to be sent.")).toBeVisible();
  await expectNoAccessibilityViolations(page);

  // ── With a Master, and reassigning outside a window ──────────────────────────────────────────────────────────
  await moveClock(request, "closed");
  await page.getByRole("tab", { name: "With a Master" }).click();
  const withMaster = page.locator("#with-a-master tbody tr");
  await expect(withMaster.filter({ hasText: urgent.reference })).toContainText(first.name);
  await expect(withMaster.filter({ hasText: standard.reference })).toContainText(second.name);
  await withMaster
    .filter({ hasText: standard.reference })
    .getByRole("link", { name: /^Reassign/ })
    .click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reassign this referral");
  await expect(page.getByText(`This referral is with ${second.name}.`)).toBeVisible();
  await expect(page.getByText("If you reassign it to another Master, their time to give a direction starts again from today.")).toBeVisible();
  await expect(page.getByText("Reassigning does not use a place in a referral window.")).toBeVisible();
  await expect(page.getByRole("radio", { name: second.name, exact: true })).toBeChecked();
  await expectNoAccessibilityViolations(page);
  await page.getByRole("radio", { name: first.name, exact: true }).check();
  await page.getByRole("button", { name: "Reassign referral" }).click();

  await expect(page).toHaveURL(`${QUEUE_PATH}?reassigned=1#with-a-master`);
  await expect(page.getByRole("alert")).toContainText("Referral reassigned.");
  await expect(page.locator("#with-a-master tbody tr").filter({ hasText: standard.reference })).toContainText(first.name);
  await expectNoAccessibilityViolations(page);

  // And the caseworker's view of the same referral: with the Master it was reassigned to.
  await page.goto(`/deed-polls/${standard.caseId}`);
  await page.getByRole("tab", { name: "Referrals", exact: true }).click();
  await expect(page.locator("#referrals .govuk-tag")).toHaveText(`With ${first.name}`);
});

/**
 * The window's cap is the total across all Masters. Lowered to leave room for one, through api's settings as a
 * Delivery Manager would on the settings page, and restored at the end.
 */
test("the window's cap refuses a selection over the room left, and a send that loses the last place", async ({ page, request }) => {
  test.slow();

  const master = await newMaster(request, "Queue cap", MOCK_API_URL);
  const kept = await queuedReferral(request, { urgent: false });
  const other = await queuedReferral(request, { urgent: false });
  const racer = await queuedReferral(request, { urgent: false });
  await moveClock(request, "open");
  const restore = await setCapToLeaveRoom(request, 1);
  await signInAsTeamLeader(page);

  try {
    // Two selected with room for one: the room left, and no Send.
    await page.goto(QUEUE_PATH);
    await selectFor(page, kept.reference).check();
    await chooseMaster(page, kept.reference, master);
    await selectFor(page, other.reference).check();
    await chooseMaster(page, other.reference, master);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Only 1 more referral can be sent this morning.")).toBeVisible();
    await expect(page.getByText("Go back to the referrals and select fewer.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send referrals" })).toHaveCount(0);
    await expectNoAccessibilityViolations(page);

    // One selected fits, and the last place goes elsewhere while the review is open: api's 409 on the review.
    await page.getByRole("link", { name: "Back to referrals" }).click();
    await selectFor(page, kept.reference).check();
    await chooseMaster(page, kept.reference, master);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("button", { name: "Send referrals" })).toBeVisible();
    const taken = await request.post(`${MOCK_API_URL}/caseworker/referral-queue/sends`, {
      headers: bearer(DELIVERY_MANAGER),
      data: { allocations: [{ referralId: racer.referralId, masterId: master.id }] }
    });
    expect(taken.status(), await taken.text()).toBe(200);
    await page.getByRole("button", { name: "Send referrals" }).click();

    await expect(page.getByRole("alert")).toContainText("No more referrals can be sent this morning.");
    await expect(page.getByRole("button", { name: "Send referrals" })).toHaveCount(0);
    await expectNoAccessibilityViolations(page);
  } finally {
    await restore();
  }
});

/** A case of its own with a referral raised into the queue by a caseworker. */
async function queuedReferral(request: APIRequestContext, options: { urgent: boolean }): Promise<QueuedReferral> {
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const surname = `Queueby${token}`;
  const reference = `KBDP2026-${String(Math.floor(Math.random() * 100_000)).padStart(5, "0")}`;
  const created = await request.post(`${MOCK_API_URL}/__mock/cases`, {
    data: { type: "Adult", state: "Received", newForename: "Ines", newSurname: surname, displayReference: reference, dateReceived: "2026-08-04T00:00:00.000" }
  });
  expect(created.status(), await created.text()).toBe(201);
  const caseId: string = (await created.json()).id;

  const raised = await request.post(`${MOCK_API_URL}/caseworker/cases/${caseId}/referrals`, {
    headers: bearer({ sub: CASEWORKER_EMAIL }),
    data: {
      reasons: ["Minor", "MinorCourtOrder"],
      ...(options.urgent ? { urgency: "Urgent", urgencyReason: "Hearing listed on Friday." } : { urgency: "Normal" })
    }
  });
  expect(raised.status(), await raised.text()).toBe(201);

  return { caseId, referralId: (await raised.json()).id, reference, surname };
}

/** Just inside, or just after, the next morning window — the mock's own control (`/__mock/clock`). */
async function moveClock(request: APIRequestContext, window: "open" | "closed"): Promise<void> {
  const moved = await request.post(`${MOCK_API_URL}/__mock/clock`, { data: { window } });
  expect(moved.status(), await moved.text()).toBe(200);
}

/** Set the cap to what is already sent in the current window plus `room`, and return how to put it back. */
async function setCapToLeaveRoom(request: APIRequestContext, room: number): Promise<() => Promise<void>> {
  const queue = await request.get(`${MOCK_API_URL}/caseworker/referral-queue?size=1`, { headers: bearer(DELIVERY_MANAGER) });
  expect(queue.status(), await queue.text()).toBe(200);
  const { sent } = (await queue.json()).window as { sent: number };
  const original = await writeCap(request, sent + room);

  return async () => {
    await writeCap(request, original);
  };
}

/** Write `windowCap`, keeping every other process setting, and answer the cap it replaced. */
async function writeCap(request: APIRequestContext, windowCap: number): Promise<number> {
  const read = await request.get(`${MOCK_API_URL}/caseworker/process-settings`, { headers: bearer(DELIVERY_MANAGER) });
  expect(read.status(), await read.text()).toBe(200);
  const stored = await read.json();
  const fields = [
    "referralClaimExpiryMinutes",
    "reminderIntervalHours",
    "morningWindowStart",
    "morningWindowEnd",
    "afternoonWindowStart",
    "afternoonWindowEnd",
    "revision"
  ];
  const written = await request.put(`${MOCK_API_URL}/caseworker/process-settings`, {
    headers: bearer(DELIVERY_MANAGER),
    data: { ...Object.fromEntries(fields.map((field) => [field, stored[field]])), windowCap }
  });
  expect(written.status(), await written.text()).toBe(200);

  return stored.windowCap;
}

/** A queue row's checkbox, by the visually hidden label naming its reference. */
function selectFor(page: Page, reference: string): Locator {
  return page.getByRole("checkbox", { name: `Select ${reference}`, exact: true });
}

async function chooseMaster(page: Page, reference: string, master: Master): Promise<void> {
  await page.getByRole("combobox", { name: `Master for ${reference}`, exact: true }).selectOption({ label: master.name });
}

function mastersTable(page: Page): Locator {
  return page.getByRole("table", { name: "Sent to each Master in this window" });
}

/** The WCAG scope every other journey checks, reported as `id: selector` so a failure names the element. */
async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

  expect(results.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target}`))).toEqual([]);
}

interface QueuedReferral {
  caseId: string;
  referralId: string;
  reference: string;
  surname: string;
}
