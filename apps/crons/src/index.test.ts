import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPropertiesVolumeSecrets = vi.fn();
const mockConfigGet = vi.fn();

vi.mock("@hmcts-cft/cloud-native-platform", () => ({
  getPropertiesVolumeSecrets: mockGetPropertiesVolumeSecrets
}));

vi.mock("config", () => ({
  default: {
    get: mockConfigGet
  }
}));

describe("index - cron job runner", () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should configure properties volume with correct chart path", async () => {
    process.env.SCRIPT_NAME = "example";

    // Import the example module and spy on its default export
    const exampleModule = await import("./example.js");
    vi.spyOn(exampleModule, "default");

    const { main } = await import("./index.js");
    await main();

    expect(mockGetPropertiesVolumeSecrets).toHaveBeenCalledWith(
      expect.objectContaining({
        chartPath: expect.stringContaining("helm/values.yaml")
      })
    );
  });

  it("should throw error when SCRIPT_NAME is not set", async () => {
    delete process.env.SCRIPT_NAME;

    const { main } = await import("./index.js");

    await expect(main()).rejects.toThrow("SCRIPT_NAME environment variable is required");
  });

  it("should execute custom script when SCRIPT_NAME is provided", async () => {
    process.env.SCRIPT_NAME = "example";

    // Import the example module and spy on its default export
    const exampleModule = await import("./example.js");
    const mockCustomScript = vi.spyOn(exampleModule, "default");

    const { main } = await import("./index.js");
    await main();

    expect(mockCustomScript).toHaveBeenCalled();
  });

  it("should throw error when script does not export a default function", async () => {
    process.env.SCRIPT_NAME = "non-existent-script";

    const { main } = await import("./index.js");

    await expect(main()).rejects.toThrow();
  });

  it("should throw error when script execution fails", async () => {
    process.env.SCRIPT_NAME = "example";
    const mockError = new Error("Script execution failed");

    // Import the example module and spy on its default export, making it fail
    const exampleModule = await import("./example.js");
    vi.spyOn(exampleModule, "default").mockRejectedValue(mockError);

    const { main } = await import("./index.js");

    await expect(main()).rejects.toThrow("Script execution failed");
  });

  it("should throw error when getPropertiesVolumeSecrets fails", async () => {
    process.env.SCRIPT_NAME = "example";
    const mockError = new Error("Config failed");
    mockGetPropertiesVolumeSecrets.mockRejectedValue(mockError);

    const { main } = await import("./index.js");

    await expect(main()).rejects.toThrow("Config failed");
  });
});
