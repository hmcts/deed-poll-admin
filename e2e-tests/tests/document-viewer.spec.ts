/**
 * The full-page document viewer, end to end in a browser — `docs/plans/completed/20261023-full-page-document-viewer.md`.
 *
 * **Two tests, one per scope.** A caseworker reads every one of a case's five documents, one per allowed upload type,
 * and a judge reads a referral's. The keyboard, axe, Welsh, session-warning and narrow-viewport checks are made at
 * points the journeys already pass through, per `.claude/rules/e2e-testing.md`. The permission, error and race
 * matrices are the route and renderer tests' subject (`src/document-viewer/routes.test.ts`,
 * `src/assets/js/document-viewer/*.test.ts`), not this file's.
 *
 * **What only a browser can show here:** that real PDF.js and its real worker draw the preview api sends, with page
 * counts and thumbnails taken from the preview's bytes; that documents switch in place with each one's page, zoom
 * and rotation kept and no history entry added; and that **Download original** saves the original's bytes and
 * name, not the preview's PDF, for the two formats whose preview is a conversion (DOCX and TIFF). And that a page
 * PDF.js cannot draw in full, an embedded image over `maxImageSize`, says so beside **Download original** while the
 * document's other pages still draw (`docs/plans/completed/20261025-document-viewer-incomplete-pages.md`), which needs
 * the patched `pdfjs-dist` running in a real browser and its worker.
 *
 * Every file is synthetic (`libs/deed-poll-api-client/src/mock/preview-sources.ts` and `syntheticPdf`), uploaded
 * through the mock's caseworker contract route as an office would attach it. Run with `yarn test:document-viewer`.
 */
import { readFile } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";
import { syntheticPdf } from "../../libs/deed-poll-api-client/src/mock/document-preview.js";
import { DOCX_BYTES, JPEG_BYTES, PNG_BYTES, tiff } from "../../libs/deed-poll-api-client/src/mock/preview-sources.js";
import { testPdf } from "../../src/assets/js/document-viewer/test-pdfs.js";
import { CASEWORKER_EMAIL, signInAsCaseworker, signInAsJudge } from "./idam-session.js";

const MOCK = "http://localhost:3219";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DOCUMENT_TYPE_ID = "11111111-1111-4111-8111-111111111111";
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const STATEMENT = { name: "Statutory declaration", file: "statement.pdf", mimeType: "application/pdf", bytes: syntheticPdf(3, "Statement page") };
const PHOTO = { name: "Passport photograph", file: "photo.jpg", mimeType: "image/jpeg", bytes: JPEG_BYTES };
const BILL = { name: "Utility bill", file: "bill.png", mimeType: "image/png", bytes: PNG_BYTES };
const SCAN = { name: "Four page scan", file: "scan-pages.tif", mimeType: "image/tiff", bytes: tiff(4) };
const LETTER = { name: "Supporting letter", file: "letter.docx", mimeType: DOCX_MIME_TYPE, bytes: DOCX_BYTES };
const BUNDLE = { name: "Oversized bundle", file: "bundle.pdf", mimeType: "application/pdf", bytes: syntheticPdf(101, "Bundle page") };
// Page 1 paints an 81-megapixel image, over the viewer's 64-megapixel `maxImageSize`; page 2 is text only. The mock
// previews a PDF as its stored bytes, so this is exactly what PDF.js is given.
const LARGE_SCAN = {
  name: "High resolution scan",
  file: "large-scan.pdf",
  mimeType: "application/pdf",
  bytes: Buffer.from(testPdf([{ text: "Large scan page 1", image: [9000, 9000] }, { text: "Large scan page 2" }]))
};
const PAGE_INCOMPLETE = "This page could not be shown in full. Download the original to see it.";
// What each journey's page logged and which workers it started, checked once the journey ends.
const pageHealth = new WeakMap<Page, { errors: string[]; workers: string[] }>();

test.beforeEach(async ({ page, request }) => {
  await scenario(request, "happy-path");
  // A CSP refusal of the worker, a font or a decoder reaches the console as an error, as does any renderer fault.
  const errors: string[] = [];
  const workers: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("worker", (worker) => workers.push(worker.url()));
  pageHealth.set(page, { errors, workers });
});

