import {
  ForbiddenError,
  findMiCompletion,
  findMiReferralOutcomes,
  findMiStageDurations,
  findMiVolume,
  InvalidInputError,
  UnauthorizedError
} from "@hmcts/deed-poll";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { showManagementInformation } from "./page.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findMiCompletion: vi.fn(),
  findMiReferralOutcomes: vi.fn(),
  findMiStageDurations: vi.fn(),
  findMiVolume: vi.fn()
}));

const CALLER = { accessToken: "tl-token" };
const DEFAULT_QUERY = { from: "2026-10-06", to: "2026-11-04", granularity: "WEEK", includeMigrated: true };
const READS = [findMiVolume, findMiStageDurations, findMiReferralOutcomes, findMiCompletion];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T09:30:00Z"));
  for (const read of READS) vi.mocked(read).mockResolvedValue({ parameters: DEFAULT_QUERY } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

async function show(query: Record<string, unknown> = {}, locale = "en") {
  const res = pageResponse();
  res.locals.locale = locale;
  await showManagementInformation(pageRequest({ teamLeader: true, accessToken: CALLER.accessToken, query }), res);
  return { res, model: res.render.mock.calls[0]?.[1] };
}

describe("showManagementInformation", () => {
  it("should read all four KPIs for the last 30 days weekly when nothing is chosen", async () => {
    const { res, model } = await show();

    for (const read of READS) expect(read).toHaveBeenCalledExactlyOnceWith(DEFAULT_QUERY, CALLER);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.render).toHaveBeenCalledWith("deed-polls/management-information/index", expect.anything());
    expect(model.report.query).toEqual(DEFAULT_QUERY);
    expect(model.range).toEqual({
      showing: "Showing 6 October 2026 to 4 November 2026",
      groupedBy: "grouped by week",
      migrated: "Cases migrated from the previous system are included."
    });
  });

  it("should send the chosen filters", async () => {
    await show({ period: "custom", from: "2026-01-01", to: "2026-06-30", granularity: "QUARTER", includeMigrated: "false" });

    expect(findMiVolume).toHaveBeenCalledWith({ from: "2026-01-01", to: "2026-06-30", granularity: "QUARTER", includeMigrated: false }, CALLER);
  });

  it("should refuse unusable filters with a 400 in api's words and read nothing", async () => {
    const { res, model } = await show({ period: "custom", from: "2026-10-02", to: "2026-10-01" });

    for (const read of READS) expect(read).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(model.report).toBeNull();
    expect(model.errorList).toEqual([{ text: "The last day of the range cannot be before the first.", href: "#to" }]);
    expect(model.fieldErrors).toEqual({ to: { text: "The last day of the range cannot be before the first." } });
    expect(model.values).toMatchObject({ period: "custom", from: "2026-10-02", to: "2026-10-01" });
  });

  it("should show api's 400 against the form the same way", async () => {
    const message = "The range cannot be longer than 2 years.";
    vi.mocked(findMiStageDurations).mockRejectedValue(new InvalidInputError(message, [{ field: "to", message }]));

    const { res, model } = await show();

    expect(res.status).toHaveBeenCalledWith(400);
    expect(model.report).toBeNull();
    expect(model.errorList).toEqual([{ text: message, href: "#to" }]);
  });

  it("should point an api 400 naming no control of the form at the first one", async () => {
    vi.mocked(findMiVolume).mockRejectedValue(new InvalidInputError("Something is wrong.", []));

    const { model } = await show();

    expect(model.errorList).toEqual([{ text: "Something is wrong.", href: "#period" }]);
  });

  it("should degrade only the KPI whose read failed, and log it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findMiCompletion).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)\nforged"));

    const { res, model } = await show();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(model.report.completion).toBeNull();
    expect(model.report.volume).toEqual({ parameters: DEFAULT_QUERY });
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("management information completion read failed"));
    expect(log.mock.calls[0][0]).not.toContain("\n");
  });

  it.each([new UnauthorizedError("expired"), new ForbiddenError("no capability")])("should not degrade a %s", async (error) => {
    vi.mocked(findMiVolume).mockRejectedValue(error);

    await expect(show()).rejects.toBe(error);
  });

  it("should check the chosen period's radio and keep the custom days as typed", async () => {
    const { model } = await show({ period: "year", from: "x" });

    expect(model.periodItems.find((item: { checked: boolean }) => item.checked)).toEqual({ value: "year", text: "Last year", checked: true });
    expect(model.values.from).toBe("x");
  });

  it("should format the range in Welsh on the Welsh page", async () => {
    const { model } = await show({}, "cy");

    expect(model.range.showing).toContain("Hydref 2026");
  });
});
