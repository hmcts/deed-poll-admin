/**
 * Permanent document deletion, end to end in a browser (plan `docs/plans/20261125-permanent-document-deletion.md`,
 * Task 4).
 *
 * Two journeys, deliberately few: an ordinary caseworker deletes one of a case's two documents (Cancel, validation,
 * Welsh, keyboard and axe inline, then the case note api wrote), and a judge, who sees no Delete control on a
 * referral's documents and is refused the staff page and a forged POST. The in-use refusal, a 202 and an unknown
 * outcome are pinned at handler level (`documents/[documentId]/delete.test.ts`), where each refusal is one fixture.
 *
 * **On a mock of its own (`yarn test:document-deletion`), never the shared developer mock**, because it deletes
 * documents from the mock it runs on, and the mock's document deletion outcome controls, which these journeys leave
 * alone, are the whole mock's.
 *
 * **What this proves is the browser journey against the mock, not permanent removal.** The mock only drops the
 * document from memory and writes api's note; that CDAM and the filesystem lose the file is api's proof.
 *
 * **It signs itself in**, as `application-deletion.spec.ts` does, because its config has no setup project.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { syntheticPdf } from "../../libs/deed-poll-api-client/src/mock/document-preview.js";
import { CASEWORKER_EMAIL, DEPLOYED_STACK_SKIP_REASON, RUNS_AGAINST_DEPLOYED_STACK, signInAsCaseworker, signInAsJudge } from "./idam-session.js";
import { bearer, judgePersonaMaster, sendToMaster } from "./masters.js";

// The config hands DEED_POLL_API_URL to the app it starts, not to this process, so the default is its mock's port.
const MOCK_API_URL = process.env.DEED_POLL_API_URL ?? "http://localhost:3222";
const DOCUMENT_TYPE_ID = "11111111-1111-4111-8111-111111111111";
const REASON = "Uploaded in error to the wrong application";
const IN_ERROR = "Wrong applicant's statement";
const KEPT = "Statutory declaration";

test.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);

test("a caseworker permanently deletes one document with a reason, and the other document and the case note remain", async ({ page, request }) => {
  test.slow();

  // Arrange: one case, two documents.
  const seeded = await seededCase(request);
  await upload(request, seeded.caseId, IN_ERROR);
  await upload(request, seeded.caseId, KEPT);
  await signInAsCaseworker(page);

  // ── the Delete link on the Documents tab, named for a screen reader ───────────────────────────────────────────
  await page.goto(`/deed-polls/${seeded.caseId}`);
  await page.getByRole("tab", { name: "Supporting documents" }).click();
  const documents = page.locator("#documents");
  await expect(documents.getByRole("link", { name: `Delete ${KEPT}` })).toBeVisible();
  await documents.getByRole("link", { name: `Delete ${IN_ERROR}` }).click();

  // ── the confirmation identifies the document and warns; Cancel writes nothing ─────────────────────────────────
  await expect(page).toHaveURL(new RegExp(`/deed-polls/${seeded.caseId}/documents/[^/]+/delete$`));
  const confirmation = page.url();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Are you sure you want to permanently delete this document?");
  await expect(page.locator(".govuk-summary-list")).toContainText(seeded.reference);
  await expect(page.locator(".govuk-summary-list")).toContainText(IN_ERROR);
  await expect(page.getByText("This will permanently delete the document. You cannot undo this.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Why are you deleting this document?")).toHaveValue("");
  await expectNoAccessibilityViolations(page);
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(`/deed-polls/${seeded.caseId}#documents`);
  await expect(page.locator("#documents")).toContainText(IN_ERROR);

  // ── Welsh: the page renders in the cy locale (its own copy mirrors English until translated) ──────────────────
  await page.goto(confirmation);
  const languageToggle = page.locator(".language");
  await languageToggle.click();
  await expect(page).toHaveURL(/\?lng=cy/);
  await expect(languageToggle).toContainText("English");
  await expect(page.locator('.govuk-footer a[href="/cookies"]')).toContainText("Cwcis");
  await expect(page.getByLabel("Why are you deleting this document?")).toBeVisible();
  await languageToggle.click();
  await expect(page).toHaveURL(/\?lng=en/);

  // ── no reason: the error summary links to the textarea ────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Permanently delete document" }).click();
  const summary = page.locator(".govuk-error-summary");
  await expect(summary).toContainText("Enter why you are deleting this document");
  await summary.getByRole("link", { name: "Enter why you are deleting this document" }).click();
  await expect(page.locator("#reason")).toBeFocused();
  await expectNoAccessibilityViolations(page);

  // ── answered by keyboard alone ────────────────────────────────────────────────────────────────────────────────
  await page.keyboard.type(REASON);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Permanently delete document" })).toBeFocused();
  await page.keyboard.press("Enter");

  // ── api answered Completed while the caseworker waited ────────────────────────────────────────────────────────
  await expect(page).toHaveURL(`/deed-polls/${seeded.caseId}?document=deleted#documents`);
  await expect(page.locator(".govuk-notification-banner--success")).toContainText("Document deleted.");
  await expect(page.locator("#documents")).not.toContainText(IN_ERROR);
  await expect(page.locator("#documents")).toContainText(KEPT);
  await expectNoAccessibilityViolations(page);

  // ── api's case note names the document and gives the reason ───────────────────────────────────────────────────
  await page.getByRole("tab", { name: "Notes" }).click();
  await expect(page.locator("#notes")).toContainText(`Document ${IN_ERROR}`);
  await expect(page.locator("#notes")).toContainText(`Reason: ${REASON}`);

  // ── the old confirmation is a missing document now, not a second deletion ────────────────────────────────────
  await page.goto(confirmation);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
});

test("a judge sees no Delete control on a referral's documents and is refused the staff delete page and POST", async ({ page, request }) => {
  test.slow();

  // Arrange: a document on a case whose referral is with the judge persona's Master.
  const seeded = await seededCase(request);
  const documentId = await upload(request, seeded.caseId, KEPT);
  const referralId = await referralWithJudge(request, seeded.caseId);
  await signInAsJudge(page);

  // ── the Master's read-only view lists the document with no Delete ─────────────────────────────────────────────
  await page.goto(`/judicial/referrals/${referralId}`);
  await expect(page.locator("main")).toContainText(KEPT);
  await expect(page.locator("main").getByRole("link", { name: /Delete/ })).toHaveCount(0);
  await expect(page.locator("main").getByRole("button", { name: /Delete/ })).toHaveCount(0);

  // ── the staff page, typed in ──────────────────────────────────────────────────────────────────────────────────
  const path = `/deed-polls/${seeded.caseId}/documents/${documentId}/delete`;
  const refused = await page.goto(path);
  expect(refused?.status()).toBe(403);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");

  // ── a forged POST, as a browser on this origin would send it ─────────────────────────────────────────────────
  const forged = await page.request.post(path, {
    headers: { "Sec-Fetch-Site": "same-origin" },
    form: { action: "delete", reason: REASON, journey: "forged" },
    maxRedirects: 0
  });
  expect(forged.status()).toBe(403);

  // The document is still there.
  const read = await request.get(`${MOCK_API_URL}/caseworker/cases/${seeded.caseId}`, { headers: bearer({ sub: CASEWORKER_EMAIL }) });
  expect((await read.json()).documents.map((document: { id: string }) => document.id)).toContain(documentId);
});

/** A case of this run's own, seeded in the mock's `Received` state. */
async function seededCase(request: APIRequestContext): Promise<SeededCase> {
  const reference = `KBDP2026-${String(Math.floor(Math.random() * 100_000)).padStart(5, "0")}`;
  const created = await request.post(`${MOCK_API_URL}/__mock/cases`, {
    data: {
      type: "Adult",
      state: "Received",
      newForename: "Nell",
      newSurname: "Docdelete",
      displayReference: reference,
      dateReceived: "2026-11-02T00:00:00.000"
    }
  });
  expect(created.status(), await created.text()).toBe(201);

  return { caseId: (await created.json()).id, reference };
}

