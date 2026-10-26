/**
 * The case detail page's referrals and emails panels, rendered rather than asserted through their view models.
 *
 * The models are asserted in `[id].test.ts`, which is where the extra calls and the tabs' empty states are
 * pinned. What this file exists for is what a model cannot show: that the raise control is a button the panel
 * **withholds** while a referral is open rather than rendering disabled, that each row links to the record it
 * is about, that a migrated referral explains its empty reasons cell instead of showing a blank one — and, for
 * the emails panel, that nothing a caseworker reads there can be mistaken for proof the applicant received the
 * email.
 *
 * Since `referrals-admin-4` it also covers the retired "Referral to Master" record, which the panel renders
 * read-only below the live history: whether a section appears at all is a rendering decision the view model can
 * only half express, and the two orderings — history above, history below — look identical in a model.
 *
 * Only those two tabs are covered — the other three panels predate this file and are asserted through their
 * view models. Rendering the whole template is how the panel is reached, not the subject.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findCaseEmails, findDeedPoll, findReferrals } from "@hmcts/deed-poll";
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
    findCaseEmails: vi.fn(),
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

/** api's slot metadata for the one shipped template — `snake_case` names, as published. */
const SLOTS = [
  { name: "judges_reason", required: true, maxLength: 4000 },
  { name: "additional_notes", required: false, maxLength: 1000 }
];

/** The emails payload: one sendable template, nothing sent yet. */
const CASE_EMAILS = {
  availability: [{ template: "application-rejected", applicable: true, reason: null, provisioned: true, slots: SLOTS }],
  history: [],
  slotDefaults: [{ template: "application-rejected", fields: { judges_reason: "The evidence does not establish identity." } }]
};

const SENT_EMAIL = {
  id: "email-1",
  template: "application-rejected",
  templateName: "Application refused",
  subject: "Your application has been refused",
  body: "Dear applicant,\n\nThe Master has refused your application.",
  recipient: "applicant@example.com",
  notifyState: "Sent" as const,
  failureReason: null,
  createdBy: "caseworker@example.com",
  createdOn: new Date("2026-03-18T11:05:00Z"),
  documents: []
};

const FAILED_EMAIL = {
  ...SENT_EMAIL,
  id: "email-2",
  subject: null,
  body: null,
  notifyState: "Failed" as const,
  failureReason: "GOV.UK Notify rejected the recipient address (PERMANENT, status 400)",
  createdOn: new Date("2026-02-27T14:20:00Z")
};

/** Content pair first, the handler's own values over it — `renderInterceptorMiddleware`'s order. See `referral-detail.njk.test.ts`. */
const html = (model: Record<string, unknown>): string => environment.render("deed-polls/detail.njk", { ...(model.en as object), ...model });

async function page(referrals: Record<string, unknown>[], record: Record<string, unknown> = found): Promise<string> {
  vi.mocked(findDeedPoll).mockResolvedValue(record as never);
  vi.mocked(findReferrals).mockResolvedValue(referrals as never);
  const res = pageResponse();

  await GET(pageRequest({ params: { id: "case-1" }, accessToken: "session-token" }), res);

  return html(res.render.mock.calls[0][1]);
}

/** The page with one emails payload, the referrals read succeeding so only the emails panel varies. */
async function emailsPage(emails: Record<string, unknown>): Promise<string> {
  vi.mocked(findReferrals).mockResolvedValue([]);
  vi.mocked(findCaseEmails).mockResolvedValue(emails as never);
  const res = pageResponse();

  await GET(pageRequest({ params: { id: "case-1" }, accessToken: "session-token" }), res);

  return html(res.render.mock.calls[0][1]);
}

/** A case whose referral history is in the retired fields, as a migrated one may be. */
const LEGACY_RECORD = {
  ...found,
  referToMasterChoice: "Yes",
  masterName: "Master Smith",
  masterDirections: "Enrol once the declarant's consent is filed.",
  masterDecision: "Approved",
  publishToLondonGazette: false
};

/**
 * The page with the referrals read failing, which the handler degrades to a panel rather than a 404.
 *
 * The `console.error` is the handler's own log line for the degradation, silenced so the suite output stays
 * readable — asserted in `[id].test.ts`, which owns the handler's side of this.
 */
