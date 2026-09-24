import { ConflictError, findDeedPoll, findReferral, InvalidInputError, NotFoundError, recordConfirmation } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../express-doubles.js";
import { GET, POST } from "./confirmation.js";

// `buildReferralDetail` and `recordConfirmationSchema` run for real: `confirmation.awaiting` is the rule this
// page's guard is made of and the schema's messages are what its error summary shows, so stubbing either would
// leave the test asserting against values it chose itself.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findReferral: vi.fn(),
  recordConfirmation: vi.fn()
}));

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

const PARAMS = { id: "case-1", referralId: "ref-1" };

const CALLER = { accessToken: "session-token" };

/** A referral api has asked the applicant about and holds no answer for — the one state this form is offered in. */
const AWAITING = {
  id: "ref-1",
  state: "Decided",
  reasons: ["Minor"],
  notes: "The applicant turns 16 next month.",
  urgency: "Normal",
  urgencyReason: null,
  migrated: false,
  claimedBy: "A Judge",
  claimedAt: new Date("2026-05-14T09:00:00Z"),
  decision: "Approved",
  directionsText: null,
  publishToGazette: true,
  decisionDate: new Date("2026-05-15T10:30:00Z"),
  decidedBy: "A Judge",
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  createdOn: new Date("2026-05-13T08:44:00Z"),
  modifiedOn: new Date("2026-05-15T10:30:00Z"),
  confirmationRequestedAt: new Date("2026-05-20T08:00:00Z"),
  confirmationOutcome: null,
  confirmationReceivedAt: null,
  confirmationRecordedBy: null
};

/** The same referral once somebody has recorded the answer. */
const RECORDED = {
  ...AWAITING,
  confirmationOutcome: "Confirmed",
  confirmationReceivedAt: new Date("2026-05-22T09:30:00Z"),
  confirmationRecordedBy: "A Caseworker"
};

const REFERRAL_PATH = "/deed-polls/case-1/referrals/ref-1";

function request(body: Record<string, unknown> = {}) {
  return pageRequest({ params: PARAMS, body, accessToken: "session-token" });
}

const response = pageResponse;

