import { ConflictError, findDeedPoll, findReferral, InvalidInputError, NotFoundError, recordConfirmation, updateDeedPoll } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../express-doubles.js";
import { GET, POST } from "./confirmation.js";

// `buildReferralDetail` and `recordConfirmationSchema` run for real: `confirmation.awaiting` is the rule this
// page's guard is made of and the schema's messages are what its error summary shows, so stubbing either would
// leave the test asserting against values it chose itself.
// `updateDeedPoll` is stubbed although this page must never call it: unstubbed it would be the real function, so
// "no case write" could only be asserted as an absence of a *different* call and a regression would reach api.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findReferral: vi.fn(),
  recordConfirmation: vi.fn(),
  updateDeedPoll: vi.fn()
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
  changesToStandardPublication: false,
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
      // Decision 8: api moves neither, and this page must not invent a second write that does. Asserted against
      // the case writer by name rather than by counting the recording — `recordConfirmation` having been called
      // once says nothing about a second call to something else.
      await POST(request({ outcome: "Withdrawn" }), response());

      expect(recordConfirmation).toHaveBeenCalledTimes(1);
      expect(updateDeedPoll).not.toHaveBeenCalled();
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

    it("should stand in its own words for an api rejection that names no field at all", async () => {
      // The other half of the same branch, and the likelier one on this form: api's published validation for the
      // request constrains only the two controls the schema has already checked, so a 400 that reaches here has
      // usually named nothing. The log says so rather than printing an empty list of fields.
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.mocked(recordConfirmation).mockRejectedValue(new InvalidInputError("Confirmation cannot be recorded", []));
      const res = response();

      await POST(request({ outcome: "Confirmed" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors).toEqual({});
      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "The response could not be recorded. Check your answer and try again." }]);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("no field named"));
      logged.mockRestore();
    });
  });

  /**
   * What may reach a log line, asserted rather than left to the reader of the one `console.error` this page has —
   * Task 5 of `notify-3b`.
   *
   * The handler holds four things a log must not carry, and each of them is here for a different reason: the
   * access token is a credential (`.claude/rules/backend.md`), the note is a transcription of an applicant's own
   * reply and is the nearest thing in this service to inbound email content, the applicant's name and address are
   * on the case the form read for its caption, and a `confirmationRecordedBy` a crafted post carried is an
   * identity api never verified — logging it would put an unverified name in the record beside real ones.
   *
   * Asserted on the joined calls rather than per call, so a second log line added later cannot satisfy the test
   * by moving the value into a different argument.
   */
  describe("what a refusal may log", () => {
    /** A case carrying the applicant's details, which the ordinary fixture has no need of. */
    const withApplicant = { ...found, newSurname: "Okonkwo", applicantEmail: "applicant@example.com", applicantAddress1: "4 Bridge Lane" };

    it("should log the rejection and none of the token, the applicant's reply, their details or a recorder the form never asked for", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.mocked(findDeedPoll).mockResolvedValue(withApplicant as never);
      vi.mocked(recordConfirmation).mockRejectedValue(new InvalidInputError("Validation failed", [{ field: "referralState", message: "not acceptable" }]));

      await POST(
        request({
          outcome: "Confirmed",
          note: "Applicant telephoned on 22 May and said they still want to proceed.",
          confirmationRecordedBy: "Somebody Else"
        }),
        response()
      );

      const line = logged.mock.calls.flat().join(" ");
      expect(line).toContain("referralState");
      expect(line).not.toContain("session-token");
      expect(line).not.toContain("telephoned");
      expect(line).not.toContain("Okonkwo");
      expect(line).not.toContain("applicant@example.com");
      expect(line).not.toContain("4 Bridge Lane");
      expect(line).not.toContain("Somebody Else");
      logged.mockRestore();
    });

    it("should log nothing at all when the answer is recorded, refused as a race, or rejected against a control", async () => {
      // The only line this page writes is for a rejection it cannot place, so every ordinary outcome — including
      // both of api's 409s — must be silent. A log per recording would put every transcribed reply in the logs.
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.mocked(findDeedPoll).mockResolvedValue(withApplicant as never);
      const note = "Applicant wrote back on 22 May.";

      await POST(request({ outcome: "Confirmed", note }), response());
      vi.mocked(recordConfirmation).mockRejectedValue(new ConflictError("Referral ref-1 already has a confirmation outcome of Confirmed"));
      await POST(request({ outcome: "Withdrawn", note }), response());
      vi.mocked(recordConfirmation).mockRejectedValue(new InvalidInputError("Validation failed", [{ field: "note", message: "The note is too long" }]));
      await POST(request({ outcome: "Withdrawn", note }), response());
      await POST(request({ note }), response());

      expect(logged).not.toHaveBeenCalled();
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

  // `../../../../../case-path.test.ts` holds the full payload matrix; this pins every branch that redirects, including
  // the guard a re-render reaches when the fresh referral no longer needs an answer — the path Fortify reported.
  describe("a case id carrying URL delimiters", () => {
    const RAW = { id: "a/b?c#d", referralId: "ref/1" };
    const ENCODED_PATH = "/deed-polls/a%2Fb%3Fc%23d/referrals/ref%2F1";

    function delimited(body: Record<string, unknown> = {}, params: Record<string, string> = RAW) {
      return pageRequest({ params, body, accessToken: "session-token" });
    }

    it("should offer encoded hrefs on the form, encoding the referral id exactly once", async () => {
      const res = response();

      await GET(delimited(), res);

      expect(res.render.mock.calls[0][1].confirmationHref).toBe(`${ENCODED_PATH}/confirmation`);
      expect(res.render.mock.calls[0][1].referralHref).toBe(ENCODED_PATH);
    });

    it("should keep the id as one segment when the form's guard sends the caseworker back", async () => {
      vi.mocked(findReferral).mockResolvedValue(RECORDED as never);
      const res = response();

      await GET(delimited(), res);

      expect(findReferral).toHaveBeenCalledWith(RAW.id, RAW.referralId, CALLER);
      expect(res.redirect).toHaveBeenCalledWith(ENCODED_PATH);
    });

    it("should record under the raw ids and redirect to the encoded referral", async () => {
      const res = response();

      await POST(delimited({ outcome: "Confirmed" }), res);

      expect(recordConfirmation).toHaveBeenCalledWith(RAW.id, RAW.referralId, { outcome: "Confirmed" }, CALLER);
      expect(res.redirect).toHaveBeenCalledWith(`${ENCODED_PATH}?confirmation=recorded`);
    });

    it("should redirect a conflict to the encoded referral", async () => {
      vi.mocked(recordConfirmation).mockRejectedValue(new ConflictError("already has a confirmation outcome"));
      const res = response();

      await POST(delimited({ outcome: "Confirmed" }), res);

      expect(res.redirect).toHaveBeenCalledWith(`${ENCODED_PATH}?confirmation=conflict`);
    });

    it("should keep the id as one segment when an invalid body's re-render finds the referral answered", async () => {
      vi.mocked(findReferral).mockResolvedValue(RECORDED as never);
      const res = response();

      await POST(delimited({}), res);

      expect(recordConfirmation).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(ENCODED_PATH);
      expect(res.render).not.toHaveBeenCalled();
    });

    it("should keep the id as one segment when api's rejection's re-render finds the referral answered", async () => {
      vi.mocked(recordConfirmation).mockRejectedValue(new InvalidInputError("Validation failed", [{ field: "note", message: "The note is too long" }]));
      vi.mocked(findReferral).mockResolvedValue(RECORDED as never);
      const res = response();

      await POST(delimited({ outcome: "Confirmed" }), res);

      expect(res.redirect).toHaveBeenCalledWith(ENCODED_PATH);
      expect(res.render).not.toHaveBeenCalled();
    });

    it.each(["", ".", ".."])("should 404 the form under case %j without reading or redirecting", async (id) => {
      const res = response();

      await expect(GET(delimited({}, { id, referralId: "ref-1" }), res)).rejects.toThrow(NotFoundError);

      expect(findReferral).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it.each(["", ".", ".."])("should 404 a recording under case %j before anything is written", async (id) => {
      const res = response();

      await expect(POST(delimited({ outcome: "Confirmed" }, { id, referralId: "ref-1" }), res)).rejects.toThrow(NotFoundError);

      expect(recordConfirmation).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it.each(["", ".", ".."])("should 404 a recording for referral %j before anything is read or written", async (referralId) => {
      const res = response();

      await expect(POST(delimited({ outcome: "Confirmed" }, { id: "case-1", referralId }), res)).rejects.toThrow(NotFoundError);
      await expect(GET(delimited({}, { id: "case-1", referralId }), response())).rejects.toThrow(NotFoundError);

      expect(recordConfirmation).not.toHaveBeenCalled();
      expect(findDeedPoll).not.toHaveBeenCalled();
      expect(findReferral).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });
});
