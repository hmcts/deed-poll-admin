import { getReferral, NotFoundError } from "@hmcts/deed-poll";
import type { JudicialReferralDetail } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET } from "./[referralId].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  getReferral: vi.fn()
}));

const CALLER = { accessToken: "judge-token" };

const detail = (overrides: Partial<JudicialReferralDetail> = {}): JudicialReferralDetail =>
  ({
    id: "ref-1",
    state: "Open",
    reasons: ["Minor"],
    notes: "Applicant is 15",
    urgency: "Urgent",
    urgencyReason: "Hearing on Friday",
    createdOn: new Date("2026-09-03T08:44:00Z"),
    claimedBy: null,
    claimedAt: null,
    decision: null,
    directionsText: null,
    changesToStandardPublication: null,
    decisionDate: null,
    decidedBy: null,
    application: {
      displayReference: "KBDP2026-00001",
      newForename: "John",
      newMiddleName: "Peter",
      newSurname: "Smyth",
      oldForename: "John",
      oldMiddleName: "Peter",
      oldSurname: "Smith",
      type: "Minor",
      nationality: "BritishCitizen",
      parents: "Jane Smith and Paul Smith",
      documents: [
        { id: "doc-1", name: "birth-certificate.pdf", documentType: "Birth certificate", sizeBytes: 245_760, uploadedOn: new Date("2026-09-02T10:15:00Z") }
      ]
    },
    ...overrides
  }) as JudicialReferralDetail;

/** A referral this judge has already directed — what the success banner is checked against. */
const decided = (): JudicialReferralDetail =>
  detail({
    state: "Decided",
    claimedBy: "judge-1",
    claimedAt: new Date("2026-09-03T09:00:00Z"),
    decision: "Approved",
    directionsText: "Grant the application",
    changesToStandardPublication: false,
    decisionDate: new Date("2026-09-03T10:00:00Z"),
    decidedBy: "judge-1"
  } as Partial<JudicialReferralDetail>);

function request(referralId = "ref-1", query: Record<string, unknown> = {}) {
  return pageRequest({ params: { referralId }, query, judicial: true, accessToken: "judge-token" });
}

