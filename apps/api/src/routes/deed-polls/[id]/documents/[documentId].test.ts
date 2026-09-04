import { findDocument, NotFoundError, removeDocument, updateDocument } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requestDouble, responseDouble } from "../../../../express-doubles.js";
import { DELETE, GET, PATCH } from "./[documentId].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDocument: vi.fn(),
  updateDocument: vi.fn(),
  removeDocument: vi.fn()
}));

const params = { id: "case-1", documentId: "doc-1" };

describe("/deed-polls/:id/documents/:documentId routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("should scope the lookup to both the case and the document", async () => {
      const doc = { id: "doc-1", name: "birth.pdf" };
      vi.mocked(findDocument).mockResolvedValue(doc as never);
      const res = responseDouble();

      await GET(requestDouble({ params }), res);

      expect(findDocument).toHaveBeenCalledWith("case-1", "doc-1");
      expect(res.json).toHaveBeenCalledWith(doc);
    });

    it("should 404 a document belonging to another case", async () => {
      vi.mocked(findDocument).mockRejectedValue(new NotFoundError("Document doc-1 not found"));

      await expect(GET(requestDouble({ params: { id: "other", documentId: "doc-1" } }), responseDouble())).rejects.toThrow(NotFoundError);
    });
  });

  describe("PATCH", () => {
    it("should apply the patch scoped to both ids", async () => {
      vi.mocked(updateDocument).mockResolvedValue({ id: "doc-1" } as never);
      const res = responseDouble();

      await PATCH(requestDouble({ params, body: { name: "renamed.pdf" } }), res);

      expect(updateDocument).toHaveBeenCalledWith("case-1", "doc-1", { name: "renamed.pdf" });
      expect(res.json).toHaveBeenCalledWith({ id: "doc-1" });
    });

    it("should allow re-typing a document, which is the common correction", async () => {
      vi.mocked(updateDocument).mockResolvedValue({ id: "doc-1" } as never);

      await PATCH(requestDouble({ params, body: { documentTypeId: "07f3f0e0-0000-4000-8000-000000000000" } }), responseDouble());

      expect(updateDocument).toHaveBeenCalledWith("case-1", "doc-1", { documentTypeId: "07f3f0e0-0000-4000-8000-000000000000" });
    });

    it("should reject a document type that is not a uuid", async () => {
      await expect(PATCH(requestDouble({ params, body: { documentTypeId: "nope" } }), responseDouble())).rejects.toThrow(ZodError);

      expect(updateDocument).not.toHaveBeenCalled();
    });

    it("should accept an empty patch, matching the partial schema", async () => {
      vi.mocked(updateDocument).mockResolvedValue({ id: "doc-1" } as never);

      await PATCH(requestDouble({ params, body: {} }), responseDouble());

      expect(updateDocument).toHaveBeenCalledWith("case-1", "doc-1", {});
    });
  });

  describe("DELETE", () => {
    it("should delete scoped to both ids and respond 204 with no body", async () => {
      vi.mocked(removeDocument).mockResolvedValue(undefined);
      const res = responseDouble();

      await DELETE(requestDouble({ params }), res);

      expect(removeDocument).toHaveBeenCalledWith("case-1", "doc-1");
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should let a NotFoundError propagate rather than reporting 204", async () => {
      vi.mocked(removeDocument).mockRejectedValue(new NotFoundError("Document doc-1 not found"));
      const res = responseDouble();

      await expect(DELETE(requestDouble({ params }), res)).rejects.toThrow(NotFoundError);

      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
