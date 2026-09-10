import { createNote, findDeedPoll, InvalidInputError, MAX_NOTE_LENGTH, NotFoundError } from "@hmcts/deed-poll";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET, POST } from "./new.js";

// createNoteSchema and validateNoteText are the domain's, so they run for real here — the trimming
// and the length limit are the behaviour under test as much as the handler is.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  createNote: vi.fn()
}));

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

const PARAMS = { id: "case-1" };

/** The session's access token, which is the whole of what this page passes to the domain. */
const CALLER = { accessToken: "session-token" };

function request(body: Record<string, unknown> = {}): Request {
  return pageRequest({ params: PARAMS, body, accessToken: "session-token" });
}

const response = pageResponse;

describe("add a note page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(createNote).mockResolvedValue({ id: "note-1" } as never);
  });

  describe("GET", () => {
    it("renders an empty form against the case in the path", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][0]).toBe("deed-polls/note-form");
      expect(res.render.mock.calls[0][1].value).toBe("");
      expect(res.render.mock.calls[0][1].case.displayReference).toBe("KBDP2026-00001");
    });

    it("passes the shared maximum length, so the counter and the validator agree", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].en.maxLength).toBe(MAX_NOTE_LENGTH);
    });

    it("404s for a missing case rather than rendering a form against nothing", async () => {
      vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));

      await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
    });
  });

  describe("POST", () => {
    it("stores the trimmed note and redirects to the notes tab", async () => {
      const res = response();

      await POST(request({ note: "  Called the applicant  " }), res);

      expect(createNote).toHaveBeenCalledWith("case-1", { note: "Called the applicant" }, CALLER);
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#notes");
    });

    it("sends the session's token and no author name, because api stamps the author from the token", async () => {
      // This used to assert the session's display name reached the domain. Sending it now would let
      // this app attribute a note to whoever it liked, so what is pinned is the inverse.
      await POST(pageRequest({ params: PARAMS, body: { note: "Called" }, name: "A Caseworker", accessToken: "session-token" }), response());

      expect(createNote).toHaveBeenCalledWith("case-1", expect.anything(), CALLER);
    });

    it("re-renders with a 400 for a blank note rather than storing whitespace", async () => {
      const res = response();

      await POST(request({ note: "   " }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createNote).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].error).toBeTruthy();
    });

    it("keeps an over-long note on screen instead of discarding it", async () => {
      // This is the case the prototype's `?error=` redirect handled worst: the failure most likely to
      // be hit is the one where the caseworker has typed the most.
      const tooLong = "x".repeat(MAX_NOTE_LENGTH + 1);
      const res = response();

      await POST(request({ note: tooLong }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].value).toBe(tooLong);
      expect(createNote).not.toHaveBeenCalled();
    });

    it("accepts a note exactly at the limit, so the boundary is not off by one", async () => {
      await POST(request({ note: "x".repeat(MAX_NOTE_LENGTH) }), response());

      expect(createNote).toHaveBeenCalled();
    });

    it("re-renders with a 400 when no note field was submitted at all", async () => {
      const res = response();

      await POST(request({}), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createNote).not.toHaveBeenCalled();
    });

    it("keeps the typed note on screen when api rejects it for a rule this form does not mirror", async () => {
      // Uncaught, this reached the 500 page: `domainErrorHandler` passes InvalidInputError on, because a
      // page that validates is expected to have caught it. api applies rules this form has no local copy
      // of, so its rejections have to land against the textarea like any other.
      vi.mocked(createNote).mockRejectedValue(
        new InvalidInputError("Request body is not valid", [{ field: "note", message: "Notes are closed on an enroled case" }])
      );
      const res = response();

      await POST(request({ note: "Called the applicant" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].error).toBe("Notes are closed on an enroled case");
      expect(res.render.mock.calls[0][1].value).toBe("Called the applicant");
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it("shows the page's own copy, not api's wording, when its rejection names no field", async () => {
      // A rejection naming no field can be a gateway's 400 with an HTML body, which leaves the adapter
      // with nothing but `deed-poll-api answered 400`. Putting that against the textarea tells the
      // caseworker about api's transport rather than about their note.
      vi.mocked(createNote).mockRejectedValue(new InvalidInputError("deed-poll-api answered 400"));
      const res = response();

      await POST(request({ note: "Called" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].error).toBe("The note could not be saved. Check the note and try again.");
      expect(res.render.mock.calls[0][1].error).not.toContain("deed-poll-api");
      expect(res.render.mock.calls[0][1].value).toBe("Called");
    });

    it("lets an unreachable api reach the error handler rather than blaming the caseworker for it", async () => {
      vi.mocked(createNote).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): deed-poll-api could not be reached"));

      await expect(POST(request({ note: "Called" }), response())).rejects.toThrow(/unavailable/);
    });
  });
});
