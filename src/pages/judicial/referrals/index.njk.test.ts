/**
 * The pool's markup, rendered rather than asserted through the view model.
 *
 * The model is `index.test.ts`'s subject. What this file pins is what a model cannot: that each row links by its
 * referral id with an accessible name that distinguishes it, that the queue carries **no** case data or
 * caseworker control, and that api's total is what appears on the page rather than the number of rows.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPool } from "@hmcts/deed-poll";
import type { JudicialPool, JudicialReferralSummary } from "@hmcts/deed-poll-api-client";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  listPool: vi.fn()
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
    state: "Open",
    reasons: ["Minor"],
    notes: null,
    urgency: "Normal",
    urgencyReason: null,
    createdOn: new Date("2026-09-03T08:44:00Z"),
    ...overrides
  }) as JudicialReferralSummary;

/** The pool as a browser receives it, for the page api answers with. */
const render = async (pool: Partial<JudicialPool>, query: Record<string, unknown> = {}): Promise<string> => {
  vi.mocked(listPool).mockResolvedValue({ referrals: [], page: 1, size: 10, total: 0, totalPages: 0, ...pool } as never);
  const res = pageResponse();
  await GET(pageRequest({ query, judicial: true, accessToken: "judge-token" }), res);
  const model = res.render.mock.calls[0][1];

  return environment.render("judicial/referrals/index.njk", { ...model, ...model.en });
};

describe("judicial pool template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should link each row to the referral, qualified by its wait so 'View' is not every link's name", async () => {
    const html = await render({ referrals: [referral()], total: 1, totalPages: 1 });

    expect(html).toContain('href="/judicial/referrals/ref-1"');
    expect(html).toContain('<span class="govuk-visually-hidden"> the referral waiting since 3 September 2026 at 9:44am</span>');
  });

  it("should show each row's reasons and wait", async () => {
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

  // api's pool row carries no case fields, and neither does this page: a queue naming the applicants would be
  // a list of applications a judge has not been asked to read (api decision 2).
  it("should show nothing about the applications and offer no caseworker control", async () => {
    const html = await render({ referrals: [referral()], total: 1, totalPages: 1 });

    expect(html).not.toContain("/deed-polls");
    expect(html).not.toMatch(/New case|Save this query|Filter cases/);
  });

  it("should state api's total rather than the number of rows", async () => {
    const html = await render({ referrals: [referral(), referral({ id: "ref-2" })], total: 23, totalPages: 3 });

    expect(html).toContain("1 to 10 of 23 referrals");
  });

  it("should page by URL when api says there is more than one page", async () => {
    const html = await render({ referrals: [referral()], page: 2, total: 23, totalPages: 3 }, { page: "2" });

    expect(html).toContain('href="/judicial/referrals?page=1"');
    expect(html).toContain('href="/judicial/referrals?page=3"');
  });

  it("should render no pagination for a pool that fits on one page", async () => {
    const html = await render({ referrals: [referral()], total: 1, totalPages: 1 });

    expect(html).not.toContain("govuk-pagination");
  });

  it("should say the pool is empty rather than rendering an empty table", async () => {
    const html = await render({ referrals: [], total: 0, totalPages: 0 });

    expect(html).toContain("There are no referrals waiting for a direction");
    expect(html).not.toContain("govuk-table");
  });

  // Decision 10 in the rendering: the refusal is said on the page the judge is sent back to, and it names no
  // other judge. The 404 is the only claim refusal that reaches the pool — a 409 goes to the referral.
  it("should show a refused claim as a message on the pool", async () => {
    const html = await render({ referrals: [referral()], total: 1, totalPages: 1 }, { claim: "unavailable" });

    expect(html).toContain("This referral is no longer available");
    expect(html).toContain("govuk-error-summary");
    expect(html).not.toMatch(/another judge|Judge |already been claimed/);
  });

  it("should show no message on an ordinary visit", async () => {
    const html = await render({ referrals: [referral()], total: 1, totalPages: 1 });

    expect(html).not.toContain("govuk-error-summary");
  });
});
