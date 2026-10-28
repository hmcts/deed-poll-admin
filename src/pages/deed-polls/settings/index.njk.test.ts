import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConflictError,
  findBankHolidays,
  findGazetteSettings,
  findMasters,
  findProcessSettings,
  InvalidInputError,
  MANAGE_PROCESS_CONFIG,
  saveBankHoliday,
  saveGazetteSettings,
  saveNewMaster,
  saveProcessSettings
} from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { addPathFilters } from "../../../path-filters.js";
import { POST as postBankHoliday } from "./bank-holidays/index.js";
import { POST as postGazette } from "./gazette-recipient.js";
import { GET, POST as postProcess } from "./index.js";
import { POST as postMaster } from "./masters/index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findBankHolidays: vi.fn(),
  findGazetteSettings: vi.fn(),
  findMasters: vi.fn(),
  findProcessSettings: vi.fn(),
  saveBankHoliday: vi.fn(),
  saveGazetteSettings: vi.fn(),
  saveNewMaster: vi.fn(),
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
addPathFilters(environment);
const PROCESS = {
  referralClaimExpiryMinutes: 10080,
  reminderIntervalHours: 48,
  masterWindowCap: 10,
  morningWindowStart: "07:00",
  morningWindowEnd: "10:30",
  afternoonWindowStart: "14:00",
  afternoonWindowEnd: "14:30",
  revision: 4,
  updatedBy: "<Dee>",
  updatedAt: new Date("2026-10-20T09:30:00Z")
};
const BODY = {
  processingDays: "7",
  reminderIntervalHours: "48",
  masterWindowCap: "10",
  morningWindowStart: "07:00",
  morningWindowEnd: "10:30",
  afternoonWindowStart: "14:00",
  afternoonWindowEnd: "14:30",
  revision: "4"
};
const GAZETTE = { recipientEmail: "lg@example.com", revision: 2, updatedBy: "<Admin>", updatedAt: new Date("2026-10-08T10:00:00Z") };
const PROCESS_ONLY = { staff: true, judicial: false, capabilities: [MANAGE_PROCESS_CONFIG] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findProcessSettings).mockResolvedValue(PROCESS);
  vi.mocked(findGazetteSettings).mockResolvedValue(GAZETTE);
  vi.mocked(saveProcessSettings).mockResolvedValue(PROCESS);
  vi.mocked(saveGazetteSettings).mockResolvedValue(GAZETTE);
  vi.mocked(findMasters).mockResolvedValue([
    { id: "6f1c1d4e-2a5b-4c3d-8e9f-0a1b2c3d4e5f", name: "<Master Wren>", email: "wren@example.test", available: false, linked: true, revision: 3 },
    { id: "7f1c1d4e-2a5b-4c3d-8e9f-0a1b2c3d4e5f", name: "Master Sullivan", email: "sullivan@example.test", available: true, linked: false, revision: 0 }
  ]);
  vi.mocked(findBankHolidays).mockResolvedValue([{ date: "2026-12-25", name: "<Christmas Day>" }]);
  vi.mocked(saveNewMaster).mockResolvedValue({ id: "x", name: "n", email: "e", available: true, linked: false, revision: 0 });
  vi.mocked(saveBankHoliday).mockResolvedValue({ date: "2029-01-01", name: "n" });
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

  it("should show every referral process value in one form with the warning before its Save and escaped attribution", async () => {
    const { markup } = await render(GET);

    const process = form(markup, "/deed-polls/settings");
    expect(markup).toContain('<h2 class="govuk-heading-m">Referral process</h2>');
    expect(process).toMatch(/id="processingDays"[^>]*value="7"/);
    expect(process).toMatch(/id="reminderIntervalHours"[^>]*value="48"/);
    expect(process).toMatch(/id="masterWindowCap"[^>]*value="10"/);
    expect(process).toMatch(/id="morningWindowStart"[^>]*value="07:00"/);
    expect(process).toMatch(/id="morningWindowEnd"[^>]*value="10:30"/);
    expect(process).toMatch(/id="afternoonWindowStart"[^>]*value="14:00"/);
    expect(process).toMatch(/id="afternoonWindowEnd"[^>]*value="14:30"/);
    expect(process.match(/name="revision"/g)).toHaveLength(1);
    expect(process).toContain('name="revision" value="4"');
    expect(process).toContain("&lt;Dee&gt;");
    expect(process).toContain("20 October 2026 at 10:30");
    expect(process.indexOf("Changes take effect immediately for every referral.")).toBeGreaterThan(-1);
    expect(process.indexOf("Changes take effect immediately")).toBeLessThan(process.indexOf("Save referral process"));
    expect(markup).not.toContain("claim window");
  });

  it("should group each window's start and end in a fieldset described by the window hint", async () => {
    const { markup } = await render(GET);

    const fieldsets = [...markup.matchAll(/<fieldset[^>]*>/g)].map((match) => match[0]);
    for (const window of ["morning", "afternoon"]) {
      const fieldset = fieldsets.find((tag) => tag.includes(`id="${window}-window"`));
      expect(fieldset).toContain(`aria-describedby="${window}-window-hint"`);
      expect(markup).toContain(`id="${window}-window-hint"`);
    }
    expect(markup).toContain("Morning referral window");
    expect(markup).toContain("Afternoon referral window");
  });

  it("should label the durations with their units", async () => {
    const { markup } = await render(GET);

    expect(markup).toMatch(/id="processingDays"[\s\S]*?govuk-input__suffix[^>]*>days</);
    expect(markup).toMatch(/id="reminderIntervalHours"[\s\S]*?govuk-input__suffix[^>]*>hours</);
  });

  it("should take the warning icon's hidden text from the page content, so Welsh can translate it", async () => {
    const { model } = await render(GET);

    const markup = environment.render("deed-polls/settings/index.njk", { ...(model.en as object), ...model, warningIcon: "ICON-MARKER" });

    expect((model.en as Record<string, unknown>).warningIcon).toBe("Warning");
    expect(form(markup, "/deed-polls/settings")).toContain("ICON-MARKER");
  });

  it("should say the referral process has never been changed, with no last-changed line, when api reports no attribution", async () => {
    vi.mocked(findProcessSettings).mockResolvedValue({ ...PROCESS, revision: 0, updatedBy: null, updatedAt: null });

    const { markup } = await render(GET);

    const process = form(markup, "/deed-polls/settings");
    expect(process).toContain("The referral process has not been changed since the service started.");
    expect(process).not.toContain("Last changed");
  });

  it("should show the date alone when api names no one who changed it", async () => {
    vi.mocked(findProcessSettings).mockResolvedValue({ ...PROCESS, updatedBy: null });

    const { markup } = await render(GET);

    const process = form(markup, "/deed-polls/settings");
    expect(process).toContain("Last changed 20 October 2026 at 10:30</p>");
    expect(process).not.toContain(" by ");
    expect(process).not.toContain("has not been changed");
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
    expect(markup).toContain("Save referral process");
  });

  it("should link to XUI staff administration in a new tab, saying staff-admin access is needed", async () => {
    const { markup } = await render(GET);

    const section = markup.slice(markup.indexOf('id="staff-and-access"'));
    expect(section).toContain("Staff and access");
    expect(section).toContain("You need staff-admin access in Manage Case to do this.");
    expect(section).toMatch(
      /<a class="govuk-link" href="https:\/\/manage-case\.aat\.platform\.hmcts\.net\/staff" target="_blank" rel="noopener noreferrer">Manage staff in Manage Case \(opens in new tab\)<\/a>/
    );
  });

  it("should keep the staff link when both sections fail to load, and for a Delivery Manager without ACCESS_GAZETTE", async () => {
    vi.mocked(findProcessSettings).mockRejectedValue(new Error("down"));

    const { markup } = await render(GET, { access: PROCESS_ONLY });

    expect(markup).toContain('href="https://manage-case.aat.platform.hmcts.net/staff"');
  });

  it("should keep the staff link on a refused save", async () => {
    const { markup } = await render(postProcess, { body: { ...BODY, processingDays: "" } });

    expect(markup).toContain('href="https://manage-case.aat.platform.hmcts.net/staff"');
  });

  it.each([
    ["process-settings", "en", "Referral process saved."],
    ["gazette-recipient", "en", "Recipient email address saved."],
    ["gazette-recipient", "cy", "Mae cyfeiriad e-bost y derbynnydd wedi’i gadw."]
  ])("should show the %s saved banner in %s", async (saved, locale, text) => {
    const { markup } = await render(GET, { query: { saved }, locale });

    expect(markup).toContain(text);
  });

  it("should keep the saved banner when the saved section's follow-up read fails", async () => {
    vi.mocked(findProcessSettings).mockRejectedValue(new Error("down"));

    const { markup } = await render(GET, { query: { saved: "process-settings" } });

    expect(markup).toContain("Referral process saved.");
    expect(markup).toContain("The referral process settings could not be loaded. Try again later.");
  });

  describe("error states", () => {
    it.each([
      ["invalid days", { ...BODY, processingDays: "1.5" }],
      ["invalid reminder", { ...BODY, reminderIntervalHours: "-1" }],
      ["invalid cap", { ...BODY, masterWindowCap: "101" }],
      ["invalid time", { ...BODY, morningWindowStart: "7am" }],
      ["out of order", { ...BODY, afternoonWindowStart: "09:00" }],
      ["missing revision", { ...BODY, revision: undefined }],
      [
        "everything wrong",
        {
          processingDays: "x",
          reminderIntervalHours: "y",
          masterWindowCap: "z",
          morningWindowStart: "a",
          morningWindowEnd: "b",
          afternoonWindowStart: "c",
          afternoonWindowEnd: "d"
        }
      ]
    ])("should link every summary entry to a control for %s", async (_name, body) => {
      const { markup } = await render(postProcess, { body });

      expectSummaryLinksResolve(markup);
    });

    it("should mark the afternoon start for the ordering rule, keeping the typed text", async () => {
      const { markup } = await render(postProcess, { body: { ...BODY, afternoonWindowStart: " 10:00 " } });

      expect(markup).toContain('id="afternoonWindowStart-error"');
      expect(markup).toContain("The afternoon window must start after the morning window ends");
      expect(markup.match(/govuk-input--error/g)).toHaveLength(1);
      expect(markup).toMatch(/id="afternoonWindowStart"[^>]*value=" 10:00 "/);
      expect(markup).toContain('name="revision" value="4"');
      expect(markup).toContain("Save referral process");
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

      const { markup } = await render(postProcess, { body: { ...BODY, processingDays: "12" } });

      const process = form(markup, "/deed-polls/settings");
      expect(process).toMatch(/id="processingDays"[^>]*value="12"/);
      expect(process).toContain('name="revision" value="4"');
      expect(process).not.toContain("Save referral process");
      expect(markup).toContain('id="reload-process-settings"');
      // The form posted to this address, so a link differing only by its fragment would scroll rather than reload.
      expect(markup).toContain('href="/deed-polls/settings?reload=process-settings#process-settings"');
      expect(markup).not.toContain("private prose");
      expect(markup).toContain("Save recipient");
      expectSummaryLinksResolve(markup);
    });

    it("should map api's 400 on the minutes to the processing window in days", async () => {
      vi.mocked(saveProcessSettings).mockRejectedValue(new InvalidInputError("x", [{ field: "referralClaimExpiryMinutes", message: "x" }]));

      const { markup } = await render(postProcess, { body: BODY });

      expect(markup).toContain('id="processingDays-error"');
      expect(markup).toContain("Enter the processing window as a whole number of days from 1 to 30");
      expect(markup).toContain("Save referral process");
      expectSummaryLinksResolve(markup);
    });

    it("should keep the process errors and drop the Gazette Save when the Gazette read fails", async () => {
      vi.mocked(findGazetteSettings).mockRejectedValue(new Error("down"));

      const { markup } = await render(postProcess, { body: { ...BODY, processingDays: "x" } });

      expect(markup).toContain("Enter the processing window as a whole number of days from 1 to 30");
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
      expect(markup).toContain("Save referral process");
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

    it.each([
      ["en", [{ field: "recipientEmail", message: "private prose" }], "Enter a valid email address, like name@example.com", "Save recipient"],
      ["cy", [{ field: "recipientEmail", message: "private prose" }], "Rhowch gyfeiriad e-bost dilys, fel enw@enghraifft.com", "Cadw’r derbynnydd"]
    ])("should show api's 400 on the recipient as its field error in %s and allow correction", async (locale, errors, message, save) => {
      vi.mocked(saveGazetteSettings).mockRejectedValue(new InvalidInputError("private prose", errors));

      const { markup } = await render(postGazette, { body: { recipientEmail: "lg@example.com", revision: "2" }, locale });

      expect(markup).toContain(message);
      expect(markup).toContain(save);
      expect(markup).not.toContain('id="reload-gazette-recipient"');
      expect(markup).not.toContain("private prose");
      expectSummaryLinksResolve(markup);
    });

    it.each([
      ["en", [], "The recipient could not be saved. Reload the settings and try again.", "Save recipient"],
      ["en", [{ field: "revision", message: "private prose" }], "The recipient could not be saved. Reload the settings and try again.", "Save recipient"],
      ["cy", [], "Ni ellid cadw’r derbynnydd. Ail-lwythwch y gosodiadau a rhowch gynnig arall arni.", "Cadw’r derbynnydd"]
    ])("should offer only a reload on api's 400 naming no recipient field in %s (%j)", async (locale, errors, message, save) => {
      vi.mocked(saveGazetteSettings).mockRejectedValue(new InvalidInputError("private prose", errors));

      const { markup } = await render(postGazette, { body: { recipientEmail: "lg@example.com", revision: "2" }, locale });

      expect(markup).toContain(message);
      expect(markup).not.toContain(save);
      expect(markup).toContain('id="reload-gazette-recipient"');
      expect(markup).not.toContain("private prose");
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

      expect(markup).toContain("The referral process settings could not be loaded. Try again later.");
      expect(markup).not.toContain("Save referral process");
      expectSummaryLinksResolve(markup);
    });
  });
});

