import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMiCompletion, findMiReferralOutcomes, findMiStageDurations, findMiVolume, InvalidInputError } from "@hmcts/deed-poll";
import axe from "axe-core";
import { JSDOM } from "jsdom";
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

  it("should head the periods by month, and label the chart's ticks with the month, for the last year", async () => {
    const markup = await render({ period: "year" });

    expect(markup).toContain("grouped by month.");
    expect(markup).toMatch(/<th scope="col" class="govuk-table__header">Month<\/th>/);
    expect(markup).toContain(">Oct 2026</text>");
    expect(markup).toContain("Line chart of");
    expect(markup).toContain("for each month from");
  });

  it("should check the granularity that was chosen", async () => {
    const markup = await render({ granularity: "QUARTER" });

    expect(markup).toMatch(/name="granularity" type="radio" value="QUARTER" checked/);
    expect(markup).toContain("grouped by quarter.");
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

    it("should give stage durations one headed, captioned table per stage, in api's order", async () => {
      const markup = await render();
      const durations = section(markup, "stage-durations");

      const stages = [
        "Received to ready for a Master",
        "Ready for a Master to referred",
        "Referred to the Master’s decision",
        "Signature requested to signature received",
        "Signature received to enrolled"
      ];
      expect([...durations.matchAll(/<h3 class="govuk-heading-m">([^<]+)<\/h3>/g)].map((match) => match[1])).toEqual(stages);
      expect([...durations.matchAll(/<caption class="govuk-table__caption govuk-visually-hidden">([^<]+)<\/caption>/g)].map((match) => match[1])).toEqual(
        stages
      );
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

      expect(markup).toContain('<div class="app-table-scroll" role="region" aria-label="Cases received and open, table" tabindex="0">');
    });

    it("should render the same tables on the Welsh page", async () => {
      const markup = await render({}, "cy");

      expect(section(markup, "completion")).toContain("<table");
      expect(section(markup, "volume")).toContain("Hyd 2026");
    });
  });

  describe("charts", () => {
    it("should draw a chart above each table, named by its title and described by its summary", async () => {
      const markup = await render();

      for (const id of ["volume", "referral-outcomes", "completion"]) {
        const body = section(markup, id);
        expect(body.indexOf(`<svg class="app-chart__svg" role="img"`)).toBeGreaterThan(-1);
        expect(body.indexOf("<svg")).toBeLessThan(body.indexOf("<table"));
        expect(body).toContain(`aria-labelledby="${id}-chart-title" aria-describedby="${id}-chart-summary"`);
        expect(body).toContain(`<title id="${id}-chart-title">`);
        expect(body).toContain(`id="${id}-chart-summary"`);
      }
      expect(section(markup, "stage-durations").match(/<svg /g)).toHaveLength(5);
    });

    it("should say in one sentence what the chart shows, and that the table has every figure", async () => {
      const markup = await render();

      expect(section(markup, "volume")).toContain(
        "Line chart of received and open at end for each week from 5 Oct 2026 to 25 Oct 2026, with every figure in the table below."
      );
      expect(section(markup, "referral-outcomes")).toContain("Line chart of approved, rejected, applicant confirmed and applicant withdrew for each week");
    });

    it("should say a gap means no cases when a line has one", async () => {
      const markup = await render();

      expect(section(markup, "completion")).toContain(
        "Line chart of median days and 95th percentile days for each week from 5 Oct 2026 to 25 Oct 2026, with a gap where a week had no cases"
      );
    });

    it("should break the line at an empty bucket rather than draw it at zero", async () => {
      const markup = await render();
      const completion = section(markup, "completion");

      // Weeks one and three have days and week two has none, so each line is two lone markers and no polyline.
      expect(completion).not.toContain("<polyline");
      expect(completion.match(/<circle class="app-chart__marker"/g)).toHaveLength(3);
      expect(section(markup, "volume").match(/<polyline/g)).toHaveLength(2);
    });

    it("should give every line a marker shape and a direct label, so colour is not the only distinction", async () => {
      const markup = await render();
      const outcomes = section(markup, "referral-outcomes");

      for (const [index, shape] of [
        [1, "circle"],
        [2, "rect"],
        [3, "path"],
        [4, "path"]
      ] as const) {
        expect(outcomes).toMatch(new RegExp(`app-chart__series--${index}">[\\s\\S]*?<${shape} class="app-chart__marker"`));
      }
      for (const label of ["Approved", "Rejected", "Applicant confirmed", "Applicant withdrew"]) {
        expect(outcomes).toMatch(new RegExp(`<text class="app-chart__label"[^>]*>${label}</text>`));
      }
    });

    it("should label the axes with the page's own formatting", async () => {
      const markup = await render();

      expect(section(markup, "volume")).toMatch(/<text class="app-chart__tick app-chart__tick--y"[^>]*>3,000<\/text>/);
      expect(section(markup, "volume")).toMatch(/<text class="app-chart__tick app-chart__tick--x"[^>]*>5 Oct<\/text>/);
    });

    it("should give fractional-day ticks enough digits to tell them apart", async () => {
      const small = miCompletion();
      vi.mocked(findMiCompletion).mockResolvedValue({
        ...small,
        cohorts: small.cohorts.map((cohort) => ({ ...cohort, daysToCompletion: { count: 1, medianDays: 0.05, p95Days: 0.05 } }))
      });

      const markup = await render();
      const ticks = [...section(markup, "completion").matchAll(/<text class="app-chart__tick app-chart__tick--y"[^>]*>([^<]*)<\/text>/g)].map(
        (match) => match[1]
      );

      expect(ticks).toEqual(["0", "0.02", "0.04", "0.06"]);
    });

    it("should draw no chart for a table whose percentiles are all empty, leaving the table", async () => {
      const empty = miCompletion();
      vi.mocked(findMiCompletion).mockResolvedValue({
        ...empty,
        cohorts: empty.cohorts.map((cohort) => ({ ...cohort, daysToCompletion: { count: 0, medianDays: null, p95Days: null } }))
      });

      const markup = await render();

      expect(section(markup, "completion")).not.toContain("<svg");
      expect(section(markup, "completion")).toContain("<table");
    });

    it("should draw no chart when one KPI could not be loaded", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(findMiVolume).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

      const markup = await render();

      expect(section(markup, "volume")).not.toContain("<svg");
    });
  });

  describe("downloads", () => {
    it("should link each section to its CSV for the range the page resolved, so a later download holds the same rows", async () => {
      const markup = await render({ period: "30-days" });
      const query = "period=custom&amp;from=2026-10-06&amp;to=2026-11-04&amp;granularity=WEEK&amp;includeMigrated=true";

      expect(section(markup, "volume")).toContain(
        `<a class="govuk-link" href="/deed-polls/management-information/volume.csv?${query}">Download cases received and open (CSV)</a>`
      );
      expect(section(markup, "stage-durations")).toContain(`href="/deed-polls/management-information/stage-durations.csv?${query}"`);
      expect(section(markup, "referral-outcomes")).toContain(`href="/deed-polls/management-information/referral-outcomes.csv?${query}"`);
      expect(section(markup, "completion")).toContain(`href="/deed-polls/management-information/completion.csv?${query}"`);
    });

    it("should carry the migrated choice into the download", async () => {
      const markup = await render({ includeMigrated: "false" });

      expect(section(markup, "volume")).toContain("includeMigrated=false");
    });

    it("should offer no download for a KPI that could not be loaded", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(findMiCompletion).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

      const markup = await render();

      expect(section(markup, "completion")).not.toContain(".csv");
      expect(section(markup, "volume")).toContain("volume.csv");
    });
  });

  describe("accessibility", () => {
    it("should have no axe violations with the charts and tables drawn", async () => {
      expect(await axeViolations(await render())).toEqual([]);
    });

    it("should have no axe violations with an empty bucket, a bucket of one and exclusions", async () => {
      const excluded = { ...miVolume().parameters, includeMigrated: false };
      vi.mocked(findMiVolume).mockResolvedValue(miVolume(excluded));
      vi.mocked(findMiStageDurations).mockResolvedValue(miStageDurations(excluded));

      expect(await axeViolations(await render({ includeMigrated: "false" }))).toEqual([]);
    });

    it("should have no axe violations with an error summary", async () => {
      expect(await axeViolations(await render({ period: "custom", from: "2026-13-01", to: "" }))).toEqual([]);
    });

    it("should have no axe violations when api fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      for (const read of [findMiVolume, findMiStageDurations, findMiReferralOutcomes, findMiCompletion]) {
        vi.mocked(read).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
      }

      expect(await axeViolations(await render())).toEqual([]);
    });
  });
});

/**
 * axe-core over the page's main content in jsdom. The layout's shared strings are not loaded here, so the header and
 * footer are left to the browser suite, as is colour contrast, which jsdom cannot compute without layout.
 */
async function axeViolations(markup: string): Promise<{ id: string; nodes: string[] }[]> {
  const dom = new JSDOM(markup, { runScripts: "outside-only" });
  dom.window.eval(axe.source);
  const main = dom.window.document.getElementById("main-content");
  if (!main) throw new Error("no main-content");
  const results = await (dom.window as unknown as { axe: typeof axe }).axe.run(main, {
    rules: { "color-contrast": { enabled: false } }
  });
  dom.window.close();
  return results.violations.map((each) => ({ id: each.id, nodes: each.nodes.map((node) => node.html) }));
}

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
