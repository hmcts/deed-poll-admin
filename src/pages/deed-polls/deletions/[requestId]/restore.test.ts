import { ConflictError, findDeletion, NotFoundError, restoreDeletion, UnauthorizedError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET, POST } from "./restore.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeletion: vi.fn(),
  restoreDeletion: vi.fn()
}));

const REQUEST_ID = "6f1c1f4e-2b1a-4d8e-9f3a-1c2b3d4e5f60";
const PENDING = {
  requestId: REQUEST_ID,
  caseId: "case-1",
  reason: "DUPLICATE",
  status: "Pending",
  requestedAt: new Date("2026-11-20T10:00:00Z"),
  restorableUntil: new Date(Date.now() + 86_400_000),
  completedAt: null,
  failure: null
};

const request = (body?: Record<string, unknown>, query: Record<string, unknown> = { case: "case-1" }) =>
  pageRequest({ params: { requestId: REQUEST_ID }, query, body, accessToken: "session-token" });

describe("restore a deleted application", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(restoreDeletion).mockResolvedValue({ caseId: "case-1", status: "Restored" } as never);
    vi.mocked(findDeletion).mockResolvedValue(PENDING as never);
  });

  describe("GET", () => {
    it("should ask for confirmation, posting back to itself with the application, and read or write nothing", () => {
      const res = pageResponse();

      GET(request(), res);

      expect(res.render).toHaveBeenCalledWith(
        "deed-polls/deletions/restore",
        expect.objectContaining({
          state: "confirm",
          actionPath: `/deed-polls/deletions/${REQUEST_ID}/restore?case=case-1`,
          statusPath: `/deed-polls/deletions/${REQUEST_ID}`
        })
      );
      expect(findDeletion).not.toHaveBeenCalled();
      expect(restoreDeletion).not.toHaveBeenCalled();
    });

    it.each([{}, { case: ["case-1", "case-2"] }, { case: ".." }])("should be a 404 for the application %j", (query) => {
      expect(() => GET(request(undefined, query), pageResponse())).toThrow(NotFoundError);
    });
  });

  describe("POST", () => {
    it("should restore with the caller's token only and 303 to the application with its banner", async () => {
      const res = pageResponse();

      await POST(request({ action: "restore" }), res);

      expect(restoreDeletion).toHaveBeenCalledWith(REQUEST_ID, { accessToken: "session-token" });
      expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/case-1?deletion=restored");
    });

    it("should write nothing for any other body and go back to the status page", async () => {
      const res = pageResponse();

      await POST(request({ action: "delete" }), res);

      expect(restoreDeletion).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(303, `/deed-polls/deletions/${REQUEST_ID}`);
    });

    it.each([
      ["RESTORE_WINDOW_CLOSED", "the time to restore it has ended"],
      ["CLEANUP_STARTED", "its permanent removal has started"],
      ["STALE_CONFIRMATION", "Refresh the page"],
      [null, "Refresh the page"]
    ])("should redraw the status page from a fresh read for a %s refusal", async (code, sentence) => {
      vi.mocked(restoreDeletion).mockRejectedValue(new ConflictError("api's words", [], code as never));
      vi.mocked(findDeletion).mockResolvedValue({ ...PENDING, restorableUntil: new Date(Date.now() - 1000) } as never);
      const res = pageResponse();

      await POST(request({ action: "restore" }), res);

      const [view, model] = res.render.mock.calls[0];
      expect(view).toBe("deed-polls/deletions/status");
      expect(res.status).toHaveBeenCalledWith(409);
      expect(findDeletion).toHaveBeenCalledTimes(1);
      expect(model.notice).toContain(sentence);
      expect(model.restoreHref).toBeNull();
    });

    it("should say the request no longer exists and link to the application when api answers 404", async () => {
      vi.mocked(restoreDeletion).mockRejectedValue(new NotFoundError("Deletion request not found"));
      const res = pageResponse();

      await POST(request({ action: "restore" }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.render.mock.calls[0][1]).toMatchObject({ state: "gone", heading: "This deletion request no longer exists", casePath: "/deed-polls/case-1" });
    });

    it("should leave a 401 to the sign-in flow", async () => {
      vi.mocked(restoreDeletion).mockRejectedValue(new UnauthorizedError("expired"));

      await expect(POST(request({ action: "restore" }), pageResponse())).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });
});
