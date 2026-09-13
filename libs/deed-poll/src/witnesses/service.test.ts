import { createWitness as apiCreateWitness, updateWitness as apiUpdateWitness, getCase } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../errors.js";
import { createWitness, findWitness, findWitnesses, updateWitness } from "./service.js";

// `getCase` is the read seam, because the reads take witnesses off the case rather than calling api's
// witness GETs: one case call already carries them. What that pins is that the scoping survived losing the
// `{ id, deedPollId }` where clause — a witness of another case is simply not in this case's list. The
// writes have their own operations, so they are stubbed alongside it.
vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  getCase: vi.fn(),
  createWitness: vi.fn(),
  updateWitness: vi.fn()
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

  describe("createWitness", () => {
    it("should forward the DTO unchanged, with the caller's token and no author", async () => {
      const dto = { witnessName: "A Neighbour", witnessAddress: "1 Test Street", witnessOccupation: "Teacher", declarant: false };
      vi.mocked(apiCreateWitness).mockResolvedValue(ok({ id: "witness-1", ...dto }) as never);

      const created = await createWitness("case-1", dto, CALLER);

      expect(created).toEqual({ id: "witness-1", ...dto });
      expect(apiCreateWitness).toHaveBeenCalledWith("case-1", dto, expect.objectContaining({ accessToken: "caseworker-token", baseUrl: "http://api.test" }));
    });

    it("should throw NotFoundError when the case does not exist", async () => {
      vi.mocked(apiCreateWitness).mockResolvedValue({ ok: false, error: { kind: "not-found", status: 404, message: "DeedPoll nope not found" } } as never);

      const dto = { witnessName: "A Neighbour", witnessAddress: "1 Test Street", witnessOccupation: "Teacher", declarant: true };

      await expect(createWitness("nope", dto, CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("updateWitness", () => {
    it("should send only the fields the partial carries, so an omitted one stays as api stored it", async () => {
      vi.mocked(apiUpdateWitness).mockResolvedValue(ok({ id: "witness-1", witnessOccupation: "Retired" }) as never);

      await updateWitness("case-1", "witness-1", { witnessOccupation: "Retired" }, CALLER);

      expect(apiUpdateWitness).toHaveBeenCalledWith(
        "case-1",
        "witness-1",
        { witnessOccupation: "Retired" },
        expect.objectContaining({ accessToken: "caseworker-token" })
      );
    });

    it("should pass `declarant: false` through rather than dropping it as falsy", async () => {
      vi.mocked(apiUpdateWitness).mockResolvedValue(ok({ id: "witness-1", declarant: false }) as never);

      await updateWitness("case-1", "witness-1", { declarant: false }, CALLER);

      expect(apiUpdateWitness).toHaveBeenCalledWith("case-1", "witness-1", { declarant: false }, expect.anything());
    });

    it("should throw NotFoundError for a witness id that is not under this case, without a scoping pre-read", async () => {
      vi.mocked(apiUpdateWitness).mockResolvedValue({ ok: false, error: { kind: "not-found", status: 404, message: "Witness witness-9 not found" } } as never);

      await expect(updateWitness("case-1", "witness-9", { witnessName: "Someone" }, CALLER)).rejects.toBeInstanceOf(NotFoundError);
      expect(getCase).not.toHaveBeenCalled();
    });
  });
});
