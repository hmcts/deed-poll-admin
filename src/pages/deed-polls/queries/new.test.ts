import { createSavedQuery, InvalidInputError, selectSavedQuery } from "@hmcts/deed-poll";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET, POST } from "./new.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  createSavedQuery: vi.fn(),
  selectSavedQuery: vi.fn()
}));

/** The session's access token, which is the whole of what this page passes to the domain. */
const CALLER = { accessToken: "session-token" };

/** The query the page is opened with: a tab, one condition and an order. */
const QUERY = { filter: "received", where: ["newSurname:contains:Smith"], sort: "dateReceived:desc" };

const SUBMITTED = { name: "Awaiting enrolment", description: "Received cases", shared: "true" };

function request(body?: Record<string, unknown>, query: Record<string, unknown> = QUERY): Request {
  return pageRequest({ query, body, accessToken: "session-token" });
}

/** An Administrator, who is the only caller the share box renders for. */
function adminRequest(body?: Record<string, unknown>, query: Record<string, unknown> = QUERY): Request {
  return pageRequest({ query, body, accessToken: "session-token", teamLeader: true });
}

const response = pageResponse;

describe("save a query page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSavedQuery).mockResolvedValue({ id: "sq-1" } as never);
    vi.mocked(selectSavedQuery).mockResolvedValue(undefined);
  });

  describe("GET", () => {
    it("should render an empty form", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][0]).toBe("deed-polls/queries/new");
      expect(res.render.mock.calls[0][1].values).toEqual({});
      expect(res.render.mock.calls[0][1].errorList).toEqual([]);
    });

    it("should offer the share box to an Administrator", async () => {
      const res = response();

      await GET(adminRequest(), res);

      expect(res.render.mock.calls[0][1].canPublish).toBe(true);
    });

    it("should hide the share box from a caseworker, because publishing is an Administrator's act", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].canPublish).toBe(false);
    });

    it("should hide the share box from a judge, so holding any role is not holding the admin one", async () => {
      // `isAdmin` and `isJudicial` are alternatives rather than a ladder, so this is not implied by the
      // caseworker case above.
      const res = response();

      await GET(pageRequest({ query: QUERY, accessToken: "session-token", judicial: true }), res);

      expect(res.render.mock.calls[0][1].canPublish).toBe(false);
    });

    it("should post back to the same query it was opened with, so the query needs no hidden inputs", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].formAction).toBe(
        "/deed-polls/queries/new?filter=received&where=newSurname%3Acontains%3ASmith&sort=dateReceived%3Adesc"
      );
    });

    it("should cancel back to the list it was opened from, results and all", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].cancelHref).toBe("/deed-polls?filter=received&where=newSurname%3Acontains%3ASmith&sort=dateReceived%3Adesc");
    });

    it("should reach api for nothing at all, because a name and a URL are the whole of the form", async () => {
      await GET(request(), response());

      expect(createSavedQuery).not.toHaveBeenCalled();
    });
  });

  describe("POST", () => {
    it("should save the URL's query under the submitted name, split into api's five columns", async () => {
      await POST(request(SUBMITTED), response());

      expect(createSavedQuery).toHaveBeenCalledWith(
        {
          name: "Awaiting enrolment",
          description: "Received cases",
          shared: true,
          filter: "received",
          conditions: ["newSurname:contains:Smith"],
          sortField: "dateReceived",
          sortDirection: "desc",
          searchTerm: undefined
        },
        CALLER
      );
    });

    it("should save the search term the results were found with", async () => {
      // The gap this page had: a query saved from a set of search results dropped the term, so reopening it
      // returned different rows from the ones it was named after.
      await POST(request(SUBMITTED, { ...QUERY, q: "Threepwood" }), response());

      expect(createSavedQuery).toHaveBeenCalledWith(expect.objectContaining({ searchTerm: "Threepwood" }), CALLER);
    });

    it("should save no term when the list was not searched", async () => {
      await POST(request(SUBMITTED, { ...QUERY, q: "   " }), response());

      expect(createSavedQuery).toHaveBeenCalledWith(expect.objectContaining({ searchTerm: undefined }), CALLER);
    });

    it("should send the session's token and nothing else, because api takes the owner from it", async () => {
      await POST(pageRequest({ query: QUERY, body: SUBMITTED, name: "A Caseworker", accessToken: "session-token" }), response());

      expect(createSavedQuery).toHaveBeenCalledWith(expect.anything(), CALLER);
    });

    it("should put the new query in the caller's own list, because api does not", async () => {
      await POST(request(SUBMITTED), response());

      expect(selectSavedQuery).toHaveBeenCalledWith("sq-1", CALLER);
    });

    it("should redirect to the list the query describes, so the caseworker sees what they just named", async () => {
      const res = response();

      await POST(request(SUBMITTED), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls?filter=received&where=newSurname%3Acontains%3ASmith&sort=dateReceived%3Adesc");
    });

    it("should leave a half-filled condition out of the saved query, so it finds what was on screen", async () => {
      // The state "Add condition" leaves a row in, and the list itself was queried without it.
      await POST(request(SUBMITTED, { ...QUERY, where: ["newSurname:contains:Smith", ":"] }), response());

      expect(createSavedQuery).toHaveBeenCalledWith(expect.objectContaining({ conditions: ["newSurname:contains:Smith"] }), CALLER);
    });

    it("should save an unfiltered list as a query with no conditions and no order", async () => {
      await POST(request(SUBMITTED, {}), response());

      expect(createSavedQuery).toHaveBeenCalledWith(
        expect.objectContaining({ filter: "all", conditions: [], sortField: undefined, sortDirection: undefined }),
        CALLER
      );
    });

    it("should not publish a query whose share box was left unticked", async () => {
      await POST(request({ name: "Mine" }), response());

      expect(createSavedQuery).toHaveBeenCalledWith(expect.objectContaining({ shared: false }), CALLER);
    });

    it("should send no description at all when the field was left blank", async () => {
      await POST(request({ name: "Mine", description: "   " }), response());

      expect(createSavedQuery).toHaveBeenCalledWith(expect.objectContaining({ description: undefined }), CALLER);
    });

    it("should reject a blank name and keep what was typed on screen", async () => {
      const res = response();

      await POST(request({ name: "  ", description: "Received cases" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createSavedQuery).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].errors.name).toBe("Enter a name for this query");
      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "Enter a name for this query", href: "#name" }]);
      expect(res.render.mock.calls[0][1].values.description).toBe("Received cases");
    });

    it("should reject a name longer than api's bound before it goes on the wire", async () => {
      const res = response();

      await POST(request({ name: "n".repeat(101) }), res);

      expect(createSavedQuery).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].errors.name).toBe("Name must be 100 characters or fewer");
    });

    it("should keep the share box hidden from a caseworker when validation fails", async () => {
      // A flag resolved only in `GET` would put the control back the moment a caseworker submitted a blank
      // name, which is the whole reason it is read in `render` rather than in the handler.
      const res = response();

      await POST(request({ name: "" }), res);

      expect(res.render.mock.calls[0][1].canPublish).toBe(false);
    });

    it("should keep the share box offered to an Administrator when validation fails", async () => {
      const res = response();

      await POST(adminRequest({ name: "" }), res);

      expect(res.render.mock.calls[0][1].canPublish).toBe(true);
    });

    it("should keep the query in the failed form's action, so a corrected name saves the same query", async () => {
      const res = response();

      await POST(request({ name: "" }), res);

      expect(res.render.mock.calls[0][1].formAction).toBe(
        "/deed-polls/queries/new?filter=received&where=newSurname%3Acontains%3ASmith&sort=dateReceived%3Adesc"
      );
    });

    it("should put api's rejection against the field it names", async () => {
      vi.mocked(createSavedQuery).mockRejectedValue(new InvalidInputError("Request body is not valid", [{ field: "name", message: "Name is already used" }]));
      const res = response();

      await POST(request(SUBMITTED), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.name).toBe("Name is already used");
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it("should show the page's own copy, not api's wording, when its rejection names no field", async () => {
      vi.mocked(createSavedQuery).mockRejectedValue(new InvalidInputError("deed-poll-api answered 400"));
      const res = response();

      await POST(request(SUBMITTED), res);

      expect(res.render.mock.calls[0][1].errorList[0].text).toBe("The query could not be saved. Check the details and try again.");
      expect(res.render.mock.calls[0][1].errorList[0].text).not.toContain("deed-poll-api");
    });

    it("should let an unreachable api reach the error handler rather than blaming the caseworker for it", async () => {
      vi.mocked(createSavedQuery).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): deed-poll-api could not be reached"));

      await expect(POST(request(SUBMITTED), response())).rejects.toThrow(/unavailable/);
    });

    it("should not lose a saved query to a failed selection, because the query already exists", async () => {
      // A 500 here would say the save failed when it did not, and the obvious response to that is to save it
      // again. The query is still in the library to be added by hand.
      vi.mocked(selectSavedQuery).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
      const res = response();

      await POST(request(SUBMITTED), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls?filter=received&where=newSurname%3Acontains%3ASmith&sort=dateReceived%3Adesc");
      expect(res.status).not.toHaveBeenCalledWith(400);
    });
  });
});
