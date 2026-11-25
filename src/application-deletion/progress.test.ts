import { describe, expect, it } from "vitest";
import { deletionProgress } from "./progress.js";

const NOW = new Date("2026-11-25T12:00:00Z");

describe("deletionProgress", () => {
  it("should be restorable only strictly before the restore date", () => {
    expect(deletionProgress("Pending", new Date("2026-11-25T12:00:00.001Z"), NOW)).toBe("restorable");
    expect(deletionProgress("Pending", NOW, NOW)).toBe("awaitingRemoval");
    expect(deletionProgress("Pending", new Date("2026-11-01T00:00:00Z"), NOW)).toBe("awaitingRemoval");
  });

  it.each([
    ["InProgress", "inProgress"],
    ["AwaitingDisposal", "awaitingDisposal"],
    ["NeedsAttention", "needsAttention"],
    ["Completed", "completed"]
  ] as const)("should read %s by its status whatever the date", (status, progress) => {
    expect(deletionProgress(status, new Date("2027-01-01T00:00:00Z"), NOW)).toBe(progress);
  });
});
