import type { CaseDetail, JudicialReferralDetail } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { NotFoundError } from "../errors.js";
import { buildCaseViewerContext, buildReferralViewerContext } from "./view.js";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const aCase = (documents: Record<string, unknown>[], displayReference: string | null = "KBDP2026-00042") =>
  ({ id: "case-1", displayReference, notes: [], witnesses: [], documents }) as unknown as CaseDetail;

const aReferral = (application: Record<string, unknown> | null) =>
  ({ id: "ref-1", state: "Open", reasons: [], application, caseNotes: [] }) as unknown as JudicialReferralDetail;

const THREE_FILES = [
  { id: "doc-a", name: "Deed poll", mimeType: PDF, hasFile: true },
  { id: "doc-b", name: "Statutory declaration", mimeType: DOCX, hasFile: true },
  { id: "doc-c", name: "Passport scan", mimeType: "image/tiff", hasFile: true }
];

describe("buildCaseViewerContext", () => {
  it("should offer the case's documents with a file attached, in api's order, with the case reference", () => {
    const found = aCase([THREE_FILES[2], { id: "pending", name: "Expected", mimeType: PDF, hasFile: false }, THREE_FILES[0], THREE_FILES[1]]);

    const context = buildCaseViewerContext(found, "doc-a");

    expect(context.scope).toBe("caseworker");
    expect(context.caseReference).toBe("KBDP2026-00042");
    expect(context.documents.map((document) => document.id)).toEqual(["doc-c", "doc-a", "doc-b"]);
  });

  it("should place the selection and its neighbours for a document in the middle", () => {
    const context = buildCaseViewerContext(aCase(THREE_FILES), "doc-b");

    expect(context.current).toEqual({ id: "doc-b", name: "Statutory declaration", format: "docx" });
    expect(context.position).toBe(2);
    expect(context.total).toBe(3);
    expect(context.previous?.id).toBe("doc-a");
    expect(context.next?.id).toBe("doc-c");
  });

  it("should have no previous document at the first and no next document at the last", () => {
    const first = buildCaseViewerContext(aCase(THREE_FILES), "doc-a");
    const last = buildCaseViewerContext(aCase(THREE_FILES), "doc-c");

    expect(first.previous).toBeNull();
    expect(first.next?.id).toBe("doc-b");
    expect(last.previous?.id).toBe("doc-b");
    expect(last.next).toBeNull();
  });

  it("should have neither neighbour when the case has one document", () => {
    const context = buildCaseViewerContext(aCase([THREE_FILES[0]]), "doc-a");

    expect(context).toMatchObject({ position: 1, total: 1, previous: null, next: null });
  });

  it("should refuse every selection when the case has no documents", () => {
    expect(() => buildCaseViewerContext(aCase([]), "doc-a")).toThrow(NotFoundError);
  });

  it("should refuse a document that is not on this case rather than open another one", () => {
    expect(() => buildCaseViewerContext(aCase(THREE_FILES), "doc-of-another-case")).toThrow(NotFoundError);
  });

  it("should refuse a document with no file attached, because there is nothing to preview", () => {
    const found = aCase([...THREE_FILES, { id: "pending", name: "Expected", mimeType: PDF, hasFile: false }]);

    expect(() => buildCaseViewerContext(found, "pending")).toThrow(NotFoundError);
  });

  it("should refuse with a fixed message that repeats nothing the request supplied", () => {
    const forged = "<script>alert(1)</script>/../x";

    expect(() => buildCaseViewerContext(aCase(THREE_FILES), forged)).toThrow("The selected document is not one of this context's documents");
  });

  it("should match the selection exactly, so an id differing only by encoding or case is refused", () => {
    const found = aCase([{ id: "doc/1?x#y", name: "Delimited", mimeType: PDF, hasFile: true }]);

    expect(buildCaseViewerContext(found, "doc/1?x#y").current.id).toBe("doc/1?x#y");
    expect(() => buildCaseViewerContext(found, "doc%2F1%3Fx%23y")).toThrow(NotFoundError);
    expect(() => buildCaseViewerContext(found, "DOC/1?X#Y")).toThrow(NotFoundError);
  });

  it("should keep a name with markup or delimiters exactly as api sent it, for the template to escape", () => {
    const name = `<img src=x onerror="alert(1)"> & 'quotes' / ? #`;

    const context = buildCaseViewerContext(aCase([{ id: "doc-a", name, mimeType: PDF, hasFile: true }]), "doc-a");

    expect(context.current.name).toBe(name);
  });

  it("should name an unnamed document as not provided", () => {
    const context = buildCaseViewerContext(aCase([{ id: "doc-a", mimeType: PDF, hasFile: true }]), "doc-a");

    expect(context.current.name).toBe("Not provided");
  });

  it.each([
    [PDF, "pdf"],
    ["image/jpeg", "jpeg"],
    ["image/png", "png"],
    ["image/tiff", "tiff"],
    [DOCX, "docx"],
    ["IMAGE/PNG", "png"],
    ["application/msword", null],
    [undefined, null]
  ])("should read %s as the %s format", (mimeType, format) => {
    const context = buildCaseViewerContext(aCase([{ id: "doc-a", name: "A", mimeType, hasFile: true }]), "doc-a");

    expect(context.current.format).toBe(format);
  });

  it("should carry no reference when api sent none", () => {
    expect(buildCaseViewerContext(aCase(THREE_FILES, null), "doc-a").caseReference).toBeNull();
  });
});

describe("buildReferralViewerContext", () => {
  const application = {
    displayReference: "KBDP2026-00042",
    witnesses: [],
    documents: [
      { id: "doc-b", name: "Statutory declaration", mimeType: DOCX, documentType: "Declaration" },
      { id: "doc-a", name: "Deed poll", mimeType: PDF, documentType: "Deed" }
    ]
  };

  it("should offer the application's documents in api's order", () => {
    const context = buildReferralViewerContext(aReferral(application), "doc-a");

    expect(context.scope).toBe("judicial");
    expect(context.documents).toEqual([
      { id: "doc-b", name: "Statutory declaration", format: "docx" },
      { id: "doc-a", name: "Deed poll", format: "pdf" }
    ]);
    expect(context).toMatchObject({ position: 2, total: 2, next: null });
    expect(context.previous?.id).toBe("doc-b");
  });

  it("should carry no case reference for a judge even when the application has one", () => {
    const context = buildReferralViewerContext(aReferral(application), "doc-b");

    expect(context.caseReference).toBeNull();
  });

  it("should refuse every selection when api sent no application", () => {
    expect(() => buildReferralViewerContext(aReferral(null), "doc-a")).toThrow(NotFoundError);
  });

  it("should refuse a document that is not on this referral's application", () => {
    expect(() => buildReferralViewerContext(aReferral(application), "doc-c")).toThrow(NotFoundError);
  });

  it("should build each context from its own read, so two referrals open at once do not share documents", () => {
    const other = aReferral({ ...application, documents: [{ id: "doc-z", name: "Other", mimeType: PDF }] });

    const first = buildReferralViewerContext(aReferral(application), "doc-a");
    const second = buildReferralViewerContext(other, "doc-z");

    expect(first.documents.map((document) => document.id)).toEqual(["doc-b", "doc-a"]);
    expect(second.documents.map((document) => document.id)).toEqual(["doc-z"]);
    expect(() => buildReferralViewerContext(other, "doc-a")).toThrow(NotFoundError);
  });
});
