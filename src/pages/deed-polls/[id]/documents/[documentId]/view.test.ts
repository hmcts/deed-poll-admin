import { findDeedPoll, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../express-doubles.js";
import { GET } from "./view.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  previewDocument: vi.fn(),
  downloadDocument: vi.fn()
}));

const DOCUMENTS = [
  { id: "doc-a", name: "Deed poll", mimeType: "application/pdf", hasFile: true },
  { id: "doc-b", name: "Passport", mimeType: "image/png", hasFile: true }
];
const found = { id: "case-1", displayReference: "KBDP2026-00042", notes: [], witnesses: [], documents: DOCUMENTS };

describe("caseworker document viewer route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
  });

  it("should read the case once with the caseworker's token and render the viewer for the chosen document", async () => {
    const res = pageResponse();

    await GET(pageRequest({ params: { id: "case-1", documentId: "doc-b" }, accessToken: "caseworker-token" }), res);

    expect(findDeedPoll).toHaveBeenCalledTimes(1);
    expect(findDeedPoll).toHaveBeenCalledWith("case-1", { accessToken: "caseworker-token" });
    expect(res.render.mock.calls[0][0]).toBe("document-viewer");
    expect(res.render.mock.calls[0][1]).toMatchObject({ caseReference: "KBDP2026-00042", positionText: "Document 2 of 2" });
  });

  it("should fetch no preview or original while rendering the shell, because api audits each one", async () => {
    const { downloadDocument, previewDocument } = await import("@hmcts/deed-poll");

    await GET(pageRequest({ params: { id: "case-1", documentId: "doc-a" } }), pageResponse());

    expect(previewDocument).not.toHaveBeenCalled();
    expect(downloadDocument).not.toHaveBeenCalled();
  });

  it("should set no header of its own, leaving the shell under the app's page policy rather than a binary's", async () => {
    const res = pageResponse();

    await GET(pageRequest({ params: { id: "case-1", documentId: "doc-a" } }), res);

    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it.each([
    ["case", { id: "..", documentId: "doc-a" }],
    ["document", { id: "case-1", documentId: "." }]
  ])("should refuse a dot-only %s id before reading anything", async (_name, params) => {
    await expect(GET(pageRequest({ params }), pageResponse())).rejects.toBeInstanceOf(NotFoundError);
    expect(findDeedPoll).not.toHaveBeenCalled();
  });

  it("should refuse a document that is not one of the case's rather than show another", async () => {
    await expect(GET(pageRequest({ params: { id: "case-1", documentId: "doc-other" } }), pageResponse())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("should leave a case api will not show to the shared 404", async () => {
    vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("Case case-1 not found"));

    await expect(GET(pageRequest({ params: { id: "case-1", documentId: "doc-a" } }), pageResponse())).rejects.toBeInstanceOf(NotFoundError);
  });
});