test.afterEach(async ({ page }) => {
  const health = pageHealth.get(page);
  // PDF.js's own worker, from this app's origin, and not the fallback "fake worker" on the main thread.
  expect(health?.workers.some((url) => /^http:\/\/localhost:3319\/.*pdf\.worker[^/]*\.mjs/.test(url))).toBe(true);
  // The unavailable and over-limit previews are answered statuses, which Chromium logs as failed resources.
  expect(health?.errors.filter((text) => !/Failed to load resource: the server responded with a status of (422|503)/.test(text))).toEqual([]);
});

test("caseworker reads every format of a case's documents, keeping each one's place, and downloads the originals", async ({ page, request }) => {
  test.slow();
  const reference = `KBDP2026-V${String(Date.now()).slice(-5)}`;
  const caseId = await seedCase(request, reference);
  for (const document of [STATEMENT, PHOTO, BILL, SCAN, LETTER]) await upload(request, caseId, document);
  await signInAsCaseworker(page);
  // Time the page's own timers only, so the session warning can be reached without waiting 28 minutes for it.
  await page.clock.install();

  // ── from the case's documents tab into the viewer, in this tab ─────────────────────────────────────────────
  await page.goto(`/deed-polls/${caseId}`);
  await page.getByRole("tab", { name: "Supporting documents" }).click();
  await page.getByRole("link", { name: STATEMENT.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/deed-polls/${caseId}/documents/[^/]+/view`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STATEMENT.name);
  await expect(fact(page, "File type")).toHaveText("PDF document");
  await expect(fact(page, "Case reference")).toHaveText(reference);
  await expect(page.getByText("Document 1 of 5", { exact: true })).toBeVisible();
  await expectPages(page, 3);
  await expect(page.locator(".textLayer")).toContainText("Mock preview: Statement page 1 of 3");
  await expect(thumbnails(page)).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await accessible(page);

  // ── pages: a button from the keyboard, a typed jump, a refused jump and a thumbnail ────────────────────────
  await page.getByRole("button", { name: "Next page" }).focus();
  await page.keyboard.press("Enter");
  await expect(pageNumber(page)).toHaveValue("2");
  await expect(page.locator(".textLayer")).toContainText("Mock preview: Statement page 2 of 3");
  await expect(page.locator("[data-viewer-announcement]")).toHaveText("Page 2 of 3");
  await pageNumber(page).fill("3");
  await pageNumber(page).press("Enter");
  await expect(pageNumber(page)).toHaveValue("3");
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await pageNumber(page).fill("7");
  await pageNumber(page).press("Enter");
  await expect(pageNumber(page)).toHaveValue("3");
  await thumbnails(page).nth(1).click();
  await expect(pageNumber(page)).toHaveValue("2");
  await expect(thumbnails(page).nth(1)).toHaveAttribute("aria-current", "page");

  // ── presentation: zoom, fit and a quarter turn, all recorded in the fragment ──────────────────────────────
  const fitWidth = page.getByRole("button", { name: "Fit to width" });
  await expect(fitWidth).toHaveAttribute("aria-pressed", "true");
  const fitted = await zoomLevel(page).textContent();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoomLevel(page)).not.toHaveText(fitted ?? "");
  await expect(fitWidth).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Fit whole page" }).click();
  await expect(page.getByRole("button", { name: "Fit whole page" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Rotate 90°" }).click();
  await expect(page).toHaveURL(/#page=2&zoom=page&rotate=90$/);

  // ── documents switch in place, with no history entry, each with its own page count ────────────────────────
  const entries = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: "Next document" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(PHOTO.name);
  await expect(fact(page, "File type")).toHaveText("JPEG image");
  await expect(page.getByText("Document 2 of 5", { exact: true })).toBeVisible();
  await expectPages(page, 1);
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await expect(pageNumber(page)).toBeDisabled();
  await page.getByRole("button", { name: "Next document" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(BILL.name);
  await expectPages(page, 1);

  await page.getByLabel("Document", { exact: true }).selectOption({ label: SCAN.name });
  await page.getByRole("button", { name: "Open document" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCAN.name);
  await expect(fact(page, "File type")).toHaveText("TIFF image");
  await expectPages(page, 4);
  await expect(thumbnails(page)).toHaveCount(4);
  await thumbnails(page).nth(3).click();
  await expect(pageNumber(page)).toHaveValue("4");
  await expect(page.locator(".textLayer")).toContainText("Mock preview: TIFF frame 4 of 4");
  await expectOriginal(page, SCAN);

  await page.getByRole("button", { name: "Next document" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LETTER.name);
  await expect(fact(page, "File type")).toHaveText("Word document");
  await expect(page.getByText("Document 5 of 5", { exact: true })).toBeVisible();
  await expectPages(page, 3);
  await expect(page.getByRole("button", { name: "Next document" })).toBeDisabled();
  await expectOriginal(page, LETTER);
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await accessible(page);

  // ── back to earlier documents: each is where it was left ──────────────────────────────────────────────────
  await page.getByRole("button", { name: "Previous document" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCAN.name);
  await expectPages(page, 4);
  await expect(pageNumber(page)).toHaveValue("4");
  await page.getByLabel("Document", { exact: true }).selectOption({ label: STATEMENT.name });
  await page.getByRole("button", { name: "Open document" }).click();
  await expectPages(page, 3);
  await expect(pageNumber(page)).toHaveValue("2");
  await expect(page.getByRole("button", { name: "Fit whole page" })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/#page=2&zoom=page&rotate=90$/);
  await expectOriginal(page, STATEMENT);

  // ── the existing session warning still opens over the viewer, and staying signed in keeps the document ──────
  // The status answer is the one thing faked: the server's clock is real, so it would otherwise say 28 minutes remain.
  await page.route("**/session/status", (route) => route.fulfill({ json: { idleSeconds: 1800, idleRemaining: 100, absoluteRemaining: 20_000 } }));
  await page.clock.fastForward("29:00");
  const warning = page.locator("#session-timeout-idle");
  await expect(warning).toBeVisible();
  await expect(page.getByRole("button", { name: "Stay signed in" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(warning).toBeHidden();
  await page.unroute("**/session/status");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STATEMENT.name);
  await expect(pageNumber(page)).toHaveValue("2");

  // ── back to the case, and browser Back returns to the same place in the document ─────────────────────────
  await page.getByRole("link", { name: "Back to case" }).click();
  await expect(page).toHaveURL(`/deed-polls/${caseId}#documents`);
  await expect(page.getByRole("link", { name: STATEMENT.name, exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STATEMENT.name);
  await expectPages(page, 3);
  await expect(pageNumber(page)).toHaveValue("2");

  // ── Welsh: the shared chrome is Welsh and the viewer's counts still come from the preview ───────────────────
  await page.locator(".language").click();
  await expect(page).toHaveURL(/\?lng=cy/);
  await expect(page.getByRole("navigation", { name: "Cyfrif" })).toBeVisible();
  await expect(page.locator(".language")).toContainText("English");
  await expect(page.getByText("Document 1 of 5", { exact: true })).toBeVisible();
  await expectPages(page, 3);
  await accessible(page);
  await page.locator(".language").click();
  await expect(page.getByRole("navigation", { name: "Account" })).toBeVisible();

  // ── a narrow screen: every control reachable, no sideways scroll, thumbnails out of the way ───────────────
  await page.setViewportSize({ width: 320, height: 640 });
  await page.reload();
  await expectPages(page, 3);
  await expect(page.getByRole("button", { name: "Show thumbnails" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(pageNumber(page)).toHaveValue("2");
  await page.getByRole("button", { name: "Show thumbnails" }).click();
  await expect(thumbnails(page)).toHaveCount(3);
  await accessible(page);
});

test("judge reads a referral's documents, sees unavailable, oversized and partly drawable previews, and returns to the referral", async ({ page, request }) => {
  test.slow();
  const { caseId, referralId } = await seedReferral(request);
  for (const document of [STATEMENT, SCAN, LETTER, BUNDLE, LARGE_SCAN]) await upload(request, caseId, document);
  // Decision 3's phased release: before the DOCX converter is provisioned api answers a DOCX preview 503.
  await scenario(request, "preview-converter-unavailable");
  await signInAsJudge(page);

  await page.goto(`/judicial/referrals/${referralId}`);
  await page.getByRole("link", { name: SCAN.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/judicial/referrals/${referralId}/documents/[^/]+/view`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCAN.name);
  await expect(page.getByText("Document 2 of 5", { exact: true })).toBeVisible();
  // Decision 4: the judicial view carries no case reference.
  await expect(page.getByText("Case reference", { exact: true })).toHaveCount(0);
  await expectPages(page, 4);
  await expect(thumbnails(page)).toHaveCount(4);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(pageNumber(page)).toHaveValue("2");
  await page.getByRole("button", { name: "Zoom out" }).click();
  await accessible(page);

  // The keyboard alone moves to the previous document: focus the button and press it.
  await page.getByRole("button", { name: "Previous document" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STATEMENT.name);
  await expectPages(page, 3);
  await expect(page.getByRole("button", { name: "Previous document" })).toBeDisabled();
  // A control disabled by its own press hands focus on rather than dropping it to the page.
  await expect(page.locator("body")).not.toBeFocused();

  // ── a DOCX with no converter: a fixed sentence, no invented count, and the original still downloads ────────
  await page.getByLabel("Document", { exact: true }).selectOption({ label: LETTER.name });
  await page.getByRole("button", { name: "Open document" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LETTER.name);
  await expect(page.getByText("A preview of this document is not available. You can still download the original.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeHidden();
  await expect(page.locator("#viewer-page-total")).toHaveText("");
  await expect(page.locator("canvas")).toHaveCount(0);
  await expectOriginal(page, LETTER);
  await accessible(page);

  // ── over the 100-page limit: refused before any page draws ────────────────────────────────────────────────
  await page.getByRole("button", { name: "Next document" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(BUNDLE.name);
  await expect(page.getByText("This document is too large to preview. You can still download the original.", { exact: true })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator("#viewer-page-total")).toHaveText("");

  // ── a page PDF.js cannot draw in full says so, offers the original, and the next page still draws ──────────
  await page.getByRole("button", { name: "Next document" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LARGE_SCAN.name);
  await expect(page.locator("#viewer-page-total")).toHaveText("of 2");
  const documentPage = page.getByRole("region", { name: "Document page" });
  await expect(documentPage.getByText(PAGE_INCOMPLETE, { exact: true })).toBeVisible();
  // Nothing of the page is left drawn: not its text, not a partial canvas.
  await expect(documentPage.locator("canvas")).toHaveCount(0);
  await expect(page.locator(".textLayer")).toHaveCount(0);
  await expect(thumbnails(page)).toHaveCount(2);
  await expect(thumbnails(page).nth(0).locator(".app-document-viewer__thumbnail-placeholder")).toHaveCount(1);
  await expect(thumbnails(page).nth(1).locator("canvas")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Next page" })).toBeEnabled();
  await accessible(page);
  await expectOriginal(page, LARGE_SCAN, documentPage);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(pageNumber(page)).toHaveValue("2");
  await expectPages(page, 2);
  await expect(page.locator(".textLayer")).toContainText("Large scan page 2");
  await expect(documentPage.getByText(PAGE_INCOMPLETE, { exact: true })).toBeHidden();
  await expect(documentPage.getByRole("link", { name: "Download original" })).toBeHidden();
  // Back to page 1 asks PDF.js again, and it fails again rather than drawing a cached, truncated page.
  await thumbnails(page).nth(0).click();
  await expect(pageNumber(page)).toHaveValue("1");
  await expect(documentPage.getByText(PAGE_INCOMPLETE, { exact: true })).toBeVisible();
  await expect(documentPage.locator("canvas")).toHaveCount(0);
  // Zoom still works on that page, and the page still says so.
  const incompleteZoom = await zoomLevel(page).textContent();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoomLevel(page)).not.toHaveText(incompleteZoom ?? "");
  await expect(documentPage.getByText(PAGE_INCOMPLETE, { exact: true })).toBeVisible();

  // ── the TIFF kept its place, and its original is the TIFF, not the preview ─────────────────────────────────
  await page.getByLabel("Document", { exact: true }).selectOption({ label: SCAN.name });
  await page.getByRole("button", { name: "Open document" }).click();
  await expectPages(page, 4);
  await expect(pageNumber(page)).toHaveValue("2");
  await expect(documentPage.getByText(PAGE_INCOMPLETE, { exact: true })).toBeHidden();
  await expect(documentPage.getByRole("link", { name: "Download original" })).toBeHidden();
  await expectOriginal(page, SCAN);

  // ── Welsh, then back to the referral's documents ─────────────────────────────────────────────────────────
  await page.locator(".language").click();
  await expect(page.getByRole("navigation", { name: "Cyfrif" })).toBeVisible();
  await expect(page.getByText("Document 2 of 5", { exact: true })).toBeVisible();
  await expectPages(page, 4);
  await accessible(page);
  await page.locator(".language").click();

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.getByRole("link", { name: "Back to referral" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Back to referral" }).click();
  await expect(page).toHaveURL(`/judicial/referrals/${referralId}#documents`);
  await expect(page.getByRole("link", { name: SCAN.name, exact: true })).toBeVisible();
});

/** The preview has loaded once the page total names its count, which only the opened PDF knows. */
async function expectPages(page: Page, total: number): Promise<void> {
  await expect(page.locator("#viewer-page-total")).toHaveText(`of ${total}`);
  await expect(page.locator(".app-document-viewer__page canvas").first()).toBeVisible();
}

/** **Download original** saves the stored bytes under the uploaded name, whatever the preview was. */
async function expectOriginal(page: Page, document: { file: string; bytes: Buffer }, within: Page | Locator = page): Promise<void> {
  const [download] = await Promise.all([page.waitForEvent("download"), within.getByRole("link", { name: "Download original" }).click()]);
  expect(download.suggestedFilename()).toBe(document.file);
  expect(Buffer.compare(await readFile((await download.path()) ?? ""), document.bytes)).toBe(0);
}

function fact(page: Page, key: string): Locator {
  return page.locator(".govuk-summary-list__row", { has: page.getByText(key, { exact: true }) }).locator(".govuk-summary-list__value");
}

function pageNumber(page: Page): Locator {
  return page.getByLabel("Page", { exact: true });
}

function zoomLevel(page: Page): Locator {
  return page.getByLabel("Zoom level", { exact: true });
}

function thumbnails(page: Page): Locator {
  return page.getByRole("navigation", { name: "Page thumbnails" }).getByRole("button");
}

async function accessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

async function scenario(request: APIRequestContext, name: string): Promise<void> {
  const response = await request.post(`${MOCK}/__mock/scenario`, { data: { scenario: name } });
  expect(response.status(), await response.text()).toBe(200);
}

async function seedCase(request: APIRequestContext, displayReference: string): Promise<string> {
  const created = await request.post(`${MOCK}/__mock/cases`, {
    data: {
      type: "Adult",
      state: "Received",
      displayReference,
      dateReceived: "2026-07-01T00:00:00.000",
      oldForename: "Ines",
      oldSurname: "Kowalski",
      newForename: "Ines",
      newSurname: "Nakamura"
    }
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id;
}

async function seedReferral(request: APIRequestContext): Promise<{ caseId: string; referralId: string }> {
  const caseId = await seedCase(request, `KBDP2026-J${String(Date.now()).slice(-5)}`);
  const raised = await request.post(`${MOCK}/caseworker/cases/${caseId}/referrals`, {
    headers: bearer(CASEWORKER_EMAIL),
    data: { reasons: ["Minor"], notes: "Please consider the supporting documents.", urgency: "Urgent", urgencyReason: "Hearing listed on Friday." }
  });
  expect(raised.status(), await raised.text()).toBe(201);
  return { caseId, referralId: (await raised.json()).id };
}

async function upload(request: APIRequestContext, caseId: string, document: { name: string; file: string; mimeType: string; bytes: Buffer }): Promise<void> {
  const uploaded = await request.post(`${MOCK}/caseworker/cases/${caseId}/documents`, {
    headers: bearer(CASEWORKER_EMAIL),
    multipart: {
      file: { name: document.file, mimeType: document.mimeType, buffer: document.bytes },
      documentTypeId: DOCUMENT_TYPE_ID,
      name: document.name
    }
  });
  expect(uploaded.status(), await uploaded.text()).toBe(201);
}

/** The mock reads the subject out of the bearer token, so a hand-built token is all a seed needs (`judicial.spec.ts`). */
function bearer(subject: string): Record<string, string> {
  const claims = Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url");
  return { authorization: `Bearer x.${claims}.signature` };
}
