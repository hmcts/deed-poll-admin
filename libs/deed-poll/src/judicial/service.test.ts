import { claimJudicialReferral, directJudicialReferral, getCase, getJudicialPool, getJudicialReferral, listReferrals } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, InvalidInputError, NotFoundError } from "../errors.js";
import { claimReferral, getReferral, listPool, recordDirection } from "./service.js";

// The adapter is mocked and nothing else. What is worth pinning at this seam is that each function reaches the
// right judicial operation with no case id in sight, that the judge's token travels and no holder does, and that
// api's refusals arrive as the domain errors a page can render — the 404 that must read as "no longer available"
// and the two 409s that are states two judges can reach between them.
vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  getJudicialPool: vi.fn(),
  getJudicialReferral: vi.fn(),
  claimJudicialReferral: vi.fn(),
  directJudicialReferral: vi.fn(),
  listReferrals: vi.fn(),
  getCase: vi.fn()
}));

const CALLER = { accessToken: "judge-token" };

const DIRECTION = { decision: "Approved" as const, publishToGazette: true, directionsText: "Satisfied" };

const REFERRAL = {
  id: "ref-1",
  state: "Open",
  reasons: ["Minor"],
  application: { displayReference: "KBDP2026-00001", newForename: "Jo" },
  caseNotes: [{ note: "Chased the declarant" }]
};

const ok = <T>(data: T) => ({ ok: true as const, data });

const notFound = { ok: false as const, error: { kind: "not-found" as const, status: 404, message: "Referral ref-1 not found" } };

const conflict = (message: string) => ({ ok: false as const, error: { kind: "conflict" as const, status: 409, message } });

