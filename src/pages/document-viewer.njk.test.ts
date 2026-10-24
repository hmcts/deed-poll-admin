/**
 * The viewer shell's markup, rendered from the model the real handlers pass.
 *
 * What a model cannot show: that a document name is escaped wherever it appears, that the selector, the document
 * links and the original download work as plain HTML, that page controls are distinct from document controls, and
 * that the shell embeds, preloads or links to no preview.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCUMENT_PREVIEW_LIMITS, findDeedPoll, getReferral } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { GET as caseView } from "./deed-polls/[id]/documents/[documentId]/view.js";
import { GET as referralView } from "./judicial/referrals/[referralId]/documents/[documentId]/view.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  getReferral: vi.fn()
}));

// The three roots `configureGovuk` mounts, minus the assets — the same set as the other njk tests.
const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "..")
  ],
  { autoescape: true }
);

const UNSAFE_NAME = '<script>alert("x")</script> & "quoted"';
const DOCUMENTS = [
  { id: "doc-a", name: "Deed poll", mimeType: "application/pdf", hasFile: true },
  { id: "doc-b", name: UNSAFE_NAME, mimeType: "image/tiff", hasFile: true },
  { id: "doc-c", name: "Statement", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", hasFile: true }
];

const html = (model: Record<string, unknown>, locale = "en"): string => environment.render("document-viewer.njk", { ...(model[locale] as object), ...model });

async function caseworkerPage(documentId: string): Promise<string> {
  const res = pageResponse();
  await caseView(pageRequest({ params: { id: "case-1", documentId } }), res);
  return html(res.render.mock.calls[0][1]);
}

describe("document-viewer.njk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue({ id: "case-1", displayReference: "KBDP2026-00042", notes: [], witnesses: [], documents: DOCUMENTS } as never);
    vi.mocked(getReferral).mockResolvedValue({
      id: "ref-1",
      state: "Open",
      reasons: [],
      application: { displayReference: "KBDP2026-00042", witnesses: [], documents: DOCUMENTS },
      caseNotes: []
    } as never);
  });

  it("should escape the document's name in the heading and the selector", async () => {
    const page = await caseworkerPage("doc-b");

    expect(page).not.toContain("<script>alert");
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quoted&quot;");
  });

  it("should show the document's name, format and the case reference, with the way back to the case", async () => {
    const page = await caseworkerPage("doc-c");

    expect(page).toContain(">Statement</h1>");
    expect(page).toContain("Word document");
    expect(page).toContain("KBDP2026-00042");
    expect(page).toContain('href="/deed-polls/case-1#documents"');
    expect(page).toContain("Back to case");
  });

  it("should offer every document in the selector, the open one selected, in a GET form back to this view", async () => {
    const page = await caseworkerPage("doc-c");

    expect(page).toMatch(/<form method="get" action="\/deed-polls\/case-1\/documents\/doc-c\/view"/);
    expect(page).toContain('name="document"');
    expect(page.match(/<option /g)).toHaveLength(3);
    expect(page).toMatch(/<option value="doc-c" selected>Statement<\/option>/);
    expect(page).toContain("Document 3 of 3");
  });

  it("should link the neighbouring documents and the original download as plain links, offering no next at the end", async () => {
    const page = await caseworkerPage("doc-c");

    expect(page).toContain('href="/deed-polls/case-1/documents/doc-b/view"');
    expect(page).toContain("Previous document");
    expect(page).not.toContain("Next document");
    expect(page).toMatch(/href="\/deed-polls\/case-1\/documents\/doc-c\/download" download/);
    expect(page).toContain("Download original");
  });

  it("should keep the page controls separate from the document controls, hidden and disabled until a preview loads", async () => {
    const page = await caseworkerPage("doc-a");

    expect(page).toMatch(/<div class="app-document-viewer__toolbar" data-viewer-toolbar hidden>/);
    for (const control of ["previous-page", "next-page", "zoom-out", "zoom-in", "fit-width", "fit-page", "rotate"]) {
      expect(page).toMatch(new RegExp(`data-viewer-${control} disabled`));
    }
    expect(page).toContain('aria-label="Page thumbnails"');
    expect(page).toContain('aria-label="Page navigation"');
    expect(page).toContain('aria-label="Document controls"');
  });

  it("should tell a browser without JavaScript what still works, in the status region", async () => {
    const page = await caseworkerPage("doc-a");

    expect(page).toMatch(/role="status" aria-live="polite" data-viewer-status>The interactive preview needs JavaScript/);
  });

  it("should carry the preview's URL and fixed messages for the renderer, and fetch no document itself", async () => {
    const page = await caseworkerPage("doc-a");

    expect(page).toContain('data-preview-url="/deed-polls/case-1/documents/doc-a/preview"');
    expect(page).toContain('data-message-unavailable="A preview of this document is not available. You can still download the original."');
    expect(page).not.toMatch(/(src|href)="[^"]*\/preview"/);
    expect(page).not.toMatch(/<(iframe|embed|object)\b/);
    expect(page).not.toContain('rel="preload"');
  });

  it("should hand the renderer api's published preview limits, not numbers of its own", async () => {
    const page = await caseworkerPage("doc-a");

    expect(page).toContain(`data-max-pages="${DOCUMENT_PREVIEW_LIMITS.maxPages}"`);
    expect(page).toContain(`data-max-bytes="${DOCUMENT_PREVIEW_LIMITS.maxOutputBytes}"`);
    expect(page).toContain('data-label-page="Page"');
  });

  it("should show a judge no case reference, and the way back to the referral", async () => {
    const res = pageResponse();
    await referralView(pageRequest({ params: { referralId: "ref-1", documentId: "doc-a" }, judicial: true }), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).not.toContain("KBDP2026-00042");
    expect(page).not.toContain("Case reference");
    expect(page).toContain('href="/judicial/referrals/ref-1#documents"');
    expect(page).toContain("Back to referral");
    expect(page).toContain('data-preview-url="/judicial/referrals/ref-1/documents/doc-a/preview"');
  });

  it("should render from the Welsh content when the locale is Welsh", async () => {
    const res = pageResponse();
    res.locals.locale = "cy";
    await caseView(pageRequest({ params: { id: "case-1", documentId: "doc-a" } }), res);
    const model = res.render.mock.calls[0][1];

    expect(html(model, "cy")).toContain((model.cy as { downloadOriginal: string }).downloadOriginal);
  });
});
