import { getGazetteNoticeHistory, listCases } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, InvalidInputError, NotFoundError, UnauthorizedError } from "../errors.js";
import { countGazetteReadyCases, findGazetteHistory, findGazetteReadyCases } from "./service.js";

vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  listCases: vi.fn(),
  getGazetteNoticeHistory: vi.fn()
}));
const CALLER = { accessToken: "admin-token" };
const PAGE = { filter: "readyForPublication", cases: [], page: 2, size: 1, total: 42, totalPages: 42, exactMatchId: null };
const HISTORY = { batches: [], page: 3, size: 7, total: 42, totalPages: 6 };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEED_POLL_API_URL = "http://api.test";
});

it("should preserve the ready page and API order, sending only the published filter and paging", async () => {
  vi.mocked(listCases).mockResolvedValue({ ok: true, data: PAGE });
  const bookmarked = { page: 2, size: 1, sort: "dateReceived:desc", q: "ignored", where: ["state:is:Returned"] };

  expect(await findGazetteReadyCases(bookmarked, CALLER)).toBe(PAGE);
  expect(listCases).toHaveBeenCalledExactlyOnceWith(
    { filter: "readyForPublication", page: 2, size: 1 },
    expect.objectContaining({ accessToken: CALLER.accessToken, baseUrl: "http://api.test" })
  );
});

it("should count the whole ready list through a size-one read, not the returned rows", async () => {
  vi.mocked(listCases).mockResolvedValue({ ok: true, data: PAGE });

  expect(await countGazetteReadyCases(CALLER)).toBe(42);
  expect(listCases).toHaveBeenCalledExactlyOnceWith({ filter: "readyForPublication", page: undefined, size: 1 }, expect.anything());
});

it("should return history metadata unchanged with the caller's token", async () => {
  vi.mocked(getGazetteNoticeHistory).mockResolvedValue({ ok: true, data: HISTORY });

  expect(await findGazetteHistory({ page: 3, size: 7 }, CALLER)).toBe(HISTORY);
  expect(getGazetteNoticeHistory).toHaveBeenCalledExactlyOnceWith({ page: 3, size: 7 }, expect.objectContaining({ accessToken: CALLER.accessToken }));
  expect(listCases).not.toHaveBeenCalled();
});

it("should leave both reads' paging defaults to API", async () => {
  vi.mocked(listCases).mockResolvedValue({ ok: true, data: PAGE });
  vi.mocked(getGazetteNoticeHistory).mockResolvedValue({ ok: true, data: HISTORY });

  await findGazetteReadyCases({}, CALLER);
  await findGazetteHistory({}, CALLER);

  expect(listCases).toHaveBeenCalledWith({ filter: "readyForPublication", page: undefined, size: undefined }, expect.anything());
  expect(getGazetteNoticeHistory).toHaveBeenCalledWith({ page: undefined, size: undefined }, expect.anything());
});

describe.each([
  ["ready", listCases, findGazetteReadyCases],
  ["history", getGazetteNoticeHistory, findGazetteHistory]
] as const)("%s error translation", (_name, adapter, read) => {
  it.each([
    ["forbidden", 403, ForbiddenError],
    ["unauthorized", 401, UnauthorizedError],
    ["not-found", 404, NotFoundError],
    ["validation", 400, InvalidInputError],
    ["unavailable", 503, Error],
    ["timeout", undefined, Error],
    ["invalid-response", 200, Error]
  ] as const)("should translate %s into the normal domain error", async (kind, status, ErrorClass) => {
    vi.mocked(adapter).mockResolvedValue({ ok: false, error: { kind, status, message: "Refused", fieldErrors: [{ field: "page", message: "Invalid page" }] } });

    await expect(read({}, CALLER)).rejects.toBeInstanceOf(ErrorClass);
  });
});

it("should preserve historical batches and their full counts while dropping unsupported query fields", async () => {
  const history = {
    ...HISTORY,
    batches: [
      { sentAt: new Date("2026-01-02T09:30:00Z"), sentBy: "<b>sender</b>", caseCount: 101, referenceNumbers: ["<i>reference</i>"], referencesTruncated: true }
    ]
  };
  vi.mocked(getGazetteNoticeHistory).mockResolvedValue({ ok: true, data: history });
  const query = { page: 3, size: 7, sort: "sentAt:asc", q: "sender" };

  expect(await findGazetteHistory(query, CALLER)).toBe(history);
  expect(getGazetteNoticeHistory).toHaveBeenCalledExactlyOnceWith({ page: 3, size: 7 }, expect.objectContaining({ accessToken: CALLER.accessToken }));
});
