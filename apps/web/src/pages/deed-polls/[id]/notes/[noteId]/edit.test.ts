import { findDeedPoll, findNote, MAX_NOTE_LENGTH, NotFoundError, updateNote } from "@hmcts/deed-poll";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../express-doubles.js";
import { GET, POST } from "./edit.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findNote: vi.fn(),
  updateNote: vi.fn()
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

function request(body: Record<string, unknown> = {}): Request {
  return pageRequest({ params: PARAMS, body, accessToken: "session-token" });
}

const response = pageResponse;

describe("amend a note page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findNote).mockResolvedValue(note as never);
    vi.mocked(updateNote).mockResolvedValue(note as never);
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
      // Pinned through the delete's absence and worth keeping through it: task 6 restores the branch,
      // and only the literal "delete" may ever take the destructive path.
      await POST(request({ note: "Called twice" }), response());

      expect(updateNote).toHaveBeenCalled();
    });

    it("saves rather than silently doing nothing when the delete button is posted, since the branch is not wired yet", async () => {
      // Task 4 leaves the delete unported and task 6 completes it. Until then `action` is not read at
      // all, and this says so plainly: the assertion inverts in task 6, which is the point of having it.
      await POST(request({ note: "Called twice", action: "delete" }), response());

      expect(updateNote).toHaveBeenCalledWith("case-1", note.id, { note: "Called twice" }, CALLER);
    });
  });
});
