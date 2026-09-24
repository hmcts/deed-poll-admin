import { listCases } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_RECORDED } from "../deed-poll/case-header.js";
import { awaitingConfirmationRequestedOn, countAwaitingConfirmation } from "./awaiting-confirmation.js";

// The adapter is the seam, as `.claude/rules/testing.md` says: `countAwaitingConfirmation` goes through
// `findDeedPolls`, and what is worth pinning is the query that reaches the wire — the filter key, and the
// absence of a sort.
vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  listCases: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };

/** api's list envelope. `total` is deliberately unrelated to the rows, which is the whole point of the count. */
const page = (total: number, cases: unknown[] = []) => ({
  ok: true as const,
  data: { filter: "awaitingConfirmation", cases, page: 1, size: 1, total, totalPages: total }
});

describe("referrals/awaiting-confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
    vi.mocked(listCases).mockResolvedValue(page(0) as never);
  });

  describe("countAwaitingConfirmation", () => {
    it("asks api for its own awaitingConfirmation filter rather than recreating the predicate", async () => {
      await countAwaitingConfirmation(CALLER);

      expect(listCases).toHaveBeenCalledWith(expect.objectContaining({ filter: "awaitingConfirmation" }), expect.anything());
    });

    it("sends no sort, so api's own longest-waiting default for the tab is what orders the worklist", async () => {
      await countAwaitingConfirmation(CALLER);

      // The tab's default is only a default: an order sent here would override it.
      expect(listCases).toHaveBeenCalledWith(expect.objectContaining({ sort: undefined }), expect.anything());
    });

    it("asks for one row, because the dashboard needs the number and the rows are the worklist", async () => {
      await countAwaitingConfirmation(CALLER);

      expect(listCases).toHaveBeenCalledWith(expect.objectContaining({ size: 1 }), expect.anything());
    });

    it("narrows by nothing else, since the count is a fact about the service and not about a tab", async () => {
      await countAwaitingConfirmation(CALLER);

      const [query] = vi.mocked(listCases).mock.calls[0];
      expect(query.q).toBeUndefined();
      expect(query.where).toEqual([]);
      expect(query.page).toBeUndefined();
    });

    it("answers with api's total across every page, never the number of rows it was sent", async () => {
      vi.mocked(listCases).mockResolvedValue(page(31, [{ id: "case-1" }]) as never);

      expect(await countAwaitingConfirmation(CALLER)).toBe(31);
    });

    it("presents the caseworker's own token, so api authenticates and audits as them", async () => {
      await countAwaitingConfirmation({ accessToken: "somebody-else" });

      expect(listCases).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accessToken: "somebody-else" }));
    });

    it("throws the classified failure rather than answering zero, so the page can say the count is unknown", async () => {
      vi.mocked(listCases).mockResolvedValue({ ok: false, error: { kind: "unavailable", status: 0, message: "api is down" } } as never);

      await expect(countAwaitingConfirmation(CALLER)).rejects.toThrow();
    });
  });

  describe("awaitingConfirmationRequestedOn", () => {
    it("formats the date api published, so the case page can say when the applicant was asked", () => {
      const requested = awaitingConfirmationRequestedOn({ awaitingConfirmationSince: new Date("2026-05-12T08:44:00.000Z") });

      expect(requested).toBe("12 May 2026 at 9:44am");
    });

    it("answers null for a case waiting for nothing, so the page says nothing at all", () => {
      // Which is nearly every case: a row reading "not applicable" would answer a question nobody put.
      expect(awaitingConfirmationRequestedOn({ awaitingConfirmationSince: null })).toBeNull();
      expect(awaitingConfirmationRequestedOn({})).toBeNull();
    });

    it("does not derive the wait from anything but api's own column", () => {
      // `notify-3b` decision 2: never inferred from a referral or from correspondence history. A case carrying
      // a referral and no `awaitingConfirmationSince` is not waiting, whatever else is on it.
      const record = { awaitingConfirmationSince: null, currentReferralState: "Open" } as const;

      expect(awaitingConfirmationRequestedOn(record)).toBeNull();
    });

    it("says the date was not recorded rather than throwing on an unparseable one", () => {
      expect(awaitingConfirmationRequestedOn({ awaitingConfirmationSince: new Date("nonsense") })).toBe(NOT_RECORDED);
    });
  });
});
