import { requestDocumentDeletion as apiRequestDocumentDeletion, getDocumentDeletion } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeletionOutcomeUnknownError } from "../../deletion/errors.js";
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError, UnauthorizedError } from "../../errors.js";
import { DocumentDeletionOutcomeUnknownError } from "./errors.js";
import { findDocumentDeletion, requestDocumentDeletion } from "./service.js";

vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  getDocumentDeletion: vi.fn(),
  requestDocumentDeletion: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };
const KEY = "6f1c2c1e-0d7a-4b8e-9a43-0c1a3b5d7e9f";
const REQUEST_ID = "2a0b6d58-4d6e-4c55-8f0e-7d4a9c3b1e2f";
const BODY = { reason: "Uploaded in error", expectedDocumentVersion: 3 };
const ok = <T>(data: T) => ({ ok: true as const, data });
const failure = (kind: string, status?: number, extra: Record<string, unknown> = {}) => ({
  ok: false as const,
  error: { kind, status, message: "api's words", ...extra }
});

describe("documents/deletion/service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("requestDocumentDeletion", () => {
    it("should forward the case, the document, the exact body, the caller's key and token, and nothing else", async () => {
      // Arrange
      vi.mocked(apiRequestDocumentDeletion).mockResolvedValue(ok({ requestId: REQUEST_ID, status: "Completed" }) as never);

      // Act
      const admission = await requestDocumentDeletion("case-1", "doc-9", { ...BODY, requestedBy: "Someone", note: "x" } as typeof BODY, KEY, CALLER);

      // Assert
      expect(admission).toEqual({ requestId: REQUEST_ID, status: "Completed" });
      expect(apiRequestDocumentDeletion).toHaveBeenCalledWith("case-1", "doc-9", BODY, KEY, expect.objectContaining({ accessToken: CALLER.accessToken }));
      const config = vi.mocked(apiRequestDocumentDeletion).mock.calls[0][4];
      expect(Object.keys(config).sort()).toEqual(["accessToken", "baseUrl", "timeoutMs"]);
    });

    it("should hand back an InProgress or NeedsAttention admission as data, not as a failure", async () => {
      vi.mocked(apiRequestDocumentDeletion).mockResolvedValue(ok({ requestId: REQUEST_ID, status: "NeedsAttention" }) as never);

      await expect(requestDocumentDeletion("case-1", "doc-9", BODY, KEY, CALLER)).resolves.toEqual({ requestId: REQUEST_ID, status: "NeedsAttention" });
    });

    it("should send an exact replay as the same call, so api answers it with the same request", async () => {
      vi.mocked(apiRequestDocumentDeletion).mockResolvedValue(ok({ requestId: REQUEST_ID, status: "Completed" }) as never);

      const first = await requestDocumentDeletion("case-1", "doc-9", BODY, KEY, CALLER);
      const repeat = await requestDocumentDeletion("case-1", "doc-9", BODY, KEY, CALLER);

      expect(repeat).toEqual(first);
      expect(vi.mocked(apiRequestDocumentDeletion).mock.calls[1]).toEqual(vi.mocked(apiRequestDocumentDeletion).mock.calls[0]);
    });

    it.each([
      ["unavailable", 503],
      ["unavailable", undefined],
      ["timeout", undefined],
      ["invalid-response", 202],
      ["unknown", 418],
      ["rate-limited", 429]
    ])("should treat %s (%s) as an unknown document outcome carrying none of api's words", async (kind, status) => {
      vi.mocked(apiRequestDocumentDeletion).mockResolvedValue(failure(kind, status) as never);

      const error = await requestDocumentDeletion("case-1", "doc-9", BODY, KEY, CALLER).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DocumentDeletionOutcomeUnknownError);
      expect(error).not.toBeInstanceOf(DeletionOutcomeUnknownError);
      expect((error as Error).message).not.toContain("api's words");
    });

    it.each(["DOCUMENT_IN_USE", "DOCUMENT_CHANGED", "DOCUMENT_STORAGE_UNRESOLVED", "DOCUMENT_SHARED", "APPLICATION_DELETION_PENDING", "KEY_REUSED"])(
      "should keep a 409's %s code, so the page picks its sentence by code",
      async (code) => {
        vi.mocked(apiRequestDocumentDeletion).mockResolvedValue(failure("conflict", 409, { code }) as never);

        const error = await requestDocumentDeletion("case-1", "doc-9", BODY, KEY, CALLER).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictError);
        expect((error as ConflictError).code).toBe(code);
      }
    );

    it.each([
      ["validation", 400, InvalidInputError],
      ["unauthorized", 401, UnauthorizedError],
      ["forbidden", 403, ForbiddenError],
      ["not-found", 404, NotFoundError]
    ])("should map a definite %s answer, a judge's or a lost access's included, to its domain error", async (kind, status, type) => {
      vi.mocked(apiRequestDocumentDeletion).mockResolvedValue(failure(kind, status) as never);

      await expect(requestDocumentDeletion("case-1", "doc-9", BODY, KEY, CALLER)).rejects.toBeInstanceOf(type);
    });

    it("should carry api's field errors on a 400", async () => {
      vi.mocked(apiRequestDocumentDeletion).mockResolvedValue(
        failure("validation", 400, { fieldErrors: [{ field: "reason", message: "Enter why" }] }) as never
      );

      const error = (await requestDocumentDeletion("case-1", "doc-9", BODY, KEY, CALLER).catch((caught: unknown) => caught)) as InvalidInputError;

      expect(error.errors).toEqual([{ field: "reason", message: "Enter why" }]);
    });
  });

  describe("findDocumentDeletion", () => {
    it("should read only the request, under its case", async () => {
      const status = { requestId: REQUEST_ID, documentId: "doc-9", status: "Completed", requestedAt: new Date(), completedAt: new Date() };
      vi.mocked(getDocumentDeletion).mockResolvedValue(ok(status) as never);

      await expect(findDocumentDeletion("case-1", REQUEST_ID, CALLER)).resolves.toEqual(status);
      expect(getDocumentDeletion).toHaveBeenCalledWith("case-1", REQUEST_ID, expect.objectContaining({ accessToken: CALLER.accessToken }));
    });

    it("should fail an unreachable api as an ordinary read failure, not an unknown deletion outcome", async () => {
      vi.mocked(getDocumentDeletion).mockResolvedValue(failure("unavailable", 503) as never);

      const error = await findDocumentDeletion("case-1", REQUEST_ID, CALLER).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(DocumentDeletionOutcomeUnknownError);
    });

    it("should read an unknown, other-case or no-longer-visible request as not found", async () => {
      vi.mocked(getDocumentDeletion).mockResolvedValue(failure("not-found", 404) as never);

      await expect(findDocumentDeletion("case-2", REQUEST_ID, CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
