import { findWitnesses, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestDouble, responseDouble } from "../../../../express-doubles.js";
import * as route from "./index.js";
import { GET } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findWitnesses: vi.fn()
}));

/** The caller's bearer token, which is the whole of what this handler passes on. */
const bearer = { headers: { authorization: "Bearer caseworker-token" } };
const CALLER = { accessToken: "caseworker-token" };

describe("/deed-polls/:id/witnesses collection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /deed-polls/:id/witnesses", () => {
    it("should return the witnesses for the case in the path", async () => {
      const witnesses = [{ id: "witness-1" }];
      vi.mocked(findWitnesses).mockResolvedValue(witnesses as never);
      const res = responseDouble();

      await GET(requestDouble({ params: { id: "case-1" }, ...bearer }), res);

      expect(findWitnesses).toHaveBeenCalledWith("case-1", CALLER);
      expect(res.json).toHaveBeenCalledWith(witnesses);
    });

    it("should let a NotFoundError propagate, so a missing case 404s rather than answering an empty list", async () => {
      vi.mocked(findWitnesses).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));
      const res = responseDouble();

      await expect(GET(requestDouble({ params: { id: "nope" } }), res)).rejects.toThrow(NotFoundError);

      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // api has no witness write endpoints, deliberately — see the head of `index.ts`. Asserted rather than
  // left implicit, because a route that accepted a body and then failed is worse than one that 404s, and
  // "no POST" is otherwise provable only by the absence of a test.
  it("should export no POST, because api publishes no witness create", () => {
    expect(route).not.toHaveProperty("POST");
  });
});