describe("the judicial referral page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReferral).mockResolvedValue(detail() as never);
  });

  // No case id in the call and none available to make: api keys the judicial surface on the referral.
  it("should read the referral by id alone, with the judge's token", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/referral");
    expect(getReferral).toHaveBeenCalledWith("ref-1", CALLER);
  });

  // One payload holds the referral, the application and the timeline, so a second call would be a round trip
  // for an answer already held — and there is no judicial route to make one with.
  it("should make exactly one call for the whole screen", async () => {
    await GET(request(), pageResponse());

    expect(getReferral).toHaveBeenCalledTimes(1);
  });

  it("should render the application view built from the judicial DTO", async () => {
    const res = pageResponse();

    await GET(request(), res);

    const application = res.render.mock.calls[0][1].referral.application;
    expect(application.reference).toBe("KBDP2026-00001");
    expect(application.sections.map((section: { label: string }) => section.label)).toEqual(["General"]);
    expect(application.sections[0].rows).toContainEqual({ key: "Minor’s parents’ names", value: "Jane Smith and Paul Smith" });
  });

  // Built here with the path helpers rather than in the template (CLAUDE.md "Redirect paths").
  it("should open each document in the viewer under the referral, encoding the document id", async () => {
    vi.mocked(getReferral).mockResolvedValue(
      detail({ application: { ...detail().application, documents: [{ id: "doc/1", name: "a.pdf" }] } as JudicialReferralDetail["application"] }) as never
    );
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].documents).toEqual([
      expect.objectContaining({ name: "a.pdf", href: "/judicial/referrals/ref-1/documents/doc%2F1/view" })
    ]);
  });

  it("should offer no document links when api sent no application", async () => {
    vi.mocked(getReferral).mockResolvedValue(detail({ application: null }) as never);
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].documents).toEqual([]);
  });

  it("should render the referral's own fields as the judge reads them", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral).toMatchObject({
      state: "Open",
      reasons: ["Applicant is a minor"],
      notes: "Applicant is 15",
      urgency: "Urgent",
      isUrgent: true,
      urgencyReason: "Hearing on Friday"
    });
    // "Waiting since" was removed from the Master's referral section (Master Sullivan's feedback, 2026-10-27).
    expect(res.render.mock.calls[0][1].referral).not.toHaveProperty("waitingSince");
  });

  it("should render no case notes, which a Master is not sent", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral).not.toHaveProperty("caseNotes");
  });

  // There is no claim since api D2: a referral reaches a Master by assignment.
  it("should build no claim address", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1]).not.toHaveProperty("claimHref");
    expect(res.render.mock.calls[0][1].referral).not.toHaveProperty("claimable");
  });

  it("should offer the direction control, with its due date, on a referral assigned to this judge", async () => {
    vi.mocked(getReferral).mockResolvedValue(
      detail({ state: "Claimed", assignedAt: new Date("2026-10-23T10:00:00Z"), directionDueBy: new Date("2026-10-30T10:00:00Z") }) as never
    );
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1]).toMatchObject({
      referral: expect.objectContaining({ directable: true, directionDueBy: "30-10-26", assignedOn: "23 October 2026 at 11:00am" }),
      directionHref: "/judicial/referrals/ref-1/direction"
    });
  });

  // Decision 5 and 6: api shows a Decided referral only to the judge who directed it, so the state is the answer.
  it("should offer change and withdraw on a referral this judge has directed", async () => {
    vi.mocked(getReferral).mockResolvedValue(decided() as never);
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1]).toMatchObject({
      referral: expect.objectContaining({ directable: false, changeable: true }),
      changeHref: "/judicial/referrals/ref-1/direction?change=1",
      withdrawHref: "/judicial/referrals/ref-1/withdraw"
    });
  });

  it("should escape a referral id in the URLs it builds, because both are paths api gave it", async () => {
    const res = pageResponse();

    await GET(request("ref 1/../evil"), res);

    expect(res.render.mock.calls[0][1]).toMatchObject({
      directionHref: "/judicial/referrals/ref%201%2F..%2Fevil/direction",
      changeHref: "/judicial/referrals/ref%201%2F..%2Fevil/direction?change=1",
      withdrawHref: "/judicial/referrals/ref%201%2F..%2Fevil/withdraw"
    });
  });

  // `referralPath`'s rule (`src/judicial-referral-path.ts`): encoding leaves dots alone, so these would link to the old pool path
  // or the area's parent. Refused before the read, as the direction handler refuses them.
  it.each(["", ".", ".."])("should 404 referral %j without asking api for it", async (referralId) => {
    await expect(GET(request(referralId), pageResponse())).rejects.toThrow(NotFoundError);

    expect(getReferral).not.toHaveBeenCalled();
  });

  // Decision 10, the client half of api's non-enumeration guarantee: a referral withdrawn, closed, claimed by
  // another judge or never created are one 404, so the page says one thing and never names a holder.
  it("should render a 404 reading 'no longer available' when api will not show the referral", async () => {
    vi.mocked(getReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));
    const res = pageResponse();

    await GET(request(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/unavailable");
    expect(res.render.mock.calls[0][1].en.heading).toBe("This referral is no longer available");
  });

  it("should say nothing about another judge on the unavailable page", async () => {
    vi.mocked(getReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));
    const res = pageResponse();

    await GET(request(), res);

    // `another judge` is in the pattern deliberately: decision 10 forbids implying a holder as well as naming
    // one, and an earlier wording hedged its way past a narrower pattern than this with "it may already be with
    // another judge".
    const { en } = res.render.mock.calls[0][1];
    expect(`${en.heading} ${en.body}`).not.toMatch(/claimed by|belongs to|held by|another judge|someone else/i);
  });

  it("should offer the way back to My referrals from the unavailable page", async () => {
    vi.mocked(getReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].myReferralsPath).toBe("/judicial/referrals/mine");
    expect(res.render.mock.calls[0][1].en.backToMine).toBe("Back to My referrals");
  });

  // There is one judicial list since api D2, so every referral a Master can see links back to it.
  describe("the way back to a list", () => {
    it.each([["Claimed"], ["Decided"], [null]] as const)("should send a judge reading a %s referral back to My referrals", async (state) => {
      vi.mocked(getReferral).mockResolvedValue(detail({ state }) as never);
      const res = pageResponse();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1]).toMatchObject({
        backHref: "/judicial/referrals/mine",
        en: expect.objectContaining({ backToMine: "Back to My referrals" })
      });
    });

    // Not a `returnTo`, which decision 5 forbids: it would be an open redirect to validate.
    it("should ignore a destination the URL asked for", async () => {
      const res = pageResponse();

      await GET(request("ref-1", { returnTo: "https://evil.example/", return: "/judicial/referrals" }), res);

      expect(res.render.mock.calls[0][1].backHref).toBe("/judicial/referrals/mine");
    });
  });

  // Every other failure is a fault. A ForbiddenError here would mean the role gate admitted someone api then
  // refused, which is a bug to see on the 500 page rather than to dress as a missing referral.
  it("should let a failure that is not a 404 reach the error handler", async () => {
    vi.mocked(getReferral).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

    await expect(GET(request(), pageResponse())).rejects.toThrow("unavailable");
  });

  // What a redirect sends the judge back with. Two shapes — a banner for a success, a summary for a refusal —
  // and the direction's and the change's 409s for the refusal.
  describe("what a redirect comes back with", () => {
    it("should say the direction was recorded when it has just been", async () => {
      vi.mocked(getReferral).mockResolvedValue(decided() as never);
      const res = pageResponse();

      await GET(request("ref-1", { direction: "recorded" }), res);

      expect(res.render.mock.calls[0][1].directionBanner).toBe("Your direction has been recorded.");
      expect(res.render.mock.calls[0][1].refused).toBe("");
    });

    // The banner asserts a write, so the query alone must not be enough to show it: a stale or shared
    // `?direction=recorded` would otherwise announce a direction beside a status of `Open`.
    it("should say nothing when the query claims a direction api holds none for", async () => {
      const res = pageResponse();

      await GET(request("ref-1", { direction: "recorded" }), res);

      expect(res.render.mock.calls[0][1].directionBanner).toBe("");
    });

    // api's 409: visible, but not in this judge's hands — it went back to the pool, or they have already directed
    // it. The sentence has to stay true of both, and must name no other judge.
    it("should say the referral is not waiting for this judge's direction when api refused it", async () => {
      const res = pageResponse();

      await GET(request("ref-1", { direction: "notheld" }), res);

      expect(res.render.mock.calls[0][1].refused).toBe("This referral is not waiting for a direction from you. Check its status below.");
      expect(res.render.mock.calls[0][1].directionBanner).toBe("");
    });

    it("should say the direction was changed when it has just been", async () => {
      vi.mocked(getReferral).mockResolvedValue(decided() as never);
      const res = pageResponse();

      await GET(request("ref-1", { direction: "changed" }), res);

      expect(res.render.mock.calls[0][1].directionBanner).toBe("Your direction has been changed.");
    });

    // Withdrawn leaves the referral Claimed by this judge, so the banner points at the direction form below it.
    it("should say the direction was withdrawn when the referral is waiting for a new one", async () => {
      vi.mocked(getReferral).mockResolvedValue(detail({ state: "Claimed", claimedAt: new Date("2026-09-04T10:00:00Z") }) as never);
      const res = pageResponse();

      await GET(request("ref-1", { direction: "withdrawn" }), res);

      expect(res.render.mock.calls[0][1].directionBanner).toBe("Your direction has been withdrawn. Record a new direction.");
    });

    // Each banner asserts a write, so the state api sent must agree with it, as for a recorded direction.
    it("should say nothing when the query claims a change or withdrawal the state does not bear out", async () => {
      for (const query of [{ direction: "changed" }, { direction: "withdrawn" }]) {
        const res = pageResponse();

        await GET(request("ref-1", query), res);

        expect(res.render.mock.calls[0][1].directionBanner).toBe("");
      }
    });

    // Decision 7: api's 409 on change or withdraw is a visible referral that is not this judge's direction.
    it("should say there is no direction from this judge to change when api refused a change or withdrawal", async () => {
      const res = pageResponse();

      await GET(request("ref-1", { direction: "notchangeable" }), res);

      expect(res.render.mock.calls[0][1].refused).toBe("This referral does not have a direction from you to change or withdraw. Check its status below.");
    });

    it("should name no other judge in any refusal, because api does not say who holds it", async () => {
      for (const query of [{ direction: "notheld" }, { direction: "notchangeable" }]) {
        const res = pageResponse();

        await GET(request("ref-1", query), res);

        expect(res.render.mock.calls[0][1].refused).not.toMatch(/claimed by|belongs to|held by|another judge|already been claimed|directed by/i);
      }
    });

    it("should say nothing at all for a hand-typed value, which pins no state", async () => {
      const res = pageResponse();

      await GET(request("ref-1", { direction: "whatever" }), res);

      expect(res.render.mock.calls[0][1].directionBanner).toBe("");
      expect(res.render.mock.calls[0][1].refused).toBe("");
    });
  });

  it("should carry both locales for both renderings", async () => {
    const res = pageResponse();

    await GET(request(), res);
    expect(Object.keys(res.render.mock.calls[0][1].cy)).toEqual(Object.keys(res.render.mock.calls[0][1].en));

    vi.mocked(getReferral).mockRejectedValue(new NotFoundError("gone"));
    const refused = pageResponse();

    await GET(request(), refused);
    expect(Object.keys(refused.render.mock.calls[0][1].cy)).toEqual(Object.keys(refused.render.mock.calls[0][1].en));
  });
});