describe("service settings page: Masters", () => {
  function row(markup: string, text: string): string {
    const at = markup.indexOf(text);
    return markup.slice(markup.lastIndexOf("<tr", at), markup.indexOf("</tr>", at));
  }

  it("should list each Master with their availability, whether they have signed in and an escaped Change link", async () => {
    const { markup } = await render(GET);

    const wren = row(markup, "&lt;Master Wren&gt;");
    expect(markup).toContain('<h2 class="govuk-heading-m">Masters</h2>');
    expect(wren).toContain("wren@example.test");
    expect(wren).toMatch(/<td[^>]*>No<\/td>\s*<td[^>]*>Yes<\/td>/);
    expect(wren).toContain('href="/deed-polls/settings/masters/6f1c1d4e-2a5b-4c3d-8e9f-0a1b2c3d4e5f"');
    expect(wren).toContain('Change<span class="govuk-visually-hidden"> &lt;Master Wren&gt;</span>');
    expect(markup).not.toContain("<Master Wren>");
    expect(row(markup, "Master Sullivan")).toMatch(/<td[^>]*>Yes<\/td>\s*<td[^>]*>No<\/td>/);
    for (const heading of ["Name", "Email address", "Available", "Signed in"]) expect(markup).toContain(`>${heading}</th>`);
  });

  it("should draw the add form with no revision, posting to its own route", async () => {
    const { markup } = await render(GET);

    const add = form(markup, "/deed-polls/settings/masters");
    expect(add).toContain('id="master-name"');
    expect(add).toContain('id="master-email"');
    expect(add).not.toContain('name="revision"');
    expect(add).toContain("Add Master");
  });

  it("should say the list could not be loaded, and still offer the add form, when the read fails", async () => {
    vi.mocked(findMasters).mockRejectedValue(new Error("down"));

    const { markup } = await render(GET);

    expect(markup).toContain("The Masters could not be loaded. Try again later.");
    expect(form(markup, "/deed-polls/settings/masters")).toContain("Add Master");
  });

  it("should say there are none when the list is empty", async () => {
    vi.mocked(findMasters).mockResolvedValue([]);

    const { markup } = await render(GET);

    expect(markup).toContain("No Masters have been added.");
  });

  it("should redraw a refused add with its typed values, its errors and summary links that resolve", async () => {
    const { markup } = await render(postMaster, { body: { name: "<Wren>", email: "wren" } });

    const add = form(markup, "/deed-polls/settings/masters");
    expect(add).toMatch(/id="master-name"[^>]*value="&lt;Wren&gt;"/);
    expect(add).toMatch(/id="master-email"[^>]*value="wren"/);
    expect(add).toContain("Enter the Master’s email address, like name@example.com");
    expectSummaryLinksResolve(markup);
  });

  it("should show api's duplicate email in the page's words", async () => {
    vi.mocked(saveNewMaster).mockRejectedValue(new ConflictError("api prose", [{ field: "email", message: "api prose" }]));

    const { markup } = await render(postMaster, { body: { name: "Master Wren", email: "wren@example.test" } });

    expect(markup).toContain("Another Master already has this email address");
    expect(markup).not.toContain("api prose");
    expectSummaryLinksResolve(markup);
  });

  it.each([
    ["master-added", "Master added."],
    ["master-changed", "Master’s details saved."]
  ])("should show the %s banner", async (saved, text) => {
    const { markup } = await render(GET, { query: { saved } });

    expect(markup).toContain("govuk-notification-banner--success");
    expect(markup).toContain(text);
  });
});

