import { createDocument, findDocuments, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requestDouble, responseDouble } from "../../../../express-doubles.js";
import { GET, POST } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDocuments: vi.fn(),
  createDocument: vi.fn()
}));

const metadata = { direction: "Incoming", name: "birth.pdf", documentTypeId: "07f3f0e0-0000-4000-8000-000000000000" };

describe("/deed-polls/:id/documents collection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("should return the documents for the case in the path", async () => {
      const documents = [{ id: "doc-1" }];
      vi.mocked(findDocuments).mockResolvedValue(documents as never);
      const res = responseDouble();

      await GET(requestDouble({ params: { id: "case-1" } }), res);

      expect(findDocuments).toHaveBeenCalledWith("case-1");
      expect(res.json).toHaveBeenCalledWith(documents);
    });

    it("should let a NotFoundError propagate, so a missing case 404s rather than answering []", async () => {
      vi.mocked(findDocuments).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));

      await expect(GET(requestDouble({ params: { id: "nope" } }), responseDouble())).rejects.toThrow(NotFoundError);
    });
  });

  describe("POST", () => {
    it("should create metadata only and respond 201, with no file involved", async () => {
      const created = { id: "doc-1", ...metadata };
      vi.mocked(createDocument).mockResolvedValue(created as never);
      const res = responseDouble();

      await POST(requestDouble({ params: { id: "case-1" }, body: metadata }), res);

      expect(createDocument).toHaveBeenCalledWith("case-1", metadata);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(created);
    });

    it("should reject a body with no document type, which the FK would otherwise fail on", async () => {
      await expect(POST(requestDouble({ params: { id: "case-1" }, body: { direction: "Incoming", name: "a.pdf" } }), responseDouble())).rejects.toThrow(
        ZodError
      );

      expect(createDocument).not.toHaveBeenCalled();
    });

    it("should reject a document type that is not a uuid", async () => {
      await expect(POST(requestDouble({ params: { id: "case-1" }, body: { ...metadata, documentTypeId: "not-a-uuid" } }), responseDouble())).rejects.toThrow(
        ZodError
      );

      expect(createDocument).not.toHaveBeenCalled();
    });

    it("should reject an unrecognised direction", async () => {
      await expect(POST(requestDouble({ params: { id: "case-1" }, body: { ...metadata, direction: "Sideways" } }), responseDouble())).rejects.toThrow(ZodError);

      expect(createDocument).not.toHaveBeenCalled();
    });

    it("should reject an empty body, because a document needs a type and a direction", async () => {
      await expect(POST(requestDouble({ params: { id: "case-1" }, body: {} }), responseDouble())).rejects.toThrow(ZodError);

      expect(createDocument).not.toHaveBeenCalled();
    });
  });
});
