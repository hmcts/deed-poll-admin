import { buildCaseViewerContext, buildReferralViewerContext, NotFoundError } from "@hmcts/deed-poll";
import type { CaseDetail, JudicialReferralDetail } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { caseViewerScope, documentPaths, referralViewerScope, viewerLinks } from "./context.js";

const PDF = "application/pdf";

const aCase = (documents: Record<string, unknown>[]) =>
  ({ id: "case-1", displayReference: "KBDP2026-00042", notes: [], witnesses: [], documents }) as unknown as CaseDetail;

const aReferral = (documents: Record<string, unknown>[]) =>
  ({ id: "ref-1", state: "Open", reasons: [], application: { witnesses: [], documents }, caseNotes: [] }) as unknown as JudicialReferralDetail;

const CASE_DOCUMENTS = [
  { id: "doc-a", name: "Deed poll", mimeType: PDF, hasFile: true },
  { id: "doc/b?x#y", name: "Declaration", mimeType: PDF, hasFile: true },
  { id: "doc-c", name: "Passport", mimeType: "image/png", hasFile: true }
];

describe("caseViewerScope", () => {
  it("should return to the case page's documents section", () => {
    expect(caseViewerScope("case-1")).toEqual({ basePath: "/deed-polls/case-1", returnPath: "/deed-polls/case-1#documents" });
  });

  it("should keep a delimiter in the case id inside its one segment", () => {
    expect(caseViewerScope("case/1?q#f").returnPath).toBe("/deed-polls/case%2F1%3Fq%23f#documents");
  });

  it.each(["", ".", ".."])("should refuse the unusable case id %j before anything is read", (id) => {
    expect(() => caseViewerScope(id)).toThrow(NotFoundError);
  });
});

describe("referralViewerScope", () => {
  it("should return to the referral page under the judicial area, with no case id", () => {
    expect(referralViewerScope("ref-1")).toEqual({ basePath: "/judicial/referrals/ref-1", returnPath: "/judicial/referrals/ref-1#documents" });
  });

  it.each(["", ".", ".."])("should refuse the unusable referral id %j", (id) => {
    expect(() => referralViewerScope(id)).toThrow(NotFoundError);
  });
});

describe("documentPaths", () => {
  it("should build the scoped view, preview and original-download paths", () => {
    const paths = documentPaths(caseViewerScope("case-1"), "doc-a");

    expect(paths).toEqual({
      viewPath: "/deed-polls/case-1/documents/doc-a/view",
      previewPath: "/deed-polls/case-1/documents/doc-a/preview",
      downloadPath: "/deed-polls/case-1/documents/doc-a/download"
    });
  });

  it("should encode a delimiter in the document id once, keeping a literal percent literal", () => {
    expect(documentPaths(referralViewerScope("ref-1"), "doc/1?x#y").viewPath).toBe("/judicial/referrals/ref-1/documents/doc%2F1%3Fx%23y/view");
    expect(documentPaths(referralViewerScope("ref-1"), "doc%2F1").viewPath).toBe("/judicial/referrals/ref-1/documents/doc%252F1/view");
  });

  it.each(["", ".", ".."])("should refuse the unusable document id %j before anything is read", (id) => {
    expect(() => documentPaths(caseViewerScope("case-1"), id)).toThrow(NotFoundError);
  });
});

describe("viewerLinks", () => {
  it("should link every selector entry and mark only the current document", () => {
    const scope = caseViewerScope("case-1");

    const links = viewerLinks(scope, buildCaseViewerContext(aCase(CASE_DOCUMENTS), "doc/b?x#y"));

    expect(links.documents.map((document) => [document.viewPath, document.isCurrent])).toEqual([
      ["/deed-polls/case-1/documents/doc-a/view", false],
      ["/deed-polls/case-1/documents/doc%2Fb%3Fx%23y/view", true],
      ["/deed-polls/case-1/documents/doc-c/view", false]
    ]);
    expect(links.current).toMatchObject({ id: "doc/b?x#y", previewPath: "/deed-polls/case-1/documents/doc%2Fb%3Fx%23y/preview" });
  });

  it("should link the previous and next documents by their view paths", () => {
    const links = viewerLinks(caseViewerScope("case-1"), buildCaseViewerContext(aCase(CASE_DOCUMENTS), "doc/b?x#y"));

    expect(links.previousPath).toBe("/deed-polls/case-1/documents/doc-a/view");
    expect(links.nextPath).toBe("/deed-polls/case-1/documents/doc-c/view");
  });

  it("should offer no previous or next document for a single document", () => {
    const links = viewerLinks(caseViewerScope("case-1"), buildCaseViewerContext(aCase([CASE_DOCUMENTS[0]]), "doc-a"));

    expect(links).toMatchObject({ previousPath: null, nextPath: null, returnPath: "/deed-polls/case-1#documents" });
  });

  it("should never put a document's name into a path, however it is written", () => {
    const name = `../../evil?<script>#x`;

    const links = viewerLinks(caseViewerScope("case-1"), buildCaseViewerContext(aCase([{ ...CASE_DOCUMENTS[0], name }]), "doc-a"));

    expect(links.current.name).toBe(name);
    expect(Object.values(links.current).filter((value) => typeof value === "string" && value.startsWith("/"))).not.toContainEqual(
      expect.stringContaining("evil")
    );
  });

  it("should keep two referrals' viewers independent, each linking only under its own referral", () => {
    const first = viewerLinks(referralViewerScope("ref-1"), buildReferralViewerContext(aReferral([{ id: "doc-a", name: "A" }]), "doc-a"));
    const second = viewerLinks(referralViewerScope("ref-2"), buildReferralViewerContext(aReferral([{ id: "doc-z", name: "Z" }]), "doc-z"));

    expect(first.documents.map((document) => document.viewPath)).toEqual(["/judicial/referrals/ref-1/documents/doc-a/view"]);
    expect(second.documents.map((document) => document.viewPath)).toEqual(["/judicial/referrals/ref-2/documents/doc-z/view"]);
    expect(second.returnPath).toBe("/judicial/referrals/ref-2#documents");
  });

  it("should take its return path from the scope alone, so nothing a request supplies can redirect it", () => {
    const context = buildCaseViewerContext(aCase(CASE_DOCUMENTS), "doc-a");

    const links = viewerLinks(caseViewerScope("case-1"), { ...context, returnTo: "https://evil.example" } as never);

    expect(links.returnPath).toBe("/deed-polls/case-1#documents");
  });
});
