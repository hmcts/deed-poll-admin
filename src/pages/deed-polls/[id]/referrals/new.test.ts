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

const COMPLETE = { reasons: ["DomesticAbuse"], urgency: "Normal" };
const REASONS_REFUSED = "One or more of the reasons you selected could not be accepted. Check the reasons and try again.";

/** An open referral as api publishes one, for the conflict path's link. */
const OPEN_REFERRAL = {
  id: "ref-9",
  state: "Open",
  reasons: ["DomesticAbuse"],
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

      expect(createReferral).toHaveBeenCalledWith(
        "case-1",
        { reasons: ["DomesticAbuse"], notes: undefined, urgency: "Normal", urgencyReason: undefined },
        CALLER
      );
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#referrals");
    });

    it("should send the session's token and nothing else, because api stamps the author from it", async () => {
      await POST(pageRequest({ params: PARAMS, body: COMPLETE, name: "A Caseworker", accessToken: "session-token" }), response());

      expect(createReferral).toHaveBeenCalledWith("case-1", expect.anything(), CALLER);
    });

    it("should send several reasons when several boxes are ticked", async () => {
      await POST(request({ reasons: ["NonPublication", "DomesticAbuse"], urgency: "Normal" }), response());

      expect(createReferral).toHaveBeenCalledWith("case-1", expect.objectContaining({ reasons: ["NonPublication", "DomesticAbuse"] }), CALLER);
    });

    it("should accept the bare string a single ticked box posts as one reason", async () => {
      // A checkbox group posts a string when exactly one box is ticked, so a handler expecting an array would
      // reject the commonest submission there is.
      await POST(request({ reasons: "DomesticAbuse", urgency: "Normal" }), response());

      expect(createReferral).toHaveBeenCalledWith("case-1", expect.objectContaining({ reasons: ["DomesticAbuse"] }), CALLER);
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
      await POST(request({ reasons: ["DomesticAbuse"], urgency: "Normal", urgencyReason: "Hearing on Friday." }), response());

      expect(createReferral).toHaveBeenCalledWith(
        "case-1",
        { reasons: ["DomesticAbuse"], notes: undefined, urgency: "Normal", urgencyReason: undefined },
        CALLER
      );
    });

    it("should not send notes left behind in a closed reveal after Other was unticked", async () => {
      await POST(request({ reasons: ["DomesticAbuse"], notes: "Typed while Other was ticked.", urgency: "Normal" }), response());

      expect(createReferral).toHaveBeenCalledWith(
        "case-1",
        { reasons: ["DomesticAbuse"], notes: undefined, urgency: "Normal", urgencyReason: undefined },
        CALLER
      );
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
      await POST(request({ reasons: ["DomesticAbuse"], urgency: "Normal", notes: "x".repeat(1001) }), response());

      expect(createReferral).toHaveBeenCalledWith("case-1", expect.objectContaining({ notes: undefined }), CALLER);
    });

    it("should re-render with the error against urgency when the question was left unanswered", async () => {
      const res = response();

      await POST(request({ reasons: ["DomesticAbuse"] }), res);

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

      await POST(request({ reasons: ["DomesticAbuse"], urgency: "Urgent" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createReferral).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].errors.urgencyReason).toBe("Enter why this referral is urgent");
      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "Enter why this referral is urgent", href: "#urgencyReason" }]);
    });

    it("should accept Urgent with its reason", async () => {
      await POST(request({ reasons: ["DomesticAbuse"], urgency: "Urgent", urgencyReason: "Hearing on Friday." }), response());

      expect(createReferral).toHaveBeenCalledWith(
        "case-1",
        { reasons: ["DomesticAbuse"], notes: undefined, urgency: "Urgent", urgencyReason: "Hearing on Friday." },
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

      await POST(request({ reasons: ["NonPublication", "Other"], urgency: "Urgent", urgencyReason: "" }), res);

      const model = res.render.mock.calls[0][1];
      expect(model.reasonItems.filter((item: { checked: boolean }) => item.checked).map((item: { value: string }) => item.value)).toEqual([
        "NonPublication",
        "Other"
      ]);
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

      await POST(request({ reasons: ["DomesticAbuse"], urgency: "Urgent", urgencyReason: "Hearing on Friday." }), res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.render.mock.calls[0][1].conflictHref).toBe("/deed-polls/case-1#referrals");
      expect(res.render.mock.calls[0][1].values.urgencyReason).toBe("Hearing on Friday.");
    });

    it("should keep what was chosen on screen when the case already has an open referral", async () => {
      vi.mocked(createReferral).mockRejectedValue(new ConflictError("Case case-1 already has an open referral"));
      const res = response();

      await POST(request({ reasons: ["DomesticAbuse"], urgency: "Urgent", urgencyReason: "Hearing on Friday." }), res);

      expect(res.render.mock.calls[0][1].values.urgencyReason).toBe("Hearing on Friday.");
    });

    it("should keep the typed details on screen when api rejects them for a rule this form does not mirror", async () => {
      vi.mocked(createReferral).mockRejectedValue(
        new InvalidInputError("Request body is not valid", [{ field: "reasons", message: "Minor cannot be combined with NonPublication" }])
      );
      const res = response();

      await POST(request(COMPLETE), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.reasons).toBe(REASONS_REFUSED);
      expect(res.render.mock.calls[0][1].values.reasons).toEqual(COMPLETE.reasons);
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it("should render a rejection of one reason against the checkbox group, whichever way api spells the member", async () => {
      // Spring addresses a collection member as `reasons[0]` where zod dots it; both are about the group the
      // caseworker can change, and treating the bracketed form as unplaceable would throw away the one message
      // that says which reason was refused.
      vi.mocked(createReferral).mockRejectedValue(
        new InvalidInputError("Request body is not valid", [{ field: "reasons[0]", message: "Minor is not accepted on a migrated case" }])
      );
      const res = response();

      await POST(request(COMPLETE), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.reasons).toBe(REASONS_REFUSED);
      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: REASONS_REFUSED, href: "#reasons" }]);
    });

    it("should show its own copy, not api's member names, when api refuses a reason this form offered", async () => {
      // A deploy between the two halves of a change: this form offers a member the running api does not know yet.
      const apiWording = "reasons names no referral reason: 'MinorNoStepparentConsent'. One of Minor, DomesticAbuse, Other";
      vi.mocked(createReferral).mockRejectedValue(new InvalidInputError("Request body is not valid", [{ field: "reasons", message: apiWording }]));
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = response();

      await POST(request(COMPLETE), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: REASONS_REFUSED, href: "#reasons" }]);
      expect(JSON.stringify(res.render.mock.calls[0][1].errors)).not.toContain("MinorNoStepparentConsent");
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("MinorNoStepparentConsent"));
      logged.mockRestore();
    });

    it("should show its own copy when api names a field this form has no control for", async () => {
      // Nothing on this page is keyed by `state` — api allocates it — so the message would be dropped from both
      // the summary and the controls: a 400 with an untouched form and no explanation on it, which a caseworker
      // cannot act on and resubmitting cannot clear.
      vi.mocked(createReferral).mockRejectedValue(
        new InvalidInputError("Request body is not valid", [{ field: "state", message: "state is not accepted on create" }])
      );
      const res = response();

      await POST(request(COMPLETE), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorList[0].text).toBe("The referral could not be raised. Check the details and try again.");
    });

    it("should show both the field it can place and its own copy when api rejects on a field it cannot", async () => {
      // A Spring 400 carries every field error at once, so a rejection can name `notes` and a field this form
      // does not render together. Rendering only the notes message would have the caseworker fix what they were
      // shown and be refused a second time for the half that was never on the page.
      vi.mocked(createReferral).mockRejectedValue(
        new InvalidInputError("Request body is not valid", [
          { field: "notes", message: "Give the other reason" },
          { field: "state", message: "state is not accepted on create" }
        ])
      );
      const res = response();

      await POST(request(COMPLETE), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.notes).toBe("Give the other reason");
      // The form-level row names no control, so it is unlinked — sending focus to a guess at one is worse for a
      // keyboard user than a row that reads. The field row keeps its link.
      expect(res.render.mock.calls[0][1].errorList).toEqual([
        { text: "The referral could not be raised. Check the details and try again." },
        { text: "Give the other reason", href: "#notes" }
      ]);
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

  // `../../../../case-path.test.ts` holds the full payload matrix; this pins every destination the page builds.
  describe("a case id carrying URL delimiters", () => {
    const RAW_ID = "a/b?c#d";
    const ENCODED_CASE = "/deed-polls/a%2Fb%3Fc%23d";

    function delimited(body: Record<string, unknown> = COMPLETE, params: Record<string, string> = { id: RAW_ID }) {
      return pageRequest({ params, body, accessToken: "session-token" });
    }

    it("should raise the referral under the raw id and redirect to the encoded case's referrals tab", async () => {
      const res = response();

      await POST(delimited(), res);

      expect(createReferral).toHaveBeenCalledWith(RAW_ID, COMPLETE, CALLER);
      expect(res.redirect).toHaveBeenCalledWith(`${ENCODED_CASE}#referrals`);
    });

    it("should link a 409 to the open referral under the encoded case, encoding the referral id exactly once", async () => {
      vi.mocked(createReferral).mockRejectedValue(new ConflictError("already has an open referral"));
      vi.mocked(findReferrals).mockResolvedValue([{ ...OPEN_REFERRAL, id: "ref/9" }] as never);
      const res = response();

      await POST(delimited(), res);

      expect(findReferrals).toHaveBeenCalledWith(RAW_ID, CALLER);
      expect(res.render.mock.calls[0][1].conflictHref).toBe(`${ENCODED_CASE}/referrals/ref%2F9`);
    });

    it("should fall a 409 back to the encoded case's referrals tab when no referral is live", async () => {
      vi.mocked(createReferral).mockRejectedValue(new ConflictError("already has an open referral"));
      vi.mocked(findReferrals).mockResolvedValue([]);
      const res = response();

      await POST(delimited(), res);

      expect(res.render.mock.calls[0][1].conflictHref).toBe(`${ENCODED_CASE}#referrals`);
    });

    // The live referral's id is api's, and this runs inside the 409's catch, so an unusable one degrades to the tab
    // link rather than losing the caseworker's typed answers to an error page.
    it.each(["", ".", ".."])("should fall a 409 back to the referrals tab when api's live referral id is %j", async (liveId) => {
      vi.mocked(createReferral).mockRejectedValue(new ConflictError("already has an open referral"));
      vi.mocked(findReferrals).mockResolvedValue([{ ...OPEN_REFERRAL, id: liveId }] as never);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = response();

      await POST(delimited(), res);

      expect(res.render.mock.calls[0][1].conflictHref).toBe(`${ENCODED_CASE}#referrals`);
    });

    it.each(["", ".", ".."])("should 404 a referral raised under case %j before anything is written", async (id) => {
      const res = response();

      await expect(POST(delimited(COMPLETE, { id }), res)).rejects.toThrow(NotFoundError);

      expect(createReferral).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });
});
