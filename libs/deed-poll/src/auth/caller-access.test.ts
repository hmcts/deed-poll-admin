import { getCallerAccess } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "../errors.js";
import { findCallerAccess } from "./caller-access.js";
import { ACCESS_GAZETTE, OVERRIDE_PRIVACY } from "./capabilities.js";

vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  getCallerAccess: vi.fn()
}));

const CALLER = { accessToken: "a-fresh-token" };

describe("auth/caller-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("findCallerAccess", () => {
    it("should ask api with the caller's token and return its answer", async () => {
      vi.mocked(getCallerAccess).mockResolvedValue({
        ok: true,
        data: { staff: true, judicial: false, capabilities: [OVERRIDE_PRIVACY, ACCESS_GAZETTE] }
      });

      const access = await findCallerAccess(CALLER);

      expect(access).toEqual({ staff: true, judicial: false, capabilities: [OVERRIDE_PRIVACY, ACCESS_GAZETTE] });
      expect(getCallerAccess).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "a-fresh-token" }));
    });

    it("should throw the domain error when api refuses the token", async () => {
      vi.mocked(getCallerAccess).mockResolvedValue({ ok: false, error: { kind: "unauthorized", status: 401, message: "Authentication required" } });

      await expect(findCallerAccess(CALLER)).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });
});
