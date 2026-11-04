import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMiCompletion, findMiReferralOutcomes, findMiStageDurations, findMiVolume, InvalidInputError } from "@hmcts/deed-poll";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { miCompletion, miReferralOutcomes, miStageDurations, miVolume } from "./test-fixtures.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findMiCompletion: vi.fn(),
  findMiReferralOutcomes: vi.fn(),
  findMiStageDurations: vi.fn(),
  findMiVolume: vi.fn()
}));

const CALLER = { accessToken: "tl-token" };
const AREA = "/deed-polls/management-information";
const BOM = "\uFEFF";
const RANGE = "period=custom&from=2026-10-06&to=2026-11-04&granularity=WEEK&includeMigrated=true";

let app: Express;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T09:30:00Z"));
  vi.mocked(findMiVolume).mockResolvedValue(miVolume());
  vi.mocked(findMiStageDurations).mockResolvedValue(miStageDurations());
  vi.mocked(findMiReferralOutcomes).mockResolvedValue(miReferralOutcomes());
  vi.mocked(findMiCompletion).mockResolvedValue(miCompletion());

  const pages = path.join(fileURLToPath(import.meta.url), "../../pages");
  app = express();
  app.engine("njk", (file, _options, callback) => callback(null, path.relative(pages, file)));
  app.set("view engine", "njk");
  app.set("views", pages);
  // The session `requireAuth` guarantees, and the gate `app.ts` mounts in front of the area (pinned in `app.test.ts`).
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { session: unknown }).session = { deedPoll: { accessToken: CALLER.accessToken } };
    next();
  });
  app.use(await createSimpleRouter({ path: path.join(pages, "deed-polls/management-information"), prefix: AREA }));
});

afterEach(() => {
  vi.useRealTimers();
});

function lines(text: string): string[] {
  return text.replace(BOM, "").split("\r\n").slice(0, -1);
}

describe("management information downloads", () => {
  it("should answer volume as a UTF-8 CSV attachment, named for the KPI and its range, with a byte order mark", async () => {
    const response = await supertest(app).get(`${AREA}/volume.csv?${RANGE}`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="deed-poll-mi-volume-2026-10-06-2026-11-04.csv"');
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.text.startsWith(BOM)).toBe(true);
    expect(findMiVolume).toHaveBeenCalledExactlyOnceWith({ from: "2026-10-06", to: "2026-11-04", granularity: "WEEK", includeMigrated: true }, CALLER);
    expect(findMiStageDurations).not.toHaveBeenCalled();
  });

  it("should hold the table's rows under a header row, with ISO dates and api's unformatted figures", async () => {
    const response = await supertest(app).get(`${AREA}/volume.csv?${RANGE}`);

    expect(lines(response.text)).toEqual([
      "Period start,Period end,Received,Adult,Adult transgender,Minor,Minor transgender,Deed of relinquishment,Unknown type,Open at end",
      "2026-10-05,2026-10-11,1234,1200,0,34,0,0,0,2048",
      "2026-10-12,2026-10-18,0,0,0,0,0,0,0,2048",
      "2026-10-19,2026-10-25,1,0,0,0,0,0,1,2049"
    ]);
  });

  it("should put every stage's rows in one file, each percentile beside its count, and leave an empty bucket's empty", async () => {
    const response = await supertest(app).get(`${AREA}/stage-durations.csv?${RANGE}`);
    const csv = lines(response.text);

    expect(csv[0]).toBe("Stage,Period start,Period end,Cases,Median days,95th percentile days");
    expect(csv).toHaveLength(1 + 5 * 3);
    expect(csv.slice(1, 4)).toEqual([
      "Received to ready for a Master,2026-10-05,2026-10-11,12,3.25,11",
      "Received to ready for a Master,2026-10-12,2026-10-18,0,,",
      "Received to ready for a Master,2026-10-19,2026-10-25,1,6,6"
    ]);
    expect(csv.at(-1)).toBe("Signature received to enrolled,2026-10-19,2026-10-25,1,6,6");
  });

  it("should answer referral outcomes with counts only", async () => {
    const response = await supertest(app).get(`${AREA}/referral-outcomes.csv?${RANGE}`);

    expect(lines(response.text).slice(0, 2)).toEqual([
      'Period start,Period end,Approved,"Approved, urgent",Rejected,"Rejected, urgent",Applicant confirmed,Applicant withdrew',
      "2026-10-05,2026-10-11,5,1,2,0,3,0"
    ]);
  });

  it("should answer completion with still open and the count timed before the percentiles, an empty cohort's empty", async () => {
    const response = await supertest(app).get(`${AREA}/completion.csv?${RANGE}`);

    expect(response.headers["content-disposition"]).toBe('attachment; filename="deed-poll-mi-completion-2026-10-06-2026-11-04.csv"');
    expect(lines(response.text)).toEqual([
      "Period start,Period end,Received,Completed,Enrolled,Returned,Still open,Cases timed,Median days,95th percentile days",
      "2026-10-05,2026-10-11,10,8,7,1,2,8,21.5,40",
      "2026-10-12,2026-10-18,0,0,0,0,0,0,,",
      "2026-10-19,2026-10-25,1,1,1,0,0,1,9,9"
    ]);
  });

  it("should resolve a preset to its range, as the page does, and name the file for it", async () => {
    const response = await supertest(app).get(`${AREA}/referral-outcomes.csv?period=7-days`);

    expect(findMiReferralOutcomes).toHaveBeenCalledWith({ from: "2026-10-29", to: "2026-11-04", granularity: "WEEK", includeMigrated: true }, CALLER);
    expect(response.headers["content-disposition"]).toBe('attachment; filename="deed-poll-mi-referral-outcomes-2026-10-29-2026-11-04.csv"');
  });

  it("should redraw the page's form with the error, and read nothing, when the filters are unusable", async () => {
    const response = await supertest(app).get(`${AREA}/volume.csv?period=custom&from=2026-10-02&to=2026-10-01`);

    expect(response.status).toBe(400);
    expect(response.text).toBe("deed-polls/management-information/index.njk");
    expect(findMiVolume).not.toHaveBeenCalled();
  });

  it("should redraw the page's form when api refuses the filters", async () => {
    const message = "The range cannot be longer than 2 years.";
    vi.mocked(findMiCompletion).mockRejectedValue(new InvalidInputError(message, [{ field: "to", message }]));

    const response = await supertest(app).get(`${AREA}/completion.csv?${RANGE}`);

    expect(response.status).toBe(400);
    expect(response.text).toBe("deed-polls/management-information/index.njk");
  });

  it("should not answer a partial file when api cannot be read", async () => {
    vi.mocked(findMiVolume).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

    const response = await supertest(app).get(`${AREA}/volume.csv?${RANGE}`);

    expect(response.status).toBe(500);
    expect(response.headers["content-disposition"]).toBeUndefined();
  });
});
