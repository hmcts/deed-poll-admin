import config from "config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { caseCreationEnabled } from "./case-creation.js";

vi.mock("config", () => ({ default: { get: vi.fn() } }));

describe("caseCreationEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should read caseCreation.enabled", () => {
    vi.mocked(config.get).mockReturnValue(true);

    expect(caseCreationEnabled()).toBe(true);
    expect(config.get).toHaveBeenCalledWith("caseCreation.enabled");
  });

  it("should be off when the setting is false, as the chart sets it in prod", () => {
    vi.mocked(config.get).mockReturnValue(false);

    expect(caseCreationEnabled()).toBe(false);
  });

  it.each(["false", "true", "", 1, null])("should be off for %j, a value that did not parse as a boolean", (value) => {
    vi.mocked(config.get).mockReturnValue(value);

    expect(caseCreationEnabled()).toBe(false);
  });
});
