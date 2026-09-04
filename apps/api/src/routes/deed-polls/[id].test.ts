import { DEEDPOLL_ADMIN, findDeedPoll, NotFoundError, removeDeedPoll, SERVICE_ACCOUNT_NAME, updateDeedPoll } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requestDouble, responseDouble, routeHandler } from "../../express-doubles.js";
import { DELETE, GET, PATCH } from "./[id].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  updateDeedPoll: vi.fn(),
  removeDeedPoll: vi.fn()
}));

describe("/deed-polls/:id routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /deed-polls/:id", () => {
    it("should return the case for the id in the path", async () => {
      const found = { id: "case-1", notes: [], witnesses: [], documents: [] };
      vi.mocked(findDeedPoll).mockResolvedValue(found as never);
      const res = responseDouble();

      await GET(requestDouble({ params: { id: "case-1" } }), res);

      expect(findDeedPoll).toHaveBeenCalledWith("case-1");
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

      await PATCH(requestDouble({ params: { id: "case-1" }, body: { newForename: "Ada" } }), res);

      expect(updateDeedPoll).toHaveBeenCalledWith("case-1", { newForename: "Ada" }, { isAdmin: false, userName: SERVICE_ACCOUNT_NAME });
      expect(res.json).toHaveBeenCalledWith(updated);
    });

    it("should pass isAdmin true for an admin caller, since privacy is admin-only on an existing record", async () => {
      vi.mocked(updateDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await PATCH(requestDouble({ params: { id: "case-1" }, body: { privacy: "Private" }, roles: DEEDPOLL_ADMIN }), responseDouble());

      expect(updateDeedPoll).toHaveBeenCalledWith("case-1", { privacy: "Private" }, { isAdmin: true, userName: SERVICE_ACCOUNT_NAME });
    });

    it("should forward a nullable field's null, so a patch can clear a value", async () => {
      vi.mocked(updateDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await PATCH(requestDouble({ params: { id: "case-1" }, body: { dateReceived: null } }), responseDouble());

      expect(updateDeedPoll).toHaveBeenCalledWith("case-1", { dateReceived: null }, expect.anything());
    });

    it("should throw a ZodError for an invalid field rather than reaching the domain", async () => {
      await expect(PATCH(requestDouble({ params: { id: "case-1" }, body: { refundAmount: "not a number" } }), responseDouble())).rejects.toThrow(ZodError);

      expect(updateDeedPoll).not.toHaveBeenCalled();
    });

    it("should accept an empty patch, matching the partial schema", async () => {
      vi.mocked(updateDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await PATCH(requestDouble({ params: { id: "case-1" }, body: {} }), responseDouble());

      expect(updateDeedPoll).toHaveBeenCalledWith("case-1", {}, expect.anything());
    });
  });

  describe("DELETE /deed-polls/:id", () => {
    it("should delete the case and respond 204 with no body", async () => {
      vi.mocked(removeDeedPoll).mockResolvedValue(undefined);
      const res = responseDouble();

      await routeHandler(DELETE)(requestDouble({ params: { id: "case-1" } }), res);

      expect(removeDeedPoll).toHaveBeenCalledWith("case-1");
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should let a NotFoundError propagate rather than reporting 204 for a case that never existed", async () => {
      vi.mocked(removeDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll missing not found"));
      const res = responseDouble();

      await expect(routeHandler(DELETE)(requestDouble({ params: { id: "missing" } }), res)).rejects.toThrow(NotFoundError);

      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
