import { getApplicationDeletion, requestApplicationDeletion, restoreApplicationDeletion } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError, UnauthorizedError } from "../errors.js";
import { DeletionOutcomeUnknownError } from "./errors.js";
import { findDeletion, requestDeletion, restoreDeletion } from "./service.js";

vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  getApplicationDeletion: vi.fn(),
  requestApplicationDeletion: vi.fn(),
  restoreApplicationDeletion: vi.fn()
}));

const CALLER = { accessToken: "delivery-manager-token" };
const KEY = "6f1c2c1e-0d7a-4b8e-9a43-0c1a3b5d7e9f";
const REQUEST_ID = "2a0b6d58-4d6e-4c55-8f0e-7d4a9c3b1e2f";
const BODY = { reason: "DUPLICATE" as const, note: "Duplicate of another application", expectedLastChangedOn: "2026-11-20T10:15:30.123" };
const ADMISSION = { requestId: REQUEST_ID, status: "Pending" as const, restorableUntil: new Date("2026-12-09T10:15:30Z") };
const ok = <T>(data: T) => ({ ok: true as const, data });
const failure = (kind: string, status?: number, extra: Record<string, unknown> = {}) => ({
  ok: false as const,
  error: { kind, status, message: "api's words", ...extra }
});

describe("deletion/service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("requestDeletion", () => {
    it("should forward the case, the exact body, the caller's key and token, and nothing else", async () => {
      // Arrange
      vi.mocked(requestApplicationDeletion).mockResolvedValue(ok(ADMISSION) as never);

      // Act
      const admission = await requestDeletion("case-1", { ...BODY, requestedBy: "Someone" } as typeof BODY, KEY, CALLER);

      // Assert
      expect(admission).toEqual(ADMISSION);
      expect(requestApplicationDeletion).toHaveBeenCalledWith("case-1", BODY, KEY, expect.objectContaining({ accessToken: CALLER.accessToken }));
      const config = vi.mocked(requestApplicationDeletion).mock.calls[0][3];
      expect(Object.keys(config).sort()).toEqual(["accessToken", "baseUrl", "timeoutMs"]);
    });

    it("should answer a repeat of the same key with api's same request after the application has gone", async () => {
      // Arrange: api replays the first admission whether or not the case still exists.
      vi.mocked(requestApplicationDeletion).mockResolvedValue(ok(ADMISSION) as never);

      // Act
      const first = await requestDeletion("case-1", BODY, KEY, CALLER);
      const repeat = await requestDeletion("case-1", BODY, KEY, CALLER);

      // Assert
      expect(repeat).toEqual(first);
      expect(vi.mocked(requestApplicationDeletion).mock.calls[1]).toEqual(vi.mocked(requestApplicationDeletion).mock.calls[0]);
    });

    it.each([
      ["unavailable", 503],
      ["unavailable", undefined],
      ["timeout", undefined],
      ["invalid-response", 202],
      ["unknown", 418],
      ["rate-limited", 429]
    ])("should treat %s (%s) as an unknown outcome carrying none of api's words", async (kind, status) => {
      vi.mocked(requestApplicationDeletion).mockResolvedValue(failure(kind, status) as never);

      const outcome = requestDeletion("case-1", BODY, KEY, CALLER);

      await expect(outcome).rejects.toBeInstanceOf(DeletionOutcomeUnknownError);
      await expect(outcome).rejects.not.toThrow("api's words");
    });

    it("should keep a 409's refusal code, so the page picks its sentence by code", async () => {
      vi.mocked(requestApplicationDeletion).mockResolvedValue(failure("conflict", 409, { code: "STALE_CONFIRMATION" }) as never);

      const error = await requestDeletion("case-1", BODY, KEY, CALLER).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).code).toBe("STALE_CONFIRMATION");
    });

    it.each([
      ["validation", 400, InvalidInputError],
      ["unauthorized", 401, UnauthorizedError],
      ["forbidden", 403, ForbiddenError],
      ["not-found", 404, NotFoundError]
    ])("should map a definite %s answer to its domain error", async (kind, status, type) => {
      vi.mocked(requestApplicationDeletion).mockResolvedValue(failure(kind, status, { fieldErrors: [{ field: "note", message: "Too short" }] }) as never);

      await expect(requestDeletion("case-1", BODY, KEY, CALLER)).rejects.toBeInstanceOf(type);
    });

    it("should carry api's field errors on a 400", async () => {
      vi.mocked(requestApplicationDeletion).mockResolvedValue(failure("validation", 400, { fieldErrors: [{ field: "reason", message: "Choose" }] }) as never);

      const error = (await requestDeletion("case-1", BODY, KEY, CALLER).catch((caught: unknown) => caught)) as InvalidInputError;

      expect(error.errors).toEqual([{ field: "reason", message: "Choose" }]);
    });
  });

  describe("findDeletion", () => {
    it("should read only the request, by its id", async () => {
      const status = {
        requestId: REQUEST_ID,
        caseId: "case-1",
        reason: "DUPLICATE",
        status: "Completed",
        requestedAt: new Date(),
        restorableUntil: new Date()
      };
      vi.mocked(getApplicationDeletion).mockResolvedValue(ok(status) as never);

      await expect(findDeletion(REQUEST_ID, CALLER)).resolves.toEqual(status);
      expect(getApplicationDeletion).toHaveBeenCalledWith(REQUEST_ID, expect.objectContaining({ accessToken: CALLER.accessToken }));
    });

    it("should fail an unreachable api as an ordinary read failure, not an unknown deletion outcome", async () => {
      vi.mocked(getApplicationDeletion).mockResolvedValue(failure("unavailable", 503) as never);

      const error = await findDeletion(REQUEST_ID, CALLER).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(DeletionOutcomeUnknownError);
    });
  });

  describe("restoreDeletion", () => {
    it("should send the request id and no body", async () => {
      vi.mocked(restoreApplicationDeletion).mockResolvedValue(ok({ caseId: "case-1", status: "Restored" }) as never);

      await expect(restoreDeletion(REQUEST_ID, CALLER)).resolves.toEqual({ caseId: "case-1", status: "Restored" });
      expect(restoreApplicationDeletion).toHaveBeenCalledWith(REQUEST_ID, expect.objectContaining({ accessToken: CALLER.accessToken }));
    });

    it("should read an already restored or unknown request as not found", async () => {
      vi.mocked(restoreApplicationDeletion).mockResolvedValue(failure("not-found", 404) as never);

      await expect(restoreDeletion(REQUEST_ID, CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("should keep a closed window's code", async () => {
      vi.mocked(restoreApplicationDeletion).mockResolvedValue(failure("conflict", 409, { code: "RESTORE_WINDOW_CLOSED" }) as never);

      const error = (await restoreDeletion(REQUEST_ID, CALLER).catch((caught: unknown) => caught)) as ConflictError;

      expect(error.code).toBe("RESTORE_WINDOW_CLOSED");
    });
  });
});
