import {
  closeReferral as apiCloseReferral,
  createReferral as apiCreateReferral,
  withdrawReferral as apiWithdrawReferral,
  getCase,
  getReferral,
  listReferrals
} from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from "../errors.js";
import { closeReferral, createReferral, findReferral, findReferrals, withdrawReferral } from "./service.js";

// The adapter is mocked and nothing else. What is worth pinning at this seam is that each function reaches
// the right operation, that the caller's token travels and no author does, and that api's two 409s arrive as
// a `ConflictError` a page can render rather than as a fault.
vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  listReferrals: vi.fn(),
  getReferral: vi.fn(),
  createReferral: vi.fn(),
  withdrawReferral: vi.fn(),
  closeReferral: vi.fn(),
  getCase: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };

const REFERRAL = { id: "ref-1", state: "Open", reasons: ["Minor"], migrated: false };

const FORM = { reasons: ["Minor"] as const, urgency: "Normal" as const, notes: undefined, urgencyReason: undefined };

const ok = <T>(data: T) => ({ ok: true as const, data });

const notFound = { ok: false as const, error: { kind: "not-found" as const, status: 404, message: "Referral ref-1 not found" } };

describe("referrals/service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("findReferrals", () => {
    it("should return the case's whole referral history in api's order, carrying the caller's token", async () => {
      const referrals = [
        { id: "ref-2", state: "Open" },
        { id: "ref-1", state: "Withdrawn" }
      ];
      vi.mocked(listReferrals).mockResolvedValue(ok(referrals) as never);

      expect(await findReferrals("case-1", CALLER)).toEqual(referrals);
      expect(listReferrals).toHaveBeenCalledWith("case-1", expect.objectContaining({ baseUrl: "http://api.test", accessToken: "caseworker-token" }));
    });

    it("should make a dedicated call rather than reading the case, because referrals are not on its payload", async () => {
      // The one place this differs from witnesses: `GET /caseworker/cases/{id}` carries notes, witnesses and
      // documents but no referrals, so asking for the case would answer the wrong question.
      vi.mocked(listReferrals).mockResolvedValue(ok([]) as never);

      await findReferrals("case-1", CALLER);

      expect(getCase).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError for a case that does not exist, rather than answering an empty list", async () => {
      vi.mocked(listReferrals).mockResolvedValue({ ok: false, error: { kind: "not-found", status: 404, message: "Case case-9 not found" } } as never);

      await expect(findReferrals("case-9", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("should throw a plain Error naming api when it cannot be reached, which is a fault and not a state", async () => {
      vi.mocked(listReferrals).mockResolvedValue({ ok: false, error: { kind: "unavailable", status: 0, message: "fetch failed" } } as never);

      await expect(findReferrals("case-1", CALLER)).rejects.toThrow("deed-poll-api call failed (unavailable): fetch failed");
    });
  });

  describe("findReferral", () => {
    it("should ask for the referral under its own case", async () => {
      vi.mocked(getReferral).mockResolvedValue(ok(REFERRAL) as never);

      expect(await findReferral("case-1", "ref-1", CALLER)).toEqual(REFERRAL);
      expect(getReferral).toHaveBeenCalledWith("case-1", "ref-1", expect.anything());
    });

    it("should throw NotFoundError for a referral that is not under this case, with no scoping pre-read", async () => {
      // api's routes are nested, so a referral id belonging to another case is its 404. Asking for the case
      // first to check would be a second round trip for a fact this call already carries.
      vi.mocked(getReferral).mockResolvedValue(notFound as never);

      await expect(findReferral("other-case", "ref-1", CALLER)).rejects.toBeInstanceOf(NotFoundError);
      expect(getCase).not.toHaveBeenCalled();
    });
  });

  describe("createReferral", () => {
    it("should send the validated form and no author, because api stamps createdBy from the token", async () => {
      vi.mocked(apiCreateReferral).mockResolvedValue(ok(REFERRAL) as never);

      expect(await createReferral("case-1", FORM, CALLER)).toEqual(REFERRAL);
      expect(apiCreateReferral).toHaveBeenCalledWith("case-1", FORM, expect.objectContaining({ accessToken: "caseworker-token" }));
    });

    it("should send no state, because the state of a new referral is always api's own Open", async () => {
      vi.mocked(apiCreateReferral).mockResolvedValue(ok(REFERRAL) as never);

      await createReferral("case-1", FORM, CALLER);

      expect(vi.mocked(apiCreateReferral).mock.calls[0][1]).not.toHaveProperty("state");
    });

    it("should throw ConflictError when the case already has a referral that is not terminal", async () => {
      // api answers 409 rather than 400 because a second live referral is a state, not a malformed body —
      // and the page renders it as a message with a link to the open one.
      vi.mocked(apiCreateReferral).mockResolvedValue({
        ok: false,
        error: { kind: "conflict", status: 409, message: "Case case-1 already has an open referral" }
      } as never);

      await expect(createReferral("case-1", FORM, CALLER)).rejects.toBeInstanceOf(ConflictError);
      await expect(createReferral("case-1", FORM, CALLER)).rejects.toThrow("Case case-1 already has an open referral");
    });

    it("should throw InvalidInputError carrying api's field errors when it refuses the body", async () => {
      // The two conditional rules are api's as well as the form's, so its 400 has to reach the fields: the
      // field names are the wire names, which are the form's names.
      vi.mocked(apiCreateReferral).mockResolvedValue({
        ok: false,
        error: { kind: "validation", status: 400, message: "Invalid request", fieldErrors: [{ field: "notes", message: "must not be blank" }] }
      } as never);

      await expect(createReferral("case-1", { ...FORM, reasons: ["Other"] }, CALLER)).rejects.toMatchObject({
        name: "InvalidInputError",
        errors: [{ field: "notes", message: "must not be blank" }]
      });
      await expect(createReferral("case-1", { ...FORM, reasons: ["Other"] }, CALLER)).rejects.toBeInstanceOf(InvalidInputError);
    });

    it("should throw ForbiddenError when api refuses the caller the operation, which is its rule not ours", async () => {
      vi.mocked(apiCreateReferral).mockResolvedValue({ ok: false, error: { kind: "forbidden", status: 403, message: "Not permitted" } } as never);

      await expect(createReferral("case-1", FORM, CALLER)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("withdrawReferral", () => {
    it("should post to the withdrawal sub-resource with no body and return the withdrawn referral", async () => {
      const withdrawn = { ...REFERRAL, state: "Withdrawn" };
      vi.mocked(apiWithdrawReferral).mockResolvedValue(ok(withdrawn) as never);

      expect(await withdrawReferral("case-1", "ref-1", CALLER)).toEqual(withdrawn);
      expect(apiWithdrawReferral).toHaveBeenCalledWith("case-1", "ref-1", expect.objectContaining({ accessToken: "caseworker-token" }));
      expect(vi.mocked(apiWithdrawReferral).mock.calls[0]).toHaveLength(3);
    });

    it("should throw ConflictError when the referral is already closed or withdrawn", async () => {
      vi.mocked(apiWithdrawReferral).mockResolvedValue({
        ok: false,
        error: { kind: "conflict", status: 409, message: "Referral ref-1 is already terminal" }
      } as never);

      await expect(withdrawReferral("case-1", "ref-1", CALLER)).rejects.toBeInstanceOf(ConflictError);
    });

    it("should not decide for itself whether a referral may be withdrawn — api owns the transition", async () => {
      // No local state check: a referral open when the page rendered may have been decided since, and only
      // api can say. So the call is always made and the refusal is what is rendered.
      vi.mocked(apiWithdrawReferral).mockResolvedValue(ok({ ...REFERRAL, state: "Withdrawn" }) as never);

      await withdrawReferral("case-1", "ref-1", { ...CALLER });

      expect(getReferral).not.toHaveBeenCalled();
      expect(listReferrals).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError for a referral that is not under this case", async () => {
      vi.mocked(apiWithdrawReferral).mockResolvedValue(notFound as never);

      await expect(withdrawReferral("other-case", "ref-1", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("closeReferral", () => {
    const CLOSED = {
      ...REFERRAL,
      state: "Closed",
      decision: "Approved",
      directionsText: "Enrol the deed.",
      publishToGazette: true,
      decidedBy: "A Judge",
      modifiedBy: "A Caseworker"
    };

    it("should post to the closure sub-resource with no body and return the closed referral", async () => {
      vi.mocked(apiCloseReferral).mockResolvedValue(ok(CLOSED) as never);

      expect(await closeReferral("case-1", "ref-1", CALLER)).toEqual(CLOSED);
      expect(apiCloseReferral).toHaveBeenCalledWith(
        "case-1",
        "ref-1",
        expect.objectContaining({ baseUrl: "http://api.test", accessToken: "caseworker-token" })
      );
      // Three arguments and no fourth: no closure note, and nothing naming who actioned the direction — api
      // stamps the actor from the token, as it does on every other write.
      expect(vi.mocked(apiCloseReferral).mock.calls[0]).toHaveLength(3);
    });

    it("should return the judicial fields unchanged, since closing records the direction was actioned not undone", async () => {
      vi.mocked(apiCloseReferral).mockResolvedValue(ok(CLOSED) as never);

      const closed = await closeReferral("case-1", "ref-1", CALLER);

      expect(closed).toMatchObject({ decision: "Approved", directionsText: "Enrol the deed.", publishToGazette: true, decidedBy: "A Judge" });
    });

    it("should throw ConflictError when the referral is not Decided, which is api's rule to enforce", async () => {
      vi.mocked(apiCloseReferral).mockResolvedValue({
        ok: false,
        error: { kind: "conflict", status: 409, message: "Referral ref-1 is Open and can only be closed once it is Decided" }
      } as never);

      await expect(closeReferral("case-1", "ref-1", CALLER)).rejects.toBeInstanceOf(ConflictError);
    });

    it("should not read the referral first to check its state — api owns the transition", async () => {
      // The same reasoning as the withdrawal: a referral Decided when the confirmation page rendered may have
      // been closed by another caseworker since, so the pre-read would answer a question that has moved on.
      vi.mocked(apiCloseReferral).mockResolvedValue(ok(CLOSED) as never);

      await closeReferral("case-1", "ref-1", CALLER);

      expect(getReferral).not.toHaveBeenCalled();
      expect(listReferrals).not.toHaveBeenCalled();
      expect(getCase).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError for a referral that is not under this case", async () => {
      vi.mocked(apiCloseReferral).mockResolvedValue(notFound as never);

      await expect(closeReferral("other-case", "ref-1", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
