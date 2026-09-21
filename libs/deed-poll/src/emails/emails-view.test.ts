import { type CaseEmails, NOTIFY_STATE } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import {
  buildComposeView,
  buildEmailDetail,
  buildEmailsView,
  emailTemplateLabel,
  NOTIFY_STATE_LABEL,
  NOTIFY_STATE_TAG,
  unavailableEmailsView
} from "./emails-view.js";

const TEMPLATE = "application-rejected";

const SLOTS = [
  { name: "judges_reason", required: true, maxLength: 4000 },
  { name: "additional_notes", required: false, maxLength: 1000 }
];

const SENT = {
  id: "email-1",
  template: TEMPLATE,
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

const FAILED = {
  ...SENT,
  id: "email-2",
  subject: null,
  body: null,
  notifyState: "Failed" as const,
  failureReason: "GOV.UK Notify rejected the recipient address (PERMANENT, status 400)",
  createdOn: new Date("2026-02-27T14:20:00Z")
};

const emails = (overrides: Partial<CaseEmails> = {}): CaseEmails => ({
  availability: [{ template: TEMPLATE, applicable: true, reason: null, provisioned: true, slots: SLOTS }],
  history: [],
  slotDefaults: [{ template: TEMPLATE, fields: { judges_reason: "The evidence does not establish identity." } }],
  ...overrides
});

describe("emails/emails-view", () => {
  describe("the state labels", () => {
    it("should label and colour every state api publishes, so no member renders blank", () => {
      for (const state of NOTIFY_STATE) {
        expect(NOTIFY_STATE_LABEL[state]).toBeTruthy();
        expect(NOTIFY_STATE_TAG[state]).toBeTruthy();
      }
    });

    it("should never imply the applicant received, opened or downloaded anything", () => {
      // Decision 10, and it is a test rather than a preference: api knows only that Notify accepted the send,
      // and a caseworker who read "Delivered" here would conclude an applicant has their deed poll when the
      // email may have bounced. The tab's own test asserts the same of the rendered page.
      for (const label of Object.values(NOTIFY_STATE_LABEL)) {
        expect(label).not.toMatch(/delivered|viewed|opened|downloaded|received|read/i);
      }
    });
  });

  describe("buildEmailsView", () => {
    it("should render one row per email in api's order, every cell a display string", () => {
      const view = buildEmailsView(emails({ history: [SENT, FAILED] }));

      expect(view.count).toBe(2);
      expect(view.unavailable).toBe(false);
      expect(view.rows).toEqual([
        {
          id: "email-1",
          template: "Application refused",
          state: "Accepted by Notify",
          stateTagClasses: "govuk-tag--green",
          sentOn: "18 March 2026 at 11:05am",
          sentBy: "caseworker@example.com"
        },
        {
          id: "email-2",
          template: "Application refused",
          state: "Failed",
          stateTagClasses: "govuk-tag--red",
          sentOn: "27 February 2026 at 2:20pm",
          sentBy: "caseworker@example.com"
        }
      ]);
    });

    it("should carry no email content on a row, because a body belongs on a page of its own", () => {
      const view = buildEmailsView(emails({ history: [SENT] }));

      expect(view.rows[0]).not.toHaveProperty("body");
      expect(view.rows[0]).not.toHaveProperty("subject");
    });

    it("should fall back to the local wording for a row api sent no templateName for", () => {
      const view = buildEmailsView(emails({ history: [{ ...SENT, templateName: null }] }));

      expect(view.rows[0]?.template).toBe("Application rejected");
    });

    it("should humanise a template key this repo has no wording for, rather than dropping the row's label", () => {
      // `template` is a bare string with no member list, so a template notify-6 adds arrives with nothing failing.
      const view = buildEmailsView(emails({ history: [{ ...SENT, templateName: null, template: "chase-missing-documents" }] }));

      expect(view.rows[0]?.template).toBe("Chase missing documents");
    });

    it("should say the state was not recorded rather than inventing one of three that mean different things", () => {
      const view = buildEmailsView(emails({ history: [{ ...SENT, notifyState: null }] }));

      expect(view.rows[0]?.state).toBe("Not recorded");
      expect(view.rows[0]?.stateTagClasses).toBe("govuk-tag--grey");
    });

    it("should offer the template api says is applicable and provisioned", () => {
      const view = buildEmailsView(emails());

      expect(view.sendable).toEqual([{ template: TEMPLATE, name: "Application rejected" }]);
      expect(view.unsendable).toEqual([]);
    });

    it("should offer every applicable template, so one added at api's end needs no change here", () => {
      // The design intent of decision 2: the template is a route parameter and the tab renders what api says is
      // sendable, so a second applicable template appears with no code change — and is the trigger to build the
      // picker that a list of one did not justify.
      const view = buildEmailsView(
        emails({
          availability: [
            { template: TEMPLATE, applicable: true, reason: null, provisioned: true, slots: SLOTS },
            { template: "chase-missing-documents", applicable: true, reason: null, provisioned: true, slots: SLOTS }
          ]
        })
      );

      expect(view.sendable).toEqual([
        { template: TEMPLATE, name: "Application rejected" },
        { template: "chase-missing-documents", name: "Chase missing documents" }
      ]);
    });

    it("should withhold a template api says does not apply, carrying api's own sentence as the reason", () => {
      const reason = "This case has no referral that a Master has refused, so there is no refusal to tell the applicant about";
      const view = buildEmailsView(emails({ availability: [{ template: TEMPLATE, applicable: false, reason, provisioned: true, slots: SLOTS }] }));

      expect(view.sendable).toEqual([]);
      expect(view.unsendable).toEqual([{ template: TEMPLATE, name: "Application rejected", reason }]);
    });

    it("should not blame provisioning for a row that is provisioned but has no template key", () => {
      // `sendableTemplates` needs three things — applicable, provisioned, and a usable key — so an applicable and
      // provisioned row with a null `template` lands in `unsendable` while provisioning is not what is wrong with
      // it. Branching the reason on `applicable` alone stated the Notify sentence about a provisioned template: a
      // claim that is false, and one the caseworker reading it has no way to check.
      const view = buildEmailsView(emails({ availability: [{ template: null, applicable: true, reason: null, provisioned: true, slots: SLOTS }] }));

      expect(view.sendable).toEqual([]);
      expect(view.unsendable).toHaveLength(1);
      expect(view.unsendable[0]?.reason).not.toContain("GOV.UK Notify");
      expect(view.unsendable[0]?.reason).toBe("This email cannot be sent for this case at the moment");
    });

    it("should withhold an applicable template this environment has not provisioned, and say so", () => {
      // Offering the button without `provisioned` sends the caseworker to a preview that answers api's 502 — an
      // `unavailable` and therefore the 500 page — for a reason the tab already knew.
      const view = buildEmailsView(emails({ availability: [{ template: TEMPLATE, applicable: true, reason: null, provisioned: false, slots: SLOTS }] }));

      expect(view.sendable).toEqual([]);
      expect(view.unsendable[0]?.reason).toBe("This email cannot be sent in this environment yet, because its template has not been set up in GOV.UK Notify");
    });

    it("should still explain a template api refused with no reason, rather than leaving the cell empty", () => {
      const view = buildEmailsView(emails({ availability: [{ template: TEMPLATE, applicable: false, reason: null, provisioned: true, slots: SLOTS }] }));

      expect(view.unsendable[0]?.reason).toBe("This email cannot be sent for this case at the moment");
    });

    it("should account for every template api published in one list or the other", () => {
      // A template in neither is one the tab neither offers nor explains, which a caseworker cannot tell from a bug.
      const payload = emails({
        availability: [
          { template: TEMPLATE, applicable: true, reason: null, provisioned: true, slots: SLOTS },
          { template: "chase-missing-documents", applicable: false, reason: "Nothing is outstanding", provisioned: true, slots: [] }
        ]
      });

      const view = buildEmailsView(payload);

      expect(view.sendable.length + view.unsendable.length).toBe(payload.availability.length);
    });

    it("should render an empty history as an empty table rather than as a failure", () => {
      const view = buildEmailsView(emails());

      expect(view.rows).toEqual([]);
      expect(view.count).toBe(0);
      expect(view.unavailable).toBe(false);
    });
  });

  describe("unavailableEmailsView", () => {
    it("should be distinguishable from a case that has never been written to", () => {
      // The two say opposite things: "nothing has been sent" is a fact, "we could not find out" is the absence
      // of one — and the second rendered as the first misinforms a caseworker on a page that looks normal.
      const unavailable = unavailableEmailsView();

      expect(unavailable.unavailable).toBe(true);
      expect(buildEmailsView(emails()).unavailable).toBe(false);
    });

    it("should offer nothing, because the compose page reads the endpoint that just failed", () => {
      expect(unavailableEmailsView()).toEqual({ rows: [], count: 0, unavailable: true, sendable: [], unsendable: [] });
    });
  });

  describe("buildComposeView", () => {
    it("should build one control per slot in api's order, pre-populated from api's defaults", () => {
      const view = buildComposeView(emails(), TEMPLATE);

      expect(view).toEqual({
        template: TEMPLATE,
        name: "Application rejected",
        fields: [
          {
            name: "judges_reason",
            label: "The Master's reason for refusing the application",
            maxLength: 4000,
            required: true,
            value: "The evidence does not establish identity."
          },
          { name: "additional_notes", label: "Additional notes for the applicant", maxLength: 1000, required: false, value: "" }
        ]
      });
    });

    it("should keep api's snake_case placeholder names as the control names", () => {
      // The control's name is the body's key and the field api's own 400 addresses its errors to, so a
      // camelCase version here breaks the personalisation, the round trip and the error summary at once.
      const view = buildComposeView(emails(), TEMPLATE);

      expect(view?.fields.map((field) => field.name)).toEqual(["judges_reason", "additional_notes"]);
    });

    it("should give a caseworker their own text back after a failed attempt, unaltered", () => {
      // Somebody just told to shorten their text must get their words back to shorten, not the pre-populated
      // ones they replaced — and untrimmed, so the cursor lands where they left it.
      const view = buildComposeView(emails(), TEMPLATE, { judges_reason: "  My own words  " });

      expect(view?.fields[0]?.value).toBe("  My own words  ");
    });

    it("should fall back to api's default for a slot the caseworker's attempt did not carry", () => {
      const view = buildComposeView(emails(), TEMPLATE, { additional_notes: "Ring us" });

      expect(view?.fields[0]?.value).toBe("The evidence does not establish identity.");
      expect(view?.fields[1]?.value).toBe("Ring us");
    });

    it("should render an empty control for a slot api resolved no default for", () => {
      const view = buildComposeView(emails({ slotDefaults: [] }), TEMPLATE);

      expect(view?.fields.map((field) => field.value)).toEqual(["", ""]);
    });

    it("should ignore a submitted value that is not text, so a tampered post renders rather than crashing", () => {
      const view = buildComposeView(emails(), TEMPLATE, { judges_reason: ["one", "two"] });

      expect(view?.fields[0]?.value).toBe("The evidence does not establish identity.");
    });

    it("should be null for a template api does not publish, so the page answers 404", () => {
      expect(buildComposeView(emails(), "made-up")).toBeNull();
    });

    it("should be null for a template api says does not apply to this case", () => {
      const payload = emails({ availability: [{ template: TEMPLATE, applicable: false, reason: "No refusal", provisioned: true, slots: SLOTS }] });

      expect(buildComposeView(payload, TEMPLATE)).toBeNull();
    });

    it("should be null for an applicable template this environment has not provisioned", () => {
      const payload = emails({ availability: [{ template: TEMPLATE, applicable: true, reason: null, provisioned: false, slots: SLOTS }] });

      expect(buildComposeView(payload, TEMPLATE)).toBeNull();
    });

    it("should drop a slot api published with no name, because there is nothing to send it under", () => {
      const payload = emails({
        availability: [
          { template: TEMPLATE, applicable: true, reason: null, provisioned: true, slots: [{ name: null, required: false, maxLength: 10 }, ...SLOTS] }
        ]
      });

      expect(buildComposeView(payload, TEMPLATE)?.fields.map((field) => field.name)).toEqual(["judges_reason", "additional_notes"]);
    });

    it("should label a slot this repo has never seen from its placeholder name", () => {
      const payload = emails({
        availability: [
          {
            template: "chase-missing-documents",
            applicable: true,
            reason: null,
            provisioned: true,
            slots: [{ name: "days_outstanding", required: true, maxLength: 3 }]
          }
        ]
      });

      expect(buildComposeView(payload, "chase-missing-documents")).toEqual({
        template: "chase-missing-documents",
        name: "Chase missing documents",
        fields: [{ name: "days_outstanding", label: "Days outstanding", maxLength: 3, required: true, value: "" }]
      });
    });
  });

  describe("buildEmailDetail", () => {
    it("should render one email's content and its fate, every field a display string", () => {
      const detail = buildEmailDetail(emails({ history: [SENT] }), "email-1");

      expect(detail).toEqual({
        id: "email-1",
        template: "Application refused",
        subject: "Your application has been refused",
        recipient: "applicant@example.com",
        state: "Accepted by Notify",
        stateTagClasses: "govuk-tag--green",
        sentOn: "18 March 2026 at 11:05am",
        sentBy: "caseworker@example.com",
        failureReason: null,
        body: "Dear applicant,\n\nThe Master has refused your application.",
        missingBody: null,
        documents: []
      });
    });

    it("should keep the body's own line breaks, because the text layout is the email's layout", () => {
      const detail = buildEmailDetail(emails({ history: [{ ...SENT, body: "One\n\n* two\n* three" }] }), "email-1");

      expect(detail?.body).toBe("One\n\n* two\n* three");
    });

    it("should be null for an id this case's history does not carry, so the page answers 404", () => {
      // api scopes the payload to the case, so another case's email is simply absent from it — there is no
      // filter here and no second read to check ownership with.
      expect(buildEmailDetail(emails({ history: [SENT] }), "email-9")).toBeNull();
    });

    it("should be null when the case has had no emails at all", () => {
      expect(buildEmailDetail(emails(), "email-1")).toBeNull();
    });

    it("should carry api's failure prose on a failed email, because it is what makes the row actionable", () => {
      const detail = buildEmailDetail(emails({ history: [FAILED] }), "email-2");

      expect(detail?.failureReason).toBe("GOV.UK Notify rejected the recipient address (PERMANENT, status 400)");
      expect(detail?.state).toBe("Failed");
    });

    it("should treat a failure reason of only whitespace as absent rather than rendering an empty row", () => {
      const detail = buildEmailDetail(emails({ history: [{ ...FAILED, failureReason: "   " }] }), "email-2");

      expect(detail?.failureReason).toBeNull();
    });

    it.each([
      ["Pending", "This email has not been sent yet, so there is no wording to show."],
      ["Failed", "This email was not sent, so there is no wording to show."],
      ["Sent", "This email was sent before the service began keeping the wording, so no copy of it was stored here and none can be recovered."]
    ] as const)("should explain an absent body in its own words when the email is %s", (notifyState, sentence) => {
      // Decision 15: three states produce no body and they are not the same thing. "Sent before we started
      // keeping the text" is a different reassurance from "this has not gone yet", and a blank panel is neither.
      const detail = buildEmailDetail(emails({ history: [{ ...SENT, notifyState, body: null }] }), "email-1");

      expect(detail?.body).toBeNull();
      expect(detail?.missingBody).toBe(sentence);
    });

    it("should not borrow one of the three sentences for an email whose state api did not record", () => {
      // Each of them asserts a history this row does not have, and the state cell already says it is unknown.
      const detail = buildEmailDetail(emails({ history: [{ ...SENT, notifyState: null, body: null }] }), "email-1");

      expect(detail?.missingBody).toBe("No wording was recorded for this email.");
      expect(detail?.state).toBe("Not recorded");
    });

    it("should treat a body of only whitespace as absent, because a blank panel reads as a fault", () => {
      const detail = buildEmailDetail(emails({ history: [{ ...SENT, body: "  \n  " }] }), "email-1");

      expect(detail?.body).toBeNull();
      expect(detail?.missingBody).toBeTruthy();
    });

    it("should set exactly one of body and missingBody, whatever api published", () => {
      // They are alternatives: both set would render the wording and an explanation of its absence together, and
      // neither set would render nothing at all — which is the blank panel decision 15 exists to prevent.
      const history = [
        SENT,
        FAILED,
        { ...SENT, body: null, notifyState: "Pending" as const },
        { ...SENT, body: "", notifyState: null },
        { ...SENT, body: "   " }
      ].map((email, index) => ({ ...email, id: `email-${index}` }));

      for (const email of history) {
        const detail = buildEmailDetail(emails({ history }), email.id);

        expect(detail?.body === null).not.toBe(detail?.missingBody === null);
      }
    });

    it("should say what was not recorded rather than leaving a cell empty", () => {
      const detail = buildEmailDetail(emails({ history: [{ ...SENT, subject: null, recipient: null, createdBy: null, createdOn: null }] }), "email-1");

      expect(detail?.subject).toBe("Not recorded");
      expect(detail?.recipient).toBe("Not recorded");
      expect(detail?.sentBy).toBe("Not recorded");
      expect(detail?.sentOn).toBe("Not recorded");
    });

    it("should list the documents the email carried", () => {
      const documents = [
        { id: "doc-1", name: "Deed poll.pdf" },
        { id: "doc-2", name: "Covering letter.pdf" }
      ];
      const detail = buildEmailDetail(emails({ history: [{ ...SENT, documents }] }), "email-1");

      expect(detail?.documents).toEqual(documents);
    });

    it("should name an attachment api published no name for, rather than dropping it from the list", () => {
      // A document the applicant received and this page does not list is the one omission a caseworker cannot see.
      const detail = buildEmailDetail(emails({ history: [{ ...SENT, documents: [{ id: "doc-1", name: null }] }] }), "email-1");

      expect(detail?.documents).toEqual([{ id: "doc-1", name: "Unnamed document" }]);
    });

    it("should read its row out of the same payload the tab rendered, not a shape of its own", () => {
      // Decision 14: api answers the tab, the compose form and this page from one response, so a row on the tab
      // and the page behind it can never disagree about which emails a case has had.
      const payload = emails({ history: [SENT, FAILED] });

      for (const row of buildEmailsView(payload).rows) {
        expect(buildEmailDetail(payload, row.id)?.template).toBe(row.template);
      }
    });

    it("should never imply the applicant received, opened or downloaded anything", () => {
      const detail = buildEmailDetail(emails({ history: [SENT] }), "email-1");

      expect(detail?.state).not.toMatch(/delivered|viewed|opened|downloaded|received|read/i);
    });
  });

  describe("emailTemplateLabel", () => {
    it("should give the business's wording for the template api ships", () => {
      expect(emailTemplateLabel(TEMPLATE)).toBe("Application rejected");
    });

    it("should humanise an unrecognised key rather than hiding the row behind a placeholder", () => {
      expect(emailTemplateLabel("chase-missing-documents")).toBe("Chase missing documents");
    });

    it("should say the template was not recorded when api published none", () => {
      expect(emailTemplateLabel(null)).toBe("Not recorded");
      expect(emailTemplateLabel("")).toBe("Not recorded");
    });

    it("should not resolve an inherited member name to a function off Object.prototype", () => {
      expect(emailTemplateLabel("constructor")).toBe("Constructor");
    });
  });
});
