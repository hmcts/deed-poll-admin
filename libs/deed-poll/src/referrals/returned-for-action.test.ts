import { listCases } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { caseQueryWhere } from "../deed-poll/case-query.js";
import { countReturnedForAction, RETURNED_FOR_ACTION_CONDITIONS } from "./returned-for-action.js";

// The adapter is the seam, as everywhere in this layer. What is worth pinning here is not that api can count
// — `libs/deed-poll-api-client/src/mock/server.test.ts` drives seven cases through the mock's own referral
// transitions and asserts `where=currentReferralState:is:Decided` answers `total: 3` — but that the condition
// this app sends **reaches the wire at all**: `caseQueryWhere` keeps only the conditions it can resolve, so a
// field missing from `QUERYABLE_FIELDS` is dropped silently and the count comes back as the whole list's
// total. Hence the assertions on `where` rather than only on the number.
vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  listCases: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };

/** api's success envelope, as the adapter hands it over. */
const ok = <T>(data: T) => ({ ok: true as const, data });

/** One page of api's answer, with only the count the caller reads varying. */
const page = (total: number) => ok({ filter: "all", cases: [], page: 1, size: 1, total, totalPages: total });

describe("referrals/returned-for-action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("RETURNED_FOR_ACTION_CONDITIONS", () => {
    it("should serialise onto the wire rather than being dropped, because an unqueryable field is silently lost", () => {
      const where = caseQueryWhere([...RETURNED_FOR_ACTION_CONDITIONS]);

      expect(where).toEqual(["currentReferralState:is:Decided"]);
    });

    it("should name Decided and nothing else, since that is the one state a caseworker has still to close", () => {
      expect([...RETURNED_FOR_ACTION_CONDITIONS]).toEqual([{ field: "currentReferralState", operator: "is", values: ["Decided"] }]);
    });

    it("should be frozen, so a caller cannot narrow the count and every link to the worklist with it", () => {
      expect(Object.isFrozen(RETURNED_FOR_ACTION_CONDITIONS)).toBe(true);
      expect(Object.isFrozen(RETURNED_FOR_ACTION_CONDITIONS[0])).toBe(true);
    });
  });

  describe("countReturnedForAction", () => {
    it("should return api's total for the fixed filter when cases are waiting", async () => {
      vi.mocked(listCases).mockResolvedValue(page(3) as never);

      const count = await countReturnedForAction(CALLER);

      expect(count).toBe(3);
    });

    it("should return zero when no case has a returned direction", async () => {
      vi.mocked(listCases).mockResolvedValue(page(0) as never);

      expect(await countReturnedForAction(CALLER)).toBe(0);
    });

    it("should ask for the decided cases with the smallest page, because the dashboard needs the number not the rows", async () => {
      vi.mocked(listCases).mockResolvedValue(page(7) as never);

      await countReturnedForAction(CALLER);

      expect(listCases).toHaveBeenCalledWith(
        expect.objectContaining({ where: ["currentReferralState:is:Decided"], size: 1 }),
        expect.objectContaining({ baseUrl: "http://api.test" })
      );
    });

    it("should send no filter, search term or sort, so the count is a fact about the service and not about a tab", async () => {
      vi.mocked(listCases).mockResolvedValue(page(2) as never);

      await countReturnedForAction(CALLER);

      expect(listCases).toHaveBeenCalledWith(
        { filter: undefined, q: undefined, where: ["currentReferralState:is:Decided"], sort: undefined, page: undefined, size: 1 },
        expect.anything()
      );
    });

    it("should read api's own total rather than counting the rows it was given", async () => {
      // One row comes back because `size: 1` asked for one; the total is the answer.
      vi.mocked(listCases).mockResolvedValue(ok({ filter: "all", cases: [{ id: "case-1" }], page: 1, size: 1, total: 41, totalPages: 41 }) as never);

      expect(await countReturnedForAction(CALLER)).toBe(41);
    });
  });
});
