import { findNote, NotFoundError, removeNote, SERVICE_ACCOUNT_NAME, updateNote } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requestDouble, responseDouble } from "../../../../express-doubles.js";
import { DELETE, GET, PATCH } from "./[noteId].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findNote: vi.fn(),
  updateNote: vi.fn(),
  removeNote: vi.fn()
}));

const params = { id: "case-1", noteId: "note-1" };

describe("/deed-polls/:id/notes/:noteId routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("should scope the lookup to both the case and the note", async () => {
      const note = { id: "note-1", note: "Called" };
      vi.mocked(findNote).mockResolvedValue(note as never);
      const res = responseDouble();

      await GET(requestDouble({ params }), res);

      expect(findNote).toHaveBeenCalledWith("case-1", "note-1");
      expect(res.json).toHaveBeenCalledWith(note);
    });

    it("should let a NotFoundError propagate, which is how a note under the wrong case answers 404", async () => {
      vi.mocked(findNote).mockRejectedValue(new NotFoundError("Note note-1 not found"));

      await expect(GET(requestDouble({ params: { id: "other-case", noteId: "note-1" } }), responseDouble())).rejects.toThrow(NotFoundError);
    });
  });

  describe("PATCH", () => {
    it("should apply the patch scoped to both ids and return the updated note", async () => {
      const updated = { id: "note-1", note: "Called twice" };
      vi.mocked(updateNote).mockResolvedValue(updated as never);
      const res = responseDouble();

      await PATCH(requestDouble({ params, body: { note: "Called twice" } }), res);

      expect(updateNote).toHaveBeenCalledWith("case-1", "note-1", { note: "Called twice" }, { userName: SERVICE_ACCOUNT_NAME });
      expect(res.json).toHaveBeenCalledWith(updated);
    });

    it("should stamp the caller as the modifier", async () => {
      vi.mocked(updateNote).mockResolvedValue({ id: "note-1" } as never);

      await PATCH(requestDouble({ params, body: { note: "Called twice" }, userName: "A Caseworker" }), responseDouble());

      expect(updateNote).toHaveBeenCalledWith("case-1", "note-1", expect.anything(), { userName: "A Caseworker" });
    });

    it("should trim a patched note, applying the same rule as create", async () => {
      vi.mocked(updateNote).mockResolvedValue({ id: "note-1" } as never);

      await PATCH(requestDouble({ params, body: { note: "  Called twice  " } }), responseDouble());

      expect(updateNote).toHaveBeenCalledWith("case-1", "note-1", { note: "Called twice" }, expect.anything());
    });

    it("should reject a whitespace-only patch rather than blanking the note", async () => {
      await expect(PATCH(requestDouble({ params, body: { note: "  " } }), responseDouble())).rejects.toThrow(ZodError);

      expect(updateNote).not.toHaveBeenCalled();
    });

    it("should accept an empty patch, matching the partial schema", async () => {
      vi.mocked(updateNote).mockResolvedValue({ id: "note-1" } as never);

      await PATCH(requestDouble({ params, body: {} }), responseDouble());

      expect(updateNote).toHaveBeenCalledWith("case-1", "note-1", {}, expect.anything());
    });
  });

  describe("DELETE", () => {
    it("should delete scoped to both ids and respond 204 with no body", async () => {
      vi.mocked(removeNote).mockResolvedValue(undefined);
      const res = responseDouble();

      await DELETE(requestDouble({ params }), res);

      expect(removeNote).toHaveBeenCalledWith("case-1", "note-1");
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should let a NotFoundError propagate rather than reporting 204 for a note it did not delete", async () => {
      vi.mocked(removeNote).mockRejectedValue(new NotFoundError("Note note-1 not found"));
      const res = responseDouble();

      await expect(DELETE(requestDouble({ params }), res)).rejects.toThrow(NotFoundError);

      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
