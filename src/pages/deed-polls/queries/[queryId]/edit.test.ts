import { findSavedQuery, InvalidInputError, NotFoundError, removeSavedQuery, updateSavedQuery } from "@hmcts/deed-poll";
import type { SavedQuery } from "@hmcts/deed-poll-api-client";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET, POST } from "./edit.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findSavedQuery: vi.fn(),
  updateSavedQuery: vi.fn(),
  removeSavedQuery: vi.fn()
}));

/** The session's access token, which is the whole of what this page passes to the domain. */
const CALLER = { accessToken: "session-token" };

const PARAMS = { queryId: "sq-1" };

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

const SUBMITTED = { name: "Awaiting enrolment", description: "Received cases", shared: "true" };

function request(body?: Record<string, unknown>): Request {
  return pageRequest({ params: PARAMS, body, accessToken: "session-token" });
}

const response = pageResponse;

describe("amend a saved query page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findSavedQuery).mockResolvedValue(savedQuery() as never);
    vi.mocked(updateSavedQuery).mockResolvedValue(savedQuery() as never);
    vi.mocked(removeSavedQuery).mockResolvedValue(undefined);
  });

  describe("GET", () => {
    it("should render the stored query in the form", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][0]).toBe("deed-polls/queries/edit");
      expect(res.render.mock.calls[0][1].values).toEqual({
        name: "Awaiting enrolment",
        description: "Received cases with a Gazette notice",
        // The string the checkbox posts, so one comparison serves this render and every re-render after it.
        shared: "true"
      });
    });

    it("should render an absent description as an empty box rather than the word null", async () => {
      vi.mocked(findSavedQuery).mockResolvedValue(savedQuery({ description: null }) as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].values.description).toBe("");
    });

    it("should link to the query itself, built by the same function the filter bar uses", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].queryHref).toBe("/deed-polls?filter=received&where=newSurname%3Acontains%3ASmith&sort=dateReceived%3Adesc");
    });

    it("should offer the write controls when api says the caller may amend it", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].canAmend).toBe(true);
    });

    it("should hide the write controls when api says the caller may not, without deciding that here", async () => {
      // The mock api sets `editable: true` on everything, so this branch exists only in a page test.
      vi.mocked(findSavedQuery).mockResolvedValue(savedQuery({ editable: false }) as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].canAmend).toBe(false);
    });

    it("should 404 a query the caller cannot see, which api does not distinguish from one that never existed", async () => {
      vi.mocked(findSavedQuery).mockRejectedValue(new NotFoundError("Saved query sq-9 not found"));

      await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
    });
  });

  describe("POST", () => {
    it("should send the three controls the form showed, then redirect to the library", async () => {
      const res = response();

      await POST(request(SUBMITTED), res);

      expect(updateSavedQuery).toHaveBeenCalledWith("sq-1", { name: "Awaiting enrolment", description: "Received cases", shared: true }, CALLER);
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/queries");
    });

    it("should not send the query's conditions, which this form does not edit", async () => {
      await POST(request(SUBMITTED), response());

      expect(updateSavedQuery).toHaveBeenCalledWith("sq-1", expect.not.objectContaining({ conditions: expect.anything() }), CALLER);
    });

    it("should clear the description with an explicit null when the field was emptied", async () => {
      // Unlike a note's or a witness's patch: api's description column is nullable, and an omitted property
      // means "leave it as stored" — which is not what emptying the box asked for.
      await POST(request({ name: "Awaiting enrolment", description: "  " }), response());

      expect(updateSavedQuery).toHaveBeenCalledWith("sq-1", expect.objectContaining({ description: null }), CALLER);
    });

    it("should unpublish a query whose share box was unticked", async () => {
      await POST(request({ name: "Awaiting enrolment" }), response());

      expect(updateSavedQuery).toHaveBeenCalledWith("sq-1", expect.objectContaining({ shared: false }), CALLER);
    });

    it("should keep the submitted values on screen when validation fails, not the stored ones", async () => {
      const res = response();

      await POST(request({ ...SUBMITTED, name: "n".repeat(101) }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(updateSavedQuery).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].values.name).toBe("n".repeat(101));
      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "Name must be 100 characters or fewer", href: "#name" }]);
    });

    it("should reject a blank name", async () => {
      const res = response();

      await POST(request({ ...SUBMITTED, name: "   " }), res);

      expect(res.render.mock.calls[0][1].errors.name).toBe("Enter a name for this query");
    });

    it("should keep the write controls hidden when a rejected save re-renders a query the caller cannot amend", async () => {
      // A flag read only in `GET` puts the buttons back here, and nothing else in this suite would notice.
      vi.mocked(findSavedQuery).mockResolvedValue(savedQuery({ editable: false }) as never);
      const res = response();

      await POST(request({ ...SUBMITTED, name: "" }), res);

      expect(res.render.mock.calls[0][1].canAmend).toBe(false);
    });

    it("should still 404 on the re-render path for a query the caller cannot see", async () => {
      vi.mocked(findSavedQuery).mockRejectedValue(new NotFoundError("Saved query sq-9 not found"));

      await expect(POST(request({ ...SUBMITTED, name: "" }), response())).rejects.toThrow(NotFoundError);
    });

    it("should put api's rejection against the field it names", async () => {
      vi.mocked(updateSavedQuery).mockRejectedValue(new InvalidInputError("Request body is not valid", [{ field: "name", message: "Name is already used" }]));
      const res = response();

      await POST(request(SUBMITTED), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.name).toBe("Name is already used");
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it("should show the page's own copy, not api's wording, when its rejection names no field", async () => {
      vi.mocked(updateSavedQuery).mockRejectedValue(new InvalidInputError("deed-poll-api answered 400"));
      const res = response();

      await POST(request(SUBMITTED), res);

      expect(res.render.mock.calls[0][1].errorList[0].text).toBe("The query could not be saved. Check the details and try again.");
      expect(res.render.mock.calls[0][1].errorList[0].text).not.toContain("deed-poll-api");
    });

    it("should let an unreachable api reach the error handler rather than blaming the caseworker for it", async () => {
      vi.mocked(updateSavedQuery).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

      await expect(POST(request(SUBMITTED), response())).rejects.toThrow(/unavailable/);
    });

    it("should delete the query and redirect to the library", async () => {
      const res = response();

      await POST(request({ ...SUBMITTED, action: "delete" }), res);

      expect(removeSavedQuery).toHaveBeenCalledWith("sq-1", CALLER);
      expect(updateSavedQuery).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/queries");
    });

    it("should delete a query whose name would fail validation, because delete is checked before it", async () => {
      const res = response();

      await POST(request({ name: "", action: "delete" }), res);

      expect(removeSavedQuery).toHaveBeenCalledWith("sq-1", CALLER);
      expect(res.status).not.toHaveBeenCalledWith(400);
    });

    it("should save when no action was submitted, so a missing value is never destructive", async () => {
      await POST(request(SUBMITTED), response());

      expect(updateSavedQuery).toHaveBeenCalled();
      expect(removeSavedQuery).not.toHaveBeenCalled();
    });

    it("should not delete for an action other than the literal delete", async () => {
      await POST(request({ ...SUBMITTED, action: "Delete" }), response());

      expect(removeSavedQuery).not.toHaveBeenCalled();
      expect(updateSavedQuery).toHaveBeenCalled();
    });

    it("should leave a forged write on somebody else's query to api rather than refusing it here", async () => {
      // With the controls hidden, reaching this takes a hand-crafted POST, and api refuses one. A local
      // refusal as well would put the authority for one rule in two places.
      vi.mocked(findSavedQuery).mockResolvedValue(savedQuery({ editable: false }) as never);
      const res = response();

      await POST(request({ ...SUBMITTED, action: "delete" }), res);

      expect(removeSavedQuery).toHaveBeenCalledWith("sq-1", CALLER);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });
  });
});