/** Uploaded through the contract route, as the upload page does, so the document carries api's `documentVersion`. */
async function upload(request: APIRequestContext, caseId: string, name: string): Promise<string> {
  const uploaded = await request.post(`${MOCK_API_URL}/caseworker/cases/${caseId}/documents`, {
    headers: bearer({ sub: CASEWORKER_EMAIL }),
    multipart: {
      file: { name: "document.pdf", mimeType: "application/pdf", buffer: syntheticPdf(1, name) },
      documentTypeId: DOCUMENT_TYPE_ID,
      name
    }
  });
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  return (await uploaded.json()).id;
}

/** Raised and sent to the judge persona's Master, because a referral still in the queue is visible to no judge. */
async function referralWithJudge(request: APIRequestContext, caseId: string): Promise<string> {
  const master = await judgePersonaMaster(request, MOCK_API_URL);
  const raised = await request.post(`${MOCK_API_URL}/caseworker/cases/${caseId}/referrals`, {
    headers: bearer({ sub: CASEWORKER_EMAIL }),
    data: { reasons: ["DomesticAbuse"], urgency: "Normal" }
  });
  expect(raised.status(), await raised.text()).toBe(201);
  const referralId: string = (await raised.json()).id;
  await sendToMaster(request, referralId, master.id, MOCK_API_URL);
  return referralId;
}

/** The WCAG scope every other journey checks, reported as `id: selector` so a failure names the element. */
async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

  expect(results.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target}`))).toEqual([]);
}

interface SeededCase {
  caseId: string;
  reference: string;
}
