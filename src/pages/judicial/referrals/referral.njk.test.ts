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
    publishToGazette: null,
    decisionDate: null,
    decidedBy: null,
    application: {
      displayReference: "KBDP2026-00001",
      type: "Minor",
      privacy: "Private",
      oldForename: "John",
      oldMiddleName: "Peter",
      oldSurname: "Smith",
      newForename: "John",
      newMiddleName: "Peter",
      newSurname: "Smyth",
      applicantTownCity: "Leeds",
      representativeCompany: "Solicitors LLP",
      nationality: "BritishCitizen",
      dateOfDeclaration: new Date("2026-08-20T00:00:00Z"),
      witnesses: [{ witnessName: "Mary Jones", witnessAddress: "1 High Street, Leeds", witnessOccupation: "Solicitor", declarant: true }],
      documents: [
        { id: "doc-1", name: "birth-certificate.pdf", documentType: "Birth certificate", sizeBytes: 245_760, uploadedOn: new Date("2026-09-02T10:15:00Z") }
      ]
    },
    caseNotes: [{ note: "Chased the declarant", createdBy: "A Caseworker", createdOn: new Date("2026-09-02T14:30:00Z") }],
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
const gazetteRow = (html: string): string => html.match(/Published in the Gazette\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/)?.[1].trim() ?? "";

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

  // Decision 3: grouped and labelled like the caseworker detail page. The case is private, which changes nothing
  // here — private cases show in full.
  it("should render every group of the application's details, for a private case too", async () => {
    const html = await render(detail());

    for (const heading of [
      "General",
      "Names",
      "Applicant address and contact details",
      "Representative address and contact details",
      "Nationality",
      "Declarations"
    ]) {
      expect(html).toContain(`<h3 class="govuk-heading-s">${heading}</h3>`);
    }
    expect(html).toMatch(/Privacy\s*<\/dt>\s*<dd[^>]*>\s*Private/);
    expect(html).toContain("Solicitors LLP");
    expect(html).toContain("British Citizen");
    expect(html).toContain("20 August 2026");
  });

  it("should show no payment, refund, fee or case-id label", async () => {
    const html = await render(detail());

    expect(html).not.toMatch(/payment|refund|fee reference|reference number|case id/i);
  });

  it("should list the application's witnesses", async () => {
    const html = await render(detail());

    expect(html).toContain("Witnesses");
    expect(html).toContain("Mary Jones");
    expect(html).toContain("1 High Street, Leeds");
    expect(html).toMatch(/Declarant\s*<\/dt>\s*<dd[^>]*>\s*Yes/);
  });

  it("should say the application has no witnesses rather than rendering an empty list", async () => {
    const html = await render(detail({ application: { ...detail().application, witnesses: [] } as JudicialReferralDetail["application"] }));

    expect(html).toContain("No witnesses have been added to this application.");
  });

  // The href is the handler's, built with the path helpers (CLAUDE.md "Redirect paths"); the template only prints it.
  it("should link each document's name to the judicial download route, with its type, upload date and size", async () => {
    const html = await render(detail());

    expect(html).toContain('<a class="govuk-link" href="/judicial/referrals/ref-1/documents/doc-1/file">birth-certificate.pdf</a>');
    expect(html).toContain("Birth certificate");
    expect(html).toContain("2 September 2026");
    expect(html).toContain("240 KB");
    expect(html).not.toContain("/deed-polls");
  });

  it("should say no documents have been added rather than rendering an empty table", async () => {
    const html = await render(detail({ application: { ...detail().application, documents: [] } as JudicialReferralDetail["application"] }));

    expect(html).toContain("No documents have been added to this application");
    expect(html).not.toContain("govuk-table");
  });

  it("should show the previous system's referral record only when the application holds one", async () => {
    const withRecord = await render(detail({ application: { ...detail().application, masterName: "Master Smith" } as JudicialReferralDetail["application"] }));
    const without = await render(detail());

    expect(withRecord).toContain("Previous system referral information");
    expect(withRecord).toContain("Master Smith");
    expect(without).not.toContain("Previous system referral information");
  });

  // Read-only: no edit, upload, delete or email control, and the claim is the page's only form.
  it("should offer no control to change the application, its witnesses or its documents", async () => {
    const html = await render(detail({ state: "Open" }));

    expect(html).not.toMatch(/\/edit|\/upload|Upload a|Delete|Remove|Add a witness|Send an email|Change<|Amend/i);
    expect(html.match(/<form/g)).toHaveLength(1);
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

  it("should show the application's timeline with each note attributed", async () => {
    const html = await render(detail());

    expect(html).toContain("Chased the declarant");
    expect(html).toContain("A Caseworker, 2 September 2026 at 3:30pm");
  });

  // A judge's writes are exactly claim and direct (api-3), so there is no note control to hide — and no link to
  // the case, because api's judicial surface takes no case id and there is nowhere for one to point.
  it("should offer no note control and no way into the caseworker's case pages", async () => {
    const html = await render(detail());

    expect(html).not.toContain("/deed-polls");
    expect(html).not.toMatch(/Add note|Amend|notes\/new/);
  });

  it("should offer the claim control on a pool referral, as a form because it changes something", async () => {
    const html = await render(detail({ state: "Open" }));

    expect(html).toContain('action="/judicial/referrals/ref-1/claim"');
    expect(html).toContain("Claim this referral");
    expect(html).not.toContain("Record a direction");
  });

  // Claiming is not repeatable: api takes the first request and 409s the second, so a double click would show a
  // judge "not waiting to be claimed" for a claim of their own that succeeded. api stays the guard — this stops
  // the refusal being rendered at all.
  it("should debounce the claim control against a double click", async () => {
    const html = await render(detail({ state: "Open" }));

    expect(html).toContain('data-prevent-double-click="true"');
  });

  // Hidden rather than disabled, for the reason `witness-edit.njk` gives: a disabled control still reads as
  // something the judge could do, and here it would invite them to take work they do not hold.
  it("should offer the direction control and not the claim one on a referral this judge holds", async () => {
    const html = await render(detail({ state: "Claimed", claimedAt: new Date("2026-09-04T10:00:00Z") }));

    expect(html).toContain('href="/judicial/referrals/ref-1/direction"');
    expect(html).toContain("Record a direction");
    expect(html).not.toContain("Claim this referral");
    expect(html).not.toContain("disabled");
  });

  it("should offer neither control on a referral that has been directed", async () => {
    const html = await render(detail({ state: "Decided", decision: "Approved", publishToGazette: true, decisionDate: new Date("2026-09-05T16:05:00Z") }));

    expect(html).not.toContain("Claim this referral");
    expect(html).not.toContain("Record a direction");
  });

  // The Gazette answer is asserted against its own row rather than against the page: "No" is a substring of
  // "Notes from the court", which is two rows above it, so a page-wide `toContain("No")` passed whatever the
  // template did with the boolean — including inverting it.
  it("should show the direction already recorded, with the Gazette answer in words", async () => {
    const html = await render(
      detail({ state: "Decided", decision: "Approved", directionsText: "Satisfied", publishToGazette: false, decisionDate: new Date("2026-09-05T16:05:00Z") })
    );

    expect(html).toContain("Direction recorded");
    expect(html).toContain("Approved");
    expect(html).toContain("Satisfied");
    expect(gazetteRow(html)).toBe("No");
  });

  it("should show the Gazette answer as Yes when the judge directed publication", async () => {
    const html = await render(detail({ state: "Decided", decision: "Approved", publishToGazette: true, decisionDate: new Date("2026-09-05T16:05:00Z") }));

    expect(gazetteRow(html)).toBe("Yes");
  });

  // api's `publishToGazette` is nullish and the panel is keyed on `decision`, so this shape is reachable. "No"
  // here would tell the judge they directed against publication — a claim api never made, about the one answer
  // on this screen that cannot be taken back.
  it("should say the Gazette answer was not recorded rather than reading it as a No", async () => {
    const html = await render(detail({ state: "Decided", decision: "Approved", publishToGazette: null, decisionDate: new Date("2026-09-05T16:05:00Z") }));

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

  it("should say the application has no notes rather than rendering an empty list", async () => {
    const html = await render(detail({ caseNotes: [] }));

    expect(html).toContain("There are no notes on this application");
  });

  it("should offer the way back to the pool from a referral still in it", async () => {
    const html = await render(detail({ state: "Open" }));

    expect(html).toContain('<a class="govuk-link" href="/judicial/referrals">Back to referrals for a direction</a>');
  });

  // Decision 5, and the whole of the business finding: the pool is `Open` only, so this link on a claimed referral
  // used to send a judge to the one judicial list it is not on. Asserted as the rendered anchor because the two
  // halves have to move together — the right destination under the pool's name would be as wrong to read.
  it.each([
    ["Claimed", { state: "Claimed", claimedAt: new Date("2026-09-04T10:00:00Z") }],
    ["Decided", { state: "Decided", decision: "Approved", decisionDate: new Date("2026-09-05T16:05:00Z") }]
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

  it("should show a refused direction as an error summary, naming no other judge", async () => {
    const html = await render(detail({ state: "Open" }), { direction: "notheld" });

    expect(html).toContain("govuk-error-summary");
    expect(html).toContain("This referral is not waiting for a direction from you.");
    expect(html).not.toMatch(/another judge|claimed by/i);
  });

  // The claim's 409 renders through the same summary. api's visibility makes it a referral this judge already
  // holds, so the sentence must not read as another judge's — and the state it points at is on the page.
  it("should show a refused claim as an error summary on the referral, naming no other judge", async () => {
    const html = await render(detail({ state: "Claimed", claimedBy: "judge@example.com", claimedAt: new Date("2026-09-04T09:00:00Z") }), { claim: "held" });

    expect(html).toContain("govuk-error-summary");
    expect(html).toContain("This referral is not waiting to be claimed.");
    expect(html).not.toMatch(/another judge|already been claimed/i);
  });

  it("should show neither message on a referral opened straight from the pool", async () => {
    const html = await render(detail());

    expect(html).not.toContain("govuk-notification-banner");
    expect(html).not.toContain("govuk-error-summary");
  });
});
