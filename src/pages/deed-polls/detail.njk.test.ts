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

const html = (model: Record<string, unknown>): string => environment.render("deed-polls/detail.njk", { ...model, ...(model.en as object) });

async function page(referrals: Record<string, unknown>[]): Promise<string> {
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
    expect(panel).toContain("Send an email: Application refused");
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

  it("should still say what happened when there is no email to link to", async () => {
    const rendered = await sentPage({ email: "sent", emailId: "email-nope" });

    expect(rendered).toContain("accepted by GOV.UK Notify");
    expect(rendered).not.toContain('href="/deed-polls/case-1/emails/email-nope"');
  });

  it("should render no banner on an ordinary visit", async () => {
    const rendered = await sentPage({});

    expect(rendered).not.toContain("govuk-notification-banner--success");
  });
});
