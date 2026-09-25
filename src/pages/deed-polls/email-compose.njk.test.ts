/**
 * The compose form's markup, rendered rather than asserted through the view model.
 *
 * What a model cannot show and this file pins: that the controls are named with api's `snake_case` placeholder
 * names *in the rendered HTML* — the personalisation key, the request-body key and the control name are one thing,
 * and a rename anywhere between here and the wire makes Notify substitute nothing and send the template with an
 * empty quotation in it, silently. Also that the error summary links to the control it is about, that an optional
 * slot says so, and that a caseworker's own text comes back escaped rather than as markup.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findCaseEmails, findDeedPoll } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET, POST } from "./[id]/emails/[template]/compose.js";
import { POST as PREVIEW } from "./[id]/emails/[template]/preview.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findCaseEmails: vi.fn()
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

const CASE_EMAILS = {
  availability: [
    {
      template: "application-rejected",
      applicable: true,
      reason: null,
      provisioned: true,
      slots: [
        { name: "judges_reason", required: true, maxLength: 4000 },
        { name: "additional_notes", required: false, maxLength: 1000 }
      ]
    }
  ],
  history: [],
  slotDefaults: [{ template: "application-rejected", fields: { judges_reason: "Identity not established." } }]
};

const html = (model: Record<string, unknown>): string => environment.render("deed-polls/email-compose.njk", { ...(model.en as object), ...model });

/** The form as it opens, or as it comes back from the check page with a body. */
async function page(posted?: Record<string, unknown>): Promise<string> {
  const res = pageResponse();
  const req = pageRequest({ params: { id: "case-1", template: "application-rejected" }, body: posted, accessToken: "session-token" });

  await (posted ? POST(req, res) : GET(req, res));

  return html(res.render.mock.calls[0][1]);
}

/** The form as the check step sends it back when the wording will not do. */
async function rejectedPage(posted: Record<string, unknown>): Promise<string> {
  const res = pageResponse();

  await PREVIEW(pageRequest({ params: { id: "case-1", template: "application-rejected" }, body: posted, accessToken: "session-token" }), res);

  return html(res.render.mock.calls[0][1]);
}

describe("email compose template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findCaseEmails).mockResolvedValue(CASE_EMAILS as never);
  });

  it("should render one control per slot api published, under api's own placeholder names", async () => {
    const rendered = await page();

    expect(rendered).toContain('name="judges_reason"');
    expect(rendered).toContain('id="judges_reason"');
    expect(rendered).toContain('name="additional_notes"');
    expect(rendered).not.toContain("judgesReason");
    expect(rendered).not.toContain("additionalNotes");
  });

  it("should open with the judge's own words already in the control", async () => {
    const rendered = await page();

    expect(rendered).toContain("Identity not established.");
    expect(rendered).toContain("The Master&#39;s reason for refusing the application");
  });

  it("should mark the optional slot as optional and leave the required one unmarked", async () => {
    const rendered = await page();

    expect(rendered).toContain("Additional notes for the applicant (optional)");
    expect(rendered).not.toContain("The Master&#39;s reason for refusing the application (optional)");
  });

  it("should count characters against api's cap rather than stopping input at it", async () => {
    // The cap is api's and is stated in the rejection; a browser that silently stops accepting characters gives no
    // reason for having done so — the call witness-form.njk and referral-form.njk both record.
    const rendered = await page();

    expect(rendered).toContain("govuk-character-count");
    expect(rendered).toContain("4000");
    expect(rendered).not.toMatch(/<textarea[^>]*maxlength=/);
  });

  it("should post to the check page, because sending is irreversible", async () => {
    const rendered = await page();

    expect(rendered).toContain('action="/deed-polls/case-1/emails/application-rejected/preview"');
    expect(rendered).toContain("Continue");
  });

  it("should carry no journey key when the form is opened from the tab, because none has been minted yet", async () => {
    // The check page mints it — see `preview.ts`. A control here with nothing in it would post an empty value that
    // api cannot parse as a UUID, so the control is rendered only when there is a journey to name.
    const rendered = await page();

    expect(rendered).not.toContain('name="idempotencyKey"');
  });

  it("should carry the journey key back out when the check page returned to this form", async () => {
    // api's notify-6 requires the key of the send, so a correction that lost it would either be refused by this
    // app on the next submit or become a second journey. Rendered from whatever the check page posted back.
    const rendered = await page({ idempotencyKey: "6f1b8c2e-9d4a-4f7b-8c1d-2e3f4a5b6c7d", judges_reason: "Shortened" });

    expect(rendered).toContain('<input type="hidden" name="idempotencyKey" value="6f1b8c2e-9d4a-4f7b-8c1d-2e3f4a5b6c7d">');
  });

  it("should link the error summary to the control the rejection is about", async () => {
    // Rendered through the check step, because that is what validates: a `POST` back to the form is the way back
    // from the preview and re-renders whatever was typed without judging it.
    const rendered = await rejectedPage({ judges_reason: "" });

    expect(rendered).toContain("There is a problem");
    expect(rendered).toContain('href="#judges_reason"');
    expect(rendered).toContain("Enter the Master&#39;s reason for refusing the application");
  });

  it("should render a caseworker's markup as text rather than as elements", async () => {
    const rendered = await page({ judges_reason: "<script>alert(1)</script>" });

    expect(rendered).not.toContain("<script>alert(1)</script>");
    expect(rendered).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("should offer a way out that abandons the email rather than sending it", async () => {
    const rendered = await page();

    expect(rendered).toContain('href="/deed-polls/case-1#emails"');
    expect(rendered).toContain("Cancel");
  });
});