async function unavailablePage(record: Record<string, unknown> = found): Promise<string> {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(findDeedPoll).mockResolvedValue(record as never);
  vi.mocked(findReferrals).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): nope"));
  const res = pageResponse();

  await GET(pageRequest({ params: { id: "case-1" }, accessToken: "session-token" }), res);
  logged.mockRestore();

  return html(res.render.mock.calls[0][1]);
}

/**
 * The page with the emails read failing, degraded to a panel the same way.
 *
 * The referrals read is left succeeding so the two degraded panels cannot be confused for each other in an
 * assertion that is really about one of them.
 */
async function unavailableEmailsPage(): Promise<string> {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(findReferrals).mockResolvedValue([]);
  vi.mocked(findCaseEmails).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): nope"));
  const res = pageResponse();

  await GET(pageRequest({ params: { id: "case-1" }, accessToken: "session-token" }), res);
  logged.mockRestore();

  return html(res.render.mock.calls[0][1]);
}

/**
 * One tab's panel, for the assertions that a page-wide `toContain` would satisfy from another tab.
 *
 * "None recorded." is every empty panel's copy, so asserting its *absence* has to be scoped or it is really an
 * assertion about notes, witnesses and documents — and the same goes for the words decision 10 forbids, which
 * the documents tab's own columns could supply. Each window runs from the panel's `id` to the next panel's
 * class attribute, so a tab inserted after the one under test narrows the window rather than widening it,
 * which is the safe direction for a negative.
 */
function panelFor(rendered: string, id: string): string {
  const start = rendered.indexOf(`id="${id}"`);
  const next = rendered.indexOf("govuk-tabs__panel", start + 1);

  return rendered.slice(start, next === -1 ? undefined : next);
}

/**
 * The referrals panel, which is `panelFor(rendered, "referrals")`.
 *
 * Both names exist because the two branches generalised the same one-tab helper in different directions and met
 * here: `referrals-admin-4` kept it referrals-specific, `notify-2` needed a second tab and took an `id`. Kept as
 * a wrapper rather than resolved either way — rewriting seven referral tests to pass a literal would be churn in
 * somebody else's work to no end, and dropping the general form would leave the emails tests with no way to
 * scope an assertion. Prefer `panelFor` in anything new.
 */
function referralsPanel(rendered: string): string {
  return panelFor(rendered, "referrals");
}

