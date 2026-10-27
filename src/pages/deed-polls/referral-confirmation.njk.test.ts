/**
 * The record-the-response form's markup, rendered rather than asserted through the model.
 *
 * The model is asserted in `[id]/referrals/[referralId]/confirmation.test.ts`. What this file exists for is what a
 * model cannot show: that the two answers are radios under one legend and neither is pre-selected, that the note
 * is optional and labelled so, that the warning about the answer being unreplaceable is above the submit rather
 * than after it, that the error summary precedes the `h1` and links to the control it names, and that the only
 * thing on the page which can change anything is the one submit.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDeedPoll, findReferral } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { addPathFilters } from "../../path-filters.js";
import { GET, POST } from "./[id]/referrals/[referralId]/confirmation.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findReferral: vi.fn()
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

const AWAITING = {
  id: "ref-1",
  state: "Decided",
  reasons: ["Minor"],
  notes: "The applicant turns 16 next month.",
  urgency: "Normal",
  urgencyReason: null,
  migrated: false,
  claimedBy: "A Judge",
  claimedAt: new Date("2026-05-14T09:00:00Z"),
  decision: "Approved",
  directionsText: null,
  publishToGazette: true,
  decisionDate: new Date("2026-05-15T10:30:00Z"),
  decidedBy: "A Judge",
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  createdOn: new Date("2026-05-13T08:44:00Z"),
  modifiedOn: new Date("2026-05-15T10:30:00Z"),
  confirmationRequestedAt: new Date("2026-05-20T08:00:00Z"),
  confirmationOutcome: null,
  confirmationReceivedAt: null,
  confirmationRecordedBy: null
};

/** The content pair first and the handler's own values over it — `renderInterceptorMiddleware`'s order. */
const html = (model: Record<string, unknown>): string => environment.render("deed-polls/referral-confirmation.njk", { ...(model.en as object), ...model });

async function form(): Promise<string> {
  const res = pageResponse();

  await GET(pageRequest({ params: { id: "case-1", referralId: "ref-1" }, accessToken: "session-token" }), res);

  return html(res.render.mock.calls[0][1]);
}

async function submitted(body: Record<string, unknown>): Promise<string> {
  const res = pageResponse();

  await POST(pageRequest({ params: { id: "case-1", referralId: "ref-1" }, body, accessToken: "session-token" }), res);

  return html(res.render.mock.calls[0][1]);
}

describe("record the applicant's response template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findReferral).mockResolvedValue(AWAITING as never);
  });

  it("should ask one question with the two published answers as radios, neither pre-selected", async () => {
    const rendered = await form();

    expect(rendered).toContain("What did the applicant say about proceeding?");
    expect(rendered).toContain('name="outcome"');
    expect(rendered).toContain('value="Confirmed"');
    expect(rendered).toContain("The applicant wants to proceed");
    expect(rendered).toContain('value="Withdrawn"');
    expect(rendered).toContain("The applicant does not want to proceed");
    expect(rendered).not.toContain("checked");
  });

  it("should caption the page with the reference and say which request is being answered", async () => {
    const rendered = await form();

    expect(rendered).toContain("KBDP2026-00001");
    expect(rendered).toContain("Confirmation requested");
    expect(rendered).toContain("20 May 2026 at 9:00am");
  });

  it("should label the note optional and cap it with a character count rather than a silent maxlength", async () => {
    const rendered = await form();

    expect(rendered).toContain("Note (optional)");
    expect(rendered).toContain("govuk-character-count");
    expect(rendered).toContain("You can enter up to 1000 characters");
  });

  it("should warn that the response cannot be changed, above the submit that records it", async () => {
    const rendered = await form();

    expect(rendered).toContain("You cannot change or replace this response in this service once it is recorded.");
    expect(rendered.indexOf("govuk-warning-text")).toBeLessThan(rendered.indexOf("Record response"));
  });

  it("should post the form to the confirmation route and offer cancel as a link, which acts on nothing", async () => {
    const rendered = await form();

    expect(rendered).toContain('action="/deed-polls/case-1/referrals/ref-1/confirmation"');
    expect(rendered).toContain('method="post"');
    expect(rendered).toContain('href="/deed-polls/case-1/referrals/ref-1"');
    expect(rendered).toContain("Record response");
  });

  it("should show the error summary before the heading and link it to the radios", async () => {
    const rendered = await submitted({ note: "Replied by post." });

    expect(rendered).toContain("govuk-error-summary");
    expect(rendered.indexOf("govuk-error-summary")).toBeLessThan(rendered.indexOf("<h1"));
    expect(rendered).toContain('href="#outcome"');
    expect(rendered).toContain("Select what the applicant said about proceeding");
  });

  it("should keep the ticked answer and the typed note when it re-renders with an error", async () => {
    const rendered = await submitted({ outcome: "Withdrawn", note: "y".repeat(1001) });

    expect(rendered).toContain("The note must be 1000 characters or fewer");
    expect(rendered).toMatch(/value="Withdrawn"[^>]*checked/);
    expect(rendered).toContain("y".repeat(1001));
  });
});
