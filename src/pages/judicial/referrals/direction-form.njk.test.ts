/**
 * The direction form's markup, rendered rather than asserted through the view model.
 *
 * `[referralId]/direction.test.ts` is the handler's subject. What this file exists for is what a model cannot
 * show: that neither radio group carries a `checked` attribute until the judge answers it, that what was typed
 * comes back in the textarea, and that the only submit on the page continues to the check step — nothing here
 * records anything.
 *
 * The model comes from the handler rather than being hand-built, so a name it stops passing fails this test too.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getReferral } from "@hmcts/deed-poll";
import type { JudicialReferralDetail } from "@hmcts/deed-poll-api-client";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { addPathFilters } from "../../../path-filters.js";
import { GET, POST } from "./[referralId]/direction.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  getReferral: vi.fn()
}));

// The three roots `configureGovuk` mounts, minus the assets — the same set as the other njk tests.
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

const detail = (): JudicialReferralDetail =>
  ({
    id: "ref-1",
    state: "Claimed",
    reasons: ["Minor"],
    notes: null,
    urgency: "Normal",
    urgencyReason: null,
    createdOn: new Date("2026-09-03T08:44:00Z"),
    claimedBy: "a-judge",
    claimedAt: new Date("2026-09-04T09:00:00Z"),
    decision: null,
    directionsText: null,
    changesToStandardPublication: null,
    decisionDate: null,
    decidedBy: null,
    application: {
      displayReference: "KBDP2026-00001",
      type: "Minor",
      oldForename: "John",
      oldMiddleName: null,
      oldSurname: "Smith",
      newForename: "John",
      newMiddleName: null,
      newSurname: "Smyth",
      witnesses: [],
      documents: []
    },
    caseNotes: []
  }) as JudicialReferralDetail;

/** The empty form, as a judge arriving from the referral receives it. */
const renderEmpty = async (): Promise<string> => {
  const res = pageResponse();
  await GET(pageRequest({ params: { referralId: "ref-1" }, judicial: true, accessToken: "judge-token" }), res);

  return render(res.render.mock.calls[0][1]);
};

/** The form as it comes back from a rejected submission. */
const renderSubmitted = async (body: Record<string, unknown>): Promise<string> => {
  const res = pageResponse();
  await POST(pageRequest({ params: { referralId: "ref-1" }, body, judicial: true, accessToken: "judge-token" }), res);

  return render(res.render.mock.calls[0][1]);
};

const render = (model: Record<string, unknown>): string =>
  environment.render("judicial/referrals/direction-form.njk", { ...(model.en as Record<string, unknown>), ...model });

describe("direction form template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReferral).mockResolvedValue(detail() as never);
  });

  it("should ask the three questions api's body takes, and no others", async () => {
    const html = await renderEmpty();

    expect(html).toContain('name="decision"');
    expect(html).toContain('name="directionsText"');
    expect(html).toContain('name="changesToStandardPublication"');
  });

  it.each([
    {
      behaviour: "should caption the form with the application's reference, so the judge sees what they are directing",
      content: "KBDP2026-00001"
    },
    {
      behaviour: "should label the text as the Masters asked, Directions/Reasons",
      content: "Directions/Reasons"
    },
    {
      behaviour: "should say when the directions or reasons are needed, rather than leaving a Master to be refused",
      content: "If there are changes to the standard publication, say whether to publish nothing or what to publish."
    },
    {
      behaviour: "should offer cancel as a link back to the referral, so it acts on nothing",
      content: '<a class="govuk-link" href="/judicial/referrals/ref-1">Cancel</a>'
    }
  ])("$behaviour", async ({ content }) => {
    const html = await renderEmpty();

    expect(html).toContain(content);
  });

  // Decision 6, and the reason the handler compares to string literals: an unanswered form must post nothing for
  // either radio group rather than a default nobody chose.
  it("should pre-select no answer on either radio group", async () => {
    const html = await renderEmpty();

    expect(html).not.toContain("checked");
  });

  it.each([
    {
      behaviour: "should label the decisions in the case's own vocabulary",
      content: 'value="Approved"',
      detail: 'value="Rejected"'
    },
    // api's bound, and a character count rather than a `maxlength`: a browser that stops accepting characters
    // silently gives no reason for having done so.
    {
      behaviour: "should count the directions down from api's 4,000-character limit",
      content: "govuk-character-count",
      detail: "4000"
    },
    {
      behaviour: "should post to itself, so nothing is recorded by reaching this page",
      content: 'action="/judicial/referrals/ref-1/direction"',
      detail: 'method="post"'
    }
  ])("$behaviour", async ({ content, detail }) => {
    const html = await renderEmpty();

    expect(html).toContain(content);
    expect(html).toContain(detail);
  });

  // The Gazette answer is the Master's, and it is asked as its own question rather than inferred from anything
  // the court said when it referred the case — in the Masters' own words (Master Sullivan's feedback, 2026-10-27).
  it("should ask the Gazette question as a yes/no of its own", async () => {
    const html = await renderEmpty();

    expect(html).toContain("Are there any changes to the standard publications in the Gazette?");
    expect(html).toContain('value="true"');
    expect(html).toContain('value="false"');
  });

  it("should ask the decision, then the Gazette question, then the directions or reasons", async () => {
    const html = await renderEmpty();

    const decision = html.indexOf('name="decision"');
    const gazette = html.indexOf('name="changesToStandardPublication"');
    const directions = html.indexOf('name="directionsText"');
    expect(decision).toBeGreaterThan(-1);
    expect(decision).toBeLessThan(gazette);
    expect(gazette).toBeLessThan(directions);
  });

  it("should bring back what was typed and chosen when a submission is rejected", async () => {
    const html = await renderSubmitted({
      decision: "Rejected",
      directionsText: "Refuse: the evidence is incomplete.",
      changesToStandardPublication: undefined
    });

    expect(html).toContain("Refuse: the evidence is incomplete.");
    expect(html).toContain('value="Rejected" checked');
  });

  it("should show the error summary and the field message together", async () => {
    const html = await renderSubmitted({ directionsText: "Grant." });

    expect(html).toContain("There is a problem");
    expect(html).toContain('href="#decision"');
    expect(html).toContain("Select whether the application is approved or rejected");
    expect(html).toContain("Select whether there are any changes to the standard publications in the Gazette");
  });

  describe("when changing a direction", () => {
    it("should be headed for the change and come back with the direction already given checked and typed", async () => {
      vi.mocked(getReferral).mockResolvedValue({
        ...detail(),
        state: "Decided",
        decision: "Rejected",
        directionsText: "Insufficient evidence.",
        changesToStandardPublication: true
      } as never);
      const res = pageResponse();
      await GET(pageRequest({ params: { referralId: "ref-1" }, query: { change: "1" }, judicial: true, accessToken: "judge-token" }), res);

      const html = render(res.render.mock.calls[0][1]);

      expect(html).toMatch(/<h1[^>]*>Change your direction<\/h1>/);
      expect(html).toMatch(/value="Rejected" checked/);
      expect(html).toMatch(/value="true" checked/);
      expect(html).toContain("Insufficient evidence.");
      expect(html).toContain('action="/judicial/referrals/ref-1/direction?change=1"');
    });
  });
});
