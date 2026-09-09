import { createNote, findNotes, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requestDouble, responseDouble } from "../../../../express-doubles.js";
import { GET, POST } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findNotes: vi.fn(),
  createNote: vi.fn()
}));

/** The caller's bearer token, which is the whole of what these handlers pass on. */
const bearer = { headers: { authorization: "Bearer caseworker-token" } };
const CALLER = { accessToken: "caseworker-token" };

describe("/deed-polls/:id/notes collection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /deed-polls/:id/notes", () => {
    it("should return the notes for the case in the path", async () => {
      const notes = [{ id: "note-1" }, { id: "note-2" }];
      vi.mocked(findNotes).mockResolvedValue(notes as never);
      const res = responseDouble();

      await GET(requestDouble({ params: { id: "case-1" }, ...bearer }), res);

      expect(findNotes).toHaveBeenCalledWith("case-1", CALLER);
      expect(res.json).toHaveBeenCalledWith(notes);
    });

    it("should let a NotFoundError propagate, so a missing case 404s rather than answering an empty list", async () => {
      vi.mocked(findNotes).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));
      const res = responseDouble();

      await expect(GET(requestDouble({ params: { id: "nope" } }), res)).rejects.toThrow(NotFoundError);

      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe("POST /deed-polls/:id/notes", () => {
    it("should create the note against the case and respond 201", async () => {
      const created = { id: "note-1", note: "Called the applicant" };
      vi.mocked(createNote).mockResolvedValue(created as never);
      const res = responseDouble();

      await POST(requestDouble({ params: { id: "case-1" }, body: { note: "Called the applicant" }, ...bearer }), res);

      expect(createNote).toHaveBeenCalledWith("case-1", { note: "Called the applicant" }, CALLER);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(created);
    });

    it("should forward the caller's token and no author name, because api stamps the author from the token", async () => {
      // What this replaces asserted that the session's user name reached the domain. Sending it now
      // would let this app attribute a note to whoever it liked, so the assertion is the inverse: the
      // token travels and nothing else about the caller does.
      vi.mocked(createNote).mockResolvedValue({ id: "note-1" } as never);

      await POST(requestDouble({ params: { id: "case-1" }, body: { note: "Called" }, userName: "A Caseworker", ...bearer }), responseDouble());

      expect(createNote).toHaveBeenCalledWith("case-1", { note: "Called" }, CALLER);
    });

    it("should store the trimmed note, so surrounding whitespace never reaches the record", async () => {
      vi.mocked(createNote).mockResolvedValue({ id: "note-1" } as never);

      await POST(requestDouble({ params: { id: "case-1" }, body: { note: "  Called the applicant  " }, ...bearer }), responseDouble());

      expect(createNote).toHaveBeenCalledWith("case-1", { note: "Called the applicant" }, expect.anything());
    });

    it("should reject a whitespace-only note, which trimming would otherwise smuggle through", async () => {
      await expect(POST(requestDouble({ params: { id: "case-1" }, body: { note: "   " } }), responseDouble())).rejects.toThrow(ZodError);

      expect(createNote).not.toHaveBeenCalled();
    });

    it("should reject a body with no note at all", async () => {
      await expect(POST(requestDouble({ params: { id: "case-1" }, body: {} }), responseDouble())).rejects.toThrow(ZodError);

      expect(createNote).not.toHaveBeenCalled();
    });
  });
});
