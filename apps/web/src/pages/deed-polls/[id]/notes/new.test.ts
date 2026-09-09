import { createNote, findDeedPoll, MAX_NOTE_LENGTH, NotFoundError } from "@hmcts/deed-poll";
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
  });
});
