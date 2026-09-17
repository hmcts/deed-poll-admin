import { findSavedQuery, NotFoundError, removeSavedQuery } from "@hmcts/deed-poll";
import type { SavedQuery } from "@hmcts/deed-poll-api-client";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET, POST } from "./delete.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findSavedQuery: vi.fn(),
  removeSavedQuery: vi.fn()
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
    conditions: ["newSurname:contains:Smith"],
    sortField: "dateReceived",
    sortDirection: "desc",
    searchTerm: null,
    selected: true,
    editable: true,
    createdBy: "A Caseworker",
    modifiedBy: "A Caseworker",
    createdOn: null,
    modifiedOn: null,
    ...overrides
  }) as SavedQuery;

function request(body?: Record<string, unknown>): Request {
  return pageRequest({ params: { queryId: "sq-1" }, body, accessToken: "session-token" });
}

const response = pageResponse;

describe("delete a saved query confirmation page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findSavedQuery).mockResolvedValue(savedQuery() as never);
    vi.mocked(removeSavedQuery).mockResolvedValue(undefined);
  });

  describe("GET", () => {
    it("should confirm a published query's delete and act on nothing while it asks", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][0]).toBe("deed-polls/queries/delete");
      expect(res.render.mock.calls[0][1].queryName).toBe("Awaiting enrolment");
      expect(removeSavedQuery).not.toHaveBeenCalled();
    });

    it("should warn that colleagues may hold the query without claiming how many", async () => {
      // api publishes no subscriber count, so a number here would be invented — plan 11's decision 5.
      const res = response();

      await GET(request(), res);

      const { warning } = res.render.mock.calls[0][1].en;
      expect(warning).toContain("Other people may have this query");
      expect(warning).not.toMatch(/\d/);
    });

    it("should link to the query itself, so what is about to go can be checked against its rows", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].queryHref).toBe("/deed-polls?filter=received&where=newSurname%3Acontains%3ASmith&sort=dateReceived%3Adesc");
    });

    it("should offer a cancel that returns to the amend form", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].editHref).toBe("/deed-polls/queries/sq-1/edit");
    });

    it("should send an unshared query back to the amend form, which deletes it without a warning", async () => {
      // Nobody else can see it, so this page's own sentence would be untrue of it.
      vi.mocked(findSavedQuery).mockResolvedValue(savedQuery({ shared: false }) as never);
      const res = response();

      await GET(request(), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/queries/sq-1/edit");
      expect(res.render).not.toHaveBeenCalled();
      expect(removeSavedQuery).not.toHaveBeenCalled();
    });

    it("should offer the confirm control when api says the caller may delete it", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].canDelete).toBe(true);
    });

    it("should hide the confirm control when api says the caller may not, without deciding that here", async () => {
      // The mock api sets `editable: true` on everything, so this branch exists only in a page test.
      vi.mocked(findSavedQuery).mockResolvedValue(savedQuery({ editable: false }) as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].canDelete).toBe(false);
    });

    it("should 404 a query the caller cannot see, which api does not distinguish from one that never existed", async () => {
      vi.mocked(findSavedQuery).mockRejectedValue(new NotFoundError("Saved query sq-9 not found"));

      await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
    });
  });

  describe("POST", () => {
    it("should delete the query and redirect to the library when the delete is confirmed", async () => {
      const res = response();

      await POST(request({ action: "delete" }), res);

      expect(removeSavedQuery).toHaveBeenCalledWith("sq-1", CALLER);
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/queries");
    });

    it("should delete nothing for a body this page did not produce, returning to the amend form", async () => {
      const res = response();

      await POST(request({ action: "cancel" }), res);

      expect(removeSavedQuery).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/queries/sq-1/edit");
    });

    it("should delete nothing when no action was submitted, so a missing value is never destructive", async () => {
      await POST(request({}), response());

      expect(removeSavedQuery).not.toHaveBeenCalled();
    });

    it("should not delete for an action other than the literal delete", async () => {
      await POST(request({ action: "Delete" }), response());

      expect(removeSavedQuery).not.toHaveBeenCalled();
    });

    it("should not re-read the query before deleting, the confirmation having been for the caseworker", async () => {
      await POST(request({ action: "delete" }), response());

      expect(findSavedQuery).not.toHaveBeenCalled();
    });

    it("should leave a forged confirm on somebody else's query to api rather than refusing it here", async () => {
      // With the control hidden, reaching this takes a hand-crafted POST, and api refuses one. A local refusal
      // as well would put the authority for one rule in two places.
      const res = response();

      await POST(request({ action: "delete" }), res);

      expect(removeSavedQuery).toHaveBeenCalledWith("sq-1", CALLER);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it("should let an unreachable api reach the error handler rather than redirecting as though it worked", async () => {
      vi.mocked(removeSavedQuery).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
      const res = response();

      await expect(POST(request({ action: "delete" }), res)).rejects.toThrow(/unavailable/);
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });
});
