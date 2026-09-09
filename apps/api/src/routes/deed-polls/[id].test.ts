import { findDeedPoll, NotFoundError, updateDeedPoll } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requestDouble, responseDouble } from "../../express-doubles.js";
import { GET, PATCH } from "./[id].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  updateDeedPoll: vi.fn()
}));

/** The caller's bearer token, which is the whole of what these handlers pass on. */
const bearer = { headers: { authorization: "Bearer caseworker-token" } };
const CALLER = { accessToken: "caseworker-token" };

describe("/deed-polls/:id routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /deed-polls/:id", () => {
    it("should return the case for the id in the path", async () => {
      const found = { id: "case-1", notes: [], witnesses: [], documents: [] };
      vi.mocked(findDeedPoll).mockResolvedValue(found as never);
      const res = responseDouble();

      await GET(requestDouble({ params: { id: "case-1" }, ...bearer }), res);

      expect(findDeedPoll).toHaveBeenCalledWith("case-1", CALLER);
      expect(res.json).toHaveBeenCalledWith(found);
    });

    it("should let a NotFoundError propagate, because the error middleware maps it to 404", async () => {
      vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll missing not found"));
      const res = responseDouble();

      await expect(GET(requestDouble({ params: { id: "missing" } }), res)).rejects.toThrow(NotFoundError);

      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /deed-polls/:id", () => {
    it("should apply the patch and return the updated case", async () => {
      const updated = { id: "case-1", newForename: "Ada" };
      vi.mocked(updateDeedPoll).mockResolvedValue(updated as never);
      const res = responseDouble();

      await PATCH(requestDouble({ params: { id: "case-1" }, body: { newForename: "Ada" }, ...bearer }), res);

      expect(updateDeedPoll).toHaveBeenCalledWith("case-1", { newForename: "Ada" }, CALLER);
      expect(res.json).toHaveBeenCalledWith(updated);
    });

    it("should forward the caller's token rather than its own opinion of their privileges", async () => {
      // Privacy is admin-only on an existing record, and it is `deed-poll-api` that decides whether
      // this caller may set it — from the token, not from an `isAdmin` flag this app could assert.
      vi.mocked(updateDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await PATCH(requestDouble({ params: { id: "case-1" }, body: { privacy: "Private" }, ...bearer }), responseDouble());

      expect(updateDeedPoll).toHaveBeenCalledWith("case-1", { privacy: "Private" }, CALLER);
    });

    it("should pass no token for a request that arrived without one, so api answers 401", async () => {
      vi.mocked(updateDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await PATCH(requestDouble({ params: { id: "case-1" }, body: {} }), responseDouble());

      expect(updateDeedPoll).toHaveBeenCalledWith("case-1", {}, { accessToken: undefined });
    });

    it("should forward a nullable field's null, so a patch can clear a value", async () => {
      vi.mocked(updateDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await PATCH(requestDouble({ params: { id: "case-1" }, body: { dateReceived: null }, ...bearer }), responseDouble());

      expect(updateDeedPoll).toHaveBeenCalledWith("case-1", { dateReceived: null }, expect.anything());
    });

    it("should throw a ZodError for an invalid field rather than reaching the domain", async () => {
      await expect(PATCH(requestDouble({ params: { id: "case-1" }, body: { refundAmount: "not a number" } }), responseDouble())).rejects.toThrow(ZodError);

      expect(updateDeedPoll).not.toHaveBeenCalled();
    });

    it("should accept an empty patch, matching the partial schema", async () => {
      vi.mocked(updateDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await PATCH(requestDouble({ params: { id: "case-1" }, body: {}, ...bearer }), responseDouble());

      expect(updateDeedPoll).toHaveBeenCalledWith("case-1", {}, expect.anything());
    });
  });
});
