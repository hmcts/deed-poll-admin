/**
 * The document deletion confirmation and progress pages' markup, from the real handlers' models. The wording and the
 * journey are pinned in each handler's own test; this pins what is drawn: one submit for the literal `delete` action
 * and Cancel as a link, the error summary's targets, escaping of the document's name and the typed reason, the
 * recovery's one `check` control, links only once stopped, and a progress page with no control to delete again.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConflictError, DocumentDeletionOutcomeUnknownError, findDeedPoll, findDocumentDeletion, requestDocumentDeletion } from "@hmcts/deed-poll";
import axe from "axe-core";
import { JSDOM } from "jsdom";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newDocumentDeletionJourney, sealDocumentDeletionJourney } from "../../document-deletion/journey.js";
import { pageRequest, pageResponse, withoutSignOutForm } from "../../express-doubles.js";
import { addPathFilters } from "../../path-filters.js";
import { GET as statusGet } from "./[id]/document-deletions/[requestId].js";
import { GET, POST } from "./[id]/documents/[documentId]/delete.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findDocumentDeletion: vi.fn(),
  requestDocumentDeletion: vi.fn()
}));

const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "../..")
  ],
  { autoescape: true }
);
addPathFilters(environment);

const REQUEST_ID = "6f1c1f4e-2b1a-4d8e-9f3a-1c2b3d4e5f60";
const DOCUMENT = {
  id: "doc-1",
  name: "<script>alert(1)</script>.pdf",
  documentType: { id: "t-1", name: "Statutory declaration", applicableMaritalStatuses: [], applicableTypes: [] },
  hasFile: true,
  createdOn: new Date("2026-11-20T10:00:00Z"),
  documentVersion: 3
};
const PARAMS = { id: "case-1", documentId: "doc-1" };

function request(body?: Record<string, unknown>) {
  return Object.assign(pageRequest({ params: PARAMS, body, accessToken: "t" }), { sessionID: "session-a" });
}

async function posted(fields: Record<string, unknown>) {
  return request({ journey: await sealDocumentDeletionJourney(request(), newDocumentDeletionJourney("case-1", "doc-1", 3)), ...fields });
}

function rendered(res: ReturnType<typeof pageResponse>, locale: "en" | "cy" = "en"): string {
  const [view, model] = res.render.mock.calls[0];
  return withoutSignOutForm(environment.render(`${view}.njk`, { ...model[locale], ...model }));
}

describe("deed-polls/document-delete.njk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue({ id: "case-1", displayReference: "KBDP2026-00001", documents: [DOCUMENT] } as never);
  });

  it("should offer one submit for the literal delete action, Cancel as a link back to the Documents tab, and escape the name", async () => {
    // Arrange
    const res = pageResponse();

    // Act
    await GET(request(), res);
    const page = rendered(res);

    // Assert
    expect(page.match(/<button/g)).toHaveLength(1);
    expect(page).toContain(`value="delete" name="action"`);
    expect(page).toContain('action="/deed-polls/case-1/documents/doc-1/delete"');
    expect(page).toMatch(/<a class="govuk-link" href="\/deed-polls\/case-1#documents">\s*Cancel/);
    expect(page).toContain('href="/deed-polls/case-1/documents/doc-1/view"');
    expect(page).toContain("Why are you deleting this document?");
    expect(page).toContain("You cannot undo this.");
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;.pdf");
    expect(page).not.toContain("application has been deleted");
    expect(await axeViolations(page)).toEqual([]);
  }, 30_000);

  it("should link a reason error from the summary to the textarea and redraw the reason escaped", async () => {
    const res = pageResponse();

    await POST(await posted({ action: "delete", reason: `<b>${"x".repeat(500)}</b>` }), res);
    const page = rendered(res);

    expect(page).toContain("govuk-error-summary");
    expect(page).toContain('href="#reason"');
    expect(page).toContain('id="reason"');
    expect(page).toContain("&lt;b&gt;");
    expect(page).not.toContain("<b>x");
    expect(await axeViolations(page)).toEqual([]);
  }, 30_000);

  it("should show the in-use refusal in the error summary, keeping the reason and the submit", async () => {
    vi.mocked(requestDocumentDeletion).mockRejectedValue(new ConflictError("in use", [], "DOCUMENT_IN_USE"));
    const res = pageResponse();

    await POST(await posted({ action: "delete", reason: "Uploaded in error" }), res);
    const page = rendered(res);

    expect(page).toContain("This document is currently being used and cannot be deleted. Try again once the operation has finished.");
    expect(page).toContain("Uploaded in error</textarea>");
    expect(page).toContain('value="delete"');
  });

  it("should offer only the check control when the outcome is unknown", async () => {
    vi.mocked(requestDocumentDeletion).mockRejectedValue(new DocumentDeletionOutcomeUnknownError());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = pageResponse();

    await POST(await posted({ action: "delete", reason: "Uploaded in error" }), res);
    const page = rendered(res);

    expect(page.match(/<button/g)).toHaveLength(1);
    expect(page).toContain('value="check"');
    expect(page).toContain("Check deletion request");
    expect(page).not.toContain("<textarea");
    expect(page).not.toContain("Uploaded in error");
  });

  it("should draw links only once stopped", async () => {
    vi.mocked(requestDocumentDeletion).mockRejectedValue(new ConflictError("changed", [], "DOCUMENT_CHANGED"));
    const res = pageResponse();

    await POST(await posted({ action: "delete", reason: "Uploaded in error" }), res);
    const page = rendered(res);

    expect(page).toContain("The document has changed</h1>");
    expect(page).not.toMatch(/<button|<form/);
    expect(page).toContain('href="/deed-polls/case-1#documents"');
  });

  it("should render the Welsh content when the locale is cy", async () => {
    const res = pageResponse();
    res.locals.locale = "cy";

    await GET(request(), res);

    expect(rendered(res, "cy")).toContain("Permanently delete document");
  });
});

describe("deed-polls/document-deletion-status.njk", () => {
  const statusRequest = () => pageRequest({ params: { id: "case-1", requestId: REQUEST_ID }, accessToken: "t" });

  async function statusPage(overrides: Record<string, unknown> = {}) {
    vi.mocked(findDocumentDeletion).mockResolvedValue({
      requestId: REQUEST_ID,
      documentId: "doc-1",
      status: "InProgress",
      requestedAt: new Date("2026-11-26T10:00:00Z"),
      completedAt: null,
      failure: null,
      ...overrides
    } as never);
    const res = pageResponse();
    await statusGet(statusRequest(), res);
    return rendered(res);
  }

  it.each(["InProgress", "NeedsAttention"])("should offer Refresh and the way back but no delete, resend or restore for %s", async (status) => {
    const page = await statusPage({ status, failure: status === "NeedsAttention" ? "CDAM_DELETE_FAILED" : null });

    expect(page).not.toMatch(/<button|<form/);
    expect(page).not.toContain("Document deleted</h1>");
    expect(page).toContain(`href="/deed-polls/case-1/document-deletions/${REQUEST_ID}"`);
    expect(page).toContain('href="/deed-polls/case-1#documents"');
    expect(page).not.toMatch(/Restore|Undo/);
  });

  it("should head only Completed as deleted, with no Refresh", async () => {
    const page = await statusPage({ status: "Completed", completedAt: new Date("2026-11-26T10:00:05Z") });

    expect(page).toContain("Document deleted</h1>");
    expect(page).not.toContain("Refresh");
  });

  it("should draw a failed read as its own heading with Refresh, never as success", async () => {
    vi.mocked(findDocumentDeletion).mockRejectedValue(new Error("unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = pageResponse();

    await statusGet(statusRequest(), res);
    const page = rendered(res);

    expect(page).toContain("We could not check this document deletion</h1>");
    expect(page).toContain("Refresh");
    expect(page).not.toContain("Document deleted");
  });

  it("should have no axe violations", { timeout: 30_000 }, async () => {
    expect(await axeViolations(await statusPage())).toEqual([]);
  });
});

async function axeViolations(markup: string): Promise<{ id: string; nodes: string[] }[]> {
  const dom = new JSDOM(markup, { runScripts: "outside-only" });
  dom.window.eval(axe.source);
  const main = dom.window.document.getElementById("main-content");
  if (!main) throw new Error("no main-content");
  const results = await (dom.window as unknown as { axe: typeof axe }).axe.run(main, { rules: { "color-contrast": { enabled: false } } });
  dom.window.close();
  return results.violations.map((each) => ({ id: each.id, nodes: each.nodes.map((node) => node.html) }));
}