describe("judicial/service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("listPool", () => {
    it("should return api's page of the pool untouched, carrying the judge's token", async () => {
      const pool = {
        referrals: [
          { id: "urgent", urgency: "Urgent" },
          { id: "old-normal", urgency: "Normal" }
        ],
        page: 1,
        size: 10,
        total: 11,
        totalPages: 2
      };
      vi.mocked(getJudicialPool).mockResolvedValue(ok(pool) as never);

      expect(await listPool({ page: 1 }, CALLER)).toEqual(pool);
      expect(getJudicialPool).toHaveBeenCalledWith({ page: 1 }, expect.objectContaining({ baseUrl: "http://api.test", accessToken: "judge-token" }));
    });

    it("should pass the paging through as given, since the pool has no filter or sort to compose", async () => {
      vi.mocked(getJudicialPool).mockResolvedValue(ok({ referrals: [], page: 2, size: 10, total: 0, totalPages: 0 }) as never);

      await listPool({ page: 2, size: 10 }, CALLER);

      // Exactly the two keys api's query takes: a `where` or a `sort` smuggled in here would be this app
      // deciding the queue's order, which is api's (decision 3).
      expect(Object.keys(vi.mocked(getJudicialPool).mock.calls[0][0])).toEqual(["page", "size"]);
    });

    it("should not re-sort or re-order api's answer, because the pool's order is api's", async () => {
      // Newest first would be the case list's order and exactly the wrong one here: the point of the pool is
      // that the longest-waiting urgent referral is the next one to read.
      const referrals = [{ id: "urgent" }, { id: "old-normal" }, { id: "new-normal" }];
      vi.mocked(getJudicialPool).mockResolvedValue(ok({ referrals, page: 1, size: 10, total: 3, totalPages: 1 }) as never);

      const pool = await listPool({}, CALLER);

      expect(pool.referrals.map((referral) => referral.id)).toEqual(["urgent", "old-normal", "new-normal"]);
    });

    it("should throw a plain Error naming api when it cannot be reached, which is a fault and not a state", async () => {
      vi.mocked(getJudicialPool).mockResolvedValue({ ok: false, error: { kind: "unavailable", status: 0, message: "fetch failed" } } as never);

      await expect(listPool({}, CALLER)).rejects.toThrow("deed-poll-api call failed (unavailable): fetch failed");
    });
  });

  describe("getReferral", () => {
    it("should ask for the referral by id alone, with no case id anywhere in the call", async () => {
      vi.mocked(getJudicialReferral).mockResolvedValue(ok(REFERRAL) as never);

      expect(await getReferral("ref-1", CALLER)).toEqual(REFERRAL);
      expect(getJudicialReferral).toHaveBeenCalledWith("ref-1", expect.objectContaining({ accessToken: "judge-token" }));
      expect(vi.mocked(getJudicialReferral).mock.calls[0]).toHaveLength(2);
    });

    it("should return the narrow application view and the notes from the one call, reading no case", async () => {
      // `application` and `caseNotes` are on this payload, and there is no judicial route to read either from
      // separately: a second call would be both a wasted round trip and the disclosure boundary walked around.
      vi.mocked(getJudicialReferral).mockResolvedValue(ok(REFERRAL) as never);

      const referral = await getReferral("ref-1", CALLER);

      expect(referral.application).toEqual(REFERRAL.application);
      expect(referral.caseNotes).toEqual(REFERRAL.caseNotes);
      expect(getCase).not.toHaveBeenCalled();
      expect(listReferrals).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError for a referral this judge may not see, indistinguishably from one that never existed", async () => {
      // api's visibility is resolve-then-refuse: another judge's claim, a withdrawn or closed referral, and a
      // mistyped id are one status code, so this is the only thing the domain can know about any of them.
      vi.mocked(getJudicialReferral).mockResolvedValue(notFound as never);

      await expect(getReferral("ref-1", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("claimReferral", () => {
    it("should post to the claim sub-resource with no body and return the claimed referral", async () => {
      const claimed = { ...REFERRAL, state: "Claimed", claimedBy: "judge@example.com" };
      vi.mocked(claimJudicialReferral).mockResolvedValue(ok(claimed) as never);

      expect(await claimReferral("ref-1", CALLER)).toEqual(claimed);
      expect(claimJudicialReferral).toHaveBeenCalledWith("ref-1", expect.objectContaining({ accessToken: "judge-token" }));
      // No body: the holder comes from the token, so there is nothing for this app to send — and nothing it
      // could send to claim a referral for somebody else.
      expect(vi.mocked(claimJudicialReferral).mock.calls[0]).toHaveLength(2);
    });

    // Not "another judge got there first" — that is the 404 below. api checks visibility before state, so the
    // only referral a judge can see and cannot claim is one they already hold or have already decided.
    it("should throw ConflictError when the judge can see the referral but it is no longer Open", async () => {
      vi.mocked(claimJudicialReferral).mockResolvedValue(conflict("Referral ref-1 is Claimed and can only be claimed while it is Open") as never);

      await expect(claimReferral("ref-1", CALLER)).rejects.toBeInstanceOf(ConflictError);
    });

    it("should not check that the referral is still Open before claiming it, because the pool is shared", async () => {
      // A pre-read would be a second round trip whose answer was stale by the time it arrived: only api can say
      // whether the referral is still there, and it re-checks anyway.
      vi.mocked(claimJudicialReferral).mockResolvedValue(ok({ ...REFERRAL, state: "Claimed" }) as never);

      await claimReferral("ref-1", CALLER);

      expect(getJudicialReferral).not.toHaveBeenCalled();
      expect(getJudicialPool).not.toHaveBeenCalled();
    });

    // Including the commonest race there is: a referral another judge claimed a moment ago is invisible, so
    // being beaten to it is this branch and not the conflict above.
    it("should throw NotFoundError for a referral this judge may not see, which is what being beaten to one is", async () => {
      vi.mocked(claimJudicialReferral).mockResolvedValue(notFound as never);

      await expect(claimReferral("ref-1", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("recordDirection", () => {
    it("should send the validated direction and no decider, because api stamps it from the token", async () => {
      const decided = { ...REFERRAL, state: "Decided", decision: "Approved", decidedBy: "judge@example.com" };
      vi.mocked(directJudicialReferral).mockResolvedValue(ok(decided) as never);

      expect(await recordDirection("ref-1", DIRECTION, CALLER)).toEqual(decided);
      expect(directJudicialReferral).toHaveBeenCalledWith("ref-1", DIRECTION, expect.objectContaining({ accessToken: "judge-token" }));
    });

    it("should record the direction in one atomic call, since api models no draft", async () => {
      vi.mocked(directJudicialReferral).mockResolvedValue(ok({ ...REFERRAL, state: "Decided" }) as never);

      await recordDirection("ref-1", DIRECTION, CALLER);

      expect(directJudicialReferral).toHaveBeenCalledTimes(1);
      for (const field of ["state", "decidedBy", "decisionDate"]) {
        expect(vi.mocked(directJudicialReferral).mock.calls[0][1]).not.toHaveProperty(field);
      }
    });

    it("should throw ConflictError when the judge can see the referral but no longer holds it", async () => {
      // The lapsed case: the referral was taken back or never claimed, so it is visible and the refusal is one
      // the judge is looking at — a message beside the control rather than the 500 page.
      vi.mocked(directJudicialReferral).mockResolvedValue(conflict("Referral ref-1 is not claimed by this judge -- it is Open") as never);

      await expect(recordDirection("ref-1", DIRECTION, CALLER)).rejects.toBeInstanceOf(ConflictError);
      await expect(recordDirection("ref-1", DIRECTION, CALLER)).rejects.toThrow("Referral ref-1 is not claimed by this judge -- it is Open");
    });

    it("should throw NotFoundError when the referral moved out of sight, not a conflict naming its new holder", async () => {
      // Directing a referral another judge now holds is api's 404, not its 409: the two refusals divide by
      // visibility, and only the invisible one must stay silent about who has it.
      vi.mocked(directJudicialReferral).mockResolvedValue(notFound as never);

      await expect(recordDirection("ref-1", DIRECTION, CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("should throw InvalidInputError carrying api's field errors when it refuses the direction", async () => {
      vi.mocked(directJudicialReferral).mockResolvedValue({
        ok: false,
        error: { kind: "validation", status: 400, message: "Invalid request", fieldErrors: [{ field: "publishToGazette", message: "must not be null" }] }
      } as never);

      await expect(recordDirection("ref-1", DIRECTION, CALLER)).rejects.toBeInstanceOf(InvalidInputError);
      await expect(recordDirection("ref-1", DIRECTION, CALLER)).rejects.toMatchObject({
        errors: [{ field: "publishToGazette", message: "must not be null" }]
      });
    });
  });
});
