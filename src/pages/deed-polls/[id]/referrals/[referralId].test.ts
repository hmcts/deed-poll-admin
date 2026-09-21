import { findDeedPoll, findReferral, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET } from "./[referralId].js";

// `buildReferralDetail` is the domain's and runs for real: the labels, the placeholders and the two capability
// rules are what this page is made of.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findReferral: vi.fn()
}));

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

const PARAMS = { id: "case-1", referralId: "ref-1" };

const CALLER = { accessToken: "session-token" };

/** A judge's answer, as api publishes it on a `Decided` or `Closed` referral. */
const DIRECTED = {
  state: "Decided",
  claimedBy: "A Judge",
  claimedAt: new Date("2026-05-14T09:00:00Z"),
  decision: "Approved",
  directionsText: "Serve the notice on the second respondent.",
  publishToGazette: true,
  decisionDate: new Date("2026-05-15T10:30:00Z"),
  decidedBy: "A Judge"
};

const REFERRAL = {
  id: "ref-1",
  state: "Open",
  reasons: ["Minor", "Other"],
  notes: "The applicant turns 16 next month.",
  urgency: "Urgent",
  urgencyReason: "Hearing listed on Friday.",
  migrated: false,
  claimedBy: null,
  claimedAt: null,
  decision: null,
  directionsText: null,
  publishToGazette: null,
  decisionDate: null,
  decidedBy: null,
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  createdOn: new Date("2026-05-13T08:44:00Z"),
  modifiedOn: new Date("2026-05-13T08:44:00Z")
};

function request(query: Record<string, unknown> = {}) {
  return pageRequest({ params: PARAMS, query, accessToken: "session-token" });
}

const response = pageResponse;

