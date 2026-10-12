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

/**
 * An Administrator, who is the only caller the share box renders for.
 *
 * Every assertion about `shared` needs one: for anybody else the control is absent, so the body carries no
 * `shared` key and the patch omits the property rather than sending `false`.
 */
function adminRequest(body?: Record<string, unknown>): Request {
  return pageRequest({ params: PARAMS, body, accessToken: "session-token", teamLeader: true });
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

    it("should offer the share box to an Administrator", async () => {
      const res = response();

      await GET(adminRequest(), res);

      expect(res.render.mock.calls[0][1].canPublish).toBe(true);
    });

    it("should hide the share box from a caseworker", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].canPublish).toBe(false);
    });

    it("should decide the share box on the caller's role and the write controls on api's flag, which are different questions", async () => {
      // An Administrator amending somebody else's published query: api says they may amend it, and their own
      // role says they may publish. The two flags come from different places and must not be conflated --
      // `canAmend` is about this row, `canPublish` is about this caller.
      vi.mocked(findSavedQuery).mockResolvedValue(savedQuery({ editable: false }) as never);
      const res = response();

      await GET(adminRequest(), res);

      expect(res.render.mock.calls[0][1]).toMatchObject({ canAmend: false, canPublish: true });
    });

    it("should 404 a query the caller cannot see, which api does not distinguish from one that never existed", async () => {
      vi.mocked(findSavedQuery).mockRejectedValue(new NotFoundError("Saved query sq-9 not found"));

      await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
    });
  });

  describe("POST", () => {
    it("should send the three controls the form showed, then redirect to the library", async () => {
      const res = response();

      await POST(adminRequest(SUBMITTED), res);

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

    it("should unpublish a query whose share box an Administrator unticked", async () => {
      await POST(adminRequest({ name: "Awaiting enrolment" }), response());

      expect(updateSavedQuery).toHaveBeenCalledWith("sq-1", expect.objectContaining({ shared: false }), CALLER);
    });

    it("should omit shared entirely for a caseworker, rather than unpublishing a query they may not publish", async () => {
      // The defect this guards against is reachable without any hand-crafting: an Administrator publishes a
      // query and later loses the role, keeping ownership. The share box is then absent, so the body carries
      // no `shared`, the schema yields `false` — and sending that would unpublish the query on an edit to its
      // name, taking it out of every colleague's filter bar. An omitted property means "leave it as stored".
      await POST(request({ name: "Renamed" }), response());

      expect(updateSavedQuery).toHaveBeenCalledWith("sq-1", expect.not.objectContaining({ shared: expect.anything() }), CALLER);
    });

    it("should still send the name and description for a caseworker, so omitting shared costs nothing else", async () => {
      await POST(request({ name: "Renamed", description: "Still useful" }), response());

      expect(updateSavedQuery).toHaveBeenCalledWith("sq-1", { name: "Renamed", description: "Still useful" }, CALLER);
    });

    it("should keep the submitted values on screen when validation fails, not the stored ones", async () => {
      const res = response();

      await POST(request({ ...SUBMITTED, name: "n".repeat(101) }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(updateSavedQuery).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].values.name).toBe("n".repeat(101));
      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "Name must be 100 characters or fewer", href: "#name" }]);
    });

    it("should keep the share box hidden from a caseworker when validation fails", async () => {
      // A flag resolved only in `GET` would put the control back the moment a caseworker submitted an
      // over-long name -- the same failure `canAmend`'s docblock records, one render later.
      const res = response();

      await POST(request({ ...SUBMITTED, name: "n".repeat(101) }), res);

      expect(res.render.mock.calls[0][1].canPublish).toBe(false);
    });

    it("should keep the share box offered to an Administrator when validation fails", async () => {
      const res = response();

      await POST(adminRequest({ ...SUBMITTED, name: "n".repeat(101) }), res);

      expect(res.render.mock.calls[0][1].canPublish).toBe(true);
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

    it("should delete an unshared query at once and redirect to the library, since nobody else can hold it", async () => {
      vi.mocked(findSavedQuery).mockResolvedValue(savedQuery({ shared: false }) as never);
      const res = response();

      await POST(request({ ...SUBMITTED, action: "delete" }), res);

      expect(removeSavedQuery).toHaveBeenCalledWith("sq-1", CALLER);
      expect(updateSavedQuery).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/queries");
    });

    it("should send a published query's delete to the confirmation rather than acting on it", async () => {
      const res = response();

      await POST(request({ ...SUBMITTED, action: "delete" }), res);

      expect(removeSavedQuery).not.toHaveBeenCalled();
      expect(updateSavedQuery).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/queries/sq-1/delete");
    });

    it("should decide on the stored share flag, not on a box unticked without saving", async () => {
      // Everybody who has the query in their filter bar still has it, so the warning is still owed.
      //
      // This caller is a caseworker, so since plan 14 there is no share box for them to untick at all -- the
      // body carries no `shared` either way, and the stored flag is the only thing that could decide. The test
      // covers the stronger case now than when it was written, and passes unchanged.
      const res = response();

      await POST(request({ name: "Awaiting enrolment", action: "delete" }), res);

      expect(removeSavedQuery).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/queries/sq-1/delete");
    });

    it("should act on a delete whose name would fail validation, because delete is checked before it", async () => {
      vi.mocked(findSavedQuery).mockResolvedValue(savedQuery({ shared: false }) as never);
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
      vi.mocked(findSavedQuery).mockResolvedValue(savedQuery({ editable: false, shared: false }) as never);
      const res = response();

      await POST(request({ ...SUBMITTED, action: "delete" }), res);

      expect(removeSavedQuery).toHaveBeenCalledWith("sq-1", CALLER);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });
  });
});
