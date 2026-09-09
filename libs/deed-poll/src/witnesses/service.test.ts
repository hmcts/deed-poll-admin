import { getCase } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../errors.js";
import { findWitness, findWitnesses } from "./service.js";

// Only `getCase` is replaced, because that is the only call witnesses make: api publishes no witness
// endpoint, so they arrive inside the case. What these tests pin is that the scoping survived losing the
// `{ id, deedPollId }` where clause — a witness of another case is simply not in this case's list.
vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  getCase: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };

const ok = <T>(data: T) => ({ ok: true as const, data });

const caseWith = (witnesses: { id: string; witnessName?: string }[]) => ok({ id: "case-1", notes: [], witnesses, documents: [] });

describe("witnesses/service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("findWitnesses", () => {
    it("should return the witnesses api sent inside the case", async () => {
      vi.mocked(getCase).mockResolvedValue(caseWith([{ id: "witness-1", witnessName: "A Neighbour" }]) as never);

      const witnesses = await findWitnesses("case-1", CALLER);

      expect(witnesses).toEqual([{ id: "witness-1", witnessName: "A Neighbour" }]);
      expect(getCase).toHaveBeenCalledWith("case-1", expect.objectContaining({ baseUrl: "http://api.test" }));
    });

    it("should answer an empty list for a real case with no witnesses", async () => {
      vi.mocked(getCase).mockResolvedValue(caseWith([]) as never);

      expect(await findWitnesses("case-1", CALLER)).toEqual([]);
    });

    it("should throw NotFoundError for a case that does not exist, rather than an empty list", async () => {
      vi.mocked(getCase).mockResolvedValue({ ok: false, error: { kind: "not-found", status: 404, message: "DeedPoll nope not found" } } as never);

      await expect(findWitnesses("nope", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("findWitness", () => {
    it("should return the witness with the matching id", async () => {
      vi.mocked(getCase).mockResolvedValue(caseWith([{ id: "witness-1" }, { id: "witness-2" }]) as never);

      expect(await findWitness("case-1", "witness-2", CALLER)).toEqual({ id: "witness-2" });
    });

    it("should throw NotFoundError for a witness that belongs to a different case", async () => {
      // The cross-case guarantee, and it needs no `where` clause now: this case's own list is the only
      // place looked, so another case's witness is unreachable through this URL by construction.
      vi.mocked(getCase).mockResolvedValue(caseWith([{ id: "witness-1" }]) as never);

      await expect(findWitness("case-1", "witness-of-another-case", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
