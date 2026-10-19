import { ConflictError, getReferral, NotFoundError, withdrawOwnDirection } from "@hmcts/deed-poll";
import type { JudicialReferralDetail } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET, POST } from "./withdraw.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  getReferral: vi.fn(),
  withdrawOwnDirection: vi.fn()
}));

const CALLER = { accessToken: "judge-token" };

/** A referral this judge has directed — api shows a Decided referral to nobody else. */
const decided = (overrides: Partial<JudicialReferralDetail> = {}): JudicialReferralDetail =>
  ({
    id: "ref-1",
    state: "Decided",
    reasons: ["Minor"],
    notes: null,
    urgency: "Normal",
    urgencyReason: null,
    createdOn: new Date("2026-09-03T08:44:00Z"),
    claimedBy: "a-judge",
    claimedAt: new Date("2026-09-04T09:00:00Z"),
    decision: "Approved",
    directionsText: "Grant the application.",
    publishToGazette: true,
    decisionDate: new Date("2026-09-05T16:05:00Z"),
    decidedBy: "a-judge",
    application: { displayReference: "KBDP2026-00001", type: "Adult", witnesses: [], documents: [] },
    caseNotes: [],
    ...overrides
  }) as JudicialReferralDetail;

function request(referralId = "ref-1") {
  return pageRequest({ params: { referralId }, judicial: true, accessToken: "judge-token" });
}

describe("withdrawing a judicial direction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReferral).mockResolvedValue(decided() as never);
    vi.mocked(withdrawOwnDirection).mockResolvedValue(decided({ state: "Claimed", decision: null }) as never);
  });

  describe("the confirmation", () => {
    it("should ask the judge to confirm, captioned with the application and saying what withdrawing leaves", async () => {
      const res = pageResponse();

      await GET(request(), res);

      expect(getReferral).toHaveBeenCalledWith("ref-1", CALLER);
      expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/direction-withdraw");
      expect(res.render.mock.calls[0][1]).toMatchObject({
        reference: "KBDP2026-00001",
        withdrawHref: "/judicial/referrals/ref-1/withdraw",
        referralHref: "/judicial/referrals/ref-1"
      });
      expect(res.render.mock.calls[0][1].en.body).toBe(
        "You'll need to give a new direction. Until you do, this referral stays claimed by you. If it isn't directed, it may return to the shared list like any other claim."
      );
      expect(res.render.mock.calls[0][1].en.withdraw).toBe("Withdraw direction");
    });

    it("should write nothing by being shown", async () => {
      await GET(request(), pageResponse());

      expect(withdrawOwnDirection).not.toHaveBeenCalled();
    });

    it("should send the judge back to the referral when there is no direction of theirs to withdraw", async () => {
      vi.mocked(getReferral).mockResolvedValue(decided({ state: "Claimed", decision: null }) as never);
      const res = pageResponse();

      await GET(request(), res);

      expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/ref-1?direction=notchangeable");
      expect(res.render).not.toHaveBeenCalled();
    });

    it("should render 'no longer available' with a 404 once the referral is out of sight", async () => {
      vi.mocked(getReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));
      const res = pageResponse();

      await GET(request(), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/unavailable");
    });

    it("should let a failure that is not a 404 reach the error handler", async () => {
      vi.mocked(getReferral).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

      await expect(GET(request(), pageResponse())).rejects.toThrow("unavailable");
    });

    it("should escape the referral id in the paths it renders", async () => {
      const res = pageResponse();

      await GET(request("ref 1/x"), res);

      expect(res.render.mock.calls[0][1]).toMatchObject({
        withdrawHref: "/judicial/referrals/ref%201%2Fx/withdraw",
        referralHref: "/judicial/referrals/ref%201%2Fx"
      });
    });
  });

  describe("the withdrawal", () => {
    it("should withdraw by referral id with the judge's token alone, reading nothing first", async () => {
      await POST(request(), pageResponse());

      expect(withdrawOwnDirection).toHaveBeenCalledWith("ref-1", CALLER);
      expect(getReferral).not.toHaveBeenCalled();
    });

    // The referral is Claimed by this judge again, so it shows the direction form as any claimed referral does.
    it("should return the judge to the referral, saying the direction was withdrawn", async () => {
      const res = pageResponse();

      await POST(request(), res);

      expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/ref-1?direction=withdrawn");
    });

    // Decision 7: a 409 re-reads the referral and renders its current state, naming no one.
    it("should send the judge to the referral's current state when api 409s the withdrawal", async () => {
      vi.mocked(withdrawOwnDirection).mockRejectedValue(new ConflictError("Referral ref-1 is not Decided"));
      const res = pageResponse();

      await POST(request(), res);

      expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/ref-1?direction=notchangeable");
    });

    it("should render 'no longer available' when api 404s the withdrawal", async () => {
      vi.mocked(withdrawOwnDirection).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));
      const res = pageResponse();

      await POST(request(), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/unavailable");
    });

    it("should let any other failure reach the error handler", async () => {
      vi.mocked(withdrawOwnDirection).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

      await expect(POST(request(), pageResponse())).rejects.toThrow("unavailable");
    });

    // Built before the write, so refusing an unusable id cannot follow one.
    it("should refuse a dot-only id before withdrawing anything", async () => {
      await expect(POST(request(".."), pageResponse())).rejects.toBeInstanceOf(NotFoundError);

      expect(withdrawOwnDirection).not.toHaveBeenCalled();
    });
  });
});
