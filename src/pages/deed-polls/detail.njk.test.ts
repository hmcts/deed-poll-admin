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

/**
 * The page with the referrals read failing, which the handler degrades to a panel rather than a 404.
 *
 * The `console.error` is the handler's own log line for the degradation, silenced so the suite output stays
 * readable — asserted in `[id].test.ts`, which owns the handler's side of this.
 */
async function unavailablePage(): Promise<string> {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(findReferrals).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): nope"));
  const res = pageResponse();

  await GET(pageRequest({ params: { id: "case-1" }, accessToken: "session-token" }), res);
  logged.mockRestore();

  return html(res.render.mock.calls[0][1]);
}

/**
 * Just the referrals panel, for the assertions that a page-wide `toContain` would satisfy from another tab.
 *
 * "None recorded." is every empty panel's copy, so asserting its *absence* has to be scoped or it is really
 * an assertion about notes, witnesses and documents. Referrals is the last of `FORM_TABS`, so this runs from
 * its panel to the end of the document: if a tab is ever added after it the window widens and the assertion
 * goes red rather than quietly green, which is the safe direction for a negative.
 */
function referralsPanel(rendered: string): string {
  const start = rendered.indexOf('id="referrals"');
  const next = rendered.indexOf("govuk-tabs__panel", start + 1);

  return rendered.slice(start, next === -1 ? undefined : next);
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

  it.each(["Open", "Claimed"] as const)("should withhold the raise button while a %s referral is with the judiciary, and say why", async (state) => {
    const rendered = await page([{ ...REFERRAL, state }]);

    expect(rendered).not.toContain('href="/deed-polls/case-1/referrals/new"');
    expect(rendered).toContain("Withdraw the open referral before raising another.");
  });

  it("should tell a caseworker with a returned direction to action it, never to withdraw it", async () => {
    // The parametrised case above used to cover Decided too, which is how the tab came to ask for a withdrawal
    // api refuses — of the one referral whose direction is the caseworker's work to carry out.
    const rendered = await page([{ ...REFERRAL, state: "Decided" }]);

    expect(rendered).not.toContain('href="/deed-polls/case-1/referrals/new"');
    expect(rendered).toContain("mark the referral as actioned before raising another");
    expect(rendered).not.toContain("Withdraw the open referral");
  });

  it("should say a referral is live but unreadable rather than borrowing the failed-read message", async () => {
    // Two different claims: nothing was read at all, versus a referral was read whose state this app cannot
    // name. Only the second still knows there is one.
    const rendered = await page([{ ...REFERRAL, state: null }]);

    expect(rendered).not.toContain('href="/deed-polls/case-1/referrals/new"');
    expect(rendered).toContain("whose status could not be read");
    expect(rendered).not.toContain("Referral information could not be loaded");
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

  describe("when the referrals read failed", () => {
    it("should still render the case, the panel being one tab rather than the page", async () => {
      const rendered = await unavailablePage();

      expect(rendered).toContain("KBDP2026-00001");
      expect(rendered).toContain('href="#referrals"');
    });

    // The distinction the whole degraded state exists for: "None recorded." is a claim about the case, and
    // the page is not in a position to make it.
    it("should say the information could not be loaded rather than that there are none", async () => {
      const panel = referralsPanel(await unavailablePage());

      expect(panel).toContain("Referral information could not be loaded");
      expect(panel).not.toContain("None recorded.");
    });

    it("should withhold the raise button, since it cannot know whether one is already open", async () => {
      const rendered = await unavailablePage();

      expect(rendered).not.toContain('href="/deed-polls/case-1/referrals/new"');
    });

    // The open-referral message would be a second claim about a case nothing was read for.
    it("should not claim the case is with the judiciary either", async () => {
      const rendered = await unavailablePage();

      expect(rendered).not.toContain("Withdraw the open referral before raising another.");
    });
  });
});
