/**
 * The referral view's markup, rendered rather than asserted through the view model.
 *
 * The model is asserted in `[id]/referrals/[referralId].test.ts`. What this file exists for is what a model
 * cannot show: that the withdraw control is a **form** and not a link, that it disappears on a referral that
 * cannot be withdrawn rather than being rendered disabled, and that a migrated referral says why it lists no
 * reasons instead of showing an empty cell.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDeedPoll, findReferral } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./[id]/referrals/[referralId].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findReferral: vi.fn()
}));

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

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

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

const html = (model: Record<string, unknown>): string => environment.render("deed-polls/referral-detail.njk", { ...model, ...(model.en as object) });

async function page(referral: Record<string, unknown>, query: Record<string, unknown> = {}): Promise<string> {
  vi.mocked(findReferral).mockResolvedValue(referral as never);
  const res = pageResponse();

  await GET(pageRequest({ params: { id: "case-1", referralId: "ref-1" }, query, accessToken: "session-token" }), res);

  return html(res.render.mock.calls[0][1]);
}

describe("referral view template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
  });

  it("should show the referral's own fields and not restate the application", async () => {
    const rendered = await page(REFERRAL);

    expect(rendered).toContain("Applicant is a minor");
    expect(rendered).toContain("The applicant turns 16 next month.");
    expect(rendered).toContain("Hearing listed on Friday.");
    expect(rendered).toContain("A Caseworker, 13 May 2026 at 9:44am");
    expect(rendered).toContain("KBDP2026-00001");
  });

  it("should tag the state so the lifecycle is scannable, with the state printed and not only coloured", async () => {
    const rendered = await page(REFERRAL);

    expect(rendered).toMatch(/govuk-tag[^"]*govuk-tag--blue/);
    // The caseworker's label, not api's member: the tag says where the referral is, not what its enum is called.
    expect(rendered).toContain("Awaiting a judge");
  });

  it("should offer withdraw as a form posting to the withdraw route, because it changes something", async () => {
    const rendered = await page(REFERRAL);

    expect(rendered).toContain('action="/deed-polls/case-1/referrals/ref-1/withdraw"');
    expect(rendered).toContain('method="post"');
    expect(rendered).toContain("Withdraw this referral");
  });

  it.each([
    { state: "Closed", label: "Direction actioned" },
    { state: "Withdrawn", label: "Withdrawn" }
  ])("should render a $state referral read-only, with no withdraw control at all", async ({ state, label }) => {
    const rendered = await page({ ...REFERRAL, state });

    expect(rendered).not.toContain("Withdraw this referral");
    expect(rendered).not.toContain("/withdraw");
    expect(rendered).toContain(label);
  });

  it("should render no withdraw control on a referral a judge has directed, since api refuses that withdrawal", async () => {
    // Not terminal — the case still holds it — and still not withdrawable: the direction on it is the
    // caseworker's work to carry out, and Task 3 puts the "mark as actioned" control here in its place.
    const rendered = await page({ ...REFERRAL, state: "Decided" });

    expect(rendered).not.toContain("Withdraw this referral");
    expect(rendered).not.toContain("/withdraw");
    expect(rendered).toContain("Direction received");
  });

  it("should say a migrated referral came from the previous system rather than showing an empty reasons cell", async () => {
    const rendered = await page({ ...REFERRAL, migrated: true, reasons: [], notes: null, urgency: null, urgencyReason: null });

    expect(rendered).toContain("Migrated from the previous system");
    expect(rendered).toContain("Not provided");
  });

  it("should say the reasons are not recorded, not that the referral was migrated, when it was not", async () => {
    // The third branch of the reasons cell: no reasons and not migrated is data api should not produce, so it
    // must not borrow the migrated explanation for it — that would assert a history the referral does not have.
    const rendered = await page({ ...REFERRAL, reasons: [] });

    expect(rendered).not.toContain("Migrated from the previous system");
    expect(rendered).toContain("None recorded.");
  });

  it("should show the refused-withdrawal message above the referral when api refused one", async () => {
    const rendered = await page({ ...REFERRAL, state: "Closed" }, { withdraw: "conflict" });

    expect(rendered).toContain("This referral has already been closed or withdrawn.");
    expect(rendered.indexOf("govuk-error-summary")).toBeLessThan(rendered.indexOf("<h1"));
  });

  it("should link back to the case's referrals tab", async () => {
    const rendered = await page(REFERRAL);

    expect(rendered).toContain('href="/deed-polls/case-1#referrals"');
  });
});
