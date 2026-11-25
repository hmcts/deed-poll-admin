/**
 * The deletion confirmation's markup, rendered from the real handler's model (`[id]/delete.ts`). The model is pinned
 * in `delete.test.ts`; this file pins what only the markup shows: one warning-styled submit whose action is the
 * literal `delete`, Cancel as a link, each error summary link landing on its control, the signed journey as the one
 * hidden control, and applicant and submitted text escaped.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DeletionOutcomeUnknownError, findDeedPoll, findProcessSettings, requestDeletion } from "@hmcts/deed-poll";
import axe from "axe-core";
import { JSDOM } from "jsdom";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newDeletionJourney, sealDeletionJourney } from "../../application-deletion/journey.js";
import { pageRequest, pageResponse, withoutSignOutForm } from "../../express-doubles.js";
import { addPathFilters } from "../../path-filters.js";
import { GET, POST } from "./[id]/delete.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findProcessSettings: vi.fn(),
  requestDeletion: vi.fn()
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

const LAST_CHANGED_ON = "2026-11-20T10:15:30.123";
const CASE = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  type: "Adult",
  state: "Received",
  privacy: "Normal",
  newForename: "<script>alert(1)</script>",
  newSurname: "Lovelace",
  dateReceived: new Date("2026-03-01T00:00:00.000Z"),
  lastChangedOn: LAST_CHANGED_ON
};

const request = (body?: Record<string, unknown>) =>
  Object.assign(pageRequest({ params: { id: "case-1" }, body, accessToken: "t" }), { sessionID: "session-a" });

function html(model: Record<string, unknown>, locale: "en" | "cy" = "en"): string {
  return environment.render("deed-polls/application-delete.njk", { ...(model[locale] as object), ...model });
}

async function renderGet(locale: "en" | "cy" = "en") {
  const res = pageResponse();
  res.locals.locale = locale;
  await GET(request(), res);
  return html(res.render.mock.calls[0][1], locale);
}

async function renderPost(fields: Record<string, unknown>) {
  const res = pageResponse();
  const journey = await sealDeletionJourney(request(), newDeletionJourney("case-1", LAST_CHANGED_ON));
  await POST(request({ journey, ...fields }), res);
  return html(res.render.mock.calls[0][1]);
}

describe("application-delete.njk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(CASE as never);
    vi.mocked(findProcessSettings).mockResolvedValue({ deletionGraceDays: 14 } as never);
  });

  it("should offer one warning-styled submit for the literal delete action, and Cancel as a link back", async () => {
    const page = withoutSignOutForm(await renderGet());

    expect(page.match(/<button/g)).toHaveLength(1);
    expect(page).toMatch(/<button[^>]*name="action"[^>]*value="delete"|<button[^>]*value="delete"[^>]*name="action"/);
    expect(page).toContain("govuk-button--warning");
    expect(page).toContain("Permanently delete application");
    expect(page).toMatch(/<a class="govuk-link" href="\/deed-polls\/case-1">\s*Cancel\s*<\/a>/);
    expect(page).toContain('action="/deed-polls/case-1/delete"');
  });

  it("should draw both reasons unchecked, the note with its hint, and what deleting means", async () => {
    const page = await renderGet();

    expect(page).toContain('value="CREATED_IN_ERROR"');
    expect(page).toContain('value="DUPLICATE"');
    expect(page).not.toContain("checked");
    expect(page).toContain("Why are you deleting this application?");
    expect(page).toContain("Do not include the applicant’s personal details");
    expect(page).toContain("A Delivery Manager can restore it for 14 days after you delete it.");
    expect(page).toContain("cannot be recovered");
    expect(page).toContain("A record of who deleted it and why will be kept.");
    expect(page).toMatch(/<input type="hidden" name="journey" value="[\w-]+\.[a-f0-9]{64}">/);
  });

  it("should escape applicant data and submitted text", async () => {
    const page = await renderPost({ action: "delete", note: '"><script>alert(2)</script>' });

    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).not.toContain("<script>alert(2)</script>");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("should link every error in the summary to a control on the page", async () => {
    const page = await renderPost({ action: "delete", note: "" });
    const dom = new JSDOM(page);
    const targets = [...dom.window.document.querySelectorAll(".govuk-error-summary a")].map((link) => link.getAttribute("href"));

    expect(targets).toEqual(["#reason", "#note"]);
    for (const target of targets) expect(dom.window.document.querySelector(target as string), target as string).not.toBeNull();
    dom.window.close();
  });

  it("should offer only the check of the original request when the outcome is unknown", async () => {
    vi.mocked(requestDeletion).mockRejectedValue(new DeletionOutcomeUnknownError());
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const page = withoutSignOutForm(await renderPost({ action: "delete", reason: "DUPLICATE", note: "Entered twice by mistake" }));

    expect(page.match(/<button/g)).toHaveLength(1);
    expect(page).toContain('value="check"');
    expect(page).toContain("Check deletion request");
    expect(page).not.toContain('name="reason"');
    expect(page).not.toContain('name="note"');
  });

  it("should render the Welsh content when the locale is cy", async () => {
    const page = await renderGet("cy");

    expect(page).toContain("Permanently delete application");
  });

  describe("accessibility", { timeout: 30_000 }, () => {
    it("should have no axe violations on the form", async () => {
      expect(await axeViolations(await renderGet())).toEqual([]);
    });

    it("should have no axe violations with an error summary", async () => {
      expect(await axeViolations(await renderPost({ action: "delete", note: "short" }))).toEqual([]);
    });
  });
});

async function axeViolations(markup: string): Promise<{ id: string; nodes: string[] }[]> {
  const dom = new JSDOM(markup, { runScripts: "outside-only" });
  dom.window.eval(axe.source);
  const main = dom.window.document.getElementById("main-content");
  if (!main) throw new Error("no main-content");
  const results = await (dom.window as unknown as { axe: typeof axe }).axe.run(main, { rules: { "color-contrast": { enabled: false } } });
  dom.window.close();
  return results.violations.map((each) => ({ id: each.id, nodes: each.nodes.map((node) => node.html) }));
}
