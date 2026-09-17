import { deselectSavedQuery, findSavedQueries, NotFoundError, selectSavedQuery } from "@hmcts/deed-poll";
import type { SavedQuery } from "@hmcts/deed-poll-api-client";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET, POST } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findSavedQueries: vi.fn(),
  selectSavedQuery: vi.fn(),
  deselectSavedQuery: vi.fn()
}));

/** The session's access token, which is the whole of what this page passes to the domain. */
const CALLER = { accessToken: "session-token" };

const savedQuery = (overrides: Partial<SavedQuery> = {}): SavedQuery =>
  ({
    id: "sq-1",
    name: "Awaiting enrolment",
    description: "Received cases with a Gazette notice",
    shared: true,
    ownerId: "owner-1",
    ownerName: "A Caseworker",
    filter: "received",
    conditions: [],
    sortField: null,
    sortDirection: null,
    searchTerm: null,
    selected: false,
    editable: false,
    createdBy: "A Caseworker",
    modifiedBy: "A Caseworker",
    createdOn: null,
    modifiedOn: null,
    ...overrides
  }) as SavedQuery;

function request(body?: Record<string, unknown>): Request {
  return pageRequest({ body, accessToken: "session-token" });
}

const response = pageResponse;

describe("saved query library page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findSavedQueries).mockResolvedValue([savedQuery()] as never);
    vi.mocked(selectSavedQuery).mockResolvedValue(undefined);
    vi.mocked(deselectSavedQuery).mockResolvedValue(undefined);
  });

  describe("GET", () => {
    it("should render a row per query the caller can see, with what it is and whose it is", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][0]).toBe("deed-polls/queries/index");
      expect(res.render.mock.calls[0][1].rows).toEqual([
        {
          id: "sq-1",
          name: "Awaiting enrolment",
          description: "Received cases with a Gazette notice",
          ownerName: "A Caseworker",
          href: "/deed-polls?filter=received",
          shared: true,
          selected: false,
          editable: false
        }
      ]);
    });

    it("should ask api once for the whole page, because one response holds both halves of it", async () => {
      await GET(request(), response());

      expect(findSavedQueries).toHaveBeenCalledTimes(1);
      expect(findSavedQueries).toHaveBeenCalledWith(CALLER);
    });

    it("should carry api's editable flag through untouched, so the amend link is api's decision", async () => {
      vi.mocked(findSavedQueries).mockResolvedValue([savedQuery({ id: "mine", editable: true }), savedQuery({ id: "theirs", editable: false })] as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].rows.map((row: { id: string; editable: boolean }) => [row.id, row.editable])).toEqual([
        ["mine", true],
        ["theirs", false]
      ]);
    });

    it("should say which queries are already in the caller's filter bar", async () => {
      vi.mocked(findSavedQueries).mockResolvedValue([savedQuery({ selected: true })] as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].rows[0].selected).toBe(true);
    });

    it("should render an empty library rather than treating no queries as a failure", async () => {
      vi.mocked(findSavedQueries).mockResolvedValue([] as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].rows).toEqual([]);
    });

    it("should let an unreachable api reach the error handler, because the queries ARE this page", async () => {
      // Deliberately unlike the case list, which degrades to its status tabs: there, the saved queries are
      // navigation beside the rows a caseworker came for. Here there is nothing else to render.
      vi.mocked(findSavedQueries).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

      await expect(GET(request(), response())).rejects.toThrow(/unavailable/);
    });
  });

  describe("POST", () => {
    it("should add a query to the caller's own list and redirect back to the library", async () => {
      const res = response();

      await POST(request({ action: "add", queryId: "sq-1" }), res);

      expect(selectSavedQuery).toHaveBeenCalledWith("sq-1", CALLER);
      expect(deselectSavedQuery).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/queries");
    });

    it("should remove a query from the caller's own list and redirect back to the library", async () => {
      const res = response();

      await POST(request({ action: "remove", queryId: "sq-1" }), res);

      expect(deselectSavedQuery).toHaveBeenCalledWith("sq-1", CALLER);
      expect(selectSavedQuery).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/queries");
    });

    it("should remove a query the caller can no longer see, with no visibility check first", async () => {
      // api answers 204 for a selection delete either way, deliberately: the row is the caller's own, and a
      // subscriber holding a selection for a query its owner has unshared is exactly who needs to clear it.
      await POST(request({ action: "remove", queryId: "unshared-since" }), response());

      expect(deselectSavedQuery).toHaveBeenCalledWith("unshared-since", CALLER);
    });

    it("should act on nothing for an action neither button sends", async () => {
      const res = response();

      await POST(request({ action: "delete", queryId: "sq-1" }), res);

      expect(selectSavedQuery).not.toHaveBeenCalled();
      expect(deselectSavedQuery).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/queries");
    });

    it("should act on nothing when no query id was submitted, keeping an empty path segment off the wire", async () => {
      await POST(request({ action: "add" }), response());

      expect(selectSavedQuery).not.toHaveBeenCalled();
    });

    it("should act on nothing for a whitespace query id", async () => {
      await POST(request({ action: "add", queryId: "   " }), response());

      expect(selectSavedQuery).not.toHaveBeenCalled();
    });

    it("should 404 an add of a query the caller cannot see rather than reporting success", async () => {
      // api's asymmetry: `PUT …/selection` 404s where the delete does not, because adding one needs to see it.
      vi.mocked(selectSavedQuery).mockRejectedValue(new NotFoundError("Saved query sq-9 not found"));

      await expect(POST(request({ action: "add", queryId: "sq-9" }), response())).rejects.toThrow(NotFoundError);
    });

    it("should survive a double submit, because both selection operations are idempotent", async () => {
      const res = response();

      await POST(request({ action: "add", queryId: "sq-1" }), res);
      await POST(request({ action: "add", queryId: "sq-1" }), res);

      expect(selectSavedQuery).toHaveBeenCalledTimes(2);
      expect(res.redirect).toHaveBeenCalledTimes(2);
    });
  });
});
