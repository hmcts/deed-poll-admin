import { ConflictError, closeReferral, findDeedPoll, findReferral, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../express-doubles.js";
import { GET, POST } from "./close.js";

// `buildReferralDetail` runs for real: `canClose` is the rule this page's guard is made of, and stubbing it
// would leave the guard asserting against a boolean the test chose.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findReferral: vi.fn(),
  closeReferral: vi.fn()
}));

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

const PARAMS = { id: "case-1", referralId: "ref-1" };

const CALLER = { accessToken: "session-token" };

const DECIDED = {
  id: "ref-1",
  state: "Decided",
  reasons: ["Minor"],
  notes: "The applicant turns 16 next month.",
  urgency: "Urgent",
  urgencyReason: "Hearing listed on Friday.",
  migrated: false,
  claimedBy: "A Judge",
  claimedAt: new Date("2026-05-14T09:00:00Z"),
  decision: "Approved",
  directionsText: "Serve the notice on the second respondent.",
  publishToGazette: true,
  decisionDate: new Date("2026-05-15T10:30:00Z"),
  decidedBy: "A Judge",
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  createdOn: new Date("2026-05-13T08:44:00Z"),
  modifiedOn: new Date("2026-05-15T10:30:00Z")
};

function request() {
  return pageRequest({ params: PARAMS, body: {}, accessToken: "session-token" });
}

const response = pageResponse;

