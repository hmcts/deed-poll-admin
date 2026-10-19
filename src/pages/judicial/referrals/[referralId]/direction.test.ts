import { ConflictError, getReferral, InvalidInputError, NotFoundError, recordDirection } from "@hmcts/deed-poll";
import type { JudicialReferralDetail } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET, POST } from "./direction.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  getReferral: vi.fn(),
  recordDirection: vi.fn()
}));

const CALLER = { accessToken: "judge-token" };

const detail = (overrides: Partial<JudicialReferralDetail> = {}): JudicialReferralDetail =>
  ({
    id: "ref-1",
    // `Claimed` is the only state this page belongs to, and api's visibility means claimed *by this judge*.
    state: "Claimed",
    reasons: ["Minor"],
    notes: "Applicant is 15",
    urgency: "Normal",
    urgencyReason: null,
    createdOn: new Date("2026-09-03T08:44:00Z"),
    claimedBy: "a-judge",
    claimedAt: new Date("2026-09-04T09:00:00Z"),
    decision: null,
    directionsText: null,
    publishToGazette: null,
    decisionDate: null,
    decidedBy: null,
    application: {
      displayReference: "KBDP2026-00001",
      type: "Minor",
      oldForename: "John",
      oldMiddleName: null,
      oldSurname: "Smith",
      newForename: "John",
      newMiddleName: null,
      newSurname: "Smyth",
      witnesses: [],
      documents: []
    },
    caseNotes: [],
    ...overrides
  }) as JudicialReferralDetail;

function request(body?: unknown, referralId = "ref-1") {
  return pageRequest({ params: { referralId }, body, judicial: true, accessToken: "judge-token" });
}

/** A complete, valid direction as the form posts it — strings, because that is what a browser sends. */
const posted = (overrides: Record<string, unknown> = {}) => ({
  decision: "Approved",
  directionsText: "Grant the application.",
  publishToGazette: "false",
  ...overrides
});

