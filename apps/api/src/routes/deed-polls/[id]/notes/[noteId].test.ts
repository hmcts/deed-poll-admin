import { findNote, NotFoundError, updateNote } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requestDouble, responseDouble } from "../../../../express-doubles.js";
import * as route from "./[noteId].js";
import { GET, PATCH } from "./[noteId].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findNote: vi.fn(),
  updateNote: vi.fn()
}));

const params = { id: "case-1", noteId: "note-1" };

/** The caller's bearer token, which is the whole of what these handlers pass on. */
const bearer = { headers: { authorization: "Bearer caseworker-token" } };
const CALLER = { accessToken: "caseworker-token" };

describe("/deed-polls/:id/notes/:noteId routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("should scope the lookup to both the case and the note", async () => {
      const note = { id: "note-1", note: "Called" };
      vi.mocked(findNote).mockResolvedValue(note as never);
      const res = responseDouble();

      await GET(requestDouble({ params, ...bearer }), res);

      expect(findNote).toHaveBeenCalledWith("case-1", "note-1", CALLER);
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

      await PATCH(requestDouble({ params, body: { note: "Called twice" }, ...bearer }), res);

      expect(updateNote).toHaveBeenCalledWith("case-1", "note-1", { note: "Called twice" }, CALLER);
      expect(res.json).toHaveBeenCalledWith(updated);
    });

    it("should forward the caller's token and no modifier name, because api re-stamps modifiedBy from it", async () => {
      vi.mocked(updateNote).mockResolvedValue({ id: "note-1" } as never);

      await PATCH(requestDouble({ params, body: { note: "Called twice" }, userName: "A Caseworker", ...bearer }), responseDouble());

      expect(updateNote).toHaveBeenCalledWith("case-1", "note-1", expect.anything(), CALLER);
    });

    it("should trim a patched note, applying the same rule as create", async () => {
      vi.mocked(updateNote).mockResolvedValue({ id: "note-1" } as never);

      await PATCH(requestDouble({ params, body: { note: "  Called twice  " }, ...bearer }), responseDouble());

      expect(updateNote).toHaveBeenCalledWith("case-1", "note-1", { note: "Called twice" }, expect.anything());
    });

    it("should reject a whitespace-only patch rather than blanking the note", async () => {
      await expect(PATCH(requestDouble({ params, body: { note: "  " } }), responseDouble())).rejects.toThrow(ZodError);

      expect(updateNote).not.toHaveBeenCalled();
    });

    it("should accept an empty patch, matching the partial schema", async () => {
      vi.mocked(updateNote).mockResolvedValue({ id: "note-1" } as never);

      await PATCH(requestDouble({ params, body: {}, ...bearer }), responseDouble());

      expect(updateNote).toHaveBeenCalledWith("case-1", "note-1", {}, expect.anything());
    });
  });

  // The delete is task 6 of docs/plans/02-dal-cutover-to-api.md, not a permanent absence: api has the
  // endpoint. Asserted rather than left implicit because the route existing and answering wrongly is the
  // failure worth catching, and "no export" is otherwise provable only by the absence of a test.
  it("should export no DELETE yet, so the route answers 404 rather than something it cannot do", () => {
    expect(route).not.toHaveProperty("DELETE");
  });
});