describe("mark a direction as actioned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findReferral).mockResolvedValue(DECIDED as never);
    vi.mocked(closeReferral).mockResolvedValue({ ...DECIDED, state: "Closed" } as never);
  });

  describe("the confirmation", () => {
    it("should read the case and the referral scoped to it", async () => {
      await GET(request(), response());

      expect(findDeedPoll).toHaveBeenCalledWith("case-1", CALLER);
      expect(findReferral).toHaveBeenCalledWith("case-1", "ref-1", CALLER);
    });

    it("should show the case reference and the referral status being confirmed", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][0]).toBe("deed-polls/referral-close");
      expect(res.render.mock.calls[0][1].case.displayReference).toBe("KBDP2026-00001");
      expect(res.render.mock.calls[0][1].referral.state).toBe("Direction received");
      expect(res.render.mock.calls[0][1].referral.stateMeaning).toBe("Direction received — action needed");
    });

    it("should show the whole direction, so the caseworker confirms against what the judge said", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].referral.direction).toEqual({
        decision: "Approved",
        directionsText: "Serve the notice on the second respondent.",
        publishToGazette: true,
        decidedBy: "A Judge",
        decidedOn: "15 May 2026 at 11:30am"
      });
      expect(res.render.mock.calls[0][1].gazetteAnswer).toBe("Yes");
    });

    it("should state the three things being confirmed, including that the referral leaves the worklist", async () => {
      const res = response();

      await GET(request(), res);

      const content = res.render.mock.calls[0][1].en;
      expect(content.confirmingDirection).toContain("carried out the judicial direction");
      expect(content.confirmingUpdates).toContain("updates the application needs");
      expect(content.confirmingWorklist).toContain("leave the list of returned directions");
    });

    it.each([
      // A direction with no further directions, and one that recorded no Gazette answer — the two nullable fields
      // that must not read as absent and "No" respectively.
      { directionsText: null, publishToGazette: true, directions: "Not provided", gazette: "Yes" },
      { directionsText: "Serve the notice.", publishToGazette: null, directions: "Serve the notice.", gazette: "Not recorded" },
      { directionsText: "Serve the notice.", publishToGazette: false, directions: "Serve the notice.", gazette: "No" }
    ])("should read directions as $directions and the Gazette answer as $gazette", async ({ directionsText, publishToGazette, directions, gazette }) => {
      vi.mocked(findReferral).mockResolvedValue({ ...DECIDED, directionsText, publishToGazette } as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].referral.direction.directionsText).toBe(directions);
      expect(res.render.mock.calls[0][1].gazetteAnswer).toBe(gazette);
    });

    it("should post back to its own path and offer a cancel that goes to the referral", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].closeHref).toBe("/deed-polls/case-1/referrals/ref-1/close");
      expect(res.render.mock.calls[0][1].referralHref).toBe("/deed-polls/case-1/referrals/ref-1");
    });

    it.each(["Closed", "Withdrawn", "Open", "Claimed"] as const)(
      "should refuse to present a closure for a %s referral, sending the caseworker to the referral instead",
      async (state) => {
        vi.mocked(findReferral).mockResolvedValue({ ...DECIDED, state } as never);
        const res = response();

        await GET(request(), res);

        expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1/referrals/ref-1");
        expect(res.render).not.toHaveBeenCalled();
      }
    );

    it("should refuse to present a closure for a state this app cannot read", async () => {
      vi.mocked(findReferral).mockResolvedValue({ ...DECIDED, state: null } as never);
      const res = response();

      await GET(request(), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1/referrals/ref-1");
      expect(res.render).not.toHaveBeenCalled();
    });

    it("should 404 for a referral that is not under this case, which is api's answer and not a local check", async () => {
      vi.mocked(findReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));

      await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
    });

    it("should let an unreachable api reach the error handler rather than confirming against nothing", async () => {
      vi.mocked(findReferral).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): deed-poll-api could not be reached"));

      await expect(GET(request(), response())).rejects.toThrow(/unavailable/);
    });
  });

  describe("the closure", () => {
    it("should close the referral named in the path and redirect to it with the success flag", async () => {
      const res = response();

      await POST(request(), res);

      expect(closeReferral).toHaveBeenCalledWith("case-1", "ref-1", CALLER);
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1/referrals/ref-1?close=actioned");
    });

    it("should send the session's token and nothing else, because api stamps the actor from it", async () => {
      await POST(pageRequest({ params: PARAMS, body: {}, name: "A Caseworker", accessToken: "session-token" }), response());

      expect(closeReferral).toHaveBeenCalledWith("case-1", "ref-1", CALLER);
    });

    it("should send no body and read nothing first, because api owns the transition", async () => {
      await POST(request(), response());

      expect(closeReferral).toHaveBeenCalledTimes(1);
      expect(vi.mocked(closeReferral).mock.calls[0]).toHaveLength(3);
      expect(findReferral).not.toHaveBeenCalled();
      expect(findDeedPoll).not.toHaveBeenCalled();
    });

    it("should close a referral whose state is not re-checked here, letting api refuse a stale page", async () => {
      // The POST has no guard of its own: the confirmation's guard was for the caseworker, and a read here would
      // be stale by the time it acted on the answer. api's 409 is the case below.
      vi.mocked(findReferral).mockResolvedValue({ ...DECIDED, state: "Closed" } as never);

      await POST(request(), response());

      expect(closeReferral).toHaveBeenCalledWith("case-1", "ref-1", CALLER);
    });

    it("should send a refused closure back to the referral with the conflict flag, not to an error page", async () => {
      vi.mocked(closeReferral).mockRejectedValue(new ConflictError("Referral ref-1 is not Decided"));
      const res = response();

      await POST(request(), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1/referrals/ref-1?close=conflict");
    });

    it("should let a 404 reach the error handler rather than claiming the direction was actioned", async () => {
      vi.mocked(closeReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));

      await expect(POST(request(), response())).rejects.toThrow(NotFoundError);
    });

    it("should let an unreachable api reach the error handler", async () => {
      vi.mocked(closeReferral).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): deed-poll-api could not be reached"));

      await expect(POST(request(), response())).rejects.toThrow(/unavailable/);
    });

    it("should escape a referral id in the paths it redirects to", async () => {
      const res = response();

      await POST(pageRequest({ params: { id: "case-1", referralId: "ref/1" }, body: {}, accessToken: "session-token" }), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1/referrals/ref%2F1?close=actioned");
    });
  });
});
