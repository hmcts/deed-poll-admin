import { findDeedPoll, findReferral, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET } from "./[referralId].js";

// `buildReferralDetail` is the domain's and runs for real: the labels, the placeholders and the one terminal
// rule are what this page is made of.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findReferral: vi.fn()
}));

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

const PARAMS = { id: "case-1", referralId: "ref-1" };

const CALLER = { accessToken: "session-token" };

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
    expect(res.render.mock.calls[0][1].referral.state).toBe("Open");
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

  it("should offer the withdraw action on a referral that is not terminal", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.terminal).toBe(false);
  });

  it.each(["Closed", "Withdrawn"] as const)("should offer no withdraw action on a %s referral", async (state) => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, state } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.terminal).toBe(true);
  });

  it("should carry migrated with no reasons, so the page explains the empty cell", async () => {
    vi.mocked(findReferral).mockResolvedValue({ ...REFERRAL, migrated: true, reasons: [] } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referral.migrated).toBe(true);
    expect(res.render.mock.calls[0][1].referral.reasons).toEqual([]);
  });

  it("should show the refused-withdrawal message when the withdraw route sent the caseworker back", async () => {
    const res = response();

    await GET(request({ withdraw: "conflict" }), res);

    expect(res.render.mock.calls[0][1].withdrawRefused).toBe(true);
  });

  it("should show no refused-withdrawal message on an ordinary visit", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].withdrawRefused).toBe(false);
  });

  it("should 404 for a referral that is not under this case, which is api's answer and not a local check", async () => {
    vi.mocked(findReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));

    await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
  });
});
