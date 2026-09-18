import { ConflictError, createReferral, findDeedPoll, findReferrals, InvalidInputError, NotFoundError } from "@hmcts/deed-poll";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET, POST } from "./new.js";

// `createReferralSchema` and the label maps are the domain's, so they run for real here: the two conditional
// requirements are as much the behaviour under test as the handler is, and the checkbox list is built from
// api's published member array rather than from anything this test states.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findReferrals: vi.fn(),
  createReferral: vi.fn()
}));

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

const PARAMS = { id: "case-1" };

/** The session's access token, which is the whole of what this page passes to the domain. */
const CALLER = { accessToken: "session-token" };

const COMPLETE = { reasons: ["Minor"], urgency: "Normal" };

/** An open referral as api publishes one, for the conflict path's link. */
const OPEN_REFERRAL = {
  id: "ref-9",
  state: "Open",
  reasons: ["Minor"],
  notes: null,
  urgency: "Normal",
  urgencyReason: null,
  migrated: false,
  createdBy: "A Caseworker",
  createdOn: new Date("2026-05-13T08:44:00Z"),
  modifiedBy: "A Caseworker",
  modifiedOn: new Date("2026-05-13T08:44:00Z")
};

function request(body: Record<string, unknown> = {}): Request {
  return pageRequest({ params: PARAMS, body, accessToken: "session-token" });
}

const response = pageResponse;

