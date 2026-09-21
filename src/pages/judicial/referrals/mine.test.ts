/**
 * A judge's own referrals, as a model: what the page asks api for, and what it does with the page it gets back.
 *
 * The second half of this file is a **routing** test rather than a model one, and it is here because decision 6
 * is a property of this page's *name*: `/judicial/referrals/mine` has to win over `[referralId].ts`, or the word
 * is read as a referral id and a page that exists answers "no longer available". Nothing about either file
 * reveals which way `simple-router` sorted them, so it is driven through a real router.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getReferral, listMyReferrals, NotFoundError } from "@hmcts/deed-poll";
import type { JudicialMyReferrals, JudicialReferralSummary } from "@hmcts/deed-poll-api-client";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET } from "./mine.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  listMyReferrals: vi.fn(),
  getReferral: vi.fn()
}));

/** The session's access token, which is the whole of what this page passes to the domain. */
const CALLER = { accessToken: "judge-token" };

const referral = (overrides: Partial<JudicialReferralSummary> = {}): JudicialReferralSummary =>
  ({
    id: "ref-1",
    state: "Claimed",
    reasons: ["Minor"],
    notes: null,
    urgency: "Normal",
    urgencyReason: null,
    createdOn: new Date("2026-09-03T08:44:00Z"),
    ...overrides
  }) as JudicialReferralSummary;

const mine = (overrides: Partial<JudicialMyReferrals> = {}): JudicialMyReferrals =>
  ({
    referrals: [referral()],
    page: 1,
    size: 10,
    total: 1,
    totalPages: 1,
    ...overrides
  }) as JudicialMyReferrals;

function request(query: Record<string, unknown> = {}) {
  return pageRequest({ query, judicial: true, accessToken: "judge-token" });
}

describe("the judge's own referrals page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMyReferrals).mockResolvedValue(mine() as never);
  });

  it("should render the list with the judge's token and nothing identifying them", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/mine");
    expect(listMyReferrals).toHaveBeenCalledWith({ page: undefined }, CALLER);
  });

  // Decision 1: ownership is api's, from the token's subject. A judge in the request would be a judge a judge
  // could change.
  it("should send api nothing but a page, so whose list this is cannot be asked for", async () => {
    await GET(request({ page: "3", judge: "somebody.else@example.com", claimedBy: "somebody.else" }), pageResponse());

    expect(listMyReferrals).toHaveBeenCalledWith({ page: 3 }, CALLER);
  });

  it("should fall back to api's first page for a page number that names none", async () => {
    await GET(request({ page: "nonsense" }), pageResponse());

    expect(listMyReferrals).toHaveBeenCalledWith({ page: undefined }, CALLER);
  });

  // Decision 2: api orders the list — unfinished work first, then the pool's own keys — and this page does not
  // regroup it by status or sort it by anything.
  it("should render api's order exactly", async () => {
    const referrals = [
      referral({ id: "still-needed", state: "Claimed" }),
      referral({ id: "answered", state: "Decided" }),
      referral({ id: "also-needed", state: "Claimed" })
    ];
    vi.mocked(listMyReferrals).mockResolvedValue(mine({ referrals, total: 3 }) as never);
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].rows.map((row: { id: string }) => row.id)).toEqual(["still-needed", "answered", "also-needed"]);
  });

  it("should render each row's status, urgency, reasons and date, with a link qualified by both", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].rows).toEqual([
      {
        id: "ref-1",
        status: "Direction needed",
        statusTagClasses: "govuk-tag--purple",
        reasons: ["Applicant is a minor"],
        urgency: "Standard",
        isUrgent: false,
        raisedOn: "3 September 2026 at 9:44am",
        viewHint: "the referral referred on 3 September 2026 at 9:44am, Direction needed"
      }
    ]);
  });

  // Decision 2's wording, and the half a judge reads about work they have already done.
  it("should call a decided referral a recorded direction rather than the caseworker's words for it", async () => {
    vi.mocked(listMyReferrals).mockResolvedValue(mine({ referrals: [referral({ state: "Decided" })] }) as never);
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].rows[0]).toMatchObject({ status: "Direction recorded", statusTagClasses: "govuk-tag--green" });
  });

  // Decision 3: the row is `JudicialReferralSummary` and there is nothing on the page to enrich it with.
  it("should put no case or applicant field on any row", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(Object.keys(res.render.mock.calls[0][1].rows[0])).toEqual([
      "id",
      "status",
      "statusTagClasses",
      "reasons",
      "urgency",
      "isUrgent",
      "raisedOn",
      "viewHint"
    ]);
  });

  it("should state api's total rather than counting the rows on screen", async () => {
    vi.mocked(listMyReferrals).mockResolvedValue(mine({ referrals: [referral(), referral({ id: "ref-2" })], total: 23, totalPages: 3 }) as never);
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].pagingSummary).toBe("1 to 10 of 23 referrals");
    expect(res.render.mock.calls[0][1].paging).toMatchObject({ total: 23, totalPages: 3 });
  });

  it("should page through its own path, not the pool's", async () => {
    vi.mocked(listMyReferrals).mockResolvedValue(mine({ page: 2, total: 23, totalPages: 3 }) as never);
    const res = pageResponse();

    await GET(request({ page: "2" }), res);

    const { paging } = res.render.mock.calls[0][1];
    expect(paging.links.previous).toEqual({ href: "/judicial/referrals/mine?page=1" });
    expect(paging.links.next).toEqual({ href: "/judicial/referrals/mine?page=3" });
  });

  it("should state no range for a judge holding nothing rather than '0 to 0 of 0'", async () => {
    vi.mocked(listMyReferrals).mockResolvedValue(mine({ referrals: [], total: 0, totalPages: 0 }) as never);
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1]).toMatchObject({ rows: [], pagingSummary: "" });
  });

  it("should mark itself as the current judicial list", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].navCurrent).toBe("mine");
  });

  it("should name both judicial lists, so the pair cannot diverge", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].en.nav).toEqual({
      label: "Referral lists",
      pool: "Referrals for a direction",
      mine: "My referrals"
    });
  });

  it("should carry both locales, so the list is bilingual like every other page", async () => {
    const res = pageResponse();

    await GET(request(), res);

    const { en, cy } = res.render.mock.calls[0][1];
    expect(Object.keys(cy)).toEqual(Object.keys(en));
    expect(en.heading).toBe("My referrals");
  });

  it("should resolve its wording in Welsh when the request is Welsh", async () => {
    const res = pageResponse();
    res.locals.locale = "cy";

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].rows[0].viewHint).toBe("the referral referred on 3 September 2026 at 9:44am, Direction needed");
  });

  // Decision 8: the list is the whole page, so an unreadable one is not a page. An empty "My referrals" would
  // tell a judge their work had gone.
  it("should let an unreadable list reach the error handler rather than rendering an empty one", async () => {
    vi.mocked(listMyReferrals).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

    await expect(GET(request(), pageResponse())).rejects.toThrow("unavailable");
  });
});

