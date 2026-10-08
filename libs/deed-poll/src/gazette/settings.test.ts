import { getGazetteSettings, updateGazetteSettings } from "@hmcts/deed-poll-api-client";
import { beforeEach, expect, it, vi } from "vitest";
import { ConflictError, ForbiddenError } from "../errors.js";
import { gazetteSettingsFormSchema } from "./schemas.js";
import { findGazetteSettings, saveGazetteSettings } from "./service.js";

vi.mock("@hmcts/deed-poll-api-client", async (original) => ({
  ...(await original<typeof import("@hmcts/deed-poll-api-client")>()),
  getGazetteSettings: vi.fn(),
  updateGazetteSettings: vi.fn()
}));
const CALLER = { accessToken: "admin-token" };
const SETTINGS = { recipientEmail: "lg@example.com", revision: 1 };
beforeEach(() => {
  vi.clearAllMocks();
});

it("should forward only settings and the verified caller token", async () => {
  vi.mocked(getGazetteSettings).mockResolvedValue({ ok: true, data: SETTINGS });
  vi.mocked(updateGazetteSettings).mockResolvedValue({ ok: true, data: SETTINGS });
  expect(await findGazetteSettings(CALLER)).toBe(SETTINGS);
  expect(await saveGazetteSettings({ recipientEmail: "lg@example.com", revision: 0 }, CALLER)).toBe(SETTINGS);
  expect(updateGazetteSettings).toHaveBeenCalledWith({ recipientEmail: "lg@example.com", revision: 0 }, expect.objectContaining(CALLER));
});

it("should preserve the API's authorization and conflict failures", async () => {
  vi.mocked(getGazetteSettings).mockResolvedValue({ ok: false, error: { kind: "forbidden", status: 403, message: "Forbidden" } });
  vi.mocked(updateGazetteSettings).mockResolvedValue({ ok: false, error: { kind: "conflict", status: 409, message: "Changed" } });
  await expect(findGazetteSettings(CALLER)).rejects.toBeInstanceOf(ForbiddenError);
  await expect(saveGazetteSettings(SETTINGS, CALLER)).rejects.toBeInstanceOf(ConflictError);
});

it.each([undefined, "", "-1", "1.5", "0x10", "2147483648", ["0"]])("should refuse invalid form revision %j", (revision) => {
  const schema = gazetteSettingsFormSchema({ required: "required", invalid: "invalid", reload: "reload" });
  expect(schema.safeParse({ recipientEmail: "lg@example.com", revision }).success).toBe(false);
});
