import {
  closeReferral as apiCloseReferral,
  createReferral as apiCreateReferral,
  recordConfirmation as apiRecordConfirmation,
  withdrawReferral as apiWithdrawReferral,
  getCase,
  getReferral,
  listReferrals,
  patchCase
} from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from "../errors.js";
import { closeReferral, createReferral, findReferral, findReferrals, recordConfirmation, withdrawReferral } from "./service.js";

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
  recordConfirmation: vi.fn(),
  getCase: vi.fn(),
  // Mocked only to be asserted un-called: recording an answer must not write a case date or a state.
  patchCase: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };

const REFERRAL = { id: "ref-1", state: "Open", reasons: ["Minor"], migrated: false };

const FORM = { reasons: ["Minor"] as const, urgency: "Normal" as const, notes: undefined, urgencyReason: undefined };

/** The referral as api answers a recording: the four confirmation columns filled, and the state unmoved. */
const CONFIRMED = {
  id: "ref-1",
  state: "Decided",
  reasons: ["NonPublication"],
  migrated: false,
  confirmationRequestedAt: new Date("2026-03-21T09:00:00Z"),
  confirmationOutcome: "Confirmed",
  confirmationReceivedAt: new Date("2026-03-22T10:30:00Z"),
  confirmationRecordedBy: "Ada Caseworker"
};

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
      changesToStandardPublication: false,
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

      expect(closed).toMatchObject({ decision: "Approved", directionsText: "Enrol the deed.", changesToStandardPublication: false, decidedBy: "A Judge" });
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

  describe("recordConfirmation", () => {
    it("should send the validated answer and its note under the referral's own case", async () => {
      vi.mocked(apiRecordConfirmation).mockResolvedValue(ok(CONFIRMED) as never);

      const recorded = await recordConfirmation("case-1", "ref-1", { outcome: "Confirmed", note: "Replied by email" }, CALLER);

      expect(recorded).toEqual(CONFIRMED);
      expect(apiRecordConfirmation).toHaveBeenCalledWith(
        "case-1",
        "ref-1",
        { outcome: "Confirmed", note: "Replied by email" },
        expect.objectContaining({ accessToken: "caseworker-token" })
      );
    });

    it("should send an answer with no note, because the note is evidence and not a second decision", async () => {
      vi.mocked(apiRecordConfirmation).mockResolvedValue(ok(CONFIRMED) as never);

      await recordConfirmation("case-1", "ref-1", { outcome: "Withdrawn", note: undefined }, CALLER);

      expect(apiRecordConfirmation).toHaveBeenCalledWith("case-1", "ref-1", { outcome: "Withdrawn", note: undefined }, expect.anything());
    });

    it("should send no recorder and no received date, because api derives both from the token and its clock", async () => {
      // The one thing nothing else would catch: api publishes this body with `additionalProperties: true`, so a
      // recorder sent from here would be IGNORED rather than refused.
      vi.mocked(apiRecordConfirmation).mockResolvedValue(ok(CONFIRMED) as never);

      await recordConfirmation("case-1", "ref-1", { outcome: "Confirmed", note: undefined }, CALLER);

      const [, , body] = vi.mocked(apiRecordConfirmation).mock.calls[0];
      expect(Object.keys(body).sort()).toEqual(["note", "outcome"]);
      // Four calls' worth of arguments and no fifth: the caller is the config, and no author travels beside it.
      expect(vi.mocked(apiRecordConfirmation).mock.calls[0]).toHaveLength(4);
    });

    it("should throw ConflictError when the answer has already been recorded", async () => {
      vi.mocked(apiRecordConfirmation).mockResolvedValue({
        ok: false,
        error: {
          kind: "conflict",
          status: 409,
          message:
            "Referral ref-1 already has a confirmation outcome of Confirmed, recorded on 22 March 2026. Recording a second answer would overwrite it, so it is refused"
        }
      } as never);

      await expect(recordConfirmation("case-1", "ref-1", { outcome: "Withdrawn", note: undefined }, CALLER)).rejects.toBeInstanceOf(ConflictError);
    });

    it("should throw the same ConflictError when the referral was never asked to confirm", async () => {
      // Both 409s arrive as one error on purpose: they are distinguishable only by api's prose, and a page that
      // branched on the message would be parsing another service's sentences.
      vi.mocked(apiRecordConfirmation).mockResolvedValue({
        ok: false,
        error: {
          kind: "conflict",
          status: 409,
          message: "Referral ref-1 has not been asked to confirm whether the applicant wants to proceed, so there is no answer to record"
        }
      } as never);

      await expect(recordConfirmation("case-1", "ref-1", { outcome: "Confirmed", note: undefined }, CALLER)).rejects.toBeInstanceOf(ConflictError);
    });

    it("should not read the referral first to see whether it is still waiting — api owns the transition", async () => {
      vi.mocked(apiRecordConfirmation).mockResolvedValue(ok(CONFIRMED) as never);

      await recordConfirmation("case-1", "ref-1", { outcome: "Confirmed", note: undefined }, CALLER);

      expect(getReferral).not.toHaveBeenCalled();
      expect(listReferrals).not.toHaveBeenCalled();
      expect(getCase).not.toHaveBeenCalled();
    });

    it("should write nothing to the case, because recording an answer changes no state and no date", async () => {
      vi.mocked(apiRecordConfirmation).mockResolvedValue(ok(CONFIRMED) as never);

      await recordConfirmation("case-1", "ref-1", { outcome: "Confirmed", note: undefined }, CALLER);

      // `notify-3b` decision 8: which date a confirmed case should have set next is an open business question,
      // so this app must not answer it with a patch of its own.
      expect(patchCase).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError for a referral that is not under this case", async () => {
      vi.mocked(apiRecordConfirmation).mockResolvedValue(notFound as never);

      await expect(recordConfirmation("other-case", "ref-1", { outcome: "Confirmed", note: undefined }, CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
