import { listPool } from "@hmcts/deed-poll";
import type { JudicialPool, JudicialReferralSummary } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  listPool: vi.fn()
}));

/** The session's access token, which is the whole of what this page passes to the domain. */
const CALLER = { accessToken: "judge-token" };

const referral = (overrides: Partial<JudicialReferralSummary> = {}): JudicialReferralSummary =>
  ({
    id: "ref-1",
    state: "Open",
    reasons: ["Minor"],
    notes: null,
    urgency: "Normal",
    urgencyReason: null,
    createdOn: new Date("2026-09-03T08:44:00Z"),
    ...overrides
  }) as JudicialReferralSummary;

const pool = (overrides: Partial<JudicialPool> = {}): JudicialPool =>
  ({
    referrals: [referral()],
    page: 1,
    size: 10,
    total: 1,
    totalPages: 1,
    ...overrides
  }) as JudicialPool;

function request(query: Record<string, unknown> = {}) {
  return pageRequest({ query, judicial: true, accessToken: "judge-token" });
}

describe("the judicial pool page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listPool).mockResolvedValue(pool() as never);
  });

  it("should render the pool with the judge's token and nothing else", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/index");
    expect(listPool).toHaveBeenCalledWith({ page: undefined }, CALLER);
  });

  // Decision 3: the queue is one order that api fixes, so the only thing the URL carries is which page of it.
  it("should ask api for the page the URL names and nothing more", async () => {
    await GET(request({ page: "3" }), pageResponse());

    expect(listPool).toHaveBeenCalledWith({ page: 3 }, CALLER);
  });

  it("should fall back to api's first page for a page number that names none", async () => {
    await GET(request({ page: "nonsense" }), pageResponse());

    expect(listPool).toHaveBeenCalledWith({ page: undefined }, CALLER);
  });

  it("should render api's order exactly, urgent first then longest waiting", async () => {
    const referrals = [
      referral({ id: "urgent", urgency: "Urgent" }),
      referral({ id: "oldest-normal", createdOn: new Date("2026-08-01T09:00:00Z") }),
      referral({ id: "newest-normal", createdOn: new Date("2026-09-10T09:00:00Z") })
    ];
    vi.mocked(listPool).mockResolvedValue(pool({ referrals, total: 3 }) as never);
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].rows.map((row: { id: string }) => row.id)).toEqual(["urgent", "oldest-normal", "newest-normal"]);
  });

  it("should render each row's urgency, reasons and wait, with a link qualified by the wait", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].rows).toEqual([
      {
        id: "ref-1",
        reasons: ["Applicant is a minor"],
        urgency: "Standard",
        isUrgent: false,
        waitingSince: "3 September 2026 at 9:44am",
        viewHint: "the referral waiting since 3 September 2026 at 9:44am"
      }
    ]);
  });

  // api's count across every page, which is exactly what the rows on screen cannot say: ten is a page size
  // and not a cap, so a row count would read as "there are ten" on a pool of eleven.
  it("should state api's total rather than counting the rows on screen", async () => {
    vi.mocked(listPool).mockResolvedValue(pool({ referrals: [referral(), referral({ id: "ref-2" })], total: 23, totalPages: 3 }) as never);
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].pagingSummary).toBe("1 to 10 of 23 referrals");
    expect(res.render.mock.calls[0][1].paging).toMatchObject({ total: 23, totalPages: 3 });
  });

  it("should page through the pool by URL, carrying nothing else", async () => {
    vi.mocked(listPool).mockResolvedValue(pool({ page: 2, total: 23, totalPages: 3 }) as never);
    const res = pageResponse();

    await GET(request({ page: "2" }), res);

    const { paging } = res.render.mock.calls[0][1];
    expect(paging.links.previous).toEqual({ href: "/judicial/referrals?page=1" });
    expect(paging.links.next).toEqual({ href: "/judicial/referrals?page=3" });
  });

  it("should state no range for an empty pool rather than '0 to 0 of 0'", async () => {
    vi.mocked(listPool).mockResolvedValue(pool({ referrals: [], total: 0, totalPages: 0 }) as never);
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1]).toMatchObject({ rows: [], pagingSummary: "" });
  });

  // Decision 10: withdrawn, closed, another judge's and never-existed are one answer, so they get one
  // sentence — and it must not imply a holder.
  it("should say a referral is no longer available when api refused the claim with a 404", async () => {
    const res = pageResponse();

    await GET(request({ claim: "unavailable" }), res);

    expect(res.render.mock.calls[0][1].claimRefused).toBe("This referral is no longer available. Choose another referral from the list.");
    expect(res.render.mock.calls[0][1].claimRefused).not.toMatch(/judge/i);
  });

  it("should say nothing about a claim for a hand-typed query value, which pins no state", async () => {
    const res = pageResponse();

    await GET(request({ claim: "whatever" }), res);

    expect(res.render.mock.calls[0][1].claimRefused).toBe("");
  });

  // api checks visibility before state, so a claim 409 can only describe a referral this judge already holds —
  // `claim.ts` sends that one to the referral. The pool must not grow an "already claimed" sentence for it: that
  // reads as another judge's, which decision 10 forbids, about work that is in fact theirs.
  it("should say nothing for a claim 409, which never lands here and would read as another judge's if it did", async () => {
    const res = pageResponse();

    await GET(request({ claim: "held" }), res);

    expect(res.render.mock.calls[0][1].claimRefused).toBe("");
    expect(Object.values(res.render.mock.calls[0][1].en as Record<string, unknown>)).not.toContain(
      "This referral has already been claimed. Choose another referral from the list."
    );
  });

  it("should say nothing about a claim on an ordinary visit", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].claimRefused).toBe("");
  });

  it("should carry both locales, so the pool is bilingual like every other page", async () => {
    const res = pageResponse();

    await GET(request(), res);

    const { en, cy } = res.render.mock.calls[0][1];
    expect(Object.keys(cy)).toEqual(Object.keys(en));
    expect(en.heading).toBe("Referrals for a direction");
  });

  it("should resolve its wording in Welsh when the request is Welsh", async () => {
    const res = pageResponse();
    res.locals.locale = "cy";

    await GET(request({ claim: "unavailable" }), res);

    expect(res.render.mock.calls[0][1].claimRefused).toBe("This referral is no longer available. Choose another referral from the list.");
  });

  // The pool is the whole page: there is no additive panel to degrade, so an unreadable pool is not a page.
  it("should let an unreadable pool reach the error handler rather than rendering an empty one", async () => {
    vi.mocked(listPool).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

    await expect(GET(request(), pageResponse())).rejects.toThrow("unavailable");
  });
});
