import { createDeedPoll, findDeedPolls } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requestDouble, responseDouble } from "../../express-doubles.js";
import { GET, POST } from "./index.js";

// The schema is under test alongside the handler, so only the two api-backed service functions are
// replaced. createDeedPollSchema, the error classes and currentUser are all the real implementations.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPolls: vi.fn(),
  createDeedPoll: vi.fn()
}));

/** The caller's bearer token, which is the whole of what these handlers pass on. */
const bearer = { headers: { authorization: "Bearer caseworker-token" } };
const CALLER = { accessToken: "caseworker-token" };

describe("/deed-polls collection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /deed-polls", () => {
    it("should return the cases the domain returns", async () => {
      const cases = [{ id: "case-1" }, { id: "case-2" }];
      vi.mocked(findDeedPolls).mockResolvedValue(cases as never);
      const res = responseDouble();

      await GET(requestDouble(), res);

      expect(res.json).toHaveBeenCalledWith(cases);
    });

    it("should not pass a filter, so api resolves its own default and the caller sees everything", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue([] as never);

      await GET(requestDouble(bearer), responseDouble());

      expect(findDeedPolls).toHaveBeenCalledWith(undefined, CALLER);
    });
  });

  describe("POST /deed-polls", () => {
    it("should create the case and respond 201 with it", async () => {
      const created = { id: "case-1", displayReference: "DP/2026/0001" };
      vi.mocked(createDeedPoll).mockResolvedValue(created as never);
      const res = responseDouble();

      await POST(requestDouble({ body: { newForename: "Ada" }, ...bearer }), res);

      expect(createDeedPoll).toHaveBeenCalledWith({ newForename: "Ada" }, CALLER);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(created);
    });

    it("should forward the caller's token, which is what api reads their admin status from", async () => {
      // The create-time privacy default depends on it, and api derives it from the token rather than
      // being told — so there is nothing left here for an `isAdmin` flag to say.
      vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await POST(requestDouble({ body: {}, ...bearer }), responseDouble());

      expect(createDeedPoll).toHaveBeenCalledWith({}, CALLER);
    });

    it("should throw a ZodError for an invalid enum value rather than reaching the domain", async () => {
      await expect(POST(requestDouble({ body: { type: "NotAType" } }), responseDouble())).rejects.toThrow(ZodError);

      expect(createDeedPoll).not.toHaveBeenCalled();
    });

    it("should reject a US-style date, which the source forms never submit", async () => {
      await expect(POST(requestDouble({ body: { dateReceived: "01/03/2026" } }), responseDouble())).rejects.toThrow(ZodError);

      expect(createDeedPoll).not.toHaveBeenCalled();
    });

    it("should reject null for a field with a Prisma default, so it cannot clear one on create", async () => {
      await expect(POST(requestDouble({ body: { privacy: null } }), responseDouble())).rejects.toThrow(ZodError);

      expect(createDeedPoll).not.toHaveBeenCalled();
    });

    it("should strip unknown keys, as the global ValidationPipe's whitelist option did", async () => {
      vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await POST(requestDouble({ body: { newForename: "Ada", notAField: "dropped" } }), responseDouble());

      expect(createDeedPoll).toHaveBeenCalledWith({ newForename: "Ada" }, expect.anything());
    });

    it("should accept an empty body, because a case is logged incrementally", async () => {
      vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);
      const res = responseDouble();

      await POST(requestDouble({ body: {} }), res);

      expect(res.status).toHaveBeenCalledWith(201);
    });
  });
});
