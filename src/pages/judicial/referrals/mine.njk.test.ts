/**
 * My referrals' markup, rendered rather than asserted through the view model.
 *
 * The model is `mine.test.ts`'s subject. What this file pins is what a model cannot: that each row links by its
 * referral id with an accessible name that distinguishes it, that the list carries **no** case data, that the
 * sections and day headings are drawn in order, and that api's total is what appears on the page rather
 * than the number of rows.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listMyReferrals } from "@hmcts/deed-poll";
import type { JudicialMyReferrals, JudicialReferralSummary } from "@hmcts/deed-poll-api-client";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { addPathFilters } from "../../../path-filters.js";
import { GET } from "./mine.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  listMyReferrals: vi.fn()
}));

const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "../../../..", "pages")
  ],
  { autoescape: true }
);
addPathFilters(environment);

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

/** The list as a browser receives it, for the page api answers with. */
const render = async (mine: Partial<JudicialMyReferrals>, query: Record<string, unknown> = {}): Promise<string> => {
  vi.mocked(listMyReferrals).mockResolvedValue({ referrals: [], page: 1, size: 10, total: 0, totalPages: 0, ...mine } as never);
  const res = pageResponse();
  await GET(pageRequest({ query, judicial: true, accessToken: "judge-token" }), res);
  const model = res.render.mock.calls[0][1];

  return environment.render("judicial/referrals/mine.njk", { ...model.en, ...model });
};

describe("my referrals template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should link each row to the referral, qualified so 'View' is not every link's name", async () => {
    const html = await render({ referrals: [referral()], total: 1, totalPages: 1 });

    expect(html).toContain('href="/judicial/referrals/ref-1"');
    expect(html).toContain('<span class="govuk-visually-hidden"> the referral referred on 03-09-26: Applicant is a minor</span>');
  });

  it("should draw the three sections in order, each day under its own heading", async () => {
    const html = await render({
      referrals: [
        referral({ id: "urgent", urgency: "Urgent", createdOn: new Date("2026-10-20T09:00:00Z"), directionDueBy: new Date("2026-10-27T09:00:00Z") }),
        referral({ id: "await", createdOn: new Date("2026-10-21T09:00:00Z"), directionDueBy: new Date("2026-10-28T09:00:00Z") }),
        referral({ id: "directed", state: "Decided", createdOn: new Date("2026-10-16T09:00:00Z") })
      ],
      total: 3,
      totalPages: 1
    });

    const order = [
      '<h2 class="govuk-heading-l">Urgent</h2>',
      "Awaiting your direction",
      "21-10-26 referrals",
      "Directed, awaiting the office",
      "16-10-26 referrals"
    ];
    const positions = order.map((text) => html.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("should show an urgent row's referred and due dates, and only the due date under a day's heading", async () => {
    const html = await render({
      referrals: [
        referral({ id: "urgent", urgency: "Urgent", createdOn: new Date("2026-10-20T09:00:00Z"), directionDueBy: new Date("2026-10-27T09:00:00Z") }),
        referral({ id: "await", createdOn: new Date("2026-10-21T09:00:00Z"), directionDueBy: new Date("2026-10-28T09:00:00Z") })
      ],
      total: 2,
      totalPages: 1
    });

    expect(html).toContain("<li>Referred 20-10-26</li>");
    expect(html).toContain("<li>Direction due by 27-10-26</li>");
    expect(html).toContain("<li>Direction due by 28-10-26</li>");
    expect(html).not.toContain("Referred 21-10-26");
  });

  it("should give a directed referral no due date and no dates column", async () => {
    const html = await render({ referrals: [referral({ state: "Decided", directionDueBy: new Date("2026-10-27T09:00:00Z") })], total: 1, totalPages: 1 });

    expect(html).not.toContain("Direction due by");
    expect(html).not.toContain(">Dates<");
  });

  it("should draw no heading for an empty section", async () => {
    const html = await render({ referrals: [referral({ state: "Decided" })], total: 1, totalPages: 1 });

    expect(html).not.toContain(">Urgent</h2>");
    expect(html).not.toContain("Awaiting your direction");
    expect(html).toContain("Directed, awaiting the office");
  });

  it("should repeat a day's heading on a page that starts inside it", async () => {
    const html = await render(
      { referrals: [referral({ id: "second-half", createdOn: new Date("2026-10-19T15:00:00Z") })], page: 2, total: 101, totalPages: 2 },
      { page: "2" }
    );

    expect(html).toContain('<h3 class="govuk-heading-m">19-10-26 referrals</h3>');
  });

  it("should show each row's reasons in the business's words", async () => {
    const html = await render({ referrals: [referral({ reasons: ["Minor", "Other"] })], total: 1, totalPages: 1 });

    expect(html).toContain("Applicant is a minor");
    expect(html).toContain("Other");
  });

  // Decision 3: the row is the narrow summary, so there is no applicant, no case reference and nothing
  // caseworker-shaped to link to.
  it("should show nothing about the applications and offer no caseworker control", async () => {
    const html = await render({ referrals: [referral()], total: 1, totalPages: 1 });

    expect(html).not.toContain("/deed-polls");
    expect(html).not.toMatch(/New case|Save this query|Filter cases/);
  });

  // There is no pool, so there is nothing to claim and no list to navigate to.
  it("should offer no claim and no link to the old pool", async () => {
    const html = await render({ referrals: [referral()], total: 1, totalPages: 1 });

    expect(html).not.toMatch(/claim/i);
    expect(html).not.toContain('href="/judicial/referrals"');
  });

  it("should state api's total rather than the number of rows", async () => {
    const html = await render({ referrals: [referral(), referral({ id: "ref-2" })], size: 100, total: 230, totalPages: 3 });

    expect(html).toContain("1 to 100 of 230 referrals");
  });

  it("should page by URL through its own path when api says there is more than one page", async () => {
    const html = await render({ referrals: [referral()], page: 2, total: 23, totalPages: 3 }, { page: "2" });

    expect(html).toContain('href="/judicial/referrals/mine?page=1"');
    expect(html).toContain('href="/judicial/referrals/mine?page=3"');
  });

  it("should render no pagination for a list that fits on one page", async () => {
    const html = await render({ referrals: [referral()], total: 1, totalPages: 1 });

    expect(html).not.toContain("govuk-pagination");
  });

  // Decision 8: a judge holding nothing is api's empty page, and the page says where the work is rather than
  // rendering an empty table.
  it("should say the judge holds nothing rather than rendering an empty table", async () => {
    const html = await render({ referrals: [], total: 0, totalPages: 0 });

    expect(html).toContain("You have no referrals. Referrals assigned to you appear here.");
    expect(html).not.toContain("govuk-table");
    expect(html).not.toContain("govuk-heading-l");
  });

  // Each table is captioned for anyone who reaches it by landmark, and the caption is its heading.
  it("should caption each table with the heading it sits under", async () => {
    const html = await render({ referrals: [referral({ createdOn: new Date("2026-10-21T09:00:00Z") })], total: 1, totalPages: 1 });

    expect(html).toContain('<caption class="govuk-table__caption govuk-visually-hidden">21-10-26 referrals</caption>');
  });

  // api allocates the ids, so this is belt-and-braces rather than a live threat — but the id is the one value on
  // this page that reaches an attribute, and `urlencode` is what keeps it inside the href.
  it("should encode a referral id rather than letting it break out of its link", async () => {
    const html = await render({ referrals: [referral({ id: '"><script>alert(1)</script>' })], total: 1, totalPages: 1 });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain('href="/judicial/referrals/%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E"');
  });
});
