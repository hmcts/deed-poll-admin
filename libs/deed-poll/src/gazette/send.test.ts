import { previewGazetteNotice, submitGazetteNotice } from "@hmcts/deed-poll-api-client";
import { beforeEach, expect, it, vi } from "vitest";
import { ForbiddenError, UnauthorizedError } from "../errors.js";
import { GazetteOutcomeUnknownError, GazetteRefusalError } from "./errors.js";
import { previewGazetteSelection, sendGazetteSelection } from "./service.js";

vi.mock("@hmcts/deed-poll-api-client", async (original) => ({
  ...(await original<typeof import("@hmcts/deed-poll-api-client")>()),
  previewGazetteNotice: vi.fn(),
  submitGazetteNotice: vi.fn()
}));
const input = { caseIds: ["case-1"], recipientRevision: 2, selectionFingerprint: "opaque" };
const caller = { accessToken: "admin-token" };
beforeEach(() => vi.clearAllMocks());

it("should forward the original payload and key without asserting attribution or regenerating either", async () => {
  const status = { batchId: "00000000-0000-4000-8000-000000000001", state: "Uncertain" as const, caseCount: 1 };
  vi.mocked(submitGazetteNotice).mockResolvedValue({ ok: true, data: status });
  expect(await sendGazetteSelection(input, "original-key", caller)).toBe(status);
  expect(submitGazetteNotice).toHaveBeenCalledExactlyOnceWith(input, "original-key", expect.objectContaining(caller));
});

it("should preserve structured refusals without exposing API diagnostics", async () => {
  const refusal = { kind: "gazette-refusal" as const, code: "SELECTION_CHANGED" as const, conflicts: [] };
  vi.mocked(previewGazetteNotice).mockResolvedValue({ ok: false, error: refusal });
  await expect(previewGazetteSelection(["case-1"], caller)).rejects.toMatchObject({ refusal });
  await expect(previewGazetteSelection(["case-1"], caller)).rejects.toBeInstanceOf(GazetteRefusalError);
});

it.each(["unavailable", "timeout", "invalid-response", "conflict", "validation", "unknown"] as const)(
  "should treat generic %s as an unknown outcome",
  async (kind) => {
    vi.mocked(submitGazetteNotice).mockResolvedValue({ ok: false, error: { kind, message: "private diagnostic" } });
    await expect(sendGazetteSelection(input, "key", caller)).rejects.toBeInstanceOf(GazetteOutcomeUnknownError);
    await expect(sendGazetteSelection(input, "key", caller)).rejects.not.toThrow("private diagnostic");
  }
);

it("should treat a rate-limited send as an unknown outcome, because only a Gazette refusal proves non-admission", async () => {
  vi.mocked(submitGazetteNotice).mockResolvedValue({
    ok: false,
    error: { kind: "rate-limited", status: 429, message: "private diagnostic", retryAfterSeconds: 60 }
  });
  await expect(sendGazetteSelection(input, "key", caller)).rejects.toBeInstanceOf(GazetteOutcomeUnknownError);
  vi.mocked(previewGazetteNotice).mockResolvedValue({
    ok: false,
    error: { kind: "rate-limited", status: 429, message: "private diagnostic", retryAfterSeconds: 60 }
  });
  await expect(previewGazetteSelection(["case-1"], caller)).rejects.toBeInstanceOf(GazetteOutcomeUnknownError);
});

it.each([
  ["unauthorized", UnauthorizedError],
  ["forbidden", ForbiddenError]
] as const)("should retain %s handling", async (kind, ErrorType) => {
  vi.mocked(submitGazetteNotice).mockResolvedValue({ ok: false, error: { kind, message: "private diagnostic" } });
  await expect(sendGazetteSelection(input, "key", caller)).rejects.toBeInstanceOf(ErrorType);
});