describe("referral view page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findReferral).mockResolvedValue(REFERRAL as never);
  });

  it("should read the referral scoped to the case in the path", async () => {
    await GET(request(), response());

    expect(findReferral).toHaveBeenCalledWith("case-1", "ref-1", CALLER);
  });

  it("should render the referral read-only against the case's reference", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][0]).toBe("deed-polls/referral-detail");
    expect(res.render.mock.calls[0][1].case.displayReference).toBe("KBDP2026-00001");
    expect(res.render.mock.calls[0][1].referral.state).toBe("Awaiting a judge");
  });

  it("should show the reasons as labels rather than api's enum members", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.reasons).toEqual(["Applicant is a minor", "Other"]);
  });

  it("should show the referral's own urgency and reason, with Normal read as Standard", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.urgency).toBe("Urgent");
    expect(res.render.mock.calls[0][1].referral.urgencyReason).toBe("Hearing listed on Friday.");

    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, urgency: "Normal", urgencyReason: null } as never);
    const standard = response();

    await GET(request(), standard);

    expect(standard.render.mock.calls[0][1].referral.urgency).toBe("Standard");
  });

  it("should offer the withdraw action on a referral the judiciary has not answered", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.canWithdraw).toBe(true);
    expect(res.render.mock.calls[0][1].referral.canClose).toBe(false);
  });

  it.each(["Closed", "Withdrawn"] as const)("should offer neither action on a %s referral", async (state) => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, state } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.canWithdraw).toBe(false);
    expect(res.render.mock.calls[0][1].referral.canClose).toBe(false);
  });

  it("should offer neither action on a state this app cannot read, rather than letting api refuse one", async () => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, state: null } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.canWithdraw).toBe(false);
    expect(res.render.mock.calls[0][1].referral.canClose).toBe(false);
    // Nothing true to say about it either, so the page leaves the sentence out instead of explaining an unknown.
    expect(res.render.mock.calls[0][1].referral.stateMeaning).toBeNull();
  });

  it("should offer closing and not withdrawing on a referral a judge has directed", async () => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...DIRECTED } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.canWithdraw).toBe(false);
    expect(res.render.mock.calls[0][1].referral.canClose).toBe(true);
    expect(res.render.mock.calls[0][1].closeHref).toBe("/deed-polls/case-1/referrals/ref-1/close");
  });

  it("should say a returned direction needs actioning rather than only naming the state", async () => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...DIRECTED } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.state).toBe("Direction received");
    expect(res.render.mock.calls[0][1].referral.stateMeaning).toBe("Direction received — action needed");
  });

  it("should show the complete returned direction, with the deciding judge and not the last modifier", async () => {
    // `modifiedBy` is the caseworker throughout — closing the referral would make them the modifier, and reading
    // the direction's author off that field would credit the judge's decision to them.
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...DIRECTED } as never);
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

  it("should keep the direction readable after closure, since api preserves the judicial fields", async () => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...DIRECTED, state: "Closed", modifiedBy: "A Caseworker" } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.direction.decidedBy).toBe("A Judge");
    expect(res.render.mock.calls[0][1].referral.modifiedBy).toBe("A Caseworker");
  });

  it("should show no direction section on a referral the judiciary has not answered", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.direction).toBeNull();
  });

  it("should distinguish a direction with no further directions from one that was never given", async () => {
    // An approval may carry no directions, so the placeholder goes *inside* a section that exists. A referral
    // with no direction at all has no section — the case above.
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...DIRECTED, directionsText: null } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.direction.directionsText).toBe("Not provided");
  });

  it.each([
    { publishToGazette: true, answer: "Yes" },
    { publishToGazette: false, answer: "No" },
    // The third state said rather than collapsed: "No" would assert a direction against publication that the
    // judge never gave.
    { publishToGazette: null, answer: "Not recorded" }
  ])("should read a publishToGazette of $publishToGazette as $answer", async ({ publishToGazette, answer }) => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...DIRECTED, publishToGazette } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].gazetteAnswer).toBe(answer);
  });

  it("should show the claim once a judge has picked the referral up", async () => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, state: "Claimed", claimedBy: "A Judge", claimedAt: new Date("2026-05-14T09:00:00Z") } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.claim).toEqual({ claimedBy: "A Judge", claimedOn: "14 May 2026 at 10:00am" });
    expect(res.render.mock.calls[0][1].referral.canWithdraw).toBe(true);
  });

  it("should show no claim on a referral nobody has picked up, rather than an unrecorded one", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.claim).toBeNull();
  });

  it("should carry migrated with no reasons, so the page explains the empty cell", async () => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, migrated: true, reasons: [] } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.migrated).toBe(true);
    expect(res.render.mock.calls[0][1].referral.reasons).toEqual([]);
  });

  it("should say the referral is already over when the withdraw route sent the caseworker back from a terminal one", async () => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, state: "Closed" } as never);
    const res = response();

    await GET(request({ withdraw: "conflict" }), res);

    expect(res.render.mock.calls[0][1].withdrawRefused).toBe("This referral has already been closed or withdrawn.");
  });

  it("should not tell a caseworker looking at a returned direction that they have already withdrawn it", async () => {
    // api's other refusal (api-4): `Decided` is not withdrawable *and* not terminal, so "already withdrawn"
    // would be false in both halves. The message points at the control the page actually offers.
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...DIRECTED } as never);
    const res = response();

    await GET(request({ withdraw: "conflict" }), res);

    expect(res.render.mock.calls[0][1].withdrawRefused).toContain("can no longer be withdrawn");
    expect(res.render.mock.calls[0][1].withdrawRefused).toContain("mark it as actioned");
    expect(res.render.mock.calls[0][1].withdrawRefused).not.toContain("already been closed or withdrawn");
  });

  it("should show no refused-withdrawal message on an ordinary visit", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].withdrawRefused).toBe("");
  });

  it("should confirm a closure that landed, against the state api has just published", async () => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...DIRECTED, state: "Closed" } as never);
    const res = response();

    await GET(request({ close: "actioned" }), res);

    expect(res.render.mock.calls[0][1].directionActioned).toBe("The direction has been marked as actioned.");
    expect(res.render.mock.calls[0][1].referral.state).toBe("Direction actioned");
    expect(res.render.mock.calls[0][1].referral.canClose).toBe(false);
    expect(res.render.mock.calls[0][1].closeRefused).toBe("");
  });

  it("should say a refused closure was already actioned when api's fresh state says it was", async () => {
    // The likely race: two caseworkers on the same returned direction. Naming it is the difference between
    // "somebody has done this" and "something changed".
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...DIRECTED, state: "Closed" } as never);
    const res = response();

    await GET(request({ close: "conflict" }), res);

    expect(res.render.mock.calls[0][1].closeRefused).toBe("This referral has already been marked as actioned.");
    expect(res.render.mock.calls[0][1].directionActioned).toBe("");
  });

  it.each(["Withdrawn", "Open", "Claimed", null])("should not claim a %s referral was already actioned when api refused the closure", async (state) => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, state } as never);
    const res = response();

    await GET(request({ close: "conflict" }), res);

    expect(res.render.mock.calls[0][1].closeRefused).toContain("no longer waiting for a direction to be actioned");
    expect(res.render.mock.calls[0][1].closeRefused).not.toContain("already been marked as actioned");
  });

  it("should show neither closure message on an ordinary visit", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].directionActioned).toBe("");
    expect(res.render.mock.calls[0][1].closeRefused).toBe("");
  });

  it("should 404 for a referral that is not under this case, which is api's answer and not a local check", async () => {
    vi.mocked(findReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));

    await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
  });
});
