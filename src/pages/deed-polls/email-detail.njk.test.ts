/**
 * The per-email page's markup, rendered rather than asserted through the view model.
 *
 * The model is asserted in `[id]/emails/[notificationId].test.ts` and in `emails-view.test.ts`. What this file
 * exists for is what a model cannot show, and the first of them is the whole reason this page does not reuse the
 * preview's iframe: **that the body renders through autoescaping**, so markup in it is visible text and not an
 * element. api's `body` is a plain-text rendering of the template carrying words a caseworker typed (decision 12
 * of `docs/plans/notify-2-caseworker-email-tab.md`), and a later `| safe` here would ship an injection that no
 * view-model test could see.
 *
 * The rest: that an email with no wording renders its own sentence rather than an empty panel, that the page
 * never uses a word implying the applicant received anything, and that no attachments reads as "None".
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findCaseEmails, findDeedPoll } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./[id]/emails/[notificationId].js";

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

const SENT = {
  id: "email-1",
  template: "application-rejected",
  templateName: "Application refused",
  subject: "Your application has been refused",
  body: "Dear applicant,\n\nThe Master has refused your application.\n\n* One reason\n* Another",
  recipient: "applicant@example.com",
  notifyState: "Sent" as const,
  failureReason: null,
  createdBy: "caseworker@example.com",
  createdOn: new Date("2026-03-18T11:05:00Z"),
  documents: []
};

const html = (model: Record<string, unknown>): string => environment.render("deed-polls/email-detail.njk", { ...(model.en as object), ...model });

async function page(email: Record<string, unknown> = SENT): Promise<string> {
  vi.mocked(findCaseEmails).mockResolvedValue({ availability: [], history: [email], slotDefaults: [] } as never);
  const res = pageResponse();

  await GET(pageRequest({ params: { id: "case-1", notificationId: "email-1" }, accessToken: "session-token" }), res);

  return html(res.render.mock.calls[0][1]);
}

describe("email view template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
  });

  it("should show the email's metadata and the wording it carried, against the case's reference", async () => {
    const rendered = await page();

    expect(rendered).toContain("KBDP2026-00001");
    expect(rendered).toContain("Your application has been refused");
    expect(rendered).toContain("applicant@example.com");
    expect(rendered).toContain("The Master has refused your application.");
    expect(rendered).toContain("caseworker@example.com, 18 March 2026 at 11:05am");
  });

  it("should render markup in the body as visible text and not as an element", async () => {
    // Decision 12, and the whole reason this page does not reuse the preview's srcdoc iframe: the body is text
    // that has been through two services and a human. A `| safe` here would make this pass as an element.
    const rendered = await page({ ...SENT, body: "<script>alert(1)</script>\n<b>bold</b> & so on" });

    expect(rendered).not.toContain("<script>alert(1)</script>");
    expect(rendered).not.toContain("<b>bold</b>");
    expect(rendered).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; so on");
  });

  it("should preserve the body's line breaks in CSS rather than by building markup from it", async () => {
    // pre-wrap, because turning newlines into <p> or <li> means constructing HTML from caseworker free text.
    const rendered = await page();

    expect(rendered).toContain("app-email-body");
    expect(rendered).toContain("* One reason\n* Another");
  });

  it("should say this is the wording rather than a copy of what the applicant saw", async () => {
    const rendered = await page();

    expect(rendered).toContain("The wording that was sent");
    expect(rendered).toContain("branded by GOV.UK Notify");
  });

  it.each([
    ["Pending", "This email has not been sent yet, so there is no wording to show."],
    ["Failed", "This email was not sent, so there is no wording to show."],
    ["Sent", "This email was sent before the service began keeping the wording"]
  ] as const)("should explain the absent wording of a %s email instead of rendering an empty panel", async (notifyState, sentence) => {
    const rendered = await page({ ...SENT, notifyState, body: null });

    expect(rendered).toContain(sentence);
    expect(rendered).not.toContain("app-email-body");
  });

  it("should show api's failure reason on a failed email, and no such row on one that did not fail", async () => {
    const rendered = await page({ ...SENT, notifyState: "Failed", body: null, failureReason: "GOV.UK Notify rejected the recipient address" });

    expect(rendered).toContain("Why it failed");
    expect(rendered).toContain("GOV.UK Notify rejected the recipient address");
    expect(await page()).not.toContain("Why it failed");
  });

  it("should tag the state so the outbox is scannable, with the state printed and not only coloured", async () => {
    const rendered = await page();

    expect(rendered).toMatch(/govuk-tag[^"]*govuk-tag--green/);
    expect(rendered).toContain("Accepted by Notify");
  });

  it("should never use a word a caseworker could read as proof the applicant got the email", async () => {
    // Decision 10, and it is a test rather than a preference: there are no delivery callbacks in this estate and
    // no download concept in the Notify client, so none of these is a fact this service holds. The page says what
    // "Accepted by Notify" does and does not mean, because the negative alone would pass on a page saying nothing.
    const rendered = await page();

    expect(rendered).not.toMatch(/delivered|viewed|opened|downloaded/i);
    expect(rendered).toContain("It is not confirmation that the applicant received or read it.");
  });

  it("should say no documents were attached rather than leaving the cell empty", async () => {
    const rendered = await page();

    expect(rendered).toContain("Documents attached");
    expect(rendered).toContain("None");
  });

  it("should list the documents an email carried, so notify-4's attachments need no change here", async () => {
    const rendered = await page({ ...SENT, documents: [{ id: "doc-1", name: "Deed poll.pdf" }] });

    expect(rendered).toContain("Deed poll.pdf");
  });

  it("should link back to the case's emails tab", async () => {
    const rendered = await page();

    expect(rendered).toContain('href="/deed-polls/case-1#emails"');
  });
});
