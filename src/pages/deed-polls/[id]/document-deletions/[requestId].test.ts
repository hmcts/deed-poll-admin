import { ForbiddenError, findDeedPoll, findDocumentDeletion, NotFoundError, TooManyRequestsError, UnauthorizedError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET } from "./[requestId].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findDocumentDeletion: vi.fn()
}));

const REQUEST_ID = "6f1c1f4e-2b1a-4d8e-9f3a-1c2b3d4e5f60";
const request = (params: Record<string, string> = { id: "case-1", requestId: REQUEST_ID }) => pageRequest({ params, accessToken: "session-token" });

function answer(overrides: Record<string, unknown> = {}) {
  vi.mocked(findDocumentDeletion).mockResolvedValue({
    requestId: REQUEST_ID,
    documentId: "doc-1",
    status: "InProgress",
    requestedAt: new Date("2026-11-26T10:00:00Z"),
    completedAt: null,
    failure: null,
    ...overrides
  } as never);
}

describe("document deletion progress page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    answer();
  });

  it("should read only the request under its case, never the case or the document", async () => {
    // Arrange
    const res = pageResponse();

    // Act
    await GET(request(), res);

    // Assert
    expect(findDocumentDeletion).toHaveBeenCalledWith("case-1", REQUEST_ID, { accessToken: "session-token" });
    expect(findDeedPoll).not.toHaveBeenCalled();
    const [view, model] = res.render.mock.calls[0];
    expect(view).toBe("deed-polls/document-deletion-status");
    expect(model.statusPath).toBe(`/deed-polls/case-1/document-deletions/${REQUEST_ID}`);
    expect(model.documentsPath).toBe("/deed-polls/case-1#documents");
  });

  it.each([
    ["InProgress", "Document deletion in progress", "The service will finish this"],
    ["NeedsAttention", "Document deletion has not completed", "Do not ask for this document to be deleted again"],
    ["Completed", "Document deleted", "has been permanently deleted"]
  ])("should head %s as %s", async (status, heading, sentence) => {
    answer({
      status,
      completedAt: status === "Completed" ? new Date("2026-11-26T10:00:05Z") : null,
      failure: status === "NeedsAttention" ? "CDAM_DELETE_FAILED" : null
    });
    const res = pageResponse();

    await GET(request(), res);

    const model = res.render.mock.calls[0][1];
    expect(model.progress).toBe(status);
    expect(model.heading).toBe(heading);
    expect(model.title).toBe(heading);
    expect(model.sentence).toContain(sentence);
    expect(model.rows[0]).toEqual({ key: "Request reference", value: REQUEST_ID });
    expect(model.rows.some((row: { key: string }) => row.key === "Deleted")).toBe(status === "Completed");
  });

  it("should still answer after the document is gone, because the request is all it reads", async () => {
    answer({ status: "Completed", completedAt: new Date() });
    const res = pageResponse();

    await GET(request(), res);

    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.render.mock.calls[0][1].heading).toBe("Document deleted");
  });

  it("should say progress could not be checked, distinct from success, when the read fails", async () => {
    vi.mocked(findDocumentDeletion).mockRejectedValue(new Error("deed-poll-api call failed (invalid-response)"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = pageResponse();

    await GET(request(), res);

    const model = res.render.mock.calls[0][1];
    expect(res.status).toHaveBeenCalledWith(503);
    expect(model.progress).toBe("unavailable");
    expect(model.heading).toBe("We could not check this document deletion");
  });

  it.each([
    ["not found", new NotFoundError("Document deletion request not found")],
    ["forbidden after access was removed", new ForbiddenError("deed-poll-api call failed (forbidden)")],
    ["unauthorized", new UnauthorizedError("deed-poll-api call failed (unauthorized)")],
    ["rate limited", new TooManyRequestsError("slow down", null)]
  ])("should leave a %s answer to the existing flows", async (_label, error) => {
    vi.mocked(findDocumentDeletion).mockRejectedValue(error);
    const res = pageResponse();

    await expect(GET(request(), res)).rejects.toBe(error);

    expect(res.render).not.toHaveBeenCalled();
  });

  it("should refuse a dot-only request id before reading anything", async () => {
    await expect(GET(request({ id: "case-1", requestId: "." }), pageResponse())).rejects.toBeInstanceOf(NotFoundError);

    expect(findDocumentDeletion).not.toHaveBeenCalled();
  });

  it("should carry both locales' content in one shape", async () => {
    const res = pageResponse();
    res.locals.locale = "cy";

    await GET(request(), res);

    const model = res.render.mock.calls[0][1];
    expect(Object.keys(model.cy)).toEqual(Object.keys(model.en));
    expect(model.heading).toBe(model.cy.InProgressHeading);
  });
});
