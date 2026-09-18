/**
 * The case detail page's referrals panel, rendered rather than asserted through the view model.
 *
 * The model is asserted in `[id].test.ts`, which is where the second call and the tab's empty state are
 * pinned. What this file exists for is what a model cannot show: that the raise control is a button the panel
 * **withholds** while a referral is open rather than rendering disabled, that each row links to the referral
 * it is about, and that a migrated referral explains its empty reasons cell instead of showing a blank one.
 *
 * Only the referrals tab is covered — the other three panels predate this file and are asserted through their
 * view models. Rendering the whole template is how the panel is reached, not the subject.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDeedPoll, findReferrals } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./[id].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hmcts/deed-poll")>();

  return {
    ...actual,
    findDeedPoll: vi.fn(),
    findReferrals: vi.fn(),
    getCaseFieldRules: vi.fn(async (query: { type?: string | null; migrated?: boolean; publishToGazette?: boolean }) =>
      actual.getFieldRules(query.type as never, query.migrated, query.publishToGazette)
    )
  };
});

const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "../../..", "pages")
  ],
  { autoescape: true }
);

const found = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  type: "Adult",
  privacy: "Normal",
  state: "Received",
  referToMasterChoice: null,
  migratedRecord: false,
  publishToLondonGazette: true,
  dateReceived: new Date("2026-03-01T00:00:00.000Z"),
  createdOn: new Date("2026-03-01T00:00:00.000Z"),
  modifiedOn: new Date("2026-03-01T00:00:00.000Z"),
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  notes: [],
  witnesses: [],
  documents: []
};

const REFERRAL = {
  id: "ref-1",
  state: "Open",
  reasons: ["Minor", "Other"],
  notes: "The applicant turns 16 next month.",
  urgency: "Urgent",
  urgencyReason: "Hearing listed on Friday.",
  migrated: false,
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  createdOn: new Date("2026-05-13T08:44:00Z"),
  modifiedOn: new Date("2026-05-13T08:44:00Z")
};

const html = (model: Record<string, unknown>): string => environment.render("deed-polls/detail.njk", { ...model, ...(model.en as object) });

async function page(referrals: Record<string, unknown>[]): Promise<string> {
  vi.mocked(findReferrals).mockResolvedValue(referrals as never);
  const res = pageResponse();

  await GET(pageRequest({ params: { id: "case-1" }, accessToken: "session-token" }), res);

  return html(res.render.mock.calls[0][1]);
}

describe("case detail template — the referrals tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
  });

  it("should render the referrals tab as one of the page's tabs", async () => {
    const rendered = await page([]);

    expect(rendered).toContain('href="#referrals"');
    expect(rendered).toContain("Referrals");
  });

  it("should list a referral with its state tagged and its reasons in the business's words", async () => {
    const rendered = await page([REFERRAL]);

    expect(rendered).toContain("1 referral");
    expect(rendered).toMatch(/govuk-tag[^"]*govuk-tag--blue/);
    expect(rendered).toContain("Applicant is a minor");
    expect(rendered).toContain("13 May 2026");
    // The referral's own urgency, which reads "Standard" for Normal — this one is Urgent.
    expect(rendered).toContain("Urgent");
  });

  it("should link each row to that referral, the date raised being the row's handle", async () => {
    const rendered = await page([REFERRAL]);

    expect(rendered).toContain('href="/deed-polls/case-1/referrals/ref-1"');
    expect(rendered).toContain("view this referral");
  });

  it("should pluralise the count, since a case can be referred more than once", async () => {
    const rendered = await page([REFERRAL, { ...REFERRAL, id: "ref-0", state: "Withdrawn" }]);

    expect(rendered).toContain("2 referrals");
    expect(rendered).toContain('href="/deed-polls/case-1/referrals/ref-0"');
  });

  it("should offer the raise button on a case with no referral at all, which is the case that needs it most", async () => {
    const rendered = await page([]);

    expect(rendered).toContain('href="/deed-polls/case-1/referrals/new"');
    expect(rendered).toContain("Refer this case to the judiciary");
    expect(rendered).toContain("None recorded.");
  });

  it("should offer the raise button again once every referral is closed or withdrawn", async () => {
    const rendered = await page([{ ...REFERRAL, state: "Closed" }]);

    expect(rendered).toContain('href="/deed-polls/case-1/referrals/new"');
  });

  it.each(["Open", "Claimed", "Decided"] as const)("should withhold the raise button while a %s referral is with the judiciary, and say why", async (state) => {
    const rendered = await page([{ ...REFERRAL, state }]);

    expect(rendered).not.toContain('href="/deed-polls/case-1/referrals/new"');
    expect(rendered).toContain("Withdraw the open referral before raising another.");
  });

  it("should say a migrated referral came from the previous system rather than showing an empty reasons cell", async () => {
    const rendered = await page([{ ...REFERRAL, migrated: true, reasons: [], urgency: null }]);

    expect(rendered).toContain("Migrated from the previous system");
    expect(rendered).toContain("Not provided");
  });

  it("should not call a referral migrated because it has no reasons, when it is not", async () => {
    const rendered = await page([{ ...REFERRAL, reasons: [] }]);

    expect(rendered).not.toContain("Migrated from the previous system");
    // The row is still listed and still links to the referral — an empty reasons cell is not a reason to hide
    // a referral the case has.
    expect(rendered).toContain('href="/deed-polls/case-1/referrals/ref-1"');
  });
});
