import { ConflictError, findDocumentType, NotFoundError, removeDocumentType, updateDocumentType } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requestDouble, responseDouble } from "../../express-doubles.js";
import { DELETE, GET, PATCH } from "./[id].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDocumentType: vi.fn(),
  updateDocumentType: vi.fn(),
  removeDocumentType: vi.fn()
}));

const params = { id: "type-1" };

describe("/document-types/:id routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("should look the type up by its id alone, because a type has no parent", async () => {
      const type = { id: "type-1", name: "Birth certificate" };
      vi.mocked(findDocumentType).mockResolvedValue(type as never);
      const res = responseDouble();

      await GET(requestDouble({ params }), res);

      expect(findDocumentType).toHaveBeenCalledWith("type-1");
      expect(res.json).toHaveBeenCalledWith(type);
    });

    it("should let a NotFoundError propagate", async () => {
      vi.mocked(findDocumentType).mockRejectedValue(new NotFoundError("Document type type-1 not found"));

      await expect(GET(requestDouble({ params }), responseDouble())).rejects.toThrow(NotFoundError);
    });
  });

  describe("PATCH", () => {
    it("should apply the patch and return the updated type", async () => {
      const updated = { id: "type-1", name: "Renamed" };
      vi.mocked(updateDocumentType).mockResolvedValue(updated as never);
      const res = responseDouble();

      await PATCH(requestDouble({ params, body: { name: "Renamed" } }), res);

      expect(updateDocumentType).toHaveBeenCalledWith("type-1", { name: "Renamed" });
      expect(res.json).toHaveBeenCalledWith(updated);
    });

    it("should accept replacing just one applicability list", async () => {
      vi.mocked(updateDocumentType).mockResolvedValue({ id: "type-1" } as never);

      await PATCH(requestDouble({ params, body: { applicableTypes: [1, 5] } }), responseDouble());

      expect(updateDocumentType).toHaveBeenCalledWith("type-1", { applicableTypes: [1, 5] });
    });

    it("should reject an over-length name on a patch too", async () => {
      await expect(PATCH(requestDouble({ params, body: { name: "x".repeat(101) } }), responseDouble())).rejects.toThrow(ZodError);

      expect(updateDocumentType).not.toHaveBeenCalled();
    });
  });

  describe("DELETE", () => {
    it("should delete the type and respond 204 with no body", async () => {
      vi.mocked(removeDocumentType).mockResolvedValue(undefined);
      const res = responseDouble();

      await DELETE(requestDouble({ params }), res);

      expect(removeDocumentType).toHaveBeenCalledWith("type-1");
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should let a ConflictError propagate for a type still in use, rather than reporting 204", async () => {
      // The only 409 in this phase. Before removeDocumentType checked, the FK refusal surfaced as
      // a DriverAdapterError and this answered 500.
      vi.mocked(removeDocumentType).mockRejectedValue(new ConflictError("Cannot delete this document type: 2 document(s) still reference it"));
      const res = responseDouble();

      await expect(DELETE(requestDouble({ params }), res)).rejects.toThrow(ConflictError);

      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