describe("case detail template — the referrals tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findCaseEmails).mockResolvedValue(CASE_EMAILS as never);
  });

  it("should render the referrals tab as one of the page's tabs", async () => {
    const rendered = await page([]);

    expect(rendered).toContain('href="#referrals"');
    expect(rendered).toContain("Referrals");
  });

  it("should offer one referral tab, even on a case whose retired fields are populated", async () => {
    // Two tabs whose ids differed by an "s" is what decision 1 removes. Asserted on the rendered tab strip
    // because that is where a caseworker met both — and on a case that would have shown the retired one, since
    // its old visibility rule keyed on `referToMasterChoice`.
    const rendered = await page([], LEGACY_RECORD);

    expect(rendered).not.toContain('href="#referral"');
    expect(rendered).not.toContain("Referral to Master");
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

  it("should say as inset text on the row when the judge changed that referral's direction", async () => {
    const changed = { ...REFERRAL, state: "Decided", directionChangedAt: new Date("2026-10-19T09:30:00Z") };

    const panel = referralsPanel(await page([changed]));

    expect(panel).toMatch(/<div class="govuk-inset-text[^"]*">\s*The judge changed this direction on 19 October 2026 at 10:30am\.\s*<\/div>/);
  });

  it("should put the change notice only on the referral whose direction changed", async () => {
    const changed = { ...REFERRAL, id: "ref-2", state: "Decided", directionChangedAt: new Date("2026-10-19T09:30:00Z") };
    const unchanged = { ...REFERRAL, id: "ref-1", state: "Closed", directionChangedAt: null };

    const panel = referralsPanel(await page([changed, unchanged]));

    expect(panel.match(/The judge changed this direction/g)).toHaveLength(1);
    expect(panel.indexOf("The judge changed this direction")).toBeLessThan(panel.indexOf('href="/deed-polls/case-1/referrals/ref-1"'));
  });

  it("should show no change notice on a referral whose direction stands as first given", async () => {
    const panel = referralsPanel(await page([{ ...REFERRAL, state: "Decided" }]));

    expect(panel).not.toContain("The judge changed this direction");
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

  describe("the retired referral record", () => {
    it("should render the populated retired fields under their own heading, below the live history", async () => {
      // Decision 2: one tab owns both, and the historical record is clearly separated rather than mixed into
      // the list of referrals api holds.
      const panel = referralsPanel(await page([REFERRAL], LEGACY_RECORD));

      expect(panel).toContain("Previous system referral information");
      expect(panel).toContain("Master Smith");
      expect(panel).toContain("Enrol once the declarant&#39;s consent is filed.");
      expect(panel.indexOf("Previous system referral information")).toBeGreaterThan(panel.indexOf("13 May 2026"));
    });

    it("should say the record came from the previous system and is not updated", async () => {
      const panel = referralsPanel(await page([], LEGACY_RECORD));

      expect(panel).toContain("recorded in the previous system");
      expect(panel).toContain("is not updated");
    });

    it("should render only the fields the case holds, not a column of placeholders against ten retired ones", async () => {
      const panel = referralsPanel(await page([], LEGACY_RECORD));

      expect(panel).toContain("Master name");
      // Never referred under the old system either, so these were never answered — and ten "Not provided" rows
      // would claim a referral history the case does not have.
      expect(panel).not.toContain("Date ready for Master");
      expect(panel).not.toContain("Referral notes");
    });

    it("should keep an explicit No on the Gazette question, which is an answer somebody recorded", async () => {
      const panel = referralsPanel(await page([], LEGACY_RECORD));

      expect(panel).toContain("Publish to London Gazette");
      expect(panel).toContain("No");
    });

    it("should render no section at all for a case that holds none of the retired fields", async () => {
      const panel = referralsPanel(await page([REFERRAL]));

      expect(panel).not.toContain("Previous system referral information");
    });

    it("should still render the snapshot when the referrals read failed, the two being different records", async () => {
      // The reason it sits outside the panel's three-state branch: a failed call to api's referral endpoint says
      // nothing about the retired fields on the case, and hiding the history behind it would lose a migrated
      // case's whole referral record to an unrelated outage.
      const panel = referralsPanel(await unavailablePage(LEGACY_RECORD));

      expect(panel).toContain("Referral information could not be loaded");
      expect(panel).toContain("Previous system referral information");
      expect(panel).toContain("Master Smith");
    });

    it("should offer no way to edit it, the tab it was edited on having been retired", async () => {
      const panel = referralsPanel(await page([], LEGACY_RECORD));

      expect(panel).not.toContain("/edit/referral");
      expect(panel).not.toContain("Change");
    });
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
      const panel = panelFor(await unavailablePage(), "referrals");

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

describe("case detail template — the emails tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findCaseEmails).mockResolvedValue(CASE_EMAILS as never);
  });

  it("should render the emails tab as one of the page's tabs", async () => {
    const rendered = await emailsPage(CASE_EMAILS);

    expect(rendered).toContain('href="#emails"');
    expect(rendered).toContain("Emails");
  });

  it("should list a sent email with its state tagged, when it was created and who sent it", async () => {
    const rendered = await emailsPage({ ...CASE_EMAILS, history: [SENT_EMAIL] });
    const panel = panelFor(rendered, "emails");

    expect(panel).toContain("1 email");
    expect(panel).toContain("Application refused");
    expect(panel).toMatch(/govuk-tag[^"]*govuk-tag--green/);
    expect(panel).toContain("Accepted by Notify");
    expect(panel).toContain("18 March 2026");
    expect(panel).toContain("caseworker@example.com");
  });

  it("should render a failed email as failed, since that is the row that needs a phone call", async () => {
    const panel = panelFor(await emailsPage({ ...CASE_EMAILS, history: [SENT_EMAIL, FAILED_EMAIL] }), "emails");

    expect(panel).toContain("2 emails");
    expect(panel).toMatch(/govuk-tag[^"]*govuk-tag--red/);
    expect(panel).toContain("Failed");
  });

  // Decision 10, as a test rather than a preference. api knows that GOV.UK Notify accepted the send and nothing
  // more: there are no delivery callbacks in this estate and no download concept anywhere in the Notify client,
  // so a caseworker who read any of these words here could conclude an applicant has their deed poll when the
  // email in fact bounced. A later well-meaning wording change fails here instead of shipping.
  it("should never say an email was delivered, viewed, opened or downloaded", async () => {
    const panel = panelFor(await emailsPage({ ...CASE_EMAILS, history: [SENT_EMAIL, FAILED_EMAIL] }), "emails");

    expect(panel).not.toMatch(/delivered|viewed|opened|downloaded/i);
  });

  it("should say what acceptance by Notify does and does not mean, beside the states it labels", async () => {
    const panel = panelFor(await emailsPage({ ...CASE_EMAILS, history: [SENT_EMAIL] }), "emails");

    expect(panel).toContain("It is not confirmation that the applicant received or read it.");
  });

  it("should link each row to that email's own page, the table itself carrying no content", async () => {
    // Decision 14: a body is several paragraphs and would destroy the table's scannability, so the template name
    // is the row's handle and the content lives one page down.
    const panel = panelFor(await emailsPage({ ...CASE_EMAILS, history: [SENT_EMAIL] }), "emails");

    expect(panel).toContain('href="/deed-polls/case-1/emails/email-1"');
    expect(panel).toContain("view what was sent");
    expect(panel).not.toContain("The Master has refused your application.");
  });

  it("should say nothing has been sent on a case whose applicant has never been written to", async () => {
    const panel = panelFor(await emailsPage(CASE_EMAILS), "emails");

    expect(panel).toContain("None recorded.");
  });

  it("should offer the send button for the applicable template, going straight to compose with no picker", async () => {
    // Decision 2 as amended: api ships one template, and radios with one option read as an unfinished feature.
    const panel = panelFor(await emailsPage(CASE_EMAILS), "emails");

    expect(panel).toContain('href="/deed-polls/case-1/emails/application-rejected/compose"');
    expect(panel).toContain("Send an email: Application rejected");
    expect(panel).not.toContain('href="/deed-polls/case-1/emails/new"');
  });

  it("should render a second sendable template as a second button, with no change to this template", async () => {
    // The design intent of building the panel off api's availability: a template arriving with notify-3,
    // notify-4 or notify-6 appears here on its own. More than one is also the trigger to build the picker
    // decision 2 deferred, which is why this is worth pinning rather than assuming.
    const panel = panelFor(
      await emailsPage({
        ...CASE_EMAILS,
        availability: [...CASE_EMAILS.availability, { template: "chase-missing-documents", applicable: true, reason: null, provisioned: true, slots: SLOTS }]
      }),
      "emails"
    );

    expect(panel).toContain('href="/deed-polls/case-1/emails/application-rejected/compose"');
    expect(panel).toContain('href="/deed-polls/case-1/emails/chase-missing-documents/compose"');
    expect(panel).toContain("Send an email: Chase missing documents");
  });

  it("should withhold the button and give api's reason when nothing can be sent", async () => {
    // A missing button with nothing beside it reads as a bug, and an applicant with no email address is the
    // common case. api's sentence is prose written for a caseworker, so it is rendered unaltered.
    const panel = panelFor(
      await emailsPage({
        ...CASE_EMAILS,
        availability: [
          {
            template: "application-rejected",
            applicable: false,
            reason: "This case has no referral that a Master has refused",
            provisioned: true,
            slots: SLOTS
          }
        ]
      }),
      "emails"
    );

    expect(panel).not.toContain("/compose");
    expect(panel).toContain("This case has no referral that a Master has refused");
  });

  it("should withhold the button and say so for a template this environment has not provisioned", async () => {
    // api's two flags are separate questions, and `provisioned` is false everywhere until notify-0 runs. A
    // button offered without it leads to a preview api answers 502 — the 500 page — for a reason the tab held.
    const panel = panelFor(
      await emailsPage({
        ...CASE_EMAILS,
        availability: [{ template: "application-rejected", applicable: true, reason: null, provisioned: false, slots: SLOTS }]
      }),
      "emails"
    );

    expect(panel).not.toContain("/compose");
    expect(panel).toContain("has not been set up in GOV.UK Notify");
  });

  describe("when the emails read failed", () => {
    it("should still render the case, the panel being one tab rather than the page", async () => {
      const rendered = await unavailableEmailsPage();

      expect(rendered).toContain("KBDP2026-00001");
      expect(rendered).toContain('href="#emails"');
    });

    // The distinction the degraded state exists for: "None recorded." would tell a caseworker the applicant has
    // never been written to, which is the opposite claim from not having found out.
    it("should say the information could not be loaded rather than that nothing has been sent", async () => {
      const panel = panelFor(await unavailableEmailsPage(), "emails");

      expect(panel).toContain("Email information could not be loaded");
      expect(panel).not.toContain("None recorded.");
    });

    // The compose page reads the same endpoint, so a button here would lead to a page that cannot load either.
    it("should withhold every send button, since the compose page reads the same payload", async () => {
      const panel = panelFor(await unavailableEmailsPage(), "emails");

      expect(panel).not.toContain("/compose");
    });
  });
});

/**
 * The banner a completed send comes back to, rendered rather than asserted through the handler's model.
 *
 * `emails/[template]/send.ts` redirects to this page rather than rendering a confirmation of its own, so the
 * outcome of an irreversible action is markup here — and the redundant send is the one that must not read as a
 * failure. The handler's half (which query values it honours, and that an invented id builds no link) is pinned
 * in `[id].test.ts`.
 */
describe("case detail template — the banner a send comes back to", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findReferrals).mockResolvedValue([]);
    vi.mocked(findCaseEmails).mockResolvedValue({ ...CASE_EMAILS, history: [SENT_EMAIL] } as never);
  });

  async function sentPage(query: Record<string, string>): Promise<string> {
    const res = pageResponse();

    await GET(pageRequest({ params: { id: "case-1" }, query, accessToken: "session-token" }), res);

    return html(res.render.mock.calls[0][1]);
  }

  it("should confirm a send as a success, with a link to what was sent", async () => {
    const rendered = await sentPage({ email: "sent", emailId: "email-1" });

    expect(rendered).toContain("govuk-notification-banner--success");
    expect(rendered).toContain("The email has been accepted by GOV.UK Notify for sending to the applicant.");
    expect(rendered).toContain('href="/deed-polls/case-1/emails/email-1"');
  });

  it("should report a redundant send as already sent rather than as a failure", async () => {
    const rendered = await sentPage({ email: "already-sent", emailId: "email-1" });

    expect(rendered).toContain("govuk-notification-banner--success");
    expect(rendered).toContain("This email had already been sent for this case, so it was not sent again.");
  });

  it("should render no banner for an email id the history does not carry", async () => {
    // Was "should still say what happened when there is no email to link to", asserting the sentence survived an
    // unknown id with only the link withheld. That is the defect: the query string is user input, so the sentence
    // has to be earned by the history rather than by the URL.
    const rendered = await sentPage({ email: "sent", emailId: "email-nope" });

    expect(rendered).not.toContain("govuk-notification-banner--success");
    expect(rendered).not.toContain('href="/deed-polls/case-1/emails/email-nope"');
  });

  it("should still confirm the send, unlinked, when the history could not be read", async () => {
    // The one case where an unverifiable id still earns the sentence, and the reason the fix above is a condition
    // rather than a blanket check: with the emails read degraded there is nothing to check the id against, and
    // swallowing the confirmation for a send that did happen is the worse of the two errors. This is the template
    // side of `[id].test.ts`'s "still confirms the send when the emails read failed".
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findCaseEmails).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): nope"));

    const rendered = await sentPage({ email: "sent", emailId: "email-1" });

    expect(rendered).toContain("accepted by GOV.UK Notify");
    expect(rendered).not.toContain('href="/deed-polls/case-1/emails/email-1"');
    logged.mockRestore();
  });

  it("should render no banner on an ordinary visit", async () => {
    const rendered = await sentPage({});

    expect(rendered).not.toContain("govuk-notification-banner--success");
  });
});

/**
 * The awaiting-confirmation notice — `notify-3b` decision 2.
 *
 * `[id].test.ts` owns the sentence and where it comes from. What a model cannot show is the one thing the
 * decision is about: that the notice sits *beside* the case state rather than replacing it, and that it is not
 * the "Important" banner the privacy warning above the heading already is.
 */
describe("case detail template — the awaiting-confirmation notice", () => {
  const waiting = { ...found, state: "Returned", awaitingConfirmationSince: new Date("2026-05-12T08:44:00.000Z") };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findCaseEmails).mockResolvedValue(CASE_EMAILS as never);
  });

  it("should say the case is waiting, as inset text below the case header", async () => {
    const rendered = await page([], waiting);

    expect(rendered).toContain("govuk-inset-text");
    expect(rendered).toContain("The applicant was asked on 12 May 2026 at 9:44am whether they want to proceed");
  });

  it("should keep the state tag reading Returned beside it, there being no ninth case state", async () => {
    const rendered = await page([], waiting);

    expect(rendered).toContain("Returned");
    // Beside and below, not above: the notice comes after the header's summary list and before the tabs.
    expect(rendered.indexOf("govuk-inset-text")).toBeGreaterThan(rendered.indexOf("govuk-summary-list"));
    expect(rendered.indexOf("govuk-inset-text")).toBeLessThan(rendered.indexOf("govuk-tabs"));
  });

  it("should not render it as a notification banner, which the privacy warning already owns", async () => {
    const rendered = await page([], waiting);

    expect(rendered).not.toContain("govuk-notification-banner");
  });

  it("should render nothing at all on a case waiting for nothing", async () => {
    const rendered = await page([], found);

    expect(rendered).not.toContain("govuk-inset-text");
    expect(rendered).not.toContain("whether they want to proceed");
  });

  it("should say which referral is waiting on the tab the notice sends the caseworker to", async () => {
    // The notice's last sentence promises the answer is against a referral "see the Referrals tab", and this
    // table otherwise lists dates, statuses and reasons only — so on a case with a history the caseworker would
    // have to open each row to find the one that was asked.
    const asked = { ...REFERRAL, id: "ref-2", state: "Decided", confirmationRequestedAt: new Date("2026-05-12T08:44:00Z"), confirmationOutcome: null };

    const rendered = await page([asked, REFERRAL], waiting);

    expect(rendered).toContain("Awaiting the applicant&#39;s response");
    // Beside the status rather than instead of it: the referral's own state is still a fact about the row.
    expect(rendered).toContain("Direction received");
  });

  it("should mark only the referral that is waiting, not every row on a case that is", async () => {
    const asked = { ...REFERRAL, id: "ref-2", state: "Decided", confirmationRequestedAt: new Date("2026-05-12T08:44:00Z"), confirmationOutcome: null };
    const answered = { ...asked, id: "ref-3", confirmationOutcome: "Confirmed", confirmationReceivedAt: new Date("2026-05-14T09:00:00Z") };

    const rendered = await page([asked, answered, REFERRAL], waiting);

    expect(rendered.match(/Awaiting the applicant&#39;s response/g)).toHaveLength(1);
  });

  it("should mark a closed referral that is still waiting, because closing clears neither column", async () => {
    // The same reason `awaiting` is api's two-column predicate rather than a question about the state: this row
    // is what keeps the case on the worklist, and a table that showed "Direction actioned" alone would read as
    // finished.
    const closed = { ...REFERRAL, state: "Closed", confirmationRequestedAt: new Date("2026-05-12T08:44:00Z"), confirmationOutcome: null };

    const rendered = await page([closed], waiting);

    expect(rendered).toContain("Awaiting the applicant&#39;s response");
    expect(rendered).toContain("Direction actioned");
  });

  it("should mark no row on a case whose referrals were never asked", async () => {
    const rendered = await page([REFERRAL], found);

    expect(rendered).not.toContain("Awaiting the applicant&#39;s response");
  });
});

describe("case detail template — the documents tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findCaseEmails).mockResolvedValue(CASE_EMAILS as never);
  });

  const DOCUMENT = { id: "doc-1", name: "Generated deed.pdf", documentType: { name: "Deed" }, direction: null, createdOn: null, hasFile: true };

  it("should open an attached document in the case's viewer, not the legacy file route, as the panel the viewer returns to", async () => {
    const rendered = await page([], { ...found, documents: [DOCUMENT] });

    const panel = panelFor(rendered, "documents");
    expect(panel).toContain('<a class="govuk-link" href="/deed-polls/case-1/documents/doc-1/view">Generated deed.pdf</a>');
    expect(rendered).not.toContain("/documents/doc-1/file");
  });

  it("should not link a document whose file has not arrived", async () => {
    const rendered = await page([], { ...found, documents: [{ ...DOCUMENT, hasFile: false }] });

    const panel = panelFor(rendered, "documents");
    expect(panel).toContain("Generated deed.pdf");
    expect(panel).not.toContain("/documents/doc-1/");
  });
});
