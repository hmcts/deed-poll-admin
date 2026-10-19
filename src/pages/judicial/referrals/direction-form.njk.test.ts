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
    publishToGazette: null,
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
    expect(html).toContain('name="publishToGazette"');
  });

  it("should caption the form with the application's reference, so the judge sees what they are directing", async () => {
    const html = await renderEmpty();

    expect(html).toContain("KBDP2026-00001");
  });

  // Decision 6, and the reason the handler compares to string literals: an unanswered form must post nothing for
  // either radio group rather than a default nobody chose.
  it("should pre-select no answer on either radio group", async () => {
    const html = await renderEmpty();

    expect(html).not.toContain("checked");
  });

  it("should label the decisions in the case's own vocabulary", async () => {
    const html = await renderEmpty();

    expect(html).toContain('value="Approved"');
    expect(html).toContain('value="Rejected"');
  });

  // The Gazette answer is the judge's, and it is asked as its own question rather than inferred from anything
  // the court said when it referred the case.
  it("should ask the Gazette question as a yes/no of its own", async () => {
    const html = await renderEmpty();

    expect(html).toContain("Should this deed poll be published in the Gazette?");
    expect(html).toContain('value="true"');
    expect(html).toContain('value="false"');
  });

  it("should state that the directions are optional, because api does not require them", async () => {
    const html = await renderEmpty();

    expect(html).toContain("Directions (optional)");
  });

  // api's bound, and a character count rather than a `maxlength`: a browser that stops accepting characters
  // silently gives no reason for having done so.
  it("should count the directions down from api's 4,000-character limit", async () => {
    const html = await renderEmpty();

    expect(html).toContain("govuk-character-count");
    expect(html).toContain("4000");
  });

  it("should post to itself, so nothing is recorded by reaching this page", async () => {
    const html = await renderEmpty();

    expect(html).toContain('action="/judicial/referrals/ref-1/direction"');
    expect(html).toContain('method="post"');
  });

  it("should offer cancel as a link back to the referral, so it acts on nothing", async () => {
    const html = await renderEmpty();

    expect(html).toContain('<a class="govuk-link" href="/judicial/referrals/ref-1">Cancel</a>');
  });

  it("should bring back what was typed and chosen when a submission is rejected", async () => {
    const html = await renderSubmitted({ decision: "Rejected", directionsText: "Refuse: the evidence is incomplete.", publishToGazette: undefined });

    expect(html).toContain("Refuse: the evidence is incomplete.");
    expect(html).toContain('value="Rejected" checked');
  });

  it("should show the error summary and the field message together", async () => {
    const html = await renderSubmitted({ directionsText: "Grant." });

    expect(html).toContain("There is a problem");
    expect(html).toContain('href="#decision"');
    expect(html).toContain("Select whether the application is approved or rejected");
    expect(html).toContain("Select whether this direction is published in the Gazette");
  });
});
