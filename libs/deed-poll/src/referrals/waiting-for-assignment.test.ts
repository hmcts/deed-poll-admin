import { listCases } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { caseQueryWhere } from "../deed-poll/case-query.js";
import { countWaitingForAssignment, waitingForAssignmentConditions } from "./waiting-for-assignment.js";

vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  listCases: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };

const page = (total: number) => ({ ok: true as const, data: { filter: "all", cases: [], page: 1, size: 1, total, totalPages: total } });

describe("referrals/waiting-for-assignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("waitingForAssignmentConditions", () => {
    it("should serialise onto the wire as the Open referral state, because an unqueryable field is silently dropped", () => {
      expect(caseQueryWhere(waitingForAssignmentConditions())).toEqual(["currentReferralState:is:Open"]);
    });

    it("should hand every caller its own copy, so mutating one cannot narrow the count or the worklist link", () => {
      const mine = waitingForAssignmentConditions();
      mine[0].values.push("Claimed");

      expect(waitingForAssignmentConditions()).toEqual([{ field: "currentReferralState", operator: "is", values: ["Open"] }]);
    });
  });

  describe("countWaitingForAssignment", () => {
    it("should ask for the Open cases with the smallest page and no filter, term or sort", async () => {
      vi.mocked(listCases).mockResolvedValue(page(2) as never);

      await countWaitingForAssignment(CALLER);

      expect(listCases).toHaveBeenCalledWith(
        { filter: undefined, q: undefined, where: ["currentReferralState:is:Open"], sort: undefined, page: undefined, size: 1 },
        expect.objectContaining({ baseUrl: "http://api.test" })
      );
    });

    it("should return api's total rather than counting the rows it was given", async () => {
      vi.mocked(listCases).mockResolvedValue({
        ok: true,
        data: { filter: "all", cases: [{ id: "case-1" }], page: 1, size: 1, total: 9, totalPages: 9 }
      } as never);

      expect(await countWaitingForAssignment(CALLER)).toBe(9);
    });
  });
});