/**
 * Decision 6, through a real `simple-router` over the real `src/pages` tree.
 *
 * `sortRoutes` puts static segments ahead of parameterised ones, but nothing in either page file says so and a
 * change to that sort would break this page silently: `/judicial/referrals/mine` would reach `[referralId].ts`,
 * api would answer 404 for a referral id of `"mine"`, and the judge would be told their list is no longer
 * available. So the assertion is which handler answered, not which order the paths were registered in.
 *
 * The view engine is a stub that names the template it was given: this is about dispatch, and the templates are
 * `mine.njk.test.ts`'s subject.
 */
describe("the /mine route", () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(listMyReferrals).mockResolvedValue(mine() as never);
    vi.mocked(getReferral).mockRejectedValue(new NotFoundError("Referral mine not found"));

    const pages = path.join(fileURLToPath(import.meta.url), "../../../../pages");
    app = express();
    app.engine("njk", (file, _options, callback) => callback(null, path.basename(file)));
    app.set("view engine", "njk");
    app.set("views", pages);
    // The session `requireAuth` guarantees a page, since this app is the router alone.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { session: unknown }).session = { deedPoll: { accessToken: "judge-token" } };
      next();
    });
    app.use(await createSimpleRouter({ path: pages }));
  });

  it("should render the list rather than treating 'mine' as a referral id", async () => {
    const response = await supertest(app).get("/judicial/referrals/mine");

    expect(response.status).toBe(200);
    expect(response.text).toBe("mine.njk");
    expect(listMyReferrals).toHaveBeenCalledTimes(1);
    expect(getReferral).not.toHaveBeenCalled();
  });

  it("should still read a referral id that is not the literal word", async () => {
    const response = await supertest(app).get("/judicial/referrals/ref-1");

    expect(getReferral).toHaveBeenCalledWith("ref-1", CALLER);
    expect(listMyReferrals).not.toHaveBeenCalled();
    // The stubbed read answers 404, which is `[referralId].ts`'s own page rather than this one's.
    expect(response.status).toBe(404);
    expect(response.text).toBe("unavailable.njk");
  });

  it("should carry the page number through to api", async () => {
    await supertest(app).get("/judicial/referrals/mine?page=2");

    expect(listMyReferrals).toHaveBeenCalledWith({ page: 2 }, CALLER);
  });
});
