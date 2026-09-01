import { findDeedPoll, findNote, MAX_NOTE_LENGTH, NotFoundError, removeNote, SERVICE_ACCOUNT_NAME, updateNote } from "@hmcts/deed-poll";
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
  deedPollId: "case-1",
  note: "Called the applicant",
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  createdOn: new Date("2026-03-01T09:00:00.000Z"),
  modifiedOn: new Date("2026-03-01T09:00:00.000Z")
};

const PARAMS = { id: "case-1", noteId: note.id };

function request(body: Record<string, unknown> = {}, userName?: string): Request {
  return pageRequest({ params: PARAMS, body, name: userName });
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

      expect(findNote).toHaveBeenCalledWith("case-1", note.id);
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

      expect(updateNote).toHaveBeenCalledWith("case-1", note.id, { note: "Called twice" }, { userName: SERVICE_ACCOUNT_NAME });
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#notes");
    });

    it("attributes the amendment to the caller", async () => {
      await POST(request({ note: "Called twice", action: "save" }, "Second Caseworker"), response());

      expect(updateNote).toHaveBeenCalledWith("case-1", note.id, expect.anything(), { userName: "Second Caseworker" });
    });

    it("deletes when the delete button was used, scoped to both ids", async () => {
      const res = response();

      await POST(request({ note: "Called", action: "delete" }), res);

      expect(removeNote).toHaveBeenCalledWith("case-1", note.id);
      expect(updateNote).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#notes");
    });

    it("deletes even when the textarea is blank, since the text is irrelevant to a row being removed", async () => {
      // Delete is checked before validation for exactly this reason: a note whose text would fail
      // must still be deletable.
      const res = response();

      await POST(request({ note: "   ", action: "delete" }), res);

      expect(removeNote).toHaveBeenCalledWith("case-1", note.id);
      expect(res.status).not.toHaveBeenCalledWith(400);
    });

    it("deletes even when the textarea is over the limit", async () => {
      await POST(request({ note: "x".repeat(MAX_NOTE_LENGTH + 1), action: "delete" }), response());

      expect(removeNote).toHaveBeenCalled();
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

    it("saves rather than deletes when no action was submitted, so a missing value is not destructive", async () => {
      // Only the literal "delete" deletes. Anything else falls through to the save path.
      await POST(request({ note: "Called twice" }), response());

      expect(updateNote).toHaveBeenCalled();
      expect(removeNote).not.toHaveBeenCalled();
    });
  });
});
