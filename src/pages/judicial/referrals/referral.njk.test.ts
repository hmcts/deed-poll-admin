/**
 * The referral screen's markup, rendered rather than asserted through the view model.
 *
 * The model is `[referralId].test.ts`'s subject. What this file exists for is what a model cannot show, and on
 * this screen it is the disclosure question: that the page renders **only** the judicial DTO's fields, that the
 * two write controls are absent rather than disabled in the states they do not belong to, and that no caseworker
 * control — an add-note button, a link to the case — is on the page at all.
 *
 * The model comes from the page handler rather than being hand-built here, so a name the handler stops passing
 * fails this test too.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getReferral } from "@hmcts/deed-poll";
import type { JudicialReferralDetail } from "@hmcts/deed-poll-api-client";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { addPathFilters } from "../../../path-filters.js";
import { GET } from "./[referralId].js";

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

const detail = (overrides: Partial<JudicialReferralDetail> = {}): JudicialReferralDetail =>
  ({
    id: "ref-1",
    state: "Open",
    reasons: ["Minor", "DomesticAbuse"],
    notes: "Applicant is 15",
    urgency: "Urgent",
    urgencyReason: "Hearing on Friday",
    createdOn: new Date("2026-09-03T08:44:00Z"),
    claimedBy: null,
    claimedAt: null,
    decision: null,
    directionsText: null,
    changesToStandardPublication: null,
    decisionDate: null,
    decidedBy: null,
    application: {
      displayReference: "KBDP2026-00001",
      newForename: "John",
      newMiddleName: "Peter",
      newSurname: "Smyth",
      oldForename: "John",
      oldMiddleName: "Peter",
      oldSurname: "Smith",
      type: "Minor",
      nationality: "BritishCitizen",
      parents: "Jane Smith and Paul Smith",
      documents: [
        { id: "doc-1", name: "birth-certificate.pdf", documentType: "Birth certificate", sizeBytes: 245_760, uploadedOn: new Date("2026-09-02T10:15:00Z") }
      ]
    },
    ...overrides
  }) as JudicialReferralDetail;

/** The screen as a browser receives it, for the referral api answers with. */
const render = async (referral: JudicialReferralDetail, query: Record<string, unknown> = {}): Promise<string> => {
  vi.mocked(getReferral).mockResolvedValue(referral as never);
  const res = pageResponse();
  await GET(pageRequest({ params: { referralId: "ref-1" }, query, judicial: true, accessToken: "judge-token" }), res);
  const model = res.render.mock.calls[0][1];

  return environment.render("judicial/referrals/referral.njk", { ...model.en, ...model });
};

/**
 * The Gazette row's value on its own.
 *
 * Read off the row rather than off the page because "No" is a substring of "Notes from the court", two rows
 * above it: a page-wide `toContain("No")` cannot tell a correct rendering of the boolean from an inverted one.
 */
const gazetteRow = (html: string): string =>
  html.match(/Changes to the standard publications in the Gazette\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/)?.[1].trim() ?? "";