describe("record the applicant's response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findReferral).mockResolvedValue(AWAITING as never);
    vi.mocked(recordConfirmation).mockResolvedValue(RECORDED as never);
  });

  describe("the form", () => {
    it("should read the case and the referral scoped to it", async () => {
      await GET(request(), response());

      expect(findDeedPoll).toHaveBeenCalledWith("case-1", CALLER);
      expect(findReferral).toHaveBeenCalledWith("case-1", "ref-1", CALLER);
    });

    it("should show the reference and the date the applicant was asked, so the caseworker knows which request", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][0]).toBe("deed-polls/referral-confirmation");
      expect(res.render.mock.calls[0][1].reference).toBe("KBDP2026-00001");
      expect(res.render.mock.calls[0][1].requestedOn).toBe("20 May 2026 at 9:00am");
    });

    it("should offer api's two published answers, in its order and with nothing pre-selected", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].outcomeItems).toEqual([
        { value: "Confirmed", text: "The applicant wants to proceed", checked: false },
        { value: "Withdrawn", text: "The applicant does not want to proceed", checked: false }
      ]);
    });

    it("should post to itself and offer a way back to the referral", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].confirmationHref).toBe(`${REFERRAL_PATH}/confirmation`);
      expect(res.render.mock.calls[0][1].referralHref).toBe(REFERRAL_PATH);
    });

    it("should send a caseworker back to the referral when an answer is already recorded, rather than offering a form api would refuse", async () => {
      vi.mocked(findReferral).mockResolvedValue(RECORDED as never);
      const res = response();

      await GET(request(), res);

      expect(res.redirect).toHaveBeenCalledWith(REFERRAL_PATH);
      expect(res.render).not.toHaveBeenCalled();
    });

    it("should send a caseworker back to the referral when the applicant was never asked", async () => {
      vi.mocked(findReferral).mockResolvedValue({ ...AWAITING, confirmationRequestedAt: null } as never);
      const res = response();

      await GET(request(), res);

      expect(res.redirect).toHaveBeenCalledWith(REFERRAL_PATH);
      expect(res.render).not.toHaveBeenCalled();
    });

    it("should render no caption rather than an empty one for a case api published no reference for", async () => {
      vi.mocked(findDeedPoll).mockResolvedValue({ ...found, displayReference: null } as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].reference).toBe("");
    });

    it("should 404 for a referral that is not under this case, which is api's answer and not a local check", async () => {
      vi.mocked(findReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));

      await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
    });
  });

  describe("recording the answer", () => {
    it.each(["Confirmed", "Withdrawn"] as const)("should record %s with the note and send the caseworker to the fresh referral", async (outcome) => {
      const res = response();

      await POST(request({ outcome, note: "Replied by email on 22 May." }), res);

      expect(recordConfirmation).toHaveBeenCalledWith("case-1", "ref-1", { outcome, note: "Replied by email on 22 May." }, CALLER);
      expect(res.redirect).toHaveBeenCalledWith(`${REFERRAL_PATH}?confirmation=recorded`);
    });

    it("should record the answer with no note at all, because api requires only the outcome", async () => {
      await POST(request({ outcome: "Confirmed", note: "" }), response());

      expect(recordConfirmation).toHaveBeenCalledWith("case-1", "ref-1", { outcome: "Confirmed", note: undefined }, CALLER);
    });

    it("should send no recorder and no received date, because api derives both from the token and its own clock", async () => {
      await POST(request({ outcome: "Confirmed", confirmationRecordedBy: "Somebody Else", confirmationReceivedAt: "2020-01-01T00:00:00" }), response());

      const sent = vi.mocked(recordConfirmation).mock.calls[0][2];
      expect(Object.keys(sent).sort()).toEqual(["note", "outcome"]);
      expect(sent).not.toHaveProperty("confirmationRecordedBy");
      expect(sent).not.toHaveProperty("confirmationReceivedAt");
    });

    it("should read nothing before recording, so api remains the only authority on the transition", async () => {
      await POST(request({ outcome: "Confirmed" }), response());

      expect(findReferral).not.toHaveBeenCalled();
      expect(findDeedPoll).not.toHaveBeenCalled();
    });

    it("should write no case date or state, because recording the answer is not a case change", async () => {
      // Decision 8: api moves neither, and this page must not invent a second write that does. The service call
      // above is the only thing this handler does.
      await POST(request({ outcome: "Withdrawn" }), response());

      expect(recordConfirmation).toHaveBeenCalledTimes(1);
    });
  });

  describe("validation", () => {
    it("should ask the question again when no answer was ticked, rather than choosing one", async () => {
      const res = response();

      await POST(request({ note: "Replied by post." }), res);

      expect(recordConfirmation).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.outcome).toBe("Select what the applicant said about proceeding");
      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "Select what the applicant said about proceeding", href: "#outcome" }]);
    });

    it("should refuse an answer the form never offered", async () => {
      const res = response();

      await POST(request({ outcome: "Maybe" }), res);

      expect(recordConfirmation).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].errors.outcome).toBe("Select what the applicant said about proceeding");
    });

    it("should refuse a note longer than api's cap here, so a 1,001st character is a message and not a 400", async () => {
      const res = response();

      await POST(request({ outcome: "Confirmed", note: "x".repeat(1001) }), res);

      expect(recordConfirmation).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].errors.note).toBe("The note must be 1000 characters or fewer");
    });

    it("should keep what was ticked and typed on a re-render, rather than emptying the form", async () => {
      const res = response();

      await POST(request({ outcome: "Confirmed", note: "x".repeat(1001) }), res);

      expect(res.render.mock.calls[0][1].values.note).toBe("x".repeat(1001));
      expect(res.render.mock.calls[0][1].outcomeItems).toEqual([
        { value: "Confirmed", text: "The applicant wants to proceed", checked: true },
        { value: "Withdrawn", text: "The applicant does not want to proceed", checked: false }
      ]);
    });

    it("should send a caseworker to the referral rather than re-rendering when the answer was recorded meanwhile", async () => {
      // The re-render re-reads, so the guard applies on that path too: a form whose submit api would now refuse is
      // not worth showing again.
      vi.mocked(findReferral).mockResolvedValue(RECORDED as never);
      const res = response();

      await POST(request({ note: "x".repeat(1001) }), res);

      expect(res.redirect).toHaveBeenCalledWith(REFERRAL_PATH);
      expect(res.render).not.toHaveBeenCalled();
    });

    it("should show api's own rejection against the control it names", async () => {
      vi.mocked(recordConfirmation).mockRejectedValue(new InvalidInputError("Validation failed", [{ field: "note", message: "The note is too long" }]));
      const res = response();

      await POST(request({ outcome: "Confirmed", note: "Replied by post." }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.note).toBe("The note is too long");
    });

    it("should stand in its own words for an api rejection naming no control this form renders, and log it", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.mocked(recordConfirmation).mockRejectedValue(new InvalidInputError("Validation failed", [{ field: "referralState", message: "not acceptable" }]));
      const res = response();

      await POST(request({ outcome: "Confirmed", note: "Replied by post." }), res);

      expect(res.render.mock.calls[0][1].errorList[0]).toEqual({ text: "The response could not be recorded. Check your answer and try again." });
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("referralState"));
      // The caseworker's text is the one field here that could carry an applicant's words, so it stays off the log.
      expect(logged).not.toHaveBeenCalledWith(expect.stringContaining("Replied by post."));
      logged.mockRestore();
    });
  });

  describe("races", () => {
    it("should send a refused recording back to the referral with a conflict marker rather than to an error page", async () => {
      vi.mocked(recordConfirmation).mockRejectedValue(
        new ConflictError("Referral ref-1 already has a confirmation outcome of Confirmed, recorded on 22 May 2026")
      );
      const res = response();

      await POST(request({ outcome: "Withdrawn", note: "Replied by post." }), res);

      expect(res.redirect).toHaveBeenCalledWith(`${REFERRAL_PATH}?confirmation=conflict`);
      expect(res.render).not.toHaveBeenCalled();
    });

    it("should send api's other refusal to the same place, because the two are told apart by the fresh read and not by their prose", async () => {
      vi.mocked(recordConfirmation).mockRejectedValue(
        new ConflictError("Referral ref-1 has not been asked to confirm whether the applicant wants to proceed, so there is no answer to record")
      );
      const res = response();

      await POST(request({ outcome: "Confirmed" }), res);

      expect(res.redirect).toHaveBeenCalledWith(`${REFERRAL_PATH}?confirmation=conflict`);
    });

    it("should not replay the submitted note through the redirect", async () => {
      vi.mocked(recordConfirmation).mockRejectedValue(new ConflictError("already has a confirmation outcome"));
      const res = response();

      await POST(request({ outcome: "Withdrawn", note: "Replied by post." }), res);

      expect(res.redirect.mock.calls[0][0]).not.toContain("Replied");
    });

    it("should 404 for a referral under another case, which is api's answer to the write as well as to the read", async () => {
      vi.mocked(recordConfirmation).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));

      await expect(POST(request({ outcome: "Confirmed" }), response())).rejects.toThrow(NotFoundError);
    });
  });
});
