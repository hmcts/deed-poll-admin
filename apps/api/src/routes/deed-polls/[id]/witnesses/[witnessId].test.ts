import { findWitness, NotFoundError, removeWitness, updateWitness } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requestDouble, responseDouble } from "../../../../express-doubles.js";
import { DELETE, GET, PATCH } from "./[witnessId].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findWitness: vi.fn(),
  updateWitness: vi.fn(),
  removeWitness: vi.fn()
}));

const params = { id: "case-1", witnessId: "witness-1" };

describe("/deed-polls/:id/witnesses/:witnessId routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("should scope the lookup to both the case and the witness", async () => {
      const witness = { id: "witness-1", witnessName: "Grace Hopper" };
      vi.mocked(findWitness).mockResolvedValue(witness as never);
      const res = responseDouble();

      await GET(requestDouble({ params }), res);

      expect(findWitness).toHaveBeenCalledWith("case-1", "witness-1");
      expect(res.json).toHaveBeenCalledWith(witness);
    });

    it("should let a NotFoundError propagate for a witness belonging to another case", async () => {
      vi.mocked(findWitness).mockRejectedValue(new NotFoundError("Witness witness-1 not found"));

      await expect(GET(requestDouble({ params: { id: "other-case", witnessId: "witness-1" } }), responseDouble())).rejects.toThrow(NotFoundError);
    });
  });

  describe("PATCH", () => {
    it("should apply the patch scoped to both ids and return the updated witness", async () => {
      const updated = { id: "witness-1", witnessOccupation: "Commodore" };
      vi.mocked(updateWitness).mockResolvedValue(updated as never);
      const res = responseDouble();

      await PATCH(requestDouble({ params, body: { witnessOccupation: "Commodore" } }), res);

      expect(updateWitness).toHaveBeenCalledWith("case-1", "witness-1", { witnessOccupation: "Commodore" });
      expect(res.json).toHaveBeenCalledWith(updated);
    });

    it("should accept a single field, because the update schema is partial", async () => {
      vi.mocked(updateWitness).mockResolvedValue({ id: "witness-1" } as never);

      await PATCH(requestDouble({ params, body: { declarant: true } }), responseDouble());

      expect(updateWitness).toHaveBeenCalledWith("case-1", "witness-1", { declarant: true });
    });

    it("should reject a field of the wrong type rather than reaching the domain", async () => {
      await expect(PATCH(requestDouble({ params, body: { declarant: "yes" } }), responseDouble())).rejects.toThrow(ZodError);

      expect(updateWitness).not.toHaveBeenCalled();
    });

    it("should reject an over-length address, as the source column limit still applies on a patch", async () => {
      await expect(PATCH(requestDouble({ params, body: { witnessAddress: "x".repeat(251) } }), responseDouble())).rejects.toThrow(ZodError);

      expect(updateWitness).not.toHaveBeenCalled();
    });
  });

  describe("DELETE", () => {
    it("should delete scoped to both ids and respond 204 with no body", async () => {
      vi.mocked(removeWitness).mockResolvedValue(undefined);
      const res = responseDouble();

      await DELETE(requestDouble({ params }), res);

      expect(removeWitness).toHaveBeenCalledWith("case-1", "witness-1");
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should let a NotFoundError propagate rather than reporting 204 for a witness it did not delete", async () => {
      vi.mocked(removeWitness).mockRejectedValue(new NotFoundError("Witness witness-1 not found"));
      const res = responseDouble();

      await expect(DELETE(requestDouble({ params }), res)).rejects.toThrow(NotFoundError);

      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
