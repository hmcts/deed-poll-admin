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

/** The confirmation columns api publishes on a referral whose applicant has been asked and has not answered. */
const AWAITING = {
  confirmationRequestedAt: new Date("2026-05-20T08:00:00Z"),
  confirmationOutcome: null,
  confirmationReceivedAt: null,
  confirmationRecordedBy: null
};

/** And the same referral once a caseworker has recorded what they said. */
const RECORDED = {
  confirmationOutcome: "Confirmed",
  confirmationReceivedAt: new Date("2026-05-22T09:30:00Z"),
  confirmationRecordedBy: "A Caseworker"
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

  it("should tell the caseworker when the judge changed the direction, dated from api's flag", async () => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...DIRECTED, directionChangedAt: new Date("2026-10-19T09:30:00Z") } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].directionChanged).toBe("The judge changed this direction on 19 October 2026 at 10:30am.");
  });

  it("should say nothing about a change on a direction that stands as first given", async () => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...DIRECTED, directionChangedAt: null } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].directionChanged).toBe("");
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

  describe("the applicant's confirmation", () => {
    it("should say nothing about a confirmation on a referral nobody was asked about", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].referral.confirmation).toBeNull();
      expect(res.render.mock.calls[0][1].confirmationAnswer).toBe("");
    });

    it("should offer the recording action while api holds a request and no answer", async () => {
      vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...AWAITING } as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].referral.confirmation.awaiting).toBe(true);
      expect(res.render.mock.calls[0][1].referral.confirmation.requestedOn).toBe("20 May 2026 at 9:00am");
      expect(res.render.mock.calls[0][1].confirmationAnswer).toBe("Not yet recorded");
      expect(res.render.mock.calls[0][1].confirmationHref).toBe("/deed-polls/case-1/referrals/ref-1/confirmation");
    });

    it("should read the recorded answer back in the words the form asked it in, with who recorded it and when", async () => {
      // "Response recorded" is api's own clock stamping when a caseworker recorded the answer — never when the
      // applicant replied, which nothing in this service holds.
      vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...AWAITING, ...RECORDED } as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].confirmationAnswer).toBe("The applicant wants to proceed");
      expect(res.render.mock.calls[0][1].referral.confirmation.awaiting).toBe(false);
      expect(res.render.mock.calls[0][1].referral.confirmation.recordedOn).toBe("22 May 2026 at 10:30am");
      expect(res.render.mock.calls[0][1].referral.confirmation.recordedBy).toBe("A Caseworker");
    });

    it("should still offer the recording action on a closed referral, because api clears neither confirmation column", async () => {
      // The wait is not a referral state: a case stays on the awaiting-confirmation worklist under a closed
      // referral's outstanding request, so keying this on `canWithdraw`/`canClose` would strand it there.
      vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...AWAITING, state: "Closed" } as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].referral.confirmation.awaiting).toBe(true);
      expect(res.render.mock.calls[0][1].referral.canWithdraw).toBe(false);
      expect(res.render.mock.calls[0][1].referral.canClose).toBe(false);
    });

    it("should confirm a recording that landed, beside the answer api has just published", async () => {
      vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...AWAITING, ...RECORDED } as never);
      const res = response();

      await GET(request({ confirmation: "recorded" }), res);

      expect(res.render.mock.calls[0][1].confirmationRecorded).toBe("The applicant's response has been recorded.");
      expect(res.render.mock.calls[0][1].confirmationRefused).toBe("");
    });

    it("should name the answer as already recorded when the fresh read holds one", async () => {
      vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...AWAITING, ...RECORDED } as never);
      const res = response();

      await GET(request({ confirmation: "conflict" }), res);

      expect(res.render.mock.calls[0][1].confirmationRefused).toBe("The applicant's response has already been recorded.");
      expect(res.render.mock.calls[0][1].confirmationRecorded).toBe("");
    });

    it("should say the applicant was never asked when the fresh read holds no request either", async () => {
      // api's other 409, told apart by the referral rather than by the prose of the refusal — which this app must
      // not parse, since the two are distinguishable only by their wording.
      const res = response();

      await GET(request({ confirmation: "conflict" }), res);

      expect(res.render.mock.calls[0][1].confirmationRefused).toContain("has not been asked whether they still want to proceed");
      expect(res.render.mock.calls[0][1].confirmationRefused).not.toContain("already been recorded");
    });

    it("should show neither confirmation message on an ordinary visit", async () => {
      vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...AWAITING } as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].confirmationRecorded).toBe("");
      expect(res.render.mock.calls[0][1].confirmationRefused).toBe("");
    });
  });

  // The close and confirmation links are built from both route parameters, so both go through the shared path rules.
  describe("ids that are not plain path segments", () => {
    function delimited(params: Record<string, string>) {
      return pageRequest({ params, accessToken: "session-token" });
    }

    it("should build the action links from the encoded case and referral ids", async () => {
      vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, ...DIRECTED } as never);
      const res = response();

      await GET(delimited({ id: "a/b?c#d", referralId: "ref/1" }), res);

      expect(res.render.mock.calls[0][1].closeHref).toBe("/deed-polls/a%2Fb%3Fc%23d/referrals/ref%2F1/close");
      expect(res.render.mock.calls[0][1].confirmationHref).toBe("/deed-polls/a%2Fb%3Fc%23d/referrals/ref%2F1/confirmation");
      expect(findReferral).toHaveBeenCalledWith("a/b?c#d", "ref/1", expect.anything());
    });

    it.each([
      ["case", { id: "..", referralId: "ref-1" }],
      ["referral", { id: "case-1", referralId: "." }],
      ["referral", { id: "case-1", referralId: "" }]
    ])("should 404 a dot-only or empty %s id without reading anything", async (_which, params) => {
      await expect(GET(delimited(params), response())).rejects.toThrow(NotFoundError);

      expect(findDeedPoll).not.toHaveBeenCalled();
      expect(findReferral).not.toHaveBeenCalled();
    });
  });
});
