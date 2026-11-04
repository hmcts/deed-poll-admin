import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMiCompletion, findMiReferralOutcomes, findMiStageDurations, findMiVolume, InvalidInputError } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
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
const QUERY = { from: "2026-10-06", to: "2026-11-04", granularity: "WEEK", includeMigrated: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T09:30:00Z"));
  for (const read of [findMiVolume, findMiStageDurations, findMiReferralOutcomes, findMiCompletion]) {
    vi.mocked(read).mockResolvedValue({ parameters: QUERY } as never);
  }
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
});
