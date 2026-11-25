/**
 * A Delivery Manager's application deletion, end to end in a browser (plan `docs/plans/20261118-dm-application-deletion.md`,
 * Task 4).
 *
 * From the application's detail page through the confirmation to the request's status page, restore inside and after
 * the grace period, and every way the journey stops without a write: Cancel, another role, a stale confirmation, a
 * refusal by api's code, a lost admission response recovered with the same key, a request that needs attention and
 * a status read that fails.
 *
 * **On a mock of its own (`yarn test:application-deletion`), never the shared developer mock.** The deletion outcome
 * controls (`/__mock/application-deletion-outcome`) are the whole mock's, so a lost response or an injected refusal
 * set here would land on a parallel worker's deletion.
 *
 * **What this proves is the browser journey against the mock, not permanent removal.** The mock never deletes
 * anything remotely: `Completed` is moved by its `/__mock/application-deletions` control and drops the case from
 * memory. That CDAM, CCD and the documents are really removed is api's proof, under its own plan.
 *
 * **It signs itself in**, as `referral-queue.spec.ts` does, because its config has no setup project.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";
import { CASEWORKER_EMAIL, DEPLOYED_STACK_SKIP_REASON, RUNS_AGAINST_DEPLOYED_STACK, signInAsDeliveryManager, signInAsTeamLeader } from "./idam-session.js";
import { bearer } from "./masters.js";

// The config hands DEED_POLL_API_URL to the app it starts, not to this process, so the default is its mock's port.
const MOCK_API_URL = process.env.DEED_POLL_API_URL ?? "http://localhost:3220";
const STATUS_PATH = /\/deed-polls\/deletions\/([0-9a-f-]{36})$/;
const NOTE = "Raised twice by mistake when the post was opened";

test.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);

test.afterEach(async ({ request }) => {
  // Whatever a journey switched on, the next one starts from api's ordinary answers.
  await configureOutcome(request, { loseAdmissionResponse: false, statusReads: "available" });
});

test("a Delivery Manager deletes a duplicate, which leaves the list, search, the queue and its old link while the original stays", async ({
  page,
  request
}) => {
  test.slow();

  // Arrange: the original and its duplicate, sharing a name, and a referral waiting in the queue on the duplicate.
  const original = await seededCase(request);
  const duplicate = await seededCase(request, { surname: original.surname });
  await raiseReferral(request, duplicate.caseId);
  await signInAsDeliveryManager(page);

  // ── the action on the detail page ────────────────────────────────────────────────────────────────────────────
  await page.goto(`/deed-polls/${duplicate.caseId}`);
  await page.getByRole("button", { name: "Delete application" }).click();
  await expect(page).toHaveURL(`/deed-polls/${duplicate.caseId}/delete`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Are you sure you want to permanently delete this application?");
  await expect(page.locator(".govuk-summary-list")).toContainText(duplicate.reference);
  await expect(page.getByText("A Delivery Manager can restore it for 14 days after you delete it.")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Created in error" })).not.toBeChecked();
  await expect(page.getByRole("radio", { name: "Duplicate application" })).not.toBeChecked();
  await expectNoAccessibilityViolations(page);

  // ── nothing answered: both errors, each summary link reaching its control ─────────────────────────────────────
  await page.getByRole("button", { name: "Permanently delete application" }).click();
  const summary = page.locator(".govuk-error-summary");
  await expect(summary).toContainText("Select why this application is being deleted");
  await expect(summary).toContainText("Enter why you are deleting this application");
  await summary.getByRole("link", { name: "Enter why you are deleting this application" }).click();
  await expect(page.locator("#note")).toBeFocused();
  await summary.getByRole("link", { name: "Select why this application is being deleted" }).click();
  await expect(page.locator("#reason")).toBeFocused();
  await expectNoAccessibilityViolations(page);

  // ── answered by keyboard alone ───────────────────────────────────────────────────────────────────────────────
  // Focus is on the first radio (Created in error); the arrow selects the second, Tab leaves the group.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "Duplicate application" })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.locator("#note")).toBeFocused();
  await page.keyboard.type(NOTE);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Permanently delete application" })).toBeFocused();
  await page.keyboard.press("Enter");

  // ── a request, not yet a deletion ────────────────────────────────────────────────────────────────────────────
  const requestId = await statusRequestId(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Application deleted from view");
  await expect(page.getByText(/^The application has been deleted from view\. A Delivery Manager can restore it until /)).toBeVisible();
  await expect(page.locator(".govuk-summary-list")).toContainText("Duplicate application");
  await expect(page.getByRole("button", { name: "Restore application" })).toBeVisible();
  await expect(page.getByText("Application deleted", { exact: true })).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // ── gone from the list and search, the queue and its old link; the original survives ─────────────────────────
  await page.goto(`/deed-polls?q=${original.surname}`);
  const rows = page.locator("tbody tr");
  await expect(rows.filter({ hasText: original.reference })).toHaveCount(1);
  await expect(rows.filter({ hasText: duplicate.reference })).toHaveCount(0);
  await page.goto("/deed-polls/referrals");
  await expect(page.locator("#to-send")).not.toContainText(duplicate.reference);
  await page.goto(`/deed-polls/${duplicate.caseId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  await page.goto(`/deed-polls/${original.caseId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(original.reference);

  // ── only api's Completed is worded as a deletion ─────────────────────────────────────────────────────────────
  await moveRequest(request, { requestId, status: "Completed" });
  await page.goto(`/deed-polls/deletions/${requestId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Application deleted");
  await expect(page.locator(".govuk-summary-list")).toContainText("Deleted");
  await expect(page.getByRole("button", { name: "Restore application" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Refresh" })).toHaveCount(0);
  await expect(page.locator("main form")).toHaveCount(0);
  await expectNoAccessibilityViolations(page);
});

test("a Delivery Manager restores an application created in error, and the original confirmation is then stale", async ({ page, request }) => {
  test.slow();

  // Arrange
  const seeded = await seededCase(request);
  await signInAsDeliveryManager(page);

  // ── Cancel writes nothing ────────────────────────────────────────────────────────────────────────────────────
  await page.goto(`/deed-polls/${seeded.caseId}/delete`);
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(`/deed-polls/${seeded.caseId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(seeded.reference);

  // ── deleted, keeping the confirmation this browser submitted ─────────────────────────────────────────────────
  await page.getByRole("button", { name: "Delete application" }).click();
  const reviewed = await page.locator('main input[name="journey"]').inputValue();
  await answer(page, "Created in error");
  const requestId = await statusRequestId(page);

  // ── restore: a confirmation, its Cancel, then the restore itself ─────────────────────────────────────────────
  await page.getByRole("button", { name: "Restore application" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Restore this application?");
  await expectNoAccessibilityViolations(page);
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(`/deed-polls/deletions/${requestId}`);
  await page.getByRole("button", { name: "Restore application" }).click();
  await page.getByRole("button", { name: "Restore application" }).click();
  await expect(page).toHaveURL(`/deed-polls/${seeded.caseId}?deletion=restored`);
  await expect(page.getByText("The application has been restored and is back on the service.")).toBeVisible();
  await page.goto(`/deed-polls?q=${seeded.surname}`);
  await expect(page.locator("tbody tr").filter({ hasText: seeded.reference })).toHaveCount(1);

  // ── api deleted the restored request ─────────────────────────────────────────────────────────────────────────
  await page.goto(`/deed-polls/deletions/${requestId}/restore?case=${seeded.caseId}`);
  await page.getByRole("button", { name: "Restore application" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This deletion request no longer exists");
  await expect(page.getByRole("link", { name: "View the application" })).toHaveAttribute("href", `/deed-polls/${seeded.caseId}`);

  // ── the original confirmation, resubmitted: the restore changed the application ──────────────────────────────
  await page.goto(`/deed-polls/${seeded.caseId}/delete`);
  await page.locator('main input[name="journey"]').evaluate((input, value) => {
    (input as HTMLInputElement).value = value;
  }, reviewed);
  await answer(page, "Created in error");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The application has changed");
  await expect(page.locator("main form")).toHaveCount(0);
  await page.getByRole("link", { name: "Return to the application" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(seeded.reference);
});

test("a restore after the grace period is refused in this page's words", async ({ page, request }) => {
  // Arrange: a deleted application whose restore confirmation is open while its window closes.
  const seeded = await seededCase(request);
  await signInAsDeliveryManager(page);
  await page.goto(`/deed-polls/${seeded.caseId}/delete`);
  await answer(page, "Duplicate application");
  const requestId = await statusRequestId(page);
  await page.getByRole("button", { name: "Restore application" }).click();
  await moveRequest(request, { requestId, restoreWindow: "closed" });

  // Act
  await page.getByRole("button", { name: "Restore application" }).click();

  // Assert: the status redrawn from a fresh read, with no restore offered and the application still gone.
  await expect(page.getByRole("region", { name: "Important" })).toContainText(
    "The application has not been restored, because the time to restore it has ended."
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Application waiting to be permanently removed");
  await expect(page.getByRole("button", { name: "Restore application" })).toHaveCount(0);
  await expectNoAccessibilityViolations(page);
  await page.goto(`/deed-polls/${seeded.caseId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
});

test("a stale confirmation and api's refusals delete nothing and offer no resubmit", async ({ page, request }) => {
  // Arrange
  const changed = await seededCase(request);
  const retained = await seededCase(request, { retainPermanently: true });
  const unsettled = await seededCase(request);
  await signInAsDeliveryManager(page);

  // ── a note added after the review makes it stale ─────────────────────────────────────────────────────────────
  await page.goto(`/deed-polls/${changed.caseId}/delete`);
  await addNote(request, changed.caseId);
  await answer(page, "Duplicate application");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The application has changed");
  await expect(page.getByText(/^The application has changed since you reviewed it\./)).toBeVisible();
  await expect(page.locator("main form")).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // ── api's own eligibility, by its code ───────────────────────────────────────────────────────────────────────
  await page.goto(`/deed-polls/${retained.caseId}/delete`);
  await answer(page, "Created in error");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The application cannot be deleted");
  await expect(page.getByText("The application is marked to be kept permanently, so it cannot be deleted.")).toBeVisible();

  // ── a refusal api reaches through work the mock cannot know about ────────────────────────────────────────────
  await configureOutcome(request, { refuseAdmission: "EMAIL_SEND_UNRESOLVED" });
  await page.goto(`/deed-polls/${unsettled.caseId}/delete`);
  await answer(page, "Created in error");
  await expect(page.getByText("An email about the application has not finished sending, so it cannot be deleted yet. Try again later.")).toBeVisible();

  // Every one is still on the service.
  for (const each of [changed, retained, unsettled]) {
    await page.goto(`/deed-polls/${each.caseId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(each.reference);
  }
});

test("a lost admission response is recovered with the same request, never a second one", async ({ page, request }) => {
  // Arrange
  const seeded = await seededCase(request);
  await signInAsDeliveryManager(page);
  await configureOutcome(request, { loseAdmissionResponse: true });

  // Act: api admitted it, but its answer never arrived.
  await page.goto(`/deed-polls/${seeded.caseId}/delete`);
  await answer(page, "Duplicate application");

  // Assert: the page does not guess, and offers only the check.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("We do not know whether the application has been deleted");
  await expect(page.getByRole("button", { name: "Permanently delete application" })).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expectNoAccessibilityViolations(page);
  await page.getByRole("button", { name: "Check deletion request" }).click();
  const requestId = await statusRequestId(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Application deleted from view");

  // The same request: a repeat of the check lands on the same id.
  await page.goBack();
  await page.getByRole("button", { name: "Check deletion request" }).click();
  expect(await statusRequestId(page)).toBe(requestId);
});

test("a request that needs attention stays so, and a failed status read says progress could not be checked", async ({ page, request }) => {
  // Arrange
  const seeded = await seededCase(request);
  await signInAsDeliveryManager(page);
  await page.goto(`/deed-polls/${seeded.caseId}/delete`);
  await answer(page, "Created in error");
  const requestId = await statusRequestId(page);
  await moveRequest(request, { requestId, status: "NeedsAttention", failure: "CDAM_REMOVED_DOCUMENT_UNPURGED" });

  // ── persistent NeedsAttention ────────────────────────────────────────────────────────────────────────────────
  for (let visit = 0; visit < 2; visit++) {
    await page.getByRole("link", { name: "Refresh" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deletion has not completed");
    await expect(page.getByText("It is waiting for the document store team to purge documents that were removed from the application earlier.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore application" })).toHaveCount(0);
  }
  await expectNoAccessibilityViolations(page);

  // ── the status read down ─────────────────────────────────────────────────────────────────────────────────────
  await configureOutcome(request, { statusReads: "unavailable" });
  const response = await page.goto(`/deed-polls/deletions/${requestId}`);
  expect(response?.status()).toBe(503);
  await expect(
    page.getByText("The progress of this deletion request could not be checked. This does not change the request. Refresh the page to try again.")
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Refresh" })).toBeVisible();
  await expectNoAccessibilityViolations(page);

  // Back up, the request is where it was.
  await configureOutcome(request, { statusReads: "available" });
  await page.getByRole("link", { name: "Refresh" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deletion has not completed");
});

test("a Team leader has no action, and the confirmation, its POST and a status page are refused", async ({ browser, page, request }) => {
  // Arrange: a request of a Delivery Manager's for the status page, and an application to aim at.
  const target = await seededCase(request);
  const requestId = await deletedBySomeoneElse(browser, request);
  await signInAsTeamLeader(page);

  // ── no link ──────────────────────────────────────────────────────────────────────────────────────────────────
  await page.goto(`/deed-polls/${target.caseId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(target.reference);
  await expect(page.getByRole("button", { name: "Delete application" })).toHaveCount(0);

  // ── direct addresses ─────────────────────────────────────────────────────────────────────────────────────────
  for (const path of [`/deed-polls/${target.caseId}/delete`, `/deed-polls/deletions/${requestId}`, `/deed-polls/deletions/${requestId}/restore?case=x`]) {
    const refused = await page.goto(path);
    expect(refused?.status(), path).toBe(403);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  }

  // ── a forged POST, as a browser on this origin would send it ─────────────────────────────────────────────────
  const forged = await page.request.post(`/deed-polls/${target.caseId}/delete`, {
    headers: { "Sec-Fetch-Site": "same-origin" },
    form: { action: "delete", reason: "DUPLICATE", note: NOTE, journey: "forged" },
    maxRedirects: 0
  });
  expect(forged.status()).toBe(403);

  // Still on the service.
  await page.goto(`/deed-polls/${target.caseId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(target.reference);
});

/** A case of this run's own, seeded in the mock's `Received` state. */
async function seededCase(request: APIRequestContext, options: { surname?: string; retainPermanently?: boolean } = {}): Promise<SeededCase> {
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const surname = options.surname ?? `Deleteby${token}`;
  const reference = `KBDP2026-${String(Math.floor(Math.random() * 100_000)).padStart(5, "0")}`;
  const created = await request.post(`${MOCK_API_URL}/__mock/cases`, {
    data: {
      type: "Adult",
      state: "Received",
      newForename: "Nell",
      newSurname: surname,
      displayReference: reference,
      dateReceived: "2026-11-02T00:00:00.000",
      ...(options.retainPermanently ? { retainPermanently: true } : {})
    }
  });
  expect(created.status(), await created.text()).toBe(201);

  return { caseId: (await created.json()).id, reference, surname };
}