describe("recording a judicial direction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReferral).mockResolvedValue(detail() as never);
    vi.mocked(recordDirection).mockResolvedValue(detail({ state: "Decided" }) as never);
  });

  describe("the form", () => {
    it("should render the direction form for a referral this judge holds", async () => {
      const res = pageResponse();

      await GET(request(), res);

      expect(getReferral).toHaveBeenCalledWith("ref-1", CALLER);
      expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/direction-form");
    });

    // A judge must be able to see which application they are directing before they attest to it, and the
    // reference is one of the fields `JudicialCaseView` carries.
    it("should caption the form with the application's reference", async () => {
      const res = pageResponse();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].reference).toBe("KBDP2026-00001");
    });

    it("should caption nothing when api sent no application with the referral", async () => {
      vi.mocked(getReferral).mockResolvedValue(detail({ application: null }) as never);
      const res = pageResponse();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].reference).toBe("");
    });

    // Decision 6: neither radio group may default. A pre-selected Gazette answer would decide publication for
    // the judge, which is the one call api-2 decision 6 puts in their hands.
    it("should check neither decision nor Gazette radio on a form nobody has answered", async () => {
      const res = pageResponse();

      await GET(request(), res);

      const model = res.render.mock.calls[0][1];
      expect(model.decisionItems.every((item: { checked: boolean }) => item.checked === false)).toBe(true);
      expect(model.gazetteItems.every((item: { checked: boolean }) => item.checked === false)).toBe(true);
    });

    // The Gazette labels are the only strings on this page the handler resolves itself — the items are built here,
    // so unlike everything else they do not reach the template as a pair for it to choose from. Pinned against the
    // model's own `cy` rather than against two literals, so it is the resolution being asserted and not the
    // wording; while `cy` is English in the Welsh shape the two agree, and when Welsh lands this fails if the
    // handler went back to reading `en`.
    it("should resolve the Gazette labels for the request's language rather than always in English", async () => {
      const res = pageResponse();
      res.locals.locale = "cy";

      await GET(request(), res);

      const model = res.render.mock.calls[0][1];
      expect(model.gazetteItems.map((item: { text: string }) => item.text)).toEqual([model.cy.yes, model.cy.no]);
    });

    it("should offer the two decisions api publishes, in its order", async () => {
      const res = pageResponse();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].decisionItems.map((item: { value: string }) => item.value)).toEqual(["Approved", "Rejected"]);
    });

    // api checks visibility before the hold, so a referral withdrawn, closed, taken by another judge or never
    // there is one 404 — and it must read as "gone", never as "somebody else's" (decision 10).
    it("should render 'no longer available' with a 404 when the referral is not visible", async () => {
      vi.mocked(getReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));
      const res = pageResponse();

      await GET(request(), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/unavailable");
    });

    // Visible but not in this judge's hands: there is no direction to take, so they go back to the referral,
    // where the control that does apply — claim it — is the one offered.
    it("should send a judge who does not hold the referral back to it, saying so", async () => {
      vi.mocked(getReferral).mockResolvedValue(detail({ state: "Open" }) as never);
      const res = pageResponse();

      await GET(request(), res);

      expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/ref-1?direction=notheld");
      expect(res.render).not.toHaveBeenCalled();
    });

    it("should send a judge who has already directed the referral back to it too", async () => {
      vi.mocked(getReferral).mockResolvedValue(detail({ state: "Decided", decision: "Approved" }) as never);
      const res = pageResponse();

      await GET(request(), res);

      expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/ref-1?direction=notheld");
    });

    it("should escape the referral id in the paths it renders", async () => {
      const res = pageResponse();

      await GET(request(undefined, "ref 1/../evil"), res);

      const model = res.render.mock.calls[0][1];
      expect(model.directionHref).toBe("/judicial/referrals/ref%201%2F..%2Fevil/direction");
      expect(model.referralHref).toBe("/judicial/referrals/ref%201%2F..%2Fevil");
    });

    it("should let a failure that is not a 404 reach the error handler", async () => {
      vi.mocked(getReferral).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

      await expect(GET(request(), pageResponse())).rejects.toThrow("unavailable");
    });
  });

  describe("validation", () => {
    it("should re-render the form at 400 when no decision was chosen", async () => {
      const res = pageResponse();

      await POST(request(posted({ decision: undefined })), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/direction-form");
      expect(res.render.mock.calls[0][1].errors.decision).toBe("Select whether the application is approved or rejected");
    });

    // The one field worth being pedantic about: the radio's "no" posts the string `"false"`, which is truthy, so
    // an unanswered pair must stay unanswered rather than arriving as a silent `true`.
    it("should re-render the form at 400 when the Gazette question was not answered", async () => {
      const res = pageResponse();

      await POST(request(posted({ publishToGazette: undefined })), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.publishToGazette).toBe("Select whether this direction is published in the Gazette");
      expect(recordDirection).not.toHaveBeenCalled();
    });

    it("should re-render the form at 400 when the directions are longer than api accepts", async () => {
      const res = pageResponse();

      await POST(request(posted({ directionsText: "x".repeat(4001) })), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.directionsText).toBe("Directions must be 4000 characters or fewer");
    });

    // The point of re-rendering rather than redirecting: up to 4,000 characters of a judge's directions are the
    // most expensive thing on this screen to lose.
    it("should put the submitted answers back on the re-rendered form", async () => {
      const res = pageResponse();

      await POST(request(posted({ decision: undefined, directionsText: "Grant, with costs." })), res);

      const model = res.render.mock.calls[0][1];
      expect(model.values.directionsText).toBe("Grant, with costs.");
      expect(model.gazetteItems.find((item: { value: string }) => item.value === "false").checked).toBe(true);
    });

    it("should list the errors in the order the controls appear", async () => {
      const res = pageResponse();

      await POST(request({ directionsText: "x".repeat(4001) }), res);

      expect(res.render.mock.calls[0][1].errorList).toEqual([
        { text: "Select whether the application is approved or rejected", href: "#decision" },
        { text: "Directions must be 4000 characters or fewer", href: "#directionsText" },
        { text: "Select whether this direction is published in the Gazette", href: "#publishToGazette" }
      ]);
    });

    it("should accept a direction with no directions text, because api does not require one", async () => {
      const res = pageResponse();

      await POST(request(posted({ directionsText: "   " })), res);

      expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/direction-check");
      expect(res.render.mock.calls[0][1].answers.directionsText).toBe("");
    });
  });

  describe("check your answers", () => {
    it("should show the entered direction back in the judge's words", async () => {
      const res = pageResponse();

      await POST(request(posted({ decision: "Rejected", publishToGazette: "true" })), res);

      expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/direction-check");
      expect(res.render.mock.calls[0][1].answers).toEqual({
        decision: "Rejected",
        directionsText: "Grant the application.",
        publishToGazette: true
      });
    });

    // The answers travel to the confirm as the fields a browser posts, which is why `"false"` is carried as a
    // string beside the boolean the summary list reads.
    it("should carry the answers on as the fields the confirm posts", async () => {
      const res = pageResponse();

      await POST(request(posted()), res);

      expect(res.render.mock.calls[0][1].values).toEqual({
        decision: "Approved",
        directionsText: "Grant the application.",
        publishToGazette: "false"
      });
    });

    it("should record nothing on the way to the check step", async () => {
      await POST(request(posted()), pageResponse());

      expect(recordDirection).not.toHaveBeenCalled();
    });

    // The layout renders `title` in the `<title>` element, and one content pair serves both steps — so without
    // this the check step announces the form's name over a page headed "Check your direction", which is the
    // title-matches-h1 rule broken with nothing on screen to show it.
    it("should title the check step after the heading it shows, not after the form", async () => {
      const res = pageResponse();

      await POST(request(posted()), res);

      const { en, cy } = res.render.mock.calls[0][1];
      expect(en.title).toBe("Check your direction");
      expect(cy.title).toBe(cy.checkTitle);
    });

    // Decision 7: no draft anywhere, client or server. An abandoned direction must leave nothing behind.
    it("should persist no draft in the session", async () => {
      const req = request(posted());

      await POST(req, pageResponse());

      expect(req.session.deedPoll).toEqual({ user: req.session.deedPoll.user, accessToken: "judge-token" });
    });

    it("should re-render the form with the answers when the judge asks to change them", async () => {
      const res = pageResponse();

      await POST(request({ ...posted(), action: "change" }), res);

      expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/direction-form");
      expect(res.render.mock.calls[0][1].values.directionsText).toBe("Grant the application.");
      expect(res.render.mock.calls[0][1].errorList).toEqual([]);
    });

    // Changing an answer is not submitting one, so a half-answered direction goes back to the form as it stands
    // rather than being marked up with errors the judge is already on their way to fixing.
    it("should show no errors when the judge changes an answer they had not finished", async () => {
      const res = pageResponse();

      await POST(request({ decision: "Approved", action: "change" }), res);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].errors).toEqual({});
    });
  });

  describe("the confirm", () => {
    it("should record the direction once, with the three fields api takes", async () => {
      const res = pageResponse();

      await POST(request({ ...posted(), action: "confirm" }), res);

      expect(recordDirection).toHaveBeenCalledTimes(1);
      expect(recordDirection).toHaveBeenCalledWith(
        "ref-1",
        { decision: "Approved", directionsText: "Grant the application.", publishToGazette: false },
        CALLER
      );
    });

    // `Boolean("false")` is `true`, so this is the assertion that a judge's "no" is not silently a "yes".
    it("should send the Gazette answer the judge gave, not a coercion of it", async () => {
      await POST(request({ ...posted({ publishToGazette: "true" }), action: "confirm" }), pageResponse());

      expect(vi.mocked(recordDirection).mock.calls[0][1].publishToGazette).toBe(true);
    });

    it("should send no directions text at all when the judge gave none", async () => {
      await POST(request({ ...posted({ directionsText: "" }), action: "confirm" }), pageResponse());

      expect(vi.mocked(recordDirection).mock.calls[0][1].directionsText).toBeUndefined();
    });

    // One atomic call: api re-checks the hold itself, and a pre-read's answer would be stale by the time it was
    // acted on.
    it("should not read the referral before recording the direction", async () => {
      await POST(request({ ...posted(), action: "confirm" }), pageResponse());

      expect(getReferral).not.toHaveBeenCalled();
    });

    it("should return the judge to the referral, saying the direction was recorded", async () => {
      const res = pageResponse();

      await POST(request({ ...posted(), action: "confirm" }), res);

      expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/ref-1?direction=recorded");
    });

    // A refresh of the check step posts the same body without the confirm button's value, and that must render
    // the check step again rather than count as a second attestation.
    it("should not record anything for a body that does not carry the confirm literal", async () => {
      const res = pageResponse();

      await POST(request({ ...posted(), action: "something-else" }), res);

      expect(recordDirection).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/direction-check");
    });

    // api's 409: still visible, but no longer this judge's to direct. Their answers go with it, which is
    // unavoidable — the referral is not theirs.
    it("should send the judge back to the referral when api says it is no longer theirs to direct", async () => {
      vi.mocked(recordDirection).mockRejectedValue(new ConflictError("Referral ref-1 is not Claimed by this judge"));
      const res = pageResponse();

      await POST(request({ ...posted(), action: "confirm" }), res);

      expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/ref-1?direction=notheld");
    });

    // The commonest lapse there is — another judge claimed it out from under this one — and api answers it as a
    // 404, not a 409. Rendering it as a fault would be reading the 409 as the only lapse case.
    it("should render 'no longer available' when the referral has gone while the judge was typing", async () => {
      vi.mocked(recordDirection).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));
      const res = pageResponse();

      await POST(request({ ...posted(), action: "confirm" }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/unavailable");
    });

    it("should re-render the form with api's own rejection when it refuses the direction", async () => {
      vi.mocked(recordDirection).mockRejectedValue(new InvalidInputError("400", [{ field: "directionsText", message: "Directions are too long" }]));
      const res = pageResponse();

      await POST(request({ ...posted(), action: "confirm" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/direction-form");
      expect(res.render.mock.calls[0][1].errors.directionsText).toBe("Directions are too long");
    });

    it("should show its own message for a rejection naming no control this form renders", async () => {
      vi.mocked(recordDirection).mockRejectedValue(new InvalidInputError("deed-poll-api answered 400"));
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = pageResponse();

      await POST(request({ ...posted(), action: "confirm" }), res);

      expect(res.render.mock.calls[0][1].errorList[0]).toEqual({ text: "The direction could not be recorded. Check your answers and try again." });
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });

    // The mixed rejection, which is neither of the two cases above: api named one control this form renders and
    // one it does not. The placeable message must still reach its field — dropping it would leave the judge with
    // a page-level sentence and no indication which answer to change — and the stand-in must lead the summary,
    // because something was refused that the rows below cannot account for.
    it("should show both the field it can place and its own message when api rejects a control this form does not render", async () => {
      vi.mocked(recordDirection).mockRejectedValue(
        new InvalidInputError("400", [
          { field: "directionsText", message: "Directions are too long" },
          { field: "referralState", message: "Referral is not Claimed" }
        ])
      );
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = pageResponse();

      await POST(request({ ...posted(), action: "confirm" }), res);

      const model = res.render.mock.calls[0][1];
      expect(res.status).toHaveBeenCalledWith(400);
      expect(model.errors).toEqual({ directionsText: "Directions are too long" });
      expect(model.errorList).toEqual([
        { text: "The direction could not be recorded. Check your answers and try again." },
        { text: "Directions are too long", href: "#directionsText" }
      ]);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("referralState"));
      error.mockRestore();
    });

    it("should let any other failure reach the error handler", async () => {
      vi.mocked(recordDirection).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

      await expect(POST(request({ ...posted(), action: "confirm" }), pageResponse())).rejects.toThrow("unavailable");
    });
  });

  // Slash, query and fragment delimiters in one id, and a literal `%2F` encoded again rather than decoded. The
  // helper's own tests carry the full matrix; these pin that every redirect and link here goes through it.
  describe("referral ids that are not plain path segments", () => {
    const ODD_IDS = [
      ["a/b?c#d", "/judicial/referrals/a%2Fb%3Fc%23d"],
      ["%2F", "/judicial/referrals/%252F"]
    ];

    it.each(ODD_IDS)("should keep %j as one segment on the guard's redirect for a referral not held", async (referralId, expected) => {
      vi.mocked(getReferral).mockResolvedValue(detail({ state: "Open" }) as never);
      const res = pageResponse();

      await GET(request(undefined, referralId), res);

      expect(res.redirect).toHaveBeenCalledWith(`${expected}?direction=notheld`);
      expect(getReferral).toHaveBeenCalledWith(referralId, CALLER);
    });

    it.each(ODD_IDS)("should keep %j as one segment on the recorded redirect", async (referralId, expected) => {
      const res = pageResponse();

      await POST(request({ ...posted(), action: "confirm" }, referralId), res);

      expect(res.redirect).toHaveBeenCalledWith(`${expected}?direction=recorded`);
      expect(recordDirection).toHaveBeenCalledTimes(1);
      expect(vi.mocked(recordDirection).mock.calls[0][0]).toBe(referralId);
    });

    it.each(ODD_IDS)("should keep %j as one segment on the conflict redirect", async (referralId, expected) => {
      vi.mocked(recordDirection).mockRejectedValue(new ConflictError("Referral is not Claimed by this judge"));
      const res = pageResponse();

      await POST(request({ ...posted(), action: "confirm" }, referralId), res);

      expect(res.redirect).toHaveBeenCalledWith(`${expected}?direction=notheld`);
    });

    it.each(ODD_IDS)("should build the check step's links for %j from the same path", async (referralId, expected) => {
      const res = pageResponse();

      await POST(request(posted(), referralId), res);

      const model = res.render.mock.calls[0][1];
      expect(model.referralHref).toBe(expected);
      expect(model.directionHref).toBe(`${expected}/direction`);
    });
  });

  // A browser drops a `.` or `..` segment, so these could only redirect into the pool or above it. Refused before
  // any read or write, on every step, so a refusal can never follow either.
  describe("referral ids that are not usable path segments", () => {
    const STEPS = {
      form: (referralId: string, res: ReturnType<typeof pageResponse>) => GET(request(undefined, referralId), res),
      invalid: (referralId: string, res: ReturnType<typeof pageResponse>) => POST(request(posted({ decision: undefined }), referralId), res),
      change: (referralId: string, res: ReturnType<typeof pageResponse>) => POST(request({ ...posted(), action: "change" }, referralId), res),
      check: (referralId: string, res: ReturnType<typeof pageResponse>) => POST(request(posted(), referralId), res),
      confirm: (referralId: string, res: ReturnType<typeof pageResponse>) => POST(request({ ...posted(), action: "confirm" }, referralId), res)
    };

    it.each((Object.keys(STEPS) as (keyof typeof STEPS)[]).flatMap((step) => ["", ".", ".."].map((referralId) => [step, referralId] as const)))(
      "should refuse on the %s step for %j as not found, reading and writing nothing",
      async (step, referralId) => {
        const res = pageResponse();

        await expect(STEPS[step](referralId, res)).rejects.toBeInstanceOf(NotFoundError);

        expect(getReferral).not.toHaveBeenCalled();
        expect(recordDirection).not.toHaveBeenCalled();
        expect(res.redirect).not.toHaveBeenCalled();
        expect(res.render).not.toHaveBeenCalled();
      }
    );
  });
});
