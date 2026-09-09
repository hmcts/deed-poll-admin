import { createNote as apiCreateNote, getNote, listNotes, patchNote } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../errors.js";
import { createNote, findNote, findNotes, updateNote } from "./service.js";

// The adapter is mocked and nothing else. What is worth pinning at this seam is that each function
// reaches the right nested operation with the case id first, that the caller's token travels, and that
// nothing about authorship is sent — api derives `createdBy` and `modifiedBy` from the token, so a name
// on the wire would be this app asserting an identity api never verified.
vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  listNotes: vi.fn(),
  getNote: vi.fn(),
  createNote: vi.fn(),
  patchNote: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };

const ok = <T>(data: T) => ({ ok: true as const, data });

describe("notes/service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("findNotes", () => {
    it("should return the notes in api's order, which is newest first", async () => {
      const notes = [{ id: "note-2" }, { id: "note-1" }];
      vi.mocked(listNotes).mockResolvedValue(ok(notes) as never);

      expect(await findNotes("case-1", CALLER)).toEqual(notes);
      expect(listNotes).toHaveBeenCalledWith("case-1", expect.objectContaining({ baseUrl: "http://api.test" }));
    });

    it("should throw NotFoundError for a case that does not exist, rather than answering an empty list", async () => {
      // The distinction the Prisma version had to arrange with `assertCaseExists`: a mistyped case id
      // and a real case with no notes are different facts, and only one of them is true.
      vi.mocked(listNotes).mockResolvedValue({ ok: false, error: { kind: "not-found", status: 404, message: "DeedPoll nope not found" } } as never);

      await expect(findNotes("nope", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("findNote", () => {
    it("should ask for the note under its own case, so a note of another case is api's 404", async () => {
      vi.mocked(getNote).mockResolvedValue(ok({ id: "note-9" }) as never);

      expect(await findNote("case-1", "note-9", CALLER)).toEqual({ id: "note-9" });
      expect(getNote).toHaveBeenCalledWith("case-1", "note-9", expect.anything());
    });

    it("should throw NotFoundError when the note belongs to a different case", async () => {
      vi.mocked(getNote).mockResolvedValue({ ok: false, error: { kind: "not-found", status: 404, message: "Note note-9 not found" } } as never);

      await expect(findNote("other-case", "note-9", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("createNote", () => {
    it("should send the note text and no author, because api stamps both audit names from the token", async () => {
      vi.mocked(apiCreateNote).mockResolvedValue(ok({ id: "note-1", note: "Called the applicant" }) as never);

      const created = await createNote("case-1", { note: "Called the applicant" }, CALLER);

      expect(created.id).toBe("note-1");
      expect(apiCreateNote).toHaveBeenCalledWith("case-1", "Called the applicant", expect.anything());
      expect(vi.mocked(apiCreateNote).mock.calls[0][2].accessToken).toBe("caseworker-token");
    });
  });

  describe("updateNote", () => {
    it("should patch the note text", async () => {
      vi.mocked(patchNote).mockResolvedValue(ok({ id: "note-1", note: "Called twice" }) as never);

      const updated = await updateNote("case-1", "note-1", { note: "Called twice" }, CALLER);

      expect(updated.note).toBe("Called twice");
      expect(patchNote).toHaveBeenCalledWith("case-1", "note-1", "Called twice", expect.anything());
    });

    it("should pass an absent note through, because api accepts an empty patch and re-stamps modifiedBy", async () => {
      vi.mocked(patchNote).mockResolvedValue(ok({ id: "note-1" }) as never);

      await updateNote("case-1", "note-1", {}, CALLER);

      expect(patchNote).toHaveBeenCalledWith("case-1", "note-1", undefined, expect.anything());
    });
  });
});