async function raiseReferral(request: APIRequestContext, caseId: string): Promise<void> {
  const raised = await request.post(`${MOCK_API_URL}/caseworker/cases/${caseId}/referrals`, {
    headers: bearer({ sub: CASEWORKER_EMAIL }),
    data: { reasons: ["DomesticAbuse"], urgency: "Normal" }
  });
  expect(raised.status(), await raised.text()).toBe(201);
}

/** A caseworker's note, which moves the case's `lastChangedOn` (api's stale check counts notes). */
async function addNote(request: APIRequestContext, caseId: string): Promise<void> {
  const added = await request.post(`${MOCK_API_URL}/caseworker/cases/${caseId}/notes`, {
    headers: bearer({ sub: CASEWORKER_EMAIL }),
    data: { note: "Applicant phoned to check progress." }
  });
  expect(added.status(), await added.text()).toBe(201);
}

/** A request admitted in a Delivery Manager's own browser context, so the page under test stays the Team leader's. */
async function deletedBySomeoneElse(browser: Browser, request: APIRequestContext): Promise<string> {
  const seeded = await seededCase(request);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signInAsDeliveryManager(page);
    await page.goto(`/deed-polls/${seeded.caseId}/delete`);
    await answer(page, "Duplicate application");
    return await statusRequestId(page);
  } finally {
    await context.close();
  }
}

