import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConflictError,
  findGazetteSettings,
  findProcessSettings,
  InvalidInputError,
  MANAGE_PROCESS_CONFIG,
  saveGazetteSettings,
  saveProcessSettings
} from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { POST as postGazette } from "./gazette-recipient.js";
import { GET, POST as postProcess } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findGazetteSettings: vi.fn(),
  findProcessSettings: vi.fn(),
  saveGazetteSettings: vi.fn(),
  saveProcessSettings: vi.fn()
}));

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
const PROCESS = { referralClaimExpiryMinutes: 90, revision: 4, updatedBy: "<Dee>", updatedAt: new Date("2026-10-20T09:30:00Z") };
const GAZETTE = { recipientEmail: "lg@example.com", revision: 2, updatedBy: "<Admin>", updatedAt: new Date("2026-10-08T10:00:00Z") };
const PROCESS_ONLY = { staff: true, judicial: false, capabilities: [MANAGE_PROCESS_CONFIG] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findProcessSettings).mockResolvedValue(PROCESS);
  vi.mocked(findGazetteSettings).mockResolvedValue(GAZETTE);
  vi.mocked(saveProcessSettings).mockResolvedValue(PROCESS);
  vi.mocked(saveGazetteSettings).mockResolvedValue(GAZETTE);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

type Handler = typeof GET;

async function render(
  handler: Handler,
  { body, locale = "en", query = {}, access }: { body?: unknown; locale?: string; query?: Record<string, unknown>; access?: unknown } = {}
) {
  const res = pageResponse();
  res.locals.locale = locale;
  const req = pageRequest({ deliveryManager: true, accessToken: "dm-token", body, query, access });
  await handler(req, res);
  const model = res.render.mock.calls[0]?.[1];
  return { res, model, markup: environment.render("deed-polls/settings/index.njk", { ...model[locale], ...model }) };
}

function form(markup: string, action: string): string {
  const start = markup.indexOf(`action="${action}"`);
  return start === -1 ? "" : markup.slice(start, markup.indexOf("</form>", start));
}

function expectSummaryLinksResolve(markup: string) {
  const summary = markup.slice(markup.indexOf("govuk-error-summary"), markup.indexOf("</ul>", markup.indexOf("govuk-error-summary")));
  const targets = [...summary.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) expect(markup).toContain(`id="${target}"`);
}

