import { getPropertiesVolumeSecrets } from "@hmcts-cft/cloud-native-platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSecrets } from "./secrets.js";

// Set by the mock factory below, which vitest runs the first time anything imports `config`. Nothing in
// this file's import graph should — that is the assertion.
const configLoaded = vi.hoisted(() => ({ value: false }));

// `importOriginal` rather than a bare factory, so the real library — and everything it imports — is loaded
// before the assertion below reads `configLoaded`. A factory would replace the module wholesale, leaving the
// test blind to the one case it is written for: `config` arriving *through* this dependency rather than from
// `secrets.ts` itself. The library declares `config` as a peerDependency, so that case is live.
vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  getPropertiesVolumeSecrets: vi.fn(async () => ({}))
}));
vi.mock("config", () => {
  configLoaded.value = true;
  return { default: { get: vi.fn() } };
});

describe("loadSecrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The reason this module exists at all. `config` resolves `custom-environment-variables.json` when it is
   * first loaded and caches the result, so whichever module reaches it first decides what every later
   * `.get()` returns. If this module — which `server.ts` awaits *before* importing the app — ever pulls
   * `config` in, directly or through a new import, every vault secret is silently ignored in every
   * deployed environment.
   */
  it("should not pull config into its own import graph, since config caches the environment when it loads", async () => {
    await loadSecrets();

    expect(configLoaded.value).toBe(false);
  });

  // Asserted because dropping the name points a local run at the deployed database with no visible signal.
  it("should keep the local database URL when reading a real vault outside production", async () => {
    await loadSecrets();

    expect(vi.mocked(getPropertiesVolumeSecrets)).toHaveBeenCalledWith(expect.objectContaining({ omit: ["DATABASE_URL"] }));
  });

  // The chart is what names the vault and its secrets, so a wrong path loads nothing and fails only at the
  // first `config.get` of a secret.
  it("should read the vault names from this app's helm chart", async () => {
    await loadSecrets();

    expect(vi.mocked(getPropertiesVolumeSecrets).mock.calls[0][0]?.chartPath).toMatch(/apps\/api\/helm\/values\.yaml$/);
  });
});
