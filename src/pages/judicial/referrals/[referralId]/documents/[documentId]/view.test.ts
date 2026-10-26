import { getReferral, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../../express-doubles.js";
import { GET } from "./view.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  getReferral: vi.fn(),
  previewReferralDocument: vi.fn(),
  downloadReferralDocument: vi.fn()
}));

const referral = {
  id: "ref-1",
  state: "Open",
  reasons: [],
  application: {
    displayReference: "KBDP2026-00042",
    witnesses: [],
    documents: [
      { id: "doc-a", name: "Deed poll", mimeType: "application/pdf" },
      { id: "doc-b", name: "Statement", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
    ]
  },
  caseNotes: []
};

describe("judicial document viewer route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReferral).mockResolvedValue(referral as never);
  });

  it("should read the referral once with the judge's token and render the viewer with no case reference", async () => {
    const res = pageResponse();

    await GET(pageRequest({ params: { referralId: "ref-1", documentId: "doc-b" }, judicial: true, accessToken: "judge-token" }), res);

    expect(getReferral).toHaveBeenCalledTimes(1);
    expect(getReferral).toHaveBeenCalledWith("ref-1", { accessToken: "judge-token" });
    expect(res.render.mock.calls[0][0]).toBe("document-viewer");
    expect(res.render.mock.calls[0][1]).toMatchObject({ scope: "judicial", caseReference: null, formatText: "Word document" });
    expect(res.render.mock.calls[0][1].viewer.returnPath).toBe("/judicial/referrals/ref-1#documents");
  });

  it("should fetch no preview or original while rendering the shell", async () => {
    const { downloadReferralDocument, previewReferralDocument } = await import("@hmcts/deed-poll");

    await GET(pageRequest({ params: { referralId: "ref-1", documentId: "doc-a" }, judicial: true }), pageResponse());

    expect(previewReferralDocument).not.toHaveBeenCalled();
    expect(downloadReferralDocument).not.toHaveBeenCalled();
  });

  it("should render the existing no-longer-available page with a 404 when api will not show the referral", async () => {
    vi.mocked(getReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));
    const res = pageResponse();

    await GET(pageRequest({ params: { referralId: "ref-1", documentId: "doc-a" }, judicial: true }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/unavailable");
    expect(res.render.mock.calls[0][1]).toMatchObject({ poolPath: "/judicial/referrals", en: { heading: "This referral is no longer available" } });
  });

  it("should call a document missing from a visible referral a missing document, not a lost referral", async () => {
    const res = pageResponse();

    await expect(GET(pageRequest({ params: { referralId: "ref-1", documentId: "doc-gone" }, judicial: true }), res)).rejects.toBeInstanceOf(NotFoundError);
    expect(res.render).not.toHaveBeenCalled();
  });

  it("should leave any other failure to the error handler", async () => {
    const failure = new Error("deed-poll-api call failed (timeout)");
    vi.mocked(getReferral).mockRejectedValue(failure);

    await expect(GET(pageRequest({ params: { referralId: "ref-1", documentId: "doc-a" }, judicial: true }), pageResponse())).rejects.toBe(failure);
  });

  it("should refuse a dot-only referral id before reading anything", async () => {
    await expect(GET(pageRequest({ params: { referralId: "..", documentId: "doc-a" }, judicial: true }), pageResponse())).rejects.toBeInstanceOf(NotFoundError);
    expect(getReferral).not.toHaveBeenCalled();
  });
});