async function answer(page: Page, reason: "Created in error" | "Duplicate application"): Promise<void> {
  await page.getByRole("radio", { name: reason }).check();
  await page.getByLabel("Why are you deleting this application?").fill(NOTE);
  await page.getByRole("button", { name: "Permanently delete application" }).click();
}

async function statusRequestId(page: Page): Promise<string> {
  await expect(page).toHaveURL(STATUS_PATH);
  const [, requestId] = new URL(page.url()).pathname.match(STATUS_PATH) ?? [];
  return requestId;
}

/** `/__mock/application-deletions`: what the cleanup worker and Retain and Dispose would do, done by hand. */
async function moveRequest(request: APIRequestContext, control: Record<string, string>): Promise<void> {
  const moved = await request.post(`${MOCK_API_URL}/__mock/application-deletions`, { data: control });
  expect(moved.status(), await moved.text()).toBe(200);
}

/** `/__mock/application-deletion-outcome`: the next admission's lost answer or refusal, and status reads up or down. */
async function configureOutcome(request: APIRequestContext, outcome: Record<string, string | boolean>): Promise<void> {
  const configured = await request.post(`${MOCK_API_URL}/__mock/application-deletion-outcome`, { data: outcome });
  expect(configured.status(), await configured.text()).toBe(200);
}

/** The WCAG scope every other journey checks, reported as `id: selector` so a failure names the element. */
async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

  expect(results.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target}`))).toEqual([]);
}

interface SeededCase {
  caseId: string;
  reference: string;
  surname: string;
}