describe("service settings page: bank holidays", () => {
  it("should list each day as dd-mm-yy with an escaped name and a Remove link to its confirmation", async () => {
    const { markup } = await render(GET);

    expect(markup).toContain('<h2 class="govuk-heading-m">Bank holidays</h2>');
    expect(markup).toMatch(/<td[^>]*>25-12-26<\/td>\s*<td[^>]*>&lt;Christmas Day&gt;<\/td>/);
    expect(markup).toContain('href="/deed-polls/settings/bank-holidays/2026-12-25/remove"');
    expect(markup).toContain('Remove<span class="govuk-visually-hidden"> &lt;Christmas Day&gt; 25-12-26</span>');
    expect(form(markup, "/deed-polls/settings/bank-holidays/2026-12-25/remove")).toBe("");
  });

  it("should draw the add form with a GOV.UK date input named for its three parts", async () => {
    const { markup } = await render(GET);

    const add = form(markup, "/deed-polls/settings/bank-holidays");
    for (const part of ["day", "month", "year"])
      expect(add).toMatch(new RegExp(`id="bank-holiday-date-${part}"[^>]*name="date-${part}"|name="date-${part}"[^>]*id="bank-holiday-date-${part}"`));
    expect(add).toContain('id="bank-holiday-name"');
    expect(add).toContain("Add bank holiday");
  });

  it("should say the list could not be loaded when the read fails", async () => {
    vi.mocked(findBankHolidays).mockRejectedValue(new Error("down"));

    const { markup } = await render(GET);

    expect(markup).toContain("The bank holidays could not be loaded. Try again later.");
  });

  it("should redraw a refused add with the typed parts, the date marked in error and summary links that resolve", async () => {
    const { markup } = await render(postBankHoliday, { body: { "date-day": "31", "date-month": "2", "date-year": "2029", name: "Odd day" } });

    const add = form(markup, "/deed-polls/settings/bank-holidays");
    expect(add).toContain("Enter the bank holiday’s date as a real date, like 25 12 2029");
    expect(add).toMatch(/govuk-input--error[^>]*id="bank-holiday-date-day"[^>]*value="31"|id="bank-holiday-date-day"[^>]*value="31"/);
    expect(add).toMatch(/id="bank-holiday-name"[^>]*value="Odd day"/);
    expectSummaryLinksResolve(markup);
  });

  it("should show api's duplicate date in the page's words", async () => {
    vi.mocked(saveBankHoliday).mockRejectedValue(new ConflictError("api prose"));

    const { markup } = await render(postBankHoliday, { body: { "date-day": "25", "date-month": "12", "date-year": "2026", name: "Christmas" } });

    expect(markup).toContain("This date is already a bank holiday");
    expect(markup).not.toContain("api prose");
    expectSummaryLinksResolve(markup);
  });

  it.each([
    ["bank-holiday-added", "Bank holiday added."],
    ["bank-holiday-removed", "Bank holiday removed."]
  ])("should show the %s banner", async (saved, text) => {
    const { markup } = await render(GET, { query: { saved } });

    expect(markup).toContain(text);
  });
});
