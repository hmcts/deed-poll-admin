/**
 * My referrals' markup, rendered rather than asserted through the view model.
 *
 * The model is `mine.test.ts`'s subject. What this file pins is what a model cannot: that each row links by its
 * referral id with an accessible name that distinguishes it, that the list carries **no** case data, that the
 * shared navigation marks this page as the current one, and that api's total is what appears on the page rather
 * than the number of rows.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listMyReferrals } from "@hmcts/deed-poll";
import type { JudicialMyReferrals, JudicialReferralSummary } from "@hmcts/deed-poll-api-client";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
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
    expect(html).toContain('<span class="govuk-visually-hidden"> the referral referred on 3 September 2026 at 9:44am, Direction needed</span>');
  });

  // Decision 2: the two states in the judge's own words, tagged. The word is printed, so the state is not
  // carried by the tag's colour alone.
  it("should print each status as well as tagging it", async () => {
    const html = await render({ referrals: [referral(), referral({ id: "ref-2", state: "Decided" })], total: 2, totalPages: 1 });

    expect(html).toContain("Direction needed");
    expect(html).toContain("govuk-tag--purple");
    expect(html).toContain("Direction recorded");
    expect(html).toContain("govuk-tag--green");
  });

  it("should show each row's reasons and the date the court referred it", async () => {
    const html = await render({ referrals: [referral({ reasons: ["Minor", "Other"] })], total: 1, totalPages: 1 });

    expect(html).toContain("Applicant is a minor");
    expect(html).toContain("Other");
    expect(html).toContain("3 September 2026 at 9:44am");
  });

  it("should tag an urgent row while printing the word, so urgency is not colour alone", async () => {
    const html = await render({ referrals: [referral({ urgency: "Urgent" })], total: 1, totalPages: 1 });

    expect(html).toContain("govuk-tag--red");
    expect(html).toContain("Urgent");
  });

  // Decision 3: the row is the pool's narrow summary, so there is no applicant, no case reference and nothing
  // caseworker-shaped to link to.
  it("should show nothing about the applications and offer no caseworker control", async () => {
    const html = await render({ referrals: [referral()], total: 1, totalPages: 1 });

    expect(html).not.toContain("/deed-polls");
    expect(html).not.toMatch(/New case|Save this query|Filter cases/);
  });

  it("should state api's total rather than the number of rows", async () => {
    const html = await render({ referrals: [referral(), referral({ id: "ref-2" })], total: 23, totalPages: 3 });

    expect(html).toContain("1 to 10 of 23 referrals");
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

    expect(html).toContain("You have no referrals");
    expect(html).not.toContain("govuk-table");
  });

  // Decision 4, and the whole reason this page exists: a claimed referral is only reachable from here, so the
  // pair of lists must be navigable from both.
  it("should render the shared navigation with this page marked as the current one", async () => {
    const html = await render({ referrals: [referral()], total: 1, totalPages: 1 });

    expect(html).toContain('<nav class="app-judicial-nav" aria-label="Referral lists">');
    expect(html).toContain('href="/judicial/referrals"');
    expect(html).toMatch(/href="\/judicial\/referrals\/mine" aria-current="page"/);
    expect(html).toContain("app-judicial-nav__current");
  });

  it("should not mark the pool as current while it is not", async () => {
    const html = await render({ referrals: [referral()], total: 1, totalPages: 1 });

    expect(html).not.toMatch(/href="\/judicial\/referrals" aria-current/);
  });

  // The table is captioned for anyone who reaches it by landmark, and the caption is the heading rather than a
  // second wording of it.
  it("should caption the table without repeating the heading on screen", async () => {
    const html = await render({ referrals: [referral()], total: 1, totalPages: 1 });

    expect(html).toContain('<caption class="govuk-table__caption govuk-visually-hidden">My referrals</caption>');
  });

  // api allocates the ids, so this is belt-and-braces rather than a live threat — but the id is the one value on
  // this page that reaches an attribute, and `urlencode` is what keeps it inside the href.
  it("should encode a referral id rather than letting it break out of its link", async () => {
    const html = await render({ referrals: [referral({ id: '"><script>alert(1)</script>' })], total: 1, totalPages: 1 });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain('href="/judicial/referrals/%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E"');
  });
});
