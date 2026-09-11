import { findDeedPoll, findNote, InvalidInputError, MAX_NOTE_LENGTH, NotFoundError, removeNote, updateNote } from "@hmcts/deed-poll";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../express-doubles.js";
import { GET, POST } from "./edit.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findNote: vi.fn(),
  updateNote: vi.fn(),
  removeNote: vi.fn()
}));

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };
const note = {
  id: "8efc7346-126f-4081-81a6-b66469e163aa",
  note: "Called the applicant",
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  createdOn: new Date("2026-03-01T09:00:00.000Z"),
  modifiedOn: new Date("2026-03-01T09:00:00.000Z")
};

const PARAMS = { id: "case-1", noteId: note.id };

/** The session's access token, which is the whole of what this page passes to the domain. */
const CALLER = { accessToken: "session-token" };

function request(body: Record<string, unknown> = {}, { admin = false } = {}): Request {
  return pageRequest({ params: PARAMS, body, admin, accessToken: "session-token" });
}

const response = pageResponse;

describe("amend a note page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findNote).mockResolvedValue(note as never);
    vi.mocked(updateNote).mockResolvedValue(note as never);
    vi.mocked(removeNote).mockResolvedValue(undefined);
  });

  describe("GET", () => {
    it("renders the note pre-filled, scoped to both the case and the note", async () => {
      const res = response();

      await GET(request(), res);

      expect(findNote).toHaveBeenCalledWith("case-1", note.id, CALLER);
      expect(res.render.mock.calls[0][0]).toBe("deed-polls/note-edit");
      expect(res.render.mock.calls[0][1].value).toBe("Called the applicant");
    });

    it("passes the note detail view, so the audit pairs match the notes grid", async () => {
      const res = response();

      await GET(request(), res);

      const model = res.render.mock.calls[0][1].note;
      expect(model.code).toBeTruthy();
      expect(model.createdBy).toBe("A Caseworker");
      expect(model.unmodified).toBe(true);
    });

    it("404s a note belonging to another case rather than showing it under this reference", async () => {
      vi.mocked(findNote).mockRejectedValue(new NotFoundError("Note not found"));

      await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
    });

    it("offers the delete button to an administrator", async () => {
      const res = response();

      await GET(request({}, { admin: true }), res);

      expect(res.render.mock.calls[0][1].canDelete).toBe(true);
    });

    it("does not offer the delete button to a caseworker", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].canDelete).toBe(false);
    });

    it("still offers a caseworker the amend form, because the business splits edit from delete", async () => {
      // The tidy-minded mistake is to gate the whole form on the same flag. The textarea's value is what
      // would go with it.
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].value).toBe("Called the applicant");
    });
  });

  describe("POST", () => {
    it("saves the amended note and redirects to the notes tab", async () => {
      const res = response();

      await POST(request({ note: "  Called twice  ", action: "save" }), res);

      expect(updateNote).toHaveBeenCalledWith("case-1", note.id, { note: "Called twice" }, CALLER);
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#notes");
    });

    it("sends the session's token and no modifier name, because api re-stamps modifiedBy from it", async () => {
      await POST(
        pageRequest({ params: PARAMS, body: { note: "Called twice", action: "save" }, name: "Second Caseworker", accessToken: "session-token" }),
        response()
      );

      expect(updateNote).toHaveBeenCalledWith("case-1", note.id, expect.anything(), CALLER);
    });

    it("re-renders with a 400 for a blank amendment rather than blanking the note", async () => {
      const res = response();

      await POST(request({ note: "   ", action: "save" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(updateNote).not.toHaveBeenCalled();
    });

    it("keeps the submitted text on a rejected save, not the stored note", async () => {
      const tooLong = "x".repeat(MAX_NOTE_LENGTH + 1);
      const res = response();

      await POST(request({ note: tooLong, action: "save" }), res);

      expect(res.render.mock.calls[0][1].value).toBe(tooLong);
      expect(res.render.mock.calls[0][1].value).not.toBe(note.note);
    });

    it("saves when no action was submitted, so a missing value is never destructive", async () => {
      // Only the literal "delete" may ever take the destructive path. This half of the rule was pinned
      // through the delete's absence in task 4 and still holds now the branch is back.
      await POST(request({ note: "Called twice" }), response());

      expect(updateNote).toHaveBeenCalled();
      expect(removeNote).not.toHaveBeenCalled();
    });

    it("does not delete for an action other than the literal delete", async () => {
      await POST(request({ note: "Called twice", action: "Delete" }), response());

      expect(removeNote).not.toHaveBeenCalled();
      expect(updateNote).toHaveBeenCalled();
    });

    it("deletes the note and redirects to the notes tab", async () => {
      // As an administrator, since they are the only role offered the button.
      const res = response();

      await POST(request({ note: "Called twice", action: "delete" }, { admin: true }), res);

      expect(removeNote).toHaveBeenCalledWith("case-1", note.id, CALLER);
      expect(updateNote).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#notes");
    });

    it("deletes a note whose text would fail validation, because delete is checked before it", async () => {
      // The reason the branch is first: the text is irrelevant to a row about to disappear, so a blank
      // or over-long textarea must not be able to block the deletion.
      const res = response();

      await POST(request({ note: "x".repeat(MAX_NOTE_LENGTH + 1), action: "delete" }), res);

      expect(removeNote).toHaveBeenCalledWith("case-1", note.id, CALLER);
      expect(res.status).not.toHaveBeenCalledWith(400);
    });

    it("404s a delete of a note belonging to another case rather than reporting success", async () => {
      vi.mocked(removeNote).mockRejectedValue(new NotFoundError("Note not found"));

      await expect(POST(request({ action: "delete" }), response())).rejects.toThrow(NotFoundError);
    });

    it("keeps the typed amendment on screen when api rejects it for a rule this form does not mirror", async () => {
      // Uncaught, this reached the 500 page and lost the amendment: `domainErrorHandler` passes
      // InvalidInputError on, on the grounds that a page which validates has caught it.
      vi.mocked(updateNote).mockRejectedValue(
        new InvalidInputError("Request body is not valid", [{ field: "note", message: "Notes are closed on an enroled case" }])
      );
      const res = response();

      await POST(request({ note: "Called twice", action: "save" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].error).toBe("Notes are closed on an enroled case");
      expect(res.render.mock.calls[0][1].value).toBe("Called twice");
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it("shows the page's own copy, not api's wording, when its rejection names no field", async () => {
      vi.mocked(updateNote).mockRejectedValue(new InvalidInputError("deed-poll-api answered 400"));
      const res = response();

      await POST(request({ note: "Called twice", action: "save" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].error).toBe("The note could not be saved. Check the note and try again.");
      expect(res.render.mock.calls[0][1].error).not.toContain("deed-poll-api");
      expect(res.render.mock.calls[0][1].value).toBe("Called twice");
    });

    it("lets an unreachable api reach the error handler rather than blaming the caseworker for it", async () => {
      vi.mocked(updateNote).mockRejectedValue(new Error("deed-poll-api call failed (timeout): deed-poll-api did not respond in time"));

      await expect(POST(request({ note: "Called twice", action: "save" }), response())).rejects.toThrow(/timeout/);
    });

    it("keeps the delete button hidden from a caseworker when a rejected save re-renders the form", async () => {
      // The path a caseworker reaches by submitting an over-long note. A flag read only in `GET` puts the
      // button back here, and nothing else in this suite would notice.
      const res = response();

      await POST(request({ note: "x".repeat(MAX_NOTE_LENGTH + 1), action: "save" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].canDelete).toBe(false);
    });

    it("keeps the delete button on an administrator's rejected save, so the re-render reads the session and does not hard-code false", async () => {
      const res = response();

      await POST(request({ note: "x".repeat(MAX_NOTE_LENGTH + 1), action: "save" }, { admin: true }), res);

      expect(res.render.mock.calls[0][1].canDelete).toBe(true);
    });

    it("leaves a caseworker's forged delete to api rather than refusing it here", async () => {
      // Deliberate: with the button hidden, reaching this branch takes a hand-crafted request, and api
      // enforces the rule. A local refusal as well would put the authority in two places.
      const res = response();

      await POST(request({ note: "Called twice", action: "delete" }), res);

      expect(removeNote).toHaveBeenCalledWith("case-1", note.id, CALLER);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });
  });
});
