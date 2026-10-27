/**
 * The mark-as-actioned confirmation's markup, rendered rather than asserted through the view model.
 *
 * The model is asserted in `[id]/referrals/[referralId]/close.test.ts`. What this file exists for is what a model
 * cannot show: that the direction the caseworker is attesting to is on the page they attest on, that the three
 * things being confirmed are stated before the submit rather than after it, that the only control that can act is
 * the one `post` (cancel is a link), and that the page needs no JavaScript to work.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDeedPoll, findReferral } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { addPathFilters } from "../../path-filters.js";
import { GET } from "./[id]/referrals/[referralId]/close.js";

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
addPathFilters(environment);

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

const DECIDED = {
  id: "ref-1",
  state: "Decided",
  reasons: ["Minor"],
  notes: "The applicant turns 16 next month.",
  urgency: "Urgent",
  urgencyReason: "Hearing listed on Friday.",
  migrated: false,
  claimedBy: "A Judge",
  claimedAt: new Date("2026-05-14T09:00:00Z"),
  decision: "Approved",
  directionsText: "Serve the notice on the second respondent.",
  publishToGazette: true,
  decisionDate: new Date("2026-05-15T10:30:00Z"),
  decidedBy: "A Judge",
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  createdOn: new Date("2026-05-13T08:44:00Z"),
  modifiedOn: new Date("2026-05-15T10:30:00Z")
};

// Content pair first, the handler's own values over it — `renderInterceptorMiddleware`'s order. See the note in
// `referral-detail.njk.test.ts` for what spreading it the other way round hides.
const html = (model: Record<string, unknown>): string => environment.render("deed-polls/referral-close.njk", { ...(model.en as object), ...model });

async function page(referral: Record<string, unknown> = DECIDED): Promise<string> {
  vi.mocked(findReferral).mockResolvedValue(referral as never);
  const res = pageResponse();

  await GET(pageRequest({ params: { id: "case-1", referralId: "ref-1" }, accessToken: "session-token" }), res);

  return html(res.render.mock.calls[0][1]);
}

describe("mark-as-actioned confirmation template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
  });

  it("should head the page with what is being confirmed, captioned by the case it belongs to", async () => {
    const rendered = await page();

    expect(rendered).toContain("KBDP2026-00001");
    expect(rendered).toContain("Confirm the direction has been actioned");
    // One h1, and the headings below it are h2s — the direction is a section of this page, not a page of its own.
    expect(rendered.match(/<h1/g)).toHaveLength(1);
    expect(rendered).toContain("<h2");
    expect(rendered).not.toContain("<h3");
  });

  it("should show the referral status as a tag with its meaning, so the colour is not the only carrier", async () => {
    const rendered = await page();

    expect(rendered).toMatch(/govuk-tag[^"]*govuk-tag--green/);
    expect(rendered).toContain("Referral status");
    expect(rendered).toContain("Direction received");
    expect(rendered).toContain("Direction received — action needed");
  });

  it("should show the direction being confirmed in full", async () => {
    const rendered = await page();

    expect(rendered).toContain("Direction from the Master");
    expect(rendered).toContain("Approved");
    expect(rendered).toContain("Serve the notice on the second respondent.");
    expect(rendered).toMatch(/Published in the Gazette[\s\S]*?Yes/);
    expect(rendered).toContain("A Judge");
    expect(rendered).toContain("15 May 2026 at 11:30am");
  });

  it("should say the Gazette answer was not recorded rather than printing No for a direction that gave none", async () => {
    const rendered = await page({ ...DECIDED, publishToGazette: null });

    expect(rendered).toMatch(/Published in the Gazette[\s\S]*?Not recorded/);
  });

  it("should distinguish a direction with no further directions from one that was never given", async () => {
    const rendered = await page({ ...DECIDED, directionsText: null });

    expect(rendered).toContain("Direction from the Master");
    expect(rendered).toMatch(/Directions[\s\S]*?Not provided/);
  });

  it("should state the three things being confirmed above the submit, not after it", async () => {
    const rendered = await page();

    expect(rendered).toContain("By marking this referral as actioned you are confirming that:");
    expect(rendered).toContain("you have carried out the Master’s direction");
    expect(rendered).toContain("you have made any updates the application needs, including any dates");
    expect(rendered).toContain("this referral will leave the list of returned directions waiting for action");
    expect(rendered.indexOf("confirming that:")).toBeLessThan(rendered.indexOf("<form"));
  });

  it("should say the closure cannot be undone, and that the direction stays readable", async () => {
    const rendered = await page();

    expect(rendered).toContain("You cannot undo this. The direction stays on the referral for reference.");
  });

  it("should commit through a post to the closure route, needing no JavaScript", async () => {
    const rendered = await page();

    expect(rendered).toContain('action="/deed-polls/case-1/referrals/ref-1/close"');
    expect(rendered).toContain('method="post"');
    expect(rendered).toContain("Mark direction as actioned");
    expect(rendered).toContain("novalidate");
  });

  it("should offer cancel as a link, so the only control that can act is the one submit", async () => {
    const rendered = await page();

    expect(rendered).toContain('href="/deed-polls/case-1/referrals/ref-1"');
    expect(rendered).toContain("Cancel");
    expect(rendered.match(/type="submit"/g)).toHaveLength(1);
  });
});
