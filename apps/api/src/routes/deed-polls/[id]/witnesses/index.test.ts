import { createWitness, findWitnesses } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requestDouble, responseDouble } from "../../../../express-doubles.js";
import { GET, POST } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findWitnesses: vi.fn(),
  createWitness: vi.fn()
}));

const witness = {
  witnessName: "Grace Hopper",
  witnessAddress: "1 Navy Yard, London",
  witnessOccupation: "Rear Admiral",
  declarant: false
};

describe("/deed-polls/:id/witnesses collection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /deed-polls/:id/witnesses", () => {
    it("should return the witnesses for the case in the path", async () => {
      const witnesses = [{ id: "witness-1" }];
      vi.mocked(findWitnesses).mockResolvedValue(witnesses as never);
      const res = responseDouble();

      await GET(requestDouble({ params: { id: "case-1" } }), res);

      expect(findWitnesses).toHaveBeenCalledWith("case-1");
      expect(res.json).toHaveBeenCalledWith(witnesses);
    });
  });

  describe("POST /deed-polls/:id/witnesses", () => {
    it("should create the witness against the case and respond 201", async () => {
      const created = { id: "witness-1", ...witness };
      vi.mocked(createWitness).mockResolvedValue(created as never);
      const res = responseDouble();

      await POST(requestDouble({ params: { id: "case-1" }, body: witness }), res);

      expect(createWitness).toHaveBeenCalledWith("case-1", witness);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(created);
    });

    it("should pass no author context, because a witness has no createdBy column to stamp", async () => {
      vi.mocked(createWitness).mockResolvedValue({ id: "witness-1" } as never);

      await POST(requestDouble({ params: { id: "case-1" }, body: witness, userName: "A Caseworker" }), responseDouble());

      expect(createWitness).toHaveBeenCalledWith("case-1", witness);
    });

    it("should reject an empty body, because all four witness fields are required", async () => {
      await expect(POST(requestDouble({ params: { id: "case-1" }, body: {} }), responseDouble())).rejects.toThrow(ZodError);

      expect(createWitness).not.toHaveBeenCalled();
    });

    it("should reject a partial witness, unlike a case which is logged incrementally", async () => {
      await expect(POST(requestDouble({ params: { id: "case-1" }, body: { witnessName: "Grace Hopper" } }), responseDouble())).rejects.toThrow(ZodError);

      expect(createWitness).not.toHaveBeenCalled();
    });

    it("should reject a name longer than the source column allows", async () => {
      const tooLong = { ...witness, witnessName: "x".repeat(101) };

      await expect(POST(requestDouble({ params: { id: "case-1" }, body: tooLong }), responseDouble())).rejects.toThrow(ZodError);

      expect(createWitness).not.toHaveBeenCalled();
    });

    it("should strip unknown keys, as the global ValidationPipe's whitelist option did", async () => {
      vi.mocked(createWitness).mockResolvedValue({ id: "witness-1" } as never);

      await POST(requestDouble({ params: { id: "case-1" }, body: { ...witness, notAField: "dropped" } }), responseDouble());

      expect(createWitness).toHaveBeenCalledWith("case-1", witness);
    });
  });
});
