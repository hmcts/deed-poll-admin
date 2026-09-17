import {
  createSavedQuery as apiCreateSavedQuery,
  deselectSavedQuery as apiDeselectSavedQuery,
  selectSavedQuery as apiSelectSavedQuery,
  deleteSavedQuery,
  getSavedQuery,
  listSavedQueries,
  patchSavedQuery
} from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError, NotFoundError } from "../errors.js";
import { createSavedQuery, deselectSavedQuery, findSavedQueries, findSavedQuery, removeSavedQuery, selectSavedQuery, updateSavedQuery } from "./service.js";

// The adapter is mocked and nothing else. What is worth pinning at this seam is that each function
// reaches the right operation, that the caller's token travels, and that nothing about ownership does —
// api derives the owner and the audit author from the token, so an owner on the wire would be this app
// claiming a query for whoever it liked.
vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  listSavedQueries: vi.fn(),
  getSavedQuery: vi.fn(),
  createSavedQuery: vi.fn(),
  patchSavedQuery: vi.fn(),
  deleteSavedQuery: vi.fn(),
  selectSavedQuery: vi.fn(),
  deselectSavedQuery: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };

const ok = <T>(data: T) => ({ ok: true as const, data });

const notFound = { ok: false as const, error: { kind: "not-found" as const, status: 404, message: "Saved query sq-1 not found" } };

describe("saved-queries/service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("findSavedQueries", () => {
    it("should return the library in api's order, carrying the caller's token", async () => {
      const queries = [
        { id: "sq-1", name: "Awaiting enrolment" },
        { id: "sq-2", name: "Mine" }
      ];
      vi.mocked(listSavedQueries).mockResolvedValue(ok(queries) as never);

      expect(await findSavedQueries(CALLER)).toEqual(queries);
      expect(listSavedQueries).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "http://api.test", accessToken: "caseworker-token" }));
    });

    it("should ask for no parameters, because api publishes no way to ask for the selection alone", async () => {
      vi.mocked(listSavedQueries).mockResolvedValue(ok([]) as never);

      await findSavedQueries(CALLER);

      expect(listSavedQueries).toHaveBeenCalledTimes(1);
      expect(vi.mocked(listSavedQueries).mock.calls[0]).toHaveLength(1);
    });
  });

  describe("findSavedQuery", () => {
    it("should return the query api answers with", async () => {
      vi.mocked(getSavedQuery).mockResolvedValue(ok({ id: "sq-1", editable: true }) as never);

      expect(await findSavedQuery("sq-1", CALLER)).toEqual({ id: "sq-1", editable: true });
      expect(getSavedQuery).toHaveBeenCalledWith("sq-1", expect.anything());
    });

    it("should throw NotFoundError for a query the caller cannot see, which api does not distinguish from a missing one", async () => {
      // api answers 404 rather than 403 for somebody else's unshared query on purpose, so no id is
      // discoverable by watching status codes — and this app cannot tell the two apart either.
      vi.mocked(getSavedQuery).mockResolvedValue(notFound as never);

      await expect(findSavedQuery("sq-1", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("createSavedQuery", () => {
    it("should send the query's own parts and no owner, because api takes the owner from the token", async () => {
      const dto = { name: "Awaiting enrolment", conditions: ["state:is:Received"], shared: true };
      vi.mocked(apiCreateSavedQuery).mockResolvedValue(ok({ id: "sq-9", ...dto }) as never);

      expect(await createSavedQuery(dto, CALLER)).toEqual({ id: "sq-9", ...dto });
      expect(apiCreateSavedQuery).toHaveBeenCalledWith(dto, expect.objectContaining({ accessToken: "caseworker-token" }));
    });

    it("should throw InvalidInputError carrying api's field errors when it refuses the body", async () => {
      vi.mocked(apiCreateSavedQuery).mockResolvedValue({
        ok: false,
        error: { kind: "validation", status: 400, message: "Invalid request", fieldErrors: [{ field: "name", message: "must not be blank" }] }
      } as never);

      await expect(createSavedQuery({ name: "" }, CALLER)).rejects.toMatchObject({
        name: "InvalidInputError",
        errors: [{ field: "name", message: "must not be blank" }]
      });
      await expect(createSavedQuery({ name: "" }, CALLER)).rejects.toBeInstanceOf(InvalidInputError);
    });
  });

  describe("updateSavedQuery", () => {
    it("should pass the patch through untouched, so an explicit null still clears a column", async () => {
      // Unlike the note and witness patches: api's saved-query columns are nullable, and null is how a
      // description is removed. Defaulting it to "" here would store an empty description instead.
      vi.mocked(patchSavedQuery).mockResolvedValue(ok({ id: "sq-1", description: null }) as never);

      await updateSavedQuery("sq-1", { description: null }, CALLER);

      expect(patchSavedQuery).toHaveBeenCalledWith("sq-1", { description: null }, expect.anything());
    });

    it("should throw NotFoundError when api refuses the amendment as invisible", async () => {
      vi.mocked(patchSavedQuery).mockResolvedValue(notFound as never);

      await expect(updateSavedQuery("sq-1", { name: "Renamed" }, CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("removeSavedQuery", () => {
    it("should delete by id and return nothing", async () => {
      vi.mocked(deleteSavedQuery).mockResolvedValue(ok(undefined) as never);

      expect(await removeSavedQuery("sq-1", CALLER)).toBeUndefined();
      expect(deleteSavedQuery).toHaveBeenCalledWith("sq-1", expect.anything());
    });

    it("should throw NotFoundError when the query is already gone", async () => {
      vi.mocked(deleteSavedQuery).mockResolvedValue(notFound as never);

      await expect(removeSavedQuery("sq-1", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("selectSavedQuery", () => {
    it("should add the query to the caller's list", async () => {
      vi.mocked(apiSelectSavedQuery).mockResolvedValue(ok(undefined) as never);

      await selectSavedQuery("sq-1", CALLER);

      expect(apiSelectSavedQuery).toHaveBeenCalledWith("sq-1", expect.objectContaining({ accessToken: "caseworker-token" }));
    });

    it("should throw NotFoundError for a query the caller cannot see, so selecting cannot discover a private one", async () => {
      vi.mocked(apiSelectSavedQuery).mockResolvedValue(notFound as never);

      await expect(selectSavedQuery("sq-1", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("deselectSavedQuery", () => {
    it("should remove the query from the caller's list with no visibility pre-check", async () => {
      // Deliberately asymmetric with selecting: the selection row is keyed by the caller, and a
      // subscriber holding a stale selection for a query its owner has since unshared is exactly the one
      // who most needs to clear it. A read before the delete would refuse them.
      vi.mocked(apiDeselectSavedQuery).mockResolvedValue(ok(undefined) as never);

      await deselectSavedQuery("sq-1", CALLER);

      expect(apiDeselectSavedQuery).toHaveBeenCalledWith("sq-1", expect.anything());
      expect(getSavedQuery).not.toHaveBeenCalled();
    });
  });
});
