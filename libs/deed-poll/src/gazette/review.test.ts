import { getCase } from "@hmcts/deed-poll-api-client";
import { beforeEach, expect, it, vi } from "vitest";
import { GAZETTE_CHECKS, gazetteChecklistComplete, gazetteReviewsCurrent, gazetteReviewVersion } from "./review.js";

vi.mock("@hmcts/deed-poll-api-client", async (original) => ({ ...(await original<typeof import("@hmcts/deed-poll-api-client")>()), getCase: vi.fn() }));
const record = { id: "case-1", oldForename: "Former", newForename: "New", notes: [{ id: "note-1", note: "reviewed" }], witnesses: [], documents: [] } as never;
beforeEach(() => vi.clearAllMocks());

it("should require every checklist item exactly once", () => {
  expect(gazetteChecklistComplete([...GAZETTE_CHECKS])).toBe(true);
  for (const omitted of GAZETTE_CHECKS) expect(gazetteChecklistComplete(GAZETTE_CHECKS.filter((key) => key !== omitted))).toBe(false);
  for (const invalid of [undefined, "signOff", ["signOff", "signOff", "signOff", "signOff", "signOff"], [...GAZETTE_CHECKS, "extra"]]) {
    expect(gazetteChecklistComplete(invalid)).toBe(false);
  }
});

it("should invalidate a review when a nested note changes, even when the case timestamp does not", async () => {
  const reviews = [{ id: "case-1", version: gazetteReviewVersion(record) }];
  vi.mocked(getCase).mockResolvedValue({ ok: true, data: record });
  expect(await gazetteReviewsCurrent(reviews, { accessToken: "admin-token" })).toBe(true);
  vi.mocked(getCase).mockResolvedValue({ ok: true, data: { ...(record as object), notes: [{ id: "note-1", note: "changed" }] } as never });
  expect(await gazetteReviewsCurrent(reviews, { accessToken: "admin-token" })).toBe(false);
  expect(getCase).toHaveBeenCalledWith("case-1", expect.objectContaining({ accessToken: "admin-token" }));
});

it("should fail closed when the reviewed application cannot be read", async () => {
  vi.mocked(getCase).mockResolvedValue({ ok: false, error: { kind: "unavailable", message: "Unavailable" } });
  await expect(gazetteReviewsCurrent([{ id: "case-1", version: gazetteReviewVersion(record) }], {})).rejects.toThrow();
});
