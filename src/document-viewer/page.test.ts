import { buildCaseViewerContext, buildReferralViewerContext, DOCUMENT_PREVIEW_LIMITS, NotFoundError } from "@hmcts/deed-poll";
import type { CaseDetail, JudicialReferralDetail } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { cy, en } from "./content.js";
import { caseViewerScope, referralViewerScope } from "./context.js";
import { showViewer } from "./page.js";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const DOCUMENTS = [
  { id: "doc-a", name: "Deed poll", mimeType: PDF, hasFile: true },
  { id: "doc/b", name: "Statement <b>", mimeType: DOCX, hasFile: true },
  { id: "doc-c", name: "Old scan", mimeType: "image/gif", hasFile: true }
];

const aCase = { id: "case-1", displayReference: "KBDP2026-00042", notes: [], witnesses: [], documents: DOCUMENTS } as unknown as CaseDetail;
const aReferral = {
  id: "ref-1",
  state: "Open",
  reasons: [],
  application: { displayReference: "KBDP2026-00042", witnesses: [], documents: DOCUMENTS },
  caseNotes: []
} as unknown as JudicialReferralDetail;

describe("showViewer", () => {
  it("should render the shared viewer with the case's documents, the open one's paths and the way back", () => {
    const res = pageResponse();

    showViewer(pageRequest(), res, caseViewerScope("case-1"), buildCaseViewerContext(aCase, "doc/b"));

    const [view, model] = res.render.mock.calls[0];
    expect(view).toBe("document-viewer");
    expect(model).toMatchObject({
      en,
      cy,
      title: "Statement <b>",
      scope: "caseworker",
      caseReference: "KBDP2026-00042",
      selectionParameter: "document",
      previewLimits: { maxPages: DOCUMENT_PREVIEW_LIMITS.maxPages, maxBytes: DOCUMENT_PREVIEW_LIMITS.maxOutputBytes },
      positionText: "Document 2 of 3",
      formatText: "Word document",
      backText: "Back to case",
      viewer: {
        returnPath: "/deed-polls/case-1#documents",
        current: { id: "doc/b", previewPath: "/deed-polls/case-1/documents/doc%2Fb/preview", downloadPath: "/deed-polls/case-1/documents/doc%2Fb/download" },
        previousPath: "/deed-polls/case-1/documents/doc-a/view",
        nextPath: "/deed-polls/case-1/documents/doc-c/view"
      }
    });
  });

  it("should name no case reference and offer the way back to the referral for a judge", () => {
    const res = pageResponse();

    showViewer(pageRequest({ judicial: true }), res, referralViewerScope("ref-1"), buildReferralViewerContext(aReferral, "doc-a"));

    expect(res.render.mock.calls[0][1]).toMatchObject({ scope: "judicial", caseReference: null, backText: "Back to referral" });
    expect(res.render.mock.calls[0][1].viewer.returnPath).toBe("/judicial/referrals/ref-1#documents");
  });

  it("should name no format for a type outside the upload allowlist", () => {
    const res = pageResponse();

    showViewer(pageRequest(), res, caseViewerScope("case-1"), buildCaseViewerContext(aCase, "doc-c"));

    expect(res.render.mock.calls[0][1]).toMatchObject({ formatText: null });
    expect(res.render.mock.calls[0][1].viewer.nextPath).toBeNull();
  });

  it("should resolve the sentences it builds from the Welsh content when the locale is Welsh", () => {
    const res = pageResponse();
    res.locals.locale = "cy";

    showViewer(pageRequest(), res, caseViewerScope("case-1"), buildCaseViewerContext(aCase, "doc-a"));

    expect(res.render.mock.calls[0][1].positionText).toBe(cy.documentPosition(1, 3));
  });

  it("should redirect a selector submission to the chosen document's own view, without rendering", () => {
    const res = pageResponse();

    showViewer(pageRequest({ query: { document: "doc/b" } }), res, caseViewerScope("case-1"), buildCaseViewerContext(aCase, "doc-a"));

    expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/case-1/documents/doc%2Fb/view");
    expect(res.render).not.toHaveBeenCalled();
  });

  it.each([
    ["a document not in this context", "doc-elsewhere"],
    ["an absolute URL", "https://evil.example"],
    ["an empty value", ""],
    ["a repeated parameter", ["doc-a", "doc/b"]],
    ["a bracketed parameter", { id: "doc-a" }]
  ])("should refuse %s as a selection rather than substitute one", (_name, selection) => {
    const res = pageResponse();

    expect(() => showViewer(pageRequest({ query: { document: selection } }), res, caseViewerScope("case-1"), buildCaseViewerContext(aCase, "doc-a"))).toThrow(
      NotFoundError
    );
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.render).not.toHaveBeenCalled();
  });
});
