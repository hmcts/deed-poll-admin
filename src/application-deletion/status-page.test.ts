import { ForbiddenError, findDeletion, NotFoundError, TooManyRequestsError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { renderDeletionStatus } from "./status-page.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeletion: vi.fn()
}));

const REQUEST_ID = "6f1c1f4e-2b1a-4d8e-9f3a-1c2b3d4e5f60";
const LATER = new Date(Date.now() + 3 * 86_400_000);
const EARLIER = new Date(Date.now() - 1000);
const request = () => pageRequest({ params: { requestId: REQUEST_ID }, accessToken: "session-token" });
const deletion = (overrides: Record<string, unknown> = {}) => ({
  requestId: REQUEST_ID,
  caseId: "case-1",
  reason: "CREATED_IN_ERROR",
  status: "Pending",
  requestedAt: new Date("2026-11-20T10:00:00Z"),
  restorableUntil: LATER,
  completedAt: null,
  failure: null,
  ...overrides
});

async function rendered(overrides: Record<string, unknown> = {}) {
  vi.mocked(findDeletion).mockResolvedValue(deletion(overrides) as never);
  const res = pageResponse();
  await renderDeletionStatus(request(), res, REQUEST_ID);
  return { res, model: res.render.mock.calls[0][1] };
}

describe("deletion request status page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should read only the request, with the caller's token", async () => {
    await rendered();

    expect(findDeletion).toHaveBeenCalledWith(REQUEST_ID, { accessToken: "session-token" });
  });

  it("should say a pending request inside its grace period is deleted from view and restorable until api's date", async () => {
    const { res, model } = await rendered();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(model.heading).toBe("Application deleted from view");
    expect(model.paragraphs[0]).toMatch(/^The application has been deleted from view\. A Delivery Manager can restore it until .+ at .+\.$/);
    expect(model.restoreHref).toBe(`/deed-polls/deletions/${REQUEST_ID}/restore?case=case-1`);
    expect(model.rows.map((row: { key: string }) => row.key)).toEqual(["Reason", "Requested", "Can be restored until"]);
    expect(model.rows[0].value).toBe("Created in error");
  });

  it("should not offer restore, name a date or claim removal is under way for a pending request past its date", async () => {
    const { model } = await rendered({ restorableUntil: EARLIER });

    expect(model.heading).toBe("Application waiting to be permanently removed");
    expect(model.paragraphs).toEqual(["The application can no longer be restored. It will be permanently removed with its records and documents."]);
    expect(model.restoreHref).toBeNull();
  });

  it.each([
    ["InProgress", "Permanent removal in progress", "in progress"],
    ["AwaitingDisposal", "Application waiting to be removed from the case platform", "overnight run"],
    ["NeedsAttention", "Deletion has not completed", "needs investigation"]
  ])("should describe %s without calling it deleted", async (status, heading, sentence) => {
    const { model } = await rendered({ status });

    expect(model.heading).toBe(heading);
    expect(model.heading).not.toBe("Application deleted");
    expect(model.paragraphs.join(" ")).toContain(sentence);
    expect(model.restoreHref).toBeNull();
  });

  it("should add a sentence for an unpurged removed document and nothing for other failures", async () => {
    const unpurged = await rendered({ status: "NeedsAttention", failure: "CDAM_REMOVED_DOCUMENT_UNPURGED" });
    const other = await rendered({ status: "NeedsAttention", failure: "CLEANUP_STEP_FAILED" });

    expect(unpurged.model.paragraphs[1]).toContain("document store team to purge");
    expect(other.model.paragraphs).toHaveLength(1);
  });

  it("should call only Completed deleted, with its reason and completion time", async () => {
    const { model } = await rendered({ status: "Completed", reason: "DUPLICATE", completedAt: new Date("2026-12-05T02:00:00Z") });

    expect(model.heading).toBe("Application deleted");
    expect(model.rows).toEqual([
      { key: "Reason", value: "Duplicate application" },
      { key: "Requested", value: "20 November 2026 at 10:00am" },
      { key: "Deleted", value: "5 December 2026 at 2:00am" }
    ]);
  });

  it("should say progress could not be checked when the read fails, without changing what it says about the request", async () => {
    vi.mocked(findDeletion).mockRejectedValue(new Error("deed-poll-api call failed (timeout)"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = pageResponse();

    await renderDeletionStatus(request(), res, REQUEST_ID);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.render.mock.calls[0][1]).toMatchObject({ progress: "unavailable", statusPath: `/deed-polls/deletions/${REQUEST_ID}` });
  });

  it.each([new NotFoundError("Deletion request not found"), new ForbiddenError("refused"), new TooManyRequestsError("rate limited", 30)])(
    "should leave %s to the existing flow",
    async (error) => {
      vi.mocked(findDeletion).mockRejectedValue(error);

      await expect(renderDeletionStatus(request(), pageResponse(), REQUEST_ID)).rejects.toBe(error);
    }
  );

  it("should refuse a dot-segment request id before reading", async () => {
    await expect(renderDeletionStatus(request(), pageResponse(), "..")).rejects.toBeInstanceOf(NotFoundError);
    expect(findDeletion).not.toHaveBeenCalled();
  });
});
