import { assignReferral, ConflictError, findReferral, findReferralQueue, InvalidInputError, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET, POST } from "./reassign.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  assignReferral: vi.fn(),
  findReferral: vi.fn(),
  findReferralQueue: vi.fn()
}));

const CALLER = { accessToken: "team-leader-token" };
const MASTERS = [
  { id: "master-1", name: "Master Sullivan", sentInWindow: 0 },
  { id: "master-2", name: "Master Judge", sentInWindow: 0 }
];
const CLAIMED = {
  id: "referral-2",
  state: "Claimed",
  reasons: ["Other"],
  assignedMaster: { id: "master-1", name: "Master Sullivan" },
  assignedAt: new Date("2026-10-29T08:00:00Z"),
  directionDueBy: new Date("2026-11-05T08:00:00Z")
};

function request(body?: Record<string, unknown>, query: Record<string, unknown> = { case: "case-2" }) {
  return pageRequest({ teamLeader: true, accessToken: "team-leader-token", params: { referralId: "referral-2" }, query, body });
}

describe("reassign a referral", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findReferral).mockResolvedValue(CLAIMED as never);
    vi.mocked(findReferralQueue).mockResolvedValue({
      referrals: [],
      page: 1,
      size: 25,
      total: 0,
      totalPages: 0,
      window: { cap: 10, sent: 0, masters: MASTERS }
    } as never);
  });

  describe("GET", () => {
    it("should read the referral under its case and offer the available Masters, the current one selected", async () => {
      const res = pageResponse();

      await GET(request(), res);

      expect(findReferral).toHaveBeenCalledWith("case-2", "referral-2", CALLER);
      const [view, model] = res.render.mock.calls[0];
      expect(view).toBe("deed-polls/referrals/[referralId]/reassign");
      expect(model.masterItems).toEqual([
        { value: "master-1", text: "Master Sullivan", checked: true },
        { value: "master-2", text: "Master Judge", checked: false }
      ]);
      expect(model.action).toBe("/deed-polls/referrals/referral-2/reassign?case=case-2");
      expect(model.checkHref).toBe("/deed-polls/referrals/referral-2?case=case-2");
    });

    it("should say who has it and since when, read off api's dates", async () => {
      const res = pageResponse();

      await GET(request(), res);

      const model = res.render.mock.calls[0][1];
      expect(model.currentlyWith).toMatch(/^This referral is with Master Sullivan\. It was sent to them on /);
    });

    it("should send a referral no longer with a Master back to the queue with the conflict sentence", async () => {
      vi.mocked(findReferral).mockResolvedValue({ ...CLAIMED, state: "Decided" } as never);
      const res = pageResponse();

      await GET(request(), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/referrals?reassign=conflict#with-a-master");
      expect(res.render).not.toHaveBeenCalled();
    });

    it.each([[{}], [{ case: ["a", "b"] }]])("should be a 404 before any read without one case (%o)", async (query) => {
      await expect(GET(request(undefined, query), pageResponse())).rejects.toBeInstanceOf(NotFoundError);
      expect(findReferral).not.toHaveBeenCalled();
    });
  });

  describe("POST", () => {
    it("should reassign to the chosen Master and redirect to With a Master with a banner", async () => {
      vi.mocked(assignReferral).mockResolvedValue({} as never);
      const res = pageResponse();

      await POST(request({ masterId: "master-2" }), res);

      expect(assignReferral).toHaveBeenCalledWith("case-2", "referral-2", "master-2", CALLER);
      expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/referrals?reassigned=1#with-a-master");
    });

    it("should read the Master it already has, api's no-op, as the same success", async () => {
      vi.mocked(assignReferral).mockResolvedValue(CLAIMED as never);
      const res = pageResponse();

      await POST(request({ masterId: "master-1" }), res);

      expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/referrals?reassigned=1#with-a-master");
    });

    it("should refuse no Master chosen beside the radios, without a write", async () => {
      const res = pageResponse();

      await POST(request({}), res);

      expect(assignReferral).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1]).toMatchObject({
        errors: { masterId: "Select a Master" },
        errorList: [{ text: "Select a Master", href: "#masterId" }]
      });
    });

    it.each([
      ["an Open referral", "Send this referral from the queue: it has not been sent to a Master yet."],
      ["a referral no longer waiting for a direction", "This referral is not waiting for a direction."]
    ])("should redirect %s's 409 to the queue with the state sentence", async (_name, message) => {
      vi.mocked(assignReferral).mockRejectedValue(new ConflictError(message));
      const res = pageResponse();

      await POST(request({ masterId: "master-2" }), res);

      expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/referrals?reassign=conflict#with-a-master");
    });

    it("should redraw an unavailable Master beside the radios in api's words, keeping the choice", async () => {
      vi.mocked(assignReferral).mockRejectedValue(
        new InvalidInputError("Select a Master who is available", [{ field: "masterId", message: "Select a Master who is available" }])
      );
      const res = pageResponse();

      await POST(request({ masterId: "master-2" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      const model = res.render.mock.calls[0][1];
      expect(model.errors).toEqual({ masterId: "Select a Master who is available" });
      expect(model.masterItems.find((item: { checked: boolean }) => item.checked).value).toBe("master-2");
    });

    it("should redraw with its own sentence, and log api's, for a 400 it cannot place", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(assignReferral).mockRejectedValue(new InvalidInputError("body: bad\nforged", []));
      const res = pageResponse();

      await POST(request({ masterId: "master-2" }), res);

      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "The referral could not be reassigned. Try again." }]);
      expect(log.mock.calls[0][0]).not.toMatch(/[\r\n]/);
      log.mockRestore();
    });

    it("should refuse an unusable referral id before any write", async () => {
      const res = pageResponse();

      await expect(
        POST(pageRequest({ teamLeader: true, params: { referralId: ".." }, query: { case: "case-2" }, body: { masterId: "master-2" } }), res)
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(assignReferral).not.toHaveBeenCalled();
    });
  });
});
