/**
 * The check page's markup, rendered rather than asserted through the handler's model.
 *
 * **The whole of decision 3 lives in this file.** The preview is HTML from GOV.UK Notify carrying text a
 * caseworker typed, and it renders inside an `iframe` with `srcdoc` and `sandbox` — no `allow-scripts`, no
 * `allow-same-origin` — precisely so nothing in it can reach this page's DOM, cookies or session. A later
 * "simplification" to `| safe`, or a sandbox attribute dropped in a tidy-up, is a silent injection that no
 * view-model test could see, so the attributes are asserted here (see `docs/plans/notify-2-caseworker-email-tab.md`).
 *
 * The rest: that Send is withheld when there is nothing to check, that a refusal reads as one without losing the
 * caseworker's wording, and that the way back to the form is a `POST` carrying it.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConflictError, findCaseEmails, findDeedPoll, previewCaseEmail, sendCaseEmail } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { addPathFilters } from "../../path-filters.js";
import { POST as PREVIEW } from "./[id]/emails/[template]/preview.js";
import { POST as SEND } from "./[id]/emails/[template]/send.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findCaseEmails: vi.fn(),
  previewCaseEmail: vi.fn(),
  sendCaseEmail: vi.fn()
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

const RENDERED = {
  subject: "Application refused: KBDP2026-00001",
  html: '<html lang="en"><body><p>Dear applicant,</p><p>The Master has refused your application.</p></body></html>',
  templateVersion: 1
};

// The journey key the hidden control posts back — api's notify-6 made it a required header on the send.
const KEY = "6f1b8c2e-9d4a-4f7b-8c1d-2e3f4a5b6c7d";

const html = (model: Record<string, unknown>): string => environment.render("deed-polls/email-preview.njk", { ...(model.en as object), ...model });

/** The page as the check step renders it, with whatever Notify returned. */
async function previewPage(preview: Record<string, unknown> = RENDERED, posted: Record<string, unknown> = {}): Promise<string> {
  vi.mocked(previewCaseEmail).mockResolvedValue(preview as never);
  const res = pageResponse();

  await PREVIEW(
    pageRequest({
      params: { id: "case-1", template: "application-rejected" },
      body: { idempotencyKey: KEY, judges_reason: "Identity not established.", ...posted },
      accessToken: "session-token"
    }),
    res
  );

  return html(res.render.mock.calls[0][1]);
}

/** The same page as a refused send renders it. */
async function refusedPage(): Promise<string> {
  vi.mocked(sendCaseEmail).mockRejectedValue(new ConflictError("This case has no referral that a Master has refused"));
  const res = pageResponse();

  await SEND(
    pageRequest({
      params: { id: "case-1", template: "application-rejected" },
      body: { idempotencyKey: KEY, judges_reason: "Identity not established." },
      accessToken: "session-token"
    }),
    res
  );

  return html(res.render.mock.calls[0][1]);
}

describe("email preview template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findCaseEmails).mockResolvedValue(CASE_EMAILS as never);
  });

  it("should render Notify's HTML inside a sandboxed frame and never in the page", async () => {
    const rendered = await previewPage();

    expect(rendered).toMatch(/<iframe[^>]*\ssandbox=""/);
    expect(rendered).not.toContain("allow-scripts");
    expect(rendered).not.toContain("allow-same-origin");
    // Escaped into the attribute, which is what makes `srcdoc` safe to set from a variable: the browser unescapes
    // it inside the frame, and the page itself never parses it.
    expect(rendered).toContain("&lt;p&gt;Dear applicant,&lt;/p&gt;");
    expect(rendered).not.toContain("<p>Dear applicant,</p>");
  });

  it("should give the frame a title, so the sandbox costs no screen-reader user the email", async () => {
    const rendered = await previewPage();

    expect(rendered).toMatch(/<iframe[^>]*title="Preview of the email that will be sent to the applicant"/);
  });

  it("should offer Send with the warning that it cannot be recalled, above the checked wording", async () => {
    const rendered = await previewPage();

    expect(rendered).toContain("Send the email");
    expect(rendered).toContain("Once this email has been sent it cannot be recalled or edited.");
    expect(rendered).toContain('action="/deed-polls/case-1/emails/application-rejected/send"');
  });

  it("should carry the checked wording into the send", async () => {
    // What was approved is what the send posts: nothing may be rendered for approval and then sent different.
    const rendered = await previewPage(RENDERED, { additional_notes: "Ring us if anything is unclear" });

    expect(rendered).toContain('<input type="hidden" name="judges_reason" value="Identity not established.">');
    expect(rendered).toContain('<input type="hidden" name="additional_notes" value="Ring us if anything is unclear">');
  });

  it("should carry the journey's idempotency key in both forms, because either may come back here", async () => {
    // api's notify-6 requires the header of the send, so the Send form must carry it — and the way back to the
    // wording must too, or a correction would return to a check page that minted a second key and a resubmit
    // would be a second email rather than the same one arriving again.
    const rendered = await previewPage();

    expect(rendered.match(/name="idempotencyKey" value="[0-9a-f-]{36}"/g)).toHaveLength(2);
  });

  it("should offer the way back to the wording as a POST, so a correction keeps what was typed", async () => {
    const rendered = await previewPage();

    expect(rendered).toContain('action="/deed-polls/case-1/emails/application-rejected/compose"');
    expect(rendered).toContain("Change the wording");
  });

  it.each([
    ["null", null],
    ["empty", ""]
  ])("should withhold Send and explain itself when the HTML is %s", async (_description, value) => {
    // api answers an absent rendering as an empty string rather than null, so both are this state — and a Send
    // offered beside an empty frame is the one outcome decision 3 exists to prevent.
    const rendered = await previewPage({ ...RENDERED, html: value });

    expect(rendered).not.toContain("<iframe");
    expect(rendered).not.toContain("Send the email");
    expect(rendered).toContain("GOV.UK Notify did not return a preview of this email");
    // The way back is still there, so the wording is not lost with the preview.
    expect(rendered).toContain("Change the wording");
  });

  it("should render a refused send as an error summary rather than an error page", async () => {
    const rendered = await refusedPage();

    expect(rendered).toContain("There is a problem");
    expect(rendered).toContain("This email cannot be sent for this case. This case has no referral that a Master has refused");
    expect(rendered).not.toContain("Send the email");
    expect(rendered).not.toContain("<iframe");
    expect(rendered).toContain('<input type="hidden" name="judges_reason" value="Identity not established.">');
  });

  it("should show the subject Notify resolved and the template the email is", async () => {
    const rendered = await previewPage();

    expect(rendered).toContain("Application refused: KBDP2026-00001");
    expect(rendered).toContain("KBDP2026-00001");
  });

  it("should link back to the case's emails tab", async () => {
    const rendered = await previewPage();

    expect(rendered).toContain('href="/deed-polls/case-1#emails"');
  });
});
