import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMiCompletion, findMiReferralOutcomes, findMiStageDurations, findMiVolume, InvalidInputError } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { miCompletion, miReferralOutcomes, miStageDurations, miVolume } from "../../../management-information/test-fixtures.js";
import { addPathFilters } from "../../../path-filters.js";
import { GET } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findMiCompletion: vi.fn(),
  findMiReferralOutcomes: vi.fn(),
  findMiStageDurations: vi.fn(),
  findMiVolume: vi.fn()
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T09:30:00Z"));
  vi.mocked(findMiVolume).mockResolvedValue(miVolume());
  vi.mocked(findMiStageDurations).mockResolvedValue(miStageDurations());
  vi.mocked(findMiReferralOutcomes).mockResolvedValue(miReferralOutcomes());
  vi.mocked(findMiCompletion).mockResolvedValue(miCompletion());
});

afterEach(() => {
  vi.useRealTimers();
});

async function render(query: Record<string, unknown> = {}, locale = "en") {
  const res = pageResponse();
  res.locals.locale = locale;
  await GET(pageRequest({ teamLeader: true, accessToken: "tl-token", query }), res);
  const model = res.render.mock.calls[0][1];
  return environment.render("deed-polls/management-information/index.njk", { ...model[locale], ...model });
}

describe("management information page", () => {
  it("should be a GET form back to the page itself, so it works with JavaScript off", async () => {
    const markup = await render();

    expect(markup).toContain('<form method="get" action="/deed-polls/management-information" novalidate>');
    expect(markup).toContain('<h1 class="govuk-heading-xl">Management information</h1>');
  });

  it("should check the last 30 days and migrated cases, and no granularity, when nothing is chosen", async () => {
    const markup = await render();

    expect(markup).toMatch(/name="period" type="radio" value="30-days" checked/);
    expect(markup).toMatch(/name="includeMigrated" type="radio" value="true" checked/);
    expect(markup).not.toMatch(/name="granularity" type="radio" value="[A-Z]+" checked/);
    expect(markup).toContain("Showing 6 October 2026 to 4 November 2026, grouped by week.");
  });

  it("should offer every preset and the custom range's two days", async () => {
    const markup = await render();

    for (const label of ["Last 7 days", "Last 30 days", "Last 60 days", "Last 90 days", "Last year", "Choose the dates"]) expect(markup).toContain(label);
    expect(markup).toContain('id="from" name="from" type="text"');
    expect(markup).toContain('id="to" name="to" type="text"');
  });

  it("should redraw a refused custom range as typed, with a summary whose links reach their controls", async () => {
    const markup = await render({ period: "custom", from: "2026-13-01", to: "" });

    expect(markup).toContain("govuk-error-summary");
    expect(markup).toContain("Enter the first day of the range as yyyy-MM-dd.");
    expect(markup).toContain("Enter the last day of the range.");
    expect(markup).toContain('value="2026-13-01"');
    expect(markup).toMatch(/name="period" type="radio" value="custom" checked/);
    const targets = [...markup.matchAll(/govuk-error-summary[\s\S]*?<\/ul>/g)][0][0].matchAll(/href="#([^"]+)"/g);
    for (const [, target] of targets) expect(markup).toContain(`id="${target}"`);
    expect(markup).not.toContain('id="range-summary"');
  });

  it("should show api's 400 in the error summary", async () => {
    vi.mocked(findMiVolume).mockRejectedValue(
      new InvalidInputError("Choose WEEK, MONTH or QUARTER.", [{ field: "granularity", message: "Choose WEEK, MONTH or QUARTER." }])
    );

    const markup = await render();

    expect(markup).toContain('href="#granularity"');
    expect(markup).toContain('id="granularity"');
  });

  it("should say migrated cases are left out when they are", async () => {
    const markup = await render({ includeMigrated: "false" });

    expect(markup).toMatch(/name="includeMigrated" type="radio" value="false" checked/);
    expect(markup).toContain("Cases migrated from the previous system are not included.");
  });

  describe("tables", () => {
    it("should draw the four sections in order, each with its heading and the period column", async () => {
      const markup = await render();

      const headings = [...markup.matchAll(/<h2 class="govuk-heading-l" id="([a-z-]+)-heading">([^<]+)<\/h2>/g)].map((match) => match[2]);
      expect(headings).toEqual(["Cases received and open", "How long each stage took", "Referral outcomes", "Time from receipt to completion"]);
      expect(section(markup, "volume")).toContain('<th scope="row" class="govuk-table__header">5 Oct 2026 to 11 Oct 2026</th>');
      expect(section(markup, "volume")).toMatch(/<th scope="col" class="govuk-table__header">\s*Week\s*<\/th>/);
    });

    it("should format counts with thousands separators", async () => {
      const markup = await render();

      expect(section(markup, "volume")).toContain(">1,234<");
      expect(section(markup, "volume")).toContain(">2,048<");
    });

    it("should put each percentile after the count it was taken over, and say No cases rather than zero for an empty bucket", async () => {
      const markup = await render();
      const durations = section(markup, "stage-durations");

      expect(headerTexts(durations).slice(0, 4)).toEqual(["Week", "Cases", "Median days", "95th percentile days"]);
      const emptyWeek = rowCells(durations, "12 Oct 2026 to 18 Oct 2026")[0];
      expect(emptyWeek).toEqual(["0", "No cases", "No cases"]);
      expect(rowCells(durations, "5 Oct 2026 to 11 Oct 2026")[0]).toEqual(["12", "3.3", "11"]);
    });

    it("should show a bucket of one case as one case beside its percentiles", async () => {
      const markup = await render();

      expect(rowCells(section(markup, "completion"), "19 Oct 2026 to 25 Oct 2026")[0]).toEqual(["1", "1", "1", "0", "0", "1", "9", "9"]);
    });

    it("should give stage durations one captioned table per stage, in api's order", async () => {
      const markup = await render();

      const captions = [
        ...section(markup, "stage-durations").matchAll(/<caption class="govuk-table__caption govuk-table__caption--m">([^<]+)<\/caption>/g)
      ].map((match) => match[1]);
      expect(captions).toEqual([
        "Received to ready for a Master",
        "Ready for a Master to referred",
        "Referred to the Master’s decision",
        "Signature requested to signature received",
        "Signature received to enrolled"
      ]);
    });

    it("should say why recent cohorts look fast and show still open beside the percentiles", async () => {
      const markup = await render();
      const completion = section(markup, "completion");

      expect(completion).toContain("Recent intake periods look faster because their slower cases are still open.");
      expect(headerTexts(completion)).toEqual([
        "Week",
        "Received",
        "Completed",
        "Enrolled",
        "Returned",
        "Still open",
        "Cases timed",
        "Median days",
        "95th percentile days"
      ]);
    });

    it("should list what each figure does not count, with api's excluded counts", async () => {
      const markup = await render();

      for (const id of ["volume", "stage-durations", "referral-outcomes", "completion"]) {
        expect(section(markup, id)).toContain("What these figures do not count");
        expect(section(markup, id)).toContain("Staff can edit those dates");
      }
      expect(section(markup, "volume")).toContain("Cases with no date received, which no period can hold: 3");
      expect(section(markup, "stage-durations")).toContain("nothing records when they arrived");
      expect(rowCells(section(markup, "stage-durations"), "Received to ready for a Master").at(-1)).toEqual(["2"]);
      expect(section(markup, "referral-outcomes")).toContain("A referral withdrawn by staff is not counted");
      expect(section(markup, "referral-outcomes")).toContain("Referrals with a decision date but no decision: 1");
      expect(section(markup, "completion")).toContain("counted in none of the columns: 1");
      expect(section(markup, "completion")).toContain("counted as completed but not in the days: 2");
      expect(markup).not.toContain("Migrated cases left out");
    });

    it("should list the migrated exclusions when migrated cases were left out", async () => {
      const excluded = { ...miVolume().parameters, includeMigrated: false };
      vi.mocked(findMiVolume).mockResolvedValue(miVolume(excluded));
      vi.mocked(findMiStageDurations).mockResolvedValue(miStageDurations(excluded));

      const markup = await render({ includeMigrated: "false" });

      expect(section(markup, "volume")).toContain("Migrated cases left out: 7");
      expect(section(markup, "stage-durations")).toContain("On migrated cases");
    });

    it("should say a range with no periods has none rather than draw empty tables", async () => {
      vi.mocked(findMiVolume).mockResolvedValue({ ...miVolume(), periods: [] });

      const markup = await render();

      expect(section(markup, "volume")).toContain("There are no periods in this range.");
      expect(section(markup, "volume")).not.toContain("<table");
    });

    it("should say one KPI could not be loaded when api failed, and still draw the others", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(findMiReferralOutcomes).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

      const markup = await render();

      expect(section(markup, "referral-outcomes")).toContain("These figures could not be loaded. Try again shortly.");
      expect(section(markup, "referral-outcomes")).not.toContain("<table");
      expect(section(markup, "volume")).toContain("<table");
    });

    it("should draw no tables when api refuses the filters", async () => {
      vi.mocked(findMiCompletion).mockRejectedValue(new InvalidInputError("Choose WEEK, MONTH or QUARTER.", []));

      const markup = await render();

      expect(markup).not.toContain("<table");
      expect(markup).not.toContain('id="volume"');
    });

    it("should let a keyboard scroll each table's region, named by its caption", async () => {
      const markup = await render();

      expect(markup).toContain('<div class="app-table-scroll" role="region" aria-label="Cases received and open" tabindex="0">');
    });

    it("should render the same tables on the Welsh page", async () => {
      const markup = await render({}, "cy");

      expect(section(markup, "completion")).toContain("<table");
      expect(section(markup, "volume")).toContain("Hyd 2026");
    });
  });
});

function section(markup: string, id: string): string {
  const match = markup.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?</section>`));
  if (!match) throw new Error(`no section ${id}`);
  return match[0];
}

function headerTexts(markup: string): string[] {
  const head = markup.match(/<thead[\s\S]*?<\/thead>/);
  return [...(head?.[0] ?? "").matchAll(/<th[^>]*>\s*([^<]*?)\s*<\/th>/g)].map((match) => match[1]);
}

/** Every row headed by `label`, as the text of its data cells. */
function rowCells(markup: string, label: string): string[][] {
  return [...markup.matchAll(/<tr class="govuk-table__row">([\s\S]*?)<\/tr>/g)]
    .filter((row) => row[1].includes(`>${label}</th>`))
    .map((row) => [...row[1].matchAll(/<td[^>]*>\s*([^<]*?)\s*<\/td>/g)].map((cell) => cell[1]));
}
