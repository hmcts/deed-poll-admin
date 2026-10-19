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
    publishToGazette: null,
    decisionDate: null,
    decidedBy: null,
    application: {
      displayReference: "KBDP2026-00001",
      type: "Minor",
      privacy: "Private",
      oldForename: "John",
      oldMiddleName: "Peter",
      oldSurname: "Smith",
      newForename: "John",
      newMiddleName: "Peter",
      newSurname: "Smyth",
      applicantTownCity: "Leeds",
      representativeCompany: "Solicitors LLP",
      nationality: "BritishCitizen",
      dateOfDeclaration: new Date("2026-08-20T00:00:00Z"),
      witnesses: [{ witnessName: "Mary Jones", witnessAddress: "1 High Street, Leeds", witnessOccupation: "Solicitor", declarant: true }],
      documents: [
        { id: "doc-1", name: "birth-certificate.pdf", documentType: "Birth certificate", sizeBytes: 245_760, uploadedOn: new Date("2026-09-02T10:15:00Z") }
      ]
    },
    caseNotes: [{ note: "Chased the declarant", createdBy: "A Caseworker", createdOn: new Date("2026-09-02T14:30:00Z") }],
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
    publishToGazette: true,
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
    expect(application.sections.map((section: { label: string }) => section.label)).toContain("Names");
    expect(application.witnesses).toEqual([{ name: "Mary Jones", address: "1 High Street, Leeds", occupation: "Solicitor", declarant: true }]);
  });

  // Built here with the path helpers rather than in the template (CLAUDE.md "Redirect paths").
  it("should build each document's download link under the referral, encoding the document id", async () => {
    vi.mocked(getReferral).mockResolvedValue(
      detail({ application: { ...detail().application, documents: [{ id: "doc/1", name: "a.pdf" }] } as JudicialReferralDetail["application"] }) as never
    );
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].documents).toEqual([
      expect.objectContaining({ name: "a.pdf", href: "/judicial/referrals/ref-1/documents/doc%2F1/file" })
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
      urgencyReason: "Hearing on Friday",
      waitingSince: "3 September 2026 at 9:44am"
    });
  });

  it("should render the application's timeline read-only, with no note id to act on", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.caseNotes).toEqual([
      { note: "Chased the declarant", createdBy: "A Caseworker", createdOn: "2 September 2026 at 3:30pm" }
    ]);
  });

  it("should offer the claim control on a pool referral and not the direction one", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1]).toMatchObject({
      referral: expect.objectContaining({ claimable: true, directable: false }),
      claimHref: "/judicial/referrals/ref-1/claim"
    });
  });

  it("should offer the direction control on a referral this judge holds", async () => {
    vi.mocked(getReferral).mockResolvedValue(detail({ state: "Claimed", claimedAt: new Date("2026-09-04T10:00:00Z") }) as never);
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1]).toMatchObject({
      referral: expect.objectContaining({ claimable: false, directable: true }),
      directionHref: "/judicial/referrals/ref-1/direction"
    });
  });

  it("should escape a referral id in the URLs it builds, because both are paths api gave it", async () => {
    const res = pageResponse();

    await GET(request("ref 1/../evil"), res);

    expect(res.render.mock.calls[0][1]).toMatchObject({
      claimHref: "/judicial/referrals/ref%201%2F..%2Fevil/claim",
      directionHref: "/judicial/referrals/ref%201%2F..%2Fevil/direction"
    });
  });

  // `referralPath`'s rule (`src/judicial-referral-path.ts`): encoding leaves dots alone, so these would link to the pool
  // or the area's parent. Refused before the read, as the claim and direction handlers refuse them.
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

  it("should offer the way back to the pool from the unavailable page", async () => {
    vi.mocked(getReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].poolPath).toBe("/judicial/referrals");
    // The pool whatever the referral's state was, because a read api refused published none — and a guess at My
    // referrals would be a link to a list this referral has left too.
    expect(res.render.mock.calls[0][1].en.backToPool).toBe("Back to referrals for a direction");
  });

  // Decision 5, and the business finding this plan exists for: the pool is `Open` only, so a judge who claimed a
  // referral and pressed "Back to referrals" was returned to the one judicial list it is no longer on.
  describe("the way back to a list", () => {
    it("should send a judge reading a pool referral back to the pool", async () => {
      const res = pageResponse();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1]).toMatchObject({
        backHref: "/judicial/referrals",
        backLabel: "Back to referrals for a direction"
      });
    });

    it("should send a judge reading a referral they hold back to My referrals", async () => {
      vi.mocked(getReferral).mockResolvedValue(detail({ state: "Claimed", claimedAt: new Date("2026-09-04T10:00:00Z") }) as never);
      const res = pageResponse();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1]).toMatchObject({
        backHref: "/judicial/referrals/mine",
        backLabel: "Back to My referrals"
      });
    });

    // The direction is recorded and the referral is still this judge's until the office actions it, so the list it
    // is on has not changed — this is the second half of the journey the plan describes, returning after directing.
    it("should still send a judge back to My referrals after they have directed it", async () => {
      vi.mocked(getReferral).mockResolvedValue(decided() as never);
      const res = pageResponse();

      await GET(request("ref-1", { direction: "recorded" }), res);

      expect(res.render.mock.calls[0][1]).toMatchObject({
        backHref: "/judicial/referrals/mine",
        backLabel: "Back to My referrals"
      });
    });

    // A state neither list admits is not a state to guess a destination from: the pool is the page that tells a
    // judge what there is to do next, and it is the one link the unavailable page offers as well.
    it("should fall back to the pool when api published no state to derive a list from", async () => {
      vi.mocked(getReferral).mockResolvedValue(detail({ state: null }) as never);
      const res = pageResponse();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].backHref).toBe("/judicial/referrals");
    });

    // Not a `returnTo`, which decision 5 forbids: it would be an open redirect to validate, and wrong in the
    // ordinary case anyway, since claiming moves the referral off the list the judge arrived from.
    it("should ignore a destination the URL asked for", async () => {
      const res = pageResponse();

      await GET(request("ref-1", { returnTo: "https://evil.example/", return: "/judicial/referrals/mine" }), res);

      expect(res.render.mock.calls[0][1].backHref).toBe("/judicial/referrals");
    });
  });

  // Every other failure is a fault. A ForbiddenError here would mean the role gate admitted someone api then
  // refused, which is a bug to see on the 500 page rather than to dress as a missing referral.
  it("should let a failure that is not a 404 reach the error handler", async () => {
    vi.mocked(getReferral).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

    await expect(GET(request(), pageResponse())).rejects.toThrow("unavailable");
  });

  // What a redirect sends the judge back with. Two shapes — a banner for a success, a summary for a refusal —
  // and two sources for the refusal, since api's 409 on a claim lands here too.
  describe("what a redirect comes back with", () => {
    it("should say the direction was recorded when it has just been", async () => {
      vi.mocked(getReferral).mockResolvedValue(decided() as never);
      const res = pageResponse();

      await GET(request("ref-1", { direction: "recorded" }), res);

      expect(res.render.mock.calls[0][1].directionRecorded).toBe("Your direction has been recorded.");
      expect(res.render.mock.calls[0][1].refused).toBe("");
    });

    // The banner asserts a write, so the query alone must not be enough to show it: a stale or shared
    // `?direction=recorded` would otherwise announce a direction beside a status of `Open` and a claim button.
    it("should say nothing when the query claims a direction api holds none for", async () => {
      const res = pageResponse();

      await GET(request("ref-1", { direction: "recorded" }), res);

      expect(res.render.mock.calls[0][1].directionRecorded).toBe("");
    });

    // api's 409: visible, but not in this judge's hands — it went back to the pool, or they have already directed
    // it. The sentence has to stay true of both, and must name no other judge.
    it("should say the referral is not waiting for this judge's direction when api refused it", async () => {
      const res = pageResponse();

      await GET(request("ref-1", { direction: "notheld" }), res);

      expect(res.render.mock.calls[0][1].refused).toBe("This referral is not waiting for a direction from you. Check its status below.");
      expect(res.render.mock.calls[0][1].directionRecorded).toBe("");
    });

    // api's 409 on a *claim*, which its visibility narrows to a referral this judge already holds or has already
    // directed — a referral another judge took is a 404 and never gets here. So the sentence names the state and
    // not a holder: "already been claimed" would tell a judge somebody else has work that is theirs.
    it("should say the referral is not waiting to be claimed when api 409s a claim", async () => {
      const res = pageResponse();

      await GET(request("ref-1", { claim: "held" }), res);

      expect(res.render.mock.calls[0][1].refused).toBe("This referral is not waiting to be claimed. Check its status below.");
      expect(res.render.mock.calls[0][1].directionRecorded).toBe("");
    });

    it("should name no other judge in either refusal, because api does not say who holds it", async () => {
      for (const query of [{ direction: "notheld" }, { claim: "held" }]) {
        const res = pageResponse();

        await GET(request("ref-1", query), res);

        expect(res.render.mock.calls[0][1].refused).not.toMatch(/claimed by|belongs to|held by|another judge|already been claimed/i);
      }
    });

    it("should say nothing at all for a hand-typed value, which pins no state", async () => {
      const res = pageResponse();

      await GET(request("ref-1", { direction: "whatever", claim: "whatever" }), res);

      expect(res.render.mock.calls[0][1].directionRecorded).toBe("");
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