describe("judicial referral template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show the application's reference, type and both names part by part, as the caseworker page does", async () => {
    const html = await render(detail());

    expect(html).toContain("KBDP2026-00001");
    expect(html).toContain("Minor");
    expect(html).toMatch(/New surname\s*<\/dt>\s*<dd[^>]*>\s*Smyth/);
    expect(html).toMatch(/Old surname\s*<\/dt>\s*<dd[^>]*>\s*Smith/);
  });

  // Master Sullivan's feedback (2026-10-27): General first, then the referral, then the supporting documents, and
  // General holds the Masters' eleven fields in their order.
  it("should show General, then the referral, then the supporting documents", async () => {
    const html = await render(detail());

    const general = html.indexOf('<h3 class="govuk-heading-s">General</h3>');
    const referral = html.indexOf('<h2 class="govuk-heading-m">Referral</h2>');
    const documents = html.indexOf('<h2 class="govuk-heading-m" id="documents">Supporting documents</h2>');
    expect(general).toBeGreaterThan(-1);
    expect(referral).toBeGreaterThan(general);
    expect(documents).toBeGreaterThan(referral);
    expect(html).toMatch(/Minor’s parents’ names\s*<\/dt>\s*<dd[^>]*>\s*Jane Smith and Paul Smith/);
    expect(html).toContain("British Citizen");
  });

  it("should show no witnesses, case notes, previous-system record or waiting time", async () => {
    const html = await render(detail());

    expect(html).not.toMatch(/Witnesses|Case notes|Previous system referral information|Waiting since/);
  });

  it("should show no payment, refund, fee or case-id label", async () => {
    const html = await render(detail());

    expect(html).not.toMatch(/payment|refund|fee reference|reference number|case id/i);
  });

  // The href is the handler's, built with the path helpers (CLAUDE.md "Redirect paths"); the template only prints it.
  it("should link each document's name to the judicial viewer, with its type, upload date and size", async () => {
    const html = await render(detail());

    expect(html).toContain('<a class="govuk-link" href="/judicial/referrals/ref-1/documents/doc-1/view">birth-certificate.pdf</a>');
    expect(html).toContain("Birth certificate");
    expect(html).toContain("2 September 2026");
    expect(html).toContain("240 KB");
    expect(html).not.toContain("/deed-polls");
  });

  it("should mark the documents list as the viewer's way back", async () => {
    const html = await render(detail());

    expect(html).toContain('<h2 class="govuk-heading-m" id="documents">');
  });

  it("should say no documents have been added rather than rendering an empty table", async () => {
    const html = await render(detail({ application: { ...detail().application, documents: [] } as JudicialReferralDetail["application"] }));

    expect(html).toContain("No documents have been added to this application");
    expect(html).not.toContain("govuk-table");
  });

  // Read-only: no edit, upload, delete or email control, and no form at all since the claim went.
  it("should offer no control to change the application, its witnesses or its documents", async () => {
    const html = await render(detail({ state: "Claimed" }));

    expect(html).not.toMatch(/\/edit|\/upload|Upload a|Delete|Remove|Add a witness|Send an email|Change<|Amend/i);
    expect(html).not.toContain("<form");
  });

  it("should list the reasons the caseworker chose, in the business's words", async () => {
    const html = await render(detail());

    expect(html).toContain("Applicant is a minor");
    expect(html).toContain("Domestic abuse considerations");
  });

  it("should print the urgency as a word beside its tag, never as colour alone", async () => {
    const html = await render(detail({ urgency: "Urgent" }));

    expect(html).toContain("govuk-tag--red");
    expect(html).toContain("Urgent");
  });

  // A judge's writes are exactly direct, change and withdraw, so there is no note control to hide — and no link to
  // the case, because api's judicial surface takes no case id and there is nowhere for one to point.
  it("should offer no note control and no way into the caseworker's case pages", async () => {
    const html = await render(detail());

    expect(html).not.toContain("/deed-polls");
    expect(html).not.toMatch(/Add note|Amend|notes\/new/);
  });

  // There is no claim since api D2: an Open referral is visible to no Master, and nothing on the page offers one.
  it("should offer no claim control in any state", async () => {
    for (const state of ["Open", "Claimed", "Decided"] as const) {
      const html = await render(detail({ state }));

      expect(html).not.toMatch(/Claim this referral|\/claim"/);
    }
  });

  it("should show when the referral was assigned and when its direction is due", async () => {
    const html = await render(detail({ state: "Claimed", assignedAt: new Date("2026-10-23T10:00:00Z"), directionDueBy: new Date("2026-10-30T10:00:00Z") }));

    expect(html).toMatch(/Assigned to you\s*<\/dt>\s*<dd class="govuk-summary-list__value">\s*23 October 2026 at 11:00am/);
    expect(html).toMatch(/Direction due by\s*<\/dt>\s*<dd class="govuk-summary-list__value">\s*30-10-26/);
  });

  it("should show no due date once the direction is recorded", async () => {
    const html = await render(
      detail({ state: "Decided", decision: "Approved", decisionDate: new Date("2026-10-25T10:00:00Z"), directionDueBy: new Date("2026-10-30T10:00:00Z") })
    );

    expect(html).not.toContain("Direction due by");
  });

  // Hidden rather than disabled, for the reason `witness-edit.njk` gives: a disabled control still reads as
  // something the judge could do, and here it would invite them to take work they do not hold.
  it("should offer the direction control on a referral assigned to this judge", async () => {
    const html = await render(detail({ state: "Claimed", claimedAt: new Date("2026-09-04T10:00:00Z") }));

    expect(html).toContain('href="/judicial/referrals/ref-1/direction"');
    expect(html).toContain("Record a direction");
    expect(html).not.toContain("disabled");
  });

  it("should offer change and withdraw links, and not direct, on a referral this judge has directed", async () => {
    const html = await render(
      detail({ state: "Decided", decision: "Approved", changesToStandardPublication: false, decisionDate: new Date("2026-09-05T16:05:00Z") })
    );

    expect(html).not.toContain("Record a direction");
    expect(html).toMatch(/<a class="govuk-link" href="\/judicial\/referrals\/ref-1\/direction\?change=1">Change your direction<\/a>/);
    expect(html).toMatch(/<a class="govuk-link" href="\/judicial\/referrals\/ref-1\/withdraw">Withdraw your direction<\/a>/);
  });

  it("should offer neither change nor withdraw on a referral that is not yet directed", async () => {
    for (const state of ["Open", "Claimed"] as const) {
      const html = await render(detail({ state }));

      expect(html).not.toContain("Change your direction");
      expect(html).not.toContain("Withdraw your direction");
    }
  });

  // The Gazette answer is asserted against its own row rather than against the page: "No" is a substring of
  // "Notes from the court", which is two rows above it, so a page-wide `toContain("No")` passed whatever the
  // template did with the boolean — including inverting it.
  it("should show the direction already recorded, with the Gazette answer in words", async () => {
    const html = await render(
      detail({
        state: "Decided",
        decision: "Approved",
        directionsText: "Satisfied",
        changesToStandardPublication: false,
        decisionDate: new Date("2026-09-05T16:05:00Z")
      })
    );

    expect(html).toContain("Direction recorded");
    expect(html).toContain("Approved");
    expect(html).toContain("Satisfied");
    expect(gazetteRow(html)).toBe("No");
  });

  it("should show the Gazette answer as Yes when the Master directed changes to the standard publication", async () => {
    const html = await render(
      detail({
        state: "Decided",
        decision: "Approved",
        directionsText: "Publish the last name only",
        changesToStandardPublication: true,
        decisionDate: new Date("2026-09-05T16:05:00Z")
      })
    );

    expect(gazetteRow(html)).toBe("Yes");
  });

  // api's `changesToStandardPublication` is nullish and the panel is keyed on `decision`, so this shape is reachable. "No"
  // here would tell the judge they directed against publication — a claim api never made, about the one answer
  // on this screen that cannot be taken back.
  it("should say the Gazette answer was not recorded rather than reading it as a No", async () => {
    const html = await render(
      detail({ state: "Decided", decision: "Approved", changesToStandardPublication: null, decisionDate: new Date("2026-09-05T16:05:00Z") })
    );

    expect(gazetteRow(html)).toBe("Not recorded");
  });

  it("should leave the direction panel out entirely while a referral is awaiting one", async () => {
    const html = await render(detail({ state: "Open" }));

    expect(html).not.toContain("Direction recorded");
  });

  it("should say the application details were not returned rather than showing an unnamed applicant", async () => {
    const html = await render(detail({ application: null }));

    expect(html).toContain("The application details were not returned with this referral");
    expect(html).not.toContain("Not provided");
  });

  // One judicial list since api D2, so every referral links back to it.
  it.each([
    ["Claimed", { state: "Claimed", claimedAt: new Date("2026-09-04T10:00:00Z") }],
    ["Decided", { state: "Decided", decision: "Approved", decisionDate: new Date("2026-09-05T16:05:00Z") }],
    ["unknown", { state: null }]
  ] as const)("should offer the way back to My referrals from a %s referral", async (_state, overrides) => {
    const html = await render(detail(overrides));

    expect(html).toContain('<a class="govuk-link" href="/judicial/referrals/mine">Back to My referrals</a>');
    expect(html).not.toContain('href="/judicial/referrals"');
  });

  // A recorded direction is not a correction to anything on the page, which is what distinguishes the banner from
  // the summary the refusal below gets.
  it("should announce a direction it has just recorded in a success banner", async () => {
    const html = await render(detail({ state: "Decided", decision: "Approved", decisionDate: new Date("2026-09-05T16:05:00Z") }), { direction: "recorded" });

    expect(html).toContain("govuk-notification-banner--success");
    expect(html).toContain("Your direction has been recorded.");
  });

  it("should announce a withdrawn direction and offer the direction form again", async () => {
    const html = await render(detail({ state: "Claimed", claimedAt: new Date("2026-09-04T10:00:00Z") }), { direction: "withdrawn" });

    expect(html).toContain("govuk-notification-banner--success");
    expect(html).toContain("Your direction has been withdrawn. Record a new direction.");
    expect(html).toContain('href="/judicial/referrals/ref-1/direction"');
  });

  it("should show a refused change as an error summary, naming no other judge", async () => {
    const html = await render(detail({ state: "Claimed", claimedAt: new Date("2026-09-04T10:00:00Z") }), { direction: "notchangeable" });

    expect(html).toContain("govuk-error-summary");
    expect(html).toContain("This referral does not have a direction from you to change or withdraw.");
    expect(html).not.toMatch(/another judge|directed by/i);
  });

  it("should show a refused direction as an error summary, naming no other judge", async () => {
    const html = await render(detail({ state: "Open" }), { direction: "notheld" });

    expect(html).toContain("govuk-error-summary");
    expect(html).toContain("This referral is not waiting for a direction from you.");
    expect(html).not.toMatch(/another judge|claimed by/i);
  });

  it("should show neither message on a referral opened from My referrals", async () => {
    const html = await render(detail());

    expect(html).not.toContain("govuk-notification-banner");
    expect(html).not.toContain("govuk-error-summary");
  });
});