describe("service settings page", () => {
  it("should say to save each section before changing another", async () => {
    const { markup } = await render(GET);

    expect(markup).toContain("Save each section before you change another.");
  });

  it("should show the claim window in hours and minutes with the warning before its Save and escaped attribution", async () => {
    const { markup } = await render(GET);

    const process = form(markup, "/deed-polls/settings");
    expect(process).toContain('id="claim-window"');
    expect(process).toMatch(/id="claimWindowHours"[^>]*value="1"/);
    expect(process).toMatch(/id="claimWindowMinutes"[^>]*value="30"/);
    expect(process).toContain('name="revision" value="4"');
    expect(process).toContain("&lt;Dee&gt;");
    expect(process).toContain("20 October 2026 at 10:30");
    expect(process.indexOf("Changes take effect immediately for every case.")).toBeGreaterThan(-1);
    expect(process.indexOf("Changes take effect immediately")).toBeLessThan(process.indexOf("Save claim window"));
    expect(process).toContain("A longer window does not return claims that have already gone back to the pool");
  });

  it("should show the Gazette recipient form posting to its own address with its own revision", async () => {
    const { markup } = await render(GET);

    const gazette = form(markup, "/deed-polls/settings/gazette-recipient");
    expect(markup).toContain('id="gazette-recipient"');
    expect(gazette).toContain('value="lg@example.com"');
    expect(gazette).toContain('name="revision" value="2"');
    expect(gazette).toContain("Save recipient");
    expect(markup).toContain("&lt;Admin&gt;");
  });

  it("should clearly show an unset recipient without suggesting the court mailbox", async () => {
    vi.mocked(findGazetteSettings).mockResolvedValue({ recipientEmail: null, revision: 0 });

    const { markup } = await render(GET);

    expect(markup).toContain("The recipient email address has not been set.");
    expect(markup).not.toContain("kbdeedspoll@justice.gov.uk");
  });

  it("should render no Gazette section for a Delivery Manager without ACCESS_GAZETTE", async () => {
    const { markup } = await render(GET, { access: PROCESS_ONLY });

    expect(markup).not.toContain('id="gazette-recipient"');
    expect(markup).not.toContain("London Gazette");
  });

  it("should degrade the Gazette section to a sentence with no Save when its read fails", async () => {
    vi.mocked(findGazetteSettings).mockRejectedValue(new Error("down"));

    const { markup } = await render(GET);

    expect(markup).toContain("The London Gazette recipient could not be loaded. Try again later.");
    expect(form(markup, "/deed-polls/settings/gazette-recipient")).toBe("");
    expect(markup).toContain("Save claim window");
  });

  it.each([
    ["process-settings", "en", "Claim window saved."],
    ["gazette-recipient", "en", "Recipient email address saved."],
    ["gazette-recipient", "cy", "Mae cyfeiriad e-bost y derbynnydd wedi’i gadw."]
  ])("should show the %s saved banner in %s", async (saved, locale, text) => {
    const { markup } = await render(GET, { query: { saved }, locale });

    expect(markup).toContain(text);
  });

  it("should keep the saved banner when the saved section's follow-up read fails", async () => {
    vi.mocked(findProcessSettings).mockRejectedValue(new Error("down"));

    const { markup } = await render(GET, { query: { saved: "process-settings" } });

    expect(markup).toContain("Claim window saved.");
    expect(markup).toContain("The claim window could not be loaded. Try again later.");
  });

  describe("error states", () => {
    it.each([
      ["invalid hours", { claimWindowHours: "1.5", claimWindowMinutes: "0", revision: "4" }],
      ["invalid minutes", { claimWindowHours: "1", claimWindowMinutes: "-1", revision: "4" }],
      ["out of range", { claimWindowHours: "0", claimWindowMinutes: "29", revision: "4" }],
      ["both blank", { claimWindowHours: "", claimWindowMinutes: "", revision: "4" }],
      ["missing revision", { claimWindowHours: "2", claimWindowMinutes: "0" }],
      ["everything wrong", { claimWindowHours: "x", claimWindowMinutes: "y" }]
    ])("should link every summary entry to a control for %s", async (_name, body) => {
      const { markup } = await render(postProcess, { body });

      expectSummaryLinksResolve(markup);
    });

    it("should mark both inputs and the fieldset for a total out of range, keeping the typed text", async () => {
      const { markup } = await render(postProcess, { body: { claimWindowHours: "24", claimWindowMinutes: " 1 ", revision: "4" } });

      expect(markup).toContain('id="claim-window-error"');
      expect(markup).toMatch(/aria-describedby="claim-window-hint claim-window-error"/);
      expect(markup.match(/govuk-input--error/g)).toHaveLength(2);
      expect(markup).toMatch(/id="claimWindowMinutes"[^>]*value=" 1 "/);
      expect(markup).toContain('name="revision" value="4"');
      expectSummaryLinksResolve(markup);
    });

    it.each([
      ["api 409", () => vi.mocked(saveProcessSettings).mockRejectedValue(new ConflictError("private prose"))],
      [
        "api 400",
        () => vi.mocked(saveProcessSettings).mockRejectedValue(new InvalidInputError("private prose", [{ field: "revision", message: "private prose" }]))
      ]
    ])("should keep the typed text and original revision on %s, offering only a reload", async (_name, arrange) => {
      arrange();

      const { markup } = await render(postProcess, { body: { claimWindowHours: "5", claimWindowMinutes: "", revision: "4" } });

      const process = form(markup, "/deed-polls/settings");
      expect(process).toMatch(/id="claimWindowHours"[^>]*value="5"/);
      expect(process).toContain('name="revision" value="4"');
      expect(process).not.toContain("Save claim window");
      expect(markup).toContain('id="reload-process-settings"');
      expect(markup).not.toContain("private prose");
      expect(markup).toContain("Save recipient");
      expectSummaryLinksResolve(markup);
    });

    it("should map api's 400 on the minutes to the fieldset", async () => {
      vi.mocked(saveProcessSettings).mockRejectedValue(new InvalidInputError("x", [{ field: "referralClaimExpiryMinutes", message: "x" }]));

      const { markup } = await render(postProcess, { body: { claimWindowHours: "5", claimWindowMinutes: "", revision: "4" } });

      expect(markup).toContain("The claim window must be between 30 minutes and 24 hours");
      expect(markup).toContain("Save claim window");
      expectSummaryLinksResolve(markup);
    });

    it("should keep the process errors and drop the Gazette Save when the Gazette read fails", async () => {
      vi.mocked(findGazetteSettings).mockRejectedValue(new Error("down"));

      const { markup } = await render(postProcess, { body: { claimWindowHours: "x", claimWindowMinutes: "0", revision: "4" } });

      expect(markup).toContain("Enter hours as a whole number from 0 to 24");
      expect(markup).toContain("The London Gazette recipient could not be loaded. Try again later.");
      expect(markup).not.toContain("Save recipient");
      expectSummaryLinksResolve(markup);
    });

    it.each([
      ["en", "The recipient has changed since you opened this page"],
      ["cy", "Mae’r derbynnydd wedi newid ers i chi agor y dudalen hon"]
    ])("should preserve typed data on a Gazette conflict and require a reload in %s", async (locale, message) => {
      vi.mocked(saveGazetteSettings).mockRejectedValue(new ConflictError("private internal prose"));

      const { res, markup } = await render(postGazette, { body: { recipientEmail: "  draft@example.com  ", revision: "2" }, locale });

      expect(res.status).toHaveBeenCalledWith(409);
      expect(markup).toContain(message);
      expect(markup).toContain('value="  draft@example.com  "');
      expect(markup).not.toContain("private internal prose");
      expect(markup).not.toContain("Save recipient");
      expect(markup).toContain('id="reload-gazette-recipient"');
      expect(markup).toContain("Save claim window");
      expectSummaryLinksResolve(markup);
    });

    it.each([
      ["en", "Enter a valid email address, like name@example.com", "Save recipient"],
      ["cy", "Rhowch gyfeiriad e-bost dilys, fel enw@enghraifft.com", "Cadw’r derbynnydd"]
    ])("should translate the Gazette field error into %s and allow correction", async (locale, message, save) => {
      const { markup } = await render(postGazette, { body: { recipientEmail: "bad", revision: "2" }, locale });

      expect(markup).toContain(message);
      expect(markup).toContain(save);
      expectSummaryLinksResolve(markup);
    });

    it("should link a Gazette missing revision to its reload control", async () => {
      const { markup } = await render(postGazette, { body: { recipientEmail: "lg@example.com" } });

      expect(markup).toContain("Reload recipient settings");
      expectSummaryLinksResolve(markup);
    });

    it("should keep the Gazette errors and drop the process Save when the process read fails", async () => {
      vi.mocked(findProcessSettings).mockRejectedValue(new Error("down"));

      const { markup } = await render(postGazette, { body: { recipientEmail: "bad", revision: "2" } });

      expect(markup).toContain("The claim window could not be loaded. Try again later.");
      expect(markup).not.toContain("Save claim window");
      expectSummaryLinksResolve(markup);
    });
  });
});
