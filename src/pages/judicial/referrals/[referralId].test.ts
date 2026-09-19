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
      oldForename: "John",
      oldMiddleName: "Peter",
      oldSurname: "Smith",
      newForename: "John",
      newMiddleName: "Peter",
      newSurname: "Smyth"
    },
    caseNotes: [{ note: "Chased the declarant", createdBy: "A Caseworker", createdOn: new Date("2026-09-02T14:30:00Z") }],
    ...overrides
  }) as JudicialReferralDetail;

function request(referralId = "ref-1") {
  return pageRequest({ params: { referralId }, judicial: true, accessToken: "judge-token" });
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

  it("should render the narrow application view and nothing beside it", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.application).toEqual({
      reference: "KBDP2026-00001",
      type: "Minor",
      oldName: "John Peter Smith",
      newName: "John Peter Smyth"
    });
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

    const { en } = res.render.mock.calls[0][1];
    expect(`${en.heading} ${en.body}`).not.toMatch(/claimed by|belongs to|held by/i);
  });

  it("should offer the way back to the pool from the unavailable page", async () => {
    vi.mocked(getReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].poolPath).toBe("/judicial/referrals");
  });

  // Every other failure is a fault. A ForbiddenError here would mean the role gate admitted someone api then
  // refused, which is a bug to see on the 500 page rather than to dress as a missing referral.
  it("should let a failure that is not a 404 reach the error handler", async () => {
    vi.mocked(getReferral).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

    await expect(GET(request(), pageResponse())).rejects.toThrow("unavailable");
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
