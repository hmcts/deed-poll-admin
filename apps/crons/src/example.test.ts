import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleCronJob } from "./example.js";

describe("exampleCronJob", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("should be an async function", () => {
    expect(exampleCronJob).toBeInstanceOf(Function);
    expect(exampleCronJob.constructor.name).toBe("AsyncFunction");
  });

  it("should log execution message", async () => {
    await exampleCronJob();

    expect(consoleLogSpy).toHaveBeenCalledWith("Example cron job executed");
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
  });

  it("should complete without errors", async () => {
    await expect(exampleCronJob()).resolves.toBeUndefined();
  });

  it("should not throw errors", async () => {
    let error: unknown;
    try {
      await exampleCronJob();
    } catch (e) {
      error = e;
    }

    expect(error).toBeUndefined();
  });
});
