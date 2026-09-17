import { createCase, getCase, getFieldRules, listCases, patchCase } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError, UnauthorizedError } from "../errors.js";
import { createDeedPoll, findDeedPoll, findDeedPolls, getCaseFieldRules, updateDeedPoll, validateCaseForSubmit } from "./service.js";

// The adapter is mocked and nothing else. What these tests are about is the seam: that each function
// calls the right operation, that the caller's token reaches the config, and that every kind of
// classified failure arrives as the domain error the pages already render. The rules the old suite
// covered here — reference numbers, the gates, the privacy lock, state derivation — are api's now, and
// asserting them against a mock would only pin this file's opinion of them.
//
// Only the five operations are replaced. The option-set arrays stay real, because `option-sets.ts`
// builds this app's enum members out of them at import time and `validateCaseForSubmit` reads those.
vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  listCases: vi.fn(),
  getCase: vi.fn(),
  createCase: vi.fn(),
  patchCase: vi.fn(),
  getFieldRules: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };

/** api's success envelope, as the adapter hands it over. */
const ok = <T>(data: T) => ({ ok: true as const, data });

describe("deed-poll/service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
    delete process.env.DEED_POLL_API_TIMEOUT_MS;
  });

  describe("findDeedPolls", () => {
    it("passes the filter key through and returns the whole page, counts included", async () => {
      const page = { filter: "open", cases: [{ id: "case-1" }], page: 1, size: 25, total: 213, totalPages: 9 };
      vi.mocked(listCases).mockResolvedValue(ok(page) as never);

      const result = await findDeedPolls({ filter: "open" }, CALLER);

      expect(result).toEqual(page);
      expect(listCases).toHaveBeenCalledWith(expect.objectContaining({ filter: "open" }), expect.objectContaining({ baseUrl: "http://api.test" }));
    });

    it("sends no filter, sort or page when none was asked for, so api resolves its own defaults", async () => {
      vi.mocked(listCases).mockResolvedValue(ok({ filter: "all", cases: [], page: 1, size: 25, total: 0, totalPages: 0 }) as never);

      await findDeedPolls({}, CALLER);

      expect(listCases).toHaveBeenCalledWith({ filter: undefined, where: [], sort: undefined, page: undefined, size: undefined }, expect.anything());
    });

    it("serialises the conditions as api's where parameters, with the tab alongside them", async () => {
      vi.mocked(listCases).mockResolvedValue(ok({ filter: "open", cases: [], page: 1, size: 25, total: 0, totalPages: 0 }) as never);

      await findDeedPolls(
        { filter: "open", conditions: [{ field: "type", operator: "is", values: ["Adult"] }], sort: "dateReceived:desc", page: 2, size: 10 },
        CALLER
      );

      expect(listCases).toHaveBeenCalledWith({ filter: "open", where: ["type:is:Adult"], sort: "dateReceived:desc", page: 2, size: 10 }, expect.anything());
    });

    it("leaves an incomplete condition off the wire, so adding a row does not turn the request into a 400", async () => {
      vi.mocked(listCases).mockResolvedValue(ok({ filter: "all", cases: [], page: 1, size: 25, total: 0, totalPages: 0 }) as never);

      await findDeedPolls(
        {
          conditions: [
            { field: "type", operator: "is", values: ["Adult"] },
            { field: "", operator: "", values: [] }
          ]
        },
        CALLER
      );

      expect(listCases).toHaveBeenCalledWith(expect.objectContaining({ where: ["type:is:Adult"] }), expect.anything());
    });

    it("leaves a chosen comparison with no value yet off the wire, rather than asking api to refuse it", async () => {
      // The state a caseworker is in the moment they have picked a field and a comparison: api answers
      // "is takes one value, and was given 0", and being shown that for a step not yet taken is the fault
      // plan 10 exists to fix.
      vi.mocked(listCases).mockResolvedValue(ok({ filter: "all", cases: [], page: 1, size: 25, total: 0, totalPages: 0 }) as never);

      await findDeedPolls(
        {
          conditions: [
            { field: "type", operator: "is", values: [""] },
            { field: "ageOfMinor", operator: "between", values: ["3"] }
          ]
        },
        CALLER
      );

      expect(listCases).toHaveBeenCalledWith(expect.objectContaining({ where: [] }), expect.anything());
    });
  });

  describe("findDeedPoll", () => {
    it("returns the case api sent, children and derived columns included", async () => {
      const found = { id: "case-1", notes: [], witnesses: [], documents: [], daysReceivedToEnroled: 30 };
      vi.mocked(getCase).mockResolvedValue(ok(found) as never);

      expect(await findDeedPoll("case-1", CALLER)).toBe(found);
      expect(getCase).toHaveBeenCalledWith("case-1", expect.anything());
    });

    it("throws NotFoundError when api answers 404", async () => {
      vi.mocked(getCase).mockResolvedValue({ ok: false, error: { kind: "not-found", status: 404, message: "DeedPoll nope not found" } } as never);

      await expect(findDeedPoll("nope", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("createDeedPoll", () => {
    it("posts the patch as it stands, adding no reference number of its own", async () => {
      vi.mocked(createCase).mockResolvedValue(ok({ id: "case-1", displayReference: "KBDP2026-00001" }) as never);

      const created = await createDeedPoll({ type: "Adult", dateReceived: "2026-07-31" }, CALLER);

      expect(created.displayReference).toBe("KBDP2026-00001");
      const [patch] = vi.mocked(createCase).mock.calls[0];
      expect(patch).toEqual({ type: "Adult", dateReceived: "2026-07-31" });
      expect(patch).not.toHaveProperty("referencenumber");
      expect(patch).not.toHaveProperty("displayReference");
    });

    it("surfaces api's field errors as an InvalidInputError a form can render", async () => {
      vi.mocked(createCase).mockResolvedValue({
        ok: false,
        error: {
          kind: "validation",
          status: 400,
          message: "Invalid input",
          fieldErrors: [{ field: "dateReceived", message: "Enter the date the application was received" }]
        }
      } as never);

      const error = await createDeedPoll({}, CALLER).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as InvalidInputError).errors).toEqual([{ field: "dateReceived", message: "Enter the date the application was received" }]);
    });
  });

  describe("updateDeedPoll", () => {
    it("patches the case api holds", async () => {
      vi.mocked(patchCase).mockResolvedValue(ok({ id: "case-1", state: "Enroled" }) as never);

      const updated = await updateDeedPoll("case-1", { dateEnroled: "2026-03-01" }, CALLER);

      expect(updated.state).toBe("Enroled");
      expect(patchCase).toHaveBeenCalledWith("case-1", { dateEnroled: "2026-03-01" }, expect.anything());
    });

    it("sends a privacy value rather than dropping it, because api decides the entitlement", async () => {
      // The lock moved with the write path. Dropping the field here as well would leave an admin's
      // explicit Private silently unsent — the same silent-wrong-value failure the old lock avoided.
      vi.mocked(patchCase).mockResolvedValue(ok({ id: "case-1" }) as never);

      await updateDeedPoll("case-1", { privacy: "Private" }, CALLER);

      expect(vi.mocked(patchCase).mock.calls[0][1]).toEqual({ privacy: "Private" });
    });
  });

  describe("getCaseFieldRules", () => {
    it("asks api for the rules, sending all three inputs", async () => {
      vi.mocked(getFieldRules).mockResolvedValue(ok({ maritalStatus: { visible: true, required: true } }) as never);

      const rules = await getCaseFieldRules({ type: "Minor", migrated: false, publishToGazette: true }, CALLER);

      expect(rules.maritalStatus).toEqual({ visible: true, required: true });
      expect(getFieldRules).toHaveBeenCalledWith({ type: "Minor", migrated: false, publishToGazette: true }, expect.anything());
    });
  });

  describe("validateCaseForSubmit", () => {
    it("returns the record when nothing is outstanding", async () => {
      const record = { id: "case-1", notes: [], witnesses: [], documents: [] };
      vi.mocked(getCase).mockResolvedValue(ok(record) as never);

      expect(await validateCaseForSubmit("case-1", CALLER)).toBe(record);
    });

    it("throws with the collected violations when the case is not submittable", async () => {
      // An Adult case is required to carry marital status, nationality and the rest, so a bare one
      // fails the local matrix — which is the whole point of the check being separate from a save.
      vi.mocked(getCase).mockResolvedValue(ok({ id: "case-1", type: "Adult", notes: [], witnesses: [], documents: [] }) as never);

      const error = await validateCaseForSubmit("case-1", CALLER).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as InvalidInputError).errors.length).toBeGreaterThan(0);
    });
  });

  describe("the failure mapping", () => {
    const cases = [
      { kind: "forbidden", expected: ForbiddenError },
      { kind: "unauthorized", expected: UnauthorizedError },
      { kind: "conflict", expected: ConflictError },
      { kind: "not-found", expected: NotFoundError }
    ];

    it.each(cases)("turns a $kind result into its domain error", async ({ kind, expected }) => {
      vi.mocked(getCase).mockResolvedValue({ ok: false, error: { kind, message: "no" } } as never);

      await expect(findDeedPoll("case-1", CALLER)).rejects.toBeInstanceOf(expected);
    });

    it.each(["unavailable", "timeout", "invalid-response", "unknown"])("lets a %s result surface as a fault, naming api", async (kind) => {
      // Not a bespoke error class: an api this app cannot reach is the same kind of problem a database
      // outage was, and it belongs on the 500 page rather than in a handler that might mistake it for
      // something the caseworker did.
      vi.mocked(getCase).mockResolvedValue({ ok: false, error: { kind, message: "could not be reached" } } as never);

      await expect(findDeedPoll("case-1", CALLER)).rejects.toThrow(/deed-poll-api/);
    });
  });

  describe("the api config", () => {
    it("presents the caller's token, so api can authenticate and audit the write", async () => {
      vi.mocked(getCase).mockResolvedValue(ok({ id: "case-1" }) as never);

      await findDeedPoll("case-1", { accessToken: "a-token" });

      expect(vi.mocked(getCase).mock.calls[0][1].accessToken).toBe("a-token");
    });

    it("ignores an unparseable timeout override rather than passing NaN to AbortSignal.timeout", async () => {
      process.env.DEED_POLL_API_TIMEOUT_MS = "soon";
      vi.mocked(getCase).mockResolvedValue(ok({ id: "case-1" }) as never);

      await findDeedPoll("case-1", CALLER);

      expect(vi.mocked(getCase).mock.calls[0][1].timeoutMs).toBeUndefined();
    });
  });
});