describe("raise a referral page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(createReferral).mockResolvedValue({ id: "ref-1" } as never);
    vi.mocked(findReferrals).mockResolvedValue([OPEN_REFERRAL] as never);
  });

  describe("GET", () => {
    it("should render an empty form against the case in the path", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][0]).toBe("deed-polls/referral-form");
      expect(res.render.mock.calls[0][1].values).toEqual({});
      expect(res.render.mock.calls[0][1].case.displayReference).toBe("KBDP2026-00001");
    });

    it("should offer api's six reasons with none ticked, so no reason is chosen for the caseworker", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].reasonItems.map((item: { value: string }) => item.value)).toEqual([
        "Minor",
        "DomesticAbuse",
        "NonPublication",
        "DeclarantRequirementsNotMet",
        "SeparatedOrEstranged",
        "Other"
      ]);
      expect(res.render.mock.calls[0][1].reasonItems.every((item: { checked: boolean }) => item.checked === false)).toBe(true);
    });

    it("should label the reasons in the business's words while keeping api's members as the values", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].reasonItems[0]).toEqual({ value: "Minor", text: "Applicant is a minor", checked: false });
    });

    it("should offer the two urgency radios unselected, calling api's Normal Standard", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].urgencyItems).toEqual([
        { value: "Normal", text: "Standard", checked: false },
        { value: "Urgent", text: "Urgent", checked: false }
      ]);
    });

    it("should render no errors and no conflict before anything is submitted", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].errors).toEqual({});
      expect(res.render.mock.calls[0][1].errorList).toEqual([]);
      expect(res.render.mock.calls[0][1].conflictHref).toBeUndefined();
    });

    it("should 404 for a missing case rather than rendering a form against nothing", async () => {
      vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));

      await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
    });
  });

  describe("POST", () => {
    it("should raise the referral and redirect to the case's referrals tab", async () => {
      const res = response();

      await POST(request(COMPLETE), res);

      expect(createReferral).toHaveBeenCalledWith("case-1", { reasons: ["Minor"], notes: undefined, urgency: "Normal", urgencyReason: undefined }, CALLER);
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#referrals");
    });

    it("should send the session's token and nothing else, because api stamps the author from it", async () => {
      await POST(pageRequest({ params: PARAMS, body: COMPLETE, name: "A Caseworker", accessToken: "session-token" }), response());

      expect(createReferral).toHaveBeenCalledWith("case-1", expect.anything(), CALLER);
    });

    it("should send several reasons when several boxes are ticked", async () => {
      await POST(request({ reasons: ["Minor", "DomesticAbuse"], urgency: "Normal" }), response());

      expect(createReferral).toHaveBeenCalledWith("case-1", expect.objectContaining({ reasons: ["Minor", "DomesticAbuse"] }), CALLER);
    });

    it("should accept the bare string a single ticked box posts as one reason", async () => {
      // A checkbox group posts a string when exactly one box is ticked, so a handler expecting an array would
      // reject the commonest submission there is.
      await POST(request({ reasons: "Minor", urgency: "Normal" }), response());

      expect(createReferral).toHaveBeenCalledWith("case-1", expect.objectContaining({ reasons: ["Minor"] }), CALLER);
    });

    it("should re-render with the error against the group when no reason was chosen", async () => {
      const res = response();

      await POST(request({ urgency: "Normal" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createReferral).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].errors.reasons).toBe("Select at least one reason for referring this case");
      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "Select at least one reason for referring this case", href: "#reasons" }]);
    });

    it("should require the notes when Other is among the reasons", async () => {
      const res = response();

      await POST(request({ reasons: ["Other"], urgency: "Normal" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createReferral).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].errors.notes).toBe("Enter the other reason for referring this case");
      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "Enter the other reason for referring this case", href: "#notes" }]);
    });

    it("should refuse whitespace as the other reason rather than counting it as an explanation", async () => {
      const res = response();

      await POST(request({ reasons: ["Other"], notes: "   ", urgency: "Normal" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.notes).toBe("Enter the other reason for referring this case");
    });

    it("should accept Other with notes, sending api's member and not the label", async () => {
      await POST(request({ reasons: ["Other"], notes: "The declarant is abroad.", urgency: "Normal" }), response());

      expect(createReferral).toHaveBeenCalledWith(
        "case-1",
        { reasons: ["Other"], notes: "The declarant is abroad.", urgency: "Normal", urgencyReason: undefined },
        CALLER
      );
    });

    it("should not send a reason for urgency left behind in a closed reveal after Standard was chosen", async () => {
      // The conditional reveal only hides its textarea, so the browser still posts it: a caseworker who typed
      // a reason, then changed their mind, would otherwise store "Standard" alongside "because of the hearing"
      // with no edit page to correct it.
      await POST(request({ reasons: ["Minor"], urgency: "Normal", urgencyReason: "Hearing on Friday." }), response());

      expect(createReferral).toHaveBeenCalledWith("case-1", { reasons: ["Minor"], notes: undefined, urgency: "Normal", urgencyReason: undefined }, CALLER);
    });

    it("should not send notes left behind in a closed reveal after Other was unticked", async () => {
      await POST(request({ reasons: ["Minor"], notes: "Typed while Other was ticked.", urgency: "Normal" }), response());

      expect(createReferral).toHaveBeenCalledWith("case-1", { reasons: ["Minor"], notes: undefined, urgency: "Normal", urgencyReason: undefined }, CALLER);
    });

    it("should keep a value it did not send on screen, so re-ticking its box does not mean typing it again", async () => {
      const res = response();

      await POST(request({ urgency: "Normal", urgencyReason: "Hearing on Friday.", notes: "Typed while Other was ticked." }), res);

      // Dropped from the body because neither reveal was open, and still in the model the form re-renders
      // from: not sending it and forgetting it are different things.
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].values.urgencyReason).toBe("Hearing on Friday.");
      expect(res.render.mock.calls[0][1].values.notes).toBe("Typed while Other was ticked.");
    });

    it("should not validate the length of a value it is not going to send", async () => {
      // Over-long notes with Other unticked: the message would render inside a closed reveal and its summary
      // link would focus an invisible field, so there is nothing for a caseworker to act on. The value is not
      // an answer, so it is dropped rather than measured.
      await POST(request({ reasons: ["Minor"], urgency: "Normal", notes: "x".repeat(1001) }), response());

      expect(createReferral).toHaveBeenCalledWith("case-1", expect.objectContaining({ notes: undefined }), CALLER);
    });

    it("should re-render with the error against urgency when the question was left unanswered", async () => {
      const res = response();

      await POST(request({ reasons: ["Minor"] }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.urgency).toBe("Select how urgent this referral is");
    });

    it("should show both the unanswered urgency and the missing other reason in one re-render", async () => {
      const res = response();

      await POST(request({ reasons: ["Other"] }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createReferral).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].errorList).toEqual([
        { text: "Enter the other reason for referring this case", href: "#notes" },
        { text: "Select how urgent this referral is", href: "#urgency" }
      ]);
    });

    it("should require a reason for urgency when Urgent is chosen", async () => {
      const res = response();

      await POST(request({ reasons: ["Minor"], urgency: "Urgent" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createReferral).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].errors.urgencyReason).toBe("Enter why this referral is urgent");
      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "Enter why this referral is urgent", href: "#urgencyReason" }]);
    });

    it("should accept Urgent with its reason", async () => {
      await POST(request({ reasons: ["Minor"], urgency: "Urgent", urgencyReason: "Hearing on Friday." }), response());

      expect(createReferral).toHaveBeenCalledWith(
        "case-1",
        { reasons: ["Minor"], notes: undefined, urgency: "Urgent", urgencyReason: "Hearing on Friday." },
        CALLER
      );
    });

    it("should keep over-long notes on screen instead of discarding them", async () => {
      const tooLong = "x".repeat(1001);
      const res = response();

      await POST(request({ reasons: ["Other"], notes: tooLong, urgency: "Normal" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createReferral).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].values.notes).toBe(tooLong);
      expect(res.render.mock.calls[0][1].errors.notes).toBe("Notes must be 1000 characters or fewer");
    });

    it("should keep the ticked boxes and the chosen urgency on screen when something else fails", async () => {
      const res = response();

      await POST(request({ reasons: ["Minor", "Other"], urgency: "Urgent", urgencyReason: "" }), res);

      const model = res.render.mock.calls[0][1];
      expect(model.reasonItems.filter((item: { checked: boolean }) => item.checked).map((item: { value: string }) => item.value)).toEqual(["Minor", "Other"]);
      expect(model.urgencyItems.find((item: { value: string }) => item.value === "Urgent").checked).toBe(true);
    });

    it("should list every failing control in the error summary, in the order they appear on the page", async () => {
      const res = response();

      await POST(request({ reasons: ["Other"], urgency: "Urgent" }), res);

      expect(res.render.mock.calls[0][1].errorList.map((row: { href: string }) => row.href)).toEqual(["#notes", "#urgencyReason"]);
    });

    it("should render the already-open 409 as a page message linking to the open referral, not as an error page", async () => {
      vi.mocked(createReferral).mockRejectedValue(new ConflictError("Case case-1 already has an open referral"));
      const res = response();

      await POST(request(COMPLETE), res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.render.mock.calls[0][0]).toBe("deed-polls/referral-form");
      expect(res.render.mock.calls[0][1].conflictHref).toBe("/deed-polls/case-1/referrals/ref-9");
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it("should link to the referrals tab when the open referral has gone between the refusal and the read", async () => {
      vi.mocked(createReferral).mockRejectedValue(new ConflictError("Case case-1 already has an open referral"));
      vi.mocked(findReferrals).mockResolvedValue([{ ...OPEN_REFERRAL, state: "Withdrawn" }] as never);
      const res = response();

      await POST(request(COMPLETE), res);

      expect(res.render.mock.calls[0][1].conflictHref).toBe("/deed-polls/case-1#referrals");
    });

    it("should still render the 409 when the read that resolves the link fails, rather than losing the form to a 500", async () => {
      vi.mocked(createReferral).mockRejectedValue(new ConflictError("Case case-1 already has an open referral"));
      vi.mocked(findReferrals).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
      const res = response();

      await POST(request({ reasons: ["Minor"], urgency: "Urgent", urgencyReason: "Hearing on Friday." }), res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.render.mock.calls[0][1].conflictHref).toBe("/deed-polls/case-1#referrals");
      expect(res.render.mock.calls[0][1].values.urgencyReason).toBe("Hearing on Friday.");
    });

    it("should keep what was chosen on screen when the case already has an open referral", async () => {
      vi.mocked(createReferral).mockRejectedValue(new ConflictError("Case case-1 already has an open referral"));
      const res = response();

      await POST(request({ reasons: ["Minor"], urgency: "Urgent", urgencyReason: "Hearing on Friday." }), res);

      expect(res.render.mock.calls[0][1].values.urgencyReason).toBe("Hearing on Friday.");
    });

    it("should keep the typed details on screen when api rejects them for a rule this form does not mirror", async () => {
      vi.mocked(createReferral).mockRejectedValue(
        new InvalidInputError("Request body is not valid", [{ field: "reasons", message: "Minor cannot be combined with NonPublication" }])
      );
      const res = response();

      await POST(request(COMPLETE), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.reasons).toBe("Minor cannot be combined with NonPublication");
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it("should show its own copy when api names a field this form has no control for", async () => {
      // Spring addresses a collection member as `reasons[0]`, and nothing on this page is keyed that way, so
      // the message would be dropped from both the summary and the controls — a 400 with an untouched form and
      // no explanation on it, which a caseworker cannot act on and resubmitting cannot clear.
      vi.mocked(createReferral).mockRejectedValue(
        new InvalidInputError("Request body is not valid", [{ field: "reasons[0]", message: "Minor is not accepted on a migrated case" }])
      );
      const res = response();

      await POST(request(COMPLETE), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorList[0].text).toBe("The referral could not be raised. Check the details and try again.");
    });

    it("should show the page's own copy, not api's wording, when its rejection names no field", async () => {
      vi.mocked(createReferral).mockRejectedValue(new InvalidInputError("deed-poll-api answered 400"));
      const res = response();

      await POST(request(COMPLETE), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorList[0].text).toBe("The referral could not be raised. Check the details and try again.");
      expect(res.render.mock.calls[0][1].errorList[0].text).not.toContain("deed-poll-api");
    });

    it("should let an unreachable api reach the error handler rather than blaming the caseworker for it", async () => {
      vi.mocked(createReferral).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): deed-poll-api could not be reached"));

      await expect(POST(request(COMPLETE), response())).rejects.toThrow(/unavailable/);
    });
  });
});
