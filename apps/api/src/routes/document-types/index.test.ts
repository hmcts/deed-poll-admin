import { createDocumentType, findDocumentTypes } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requestDouble, responseDouble } from "../../express-doubles.js";
import { GET, POST } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDocumentTypes: vi.fn(),
  createDocumentType: vi.fn()
}));

const documentType = { name: "Birth certificate", applicableMaritalStatuses: [1, 2], applicableTypes: [3] };

describe("/document-types collection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /document-types", () => {
    it("should return every type, taking no case id because types are global", async () => {
      const types = [{ id: "type-1" }, { id: "type-2" }];
      vi.mocked(findDocumentTypes).mockResolvedValue(types as never);
      const res = responseDouble();

      await GET(requestDouble(), res);

      expect(findDocumentTypes).toHaveBeenCalledWith();
      expect(res.json).toHaveBeenCalledWith(types);
    });
  });

  describe("POST /document-types", () => {
    it("should create the type and respond 201 with it", async () => {
      const created = { id: "type-1", ...documentType };
      vi.mocked(createDocumentType).mockResolvedValue(created as never);
      const res = responseDouble();

      await POST(requestDouble({ body: documentType }), res);

      expect(createDocumentType).toHaveBeenCalledWith(documentType);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(created);
    });

    it("should default both applicability lists when only a name is given", async () => {
      // optionSetValues is optional, and the Prisma columns default to []. A type that applies
      // to nothing is a legitimate starting point for reference data entered incrementally.
      vi.mocked(createDocumentType).mockResolvedValue({ id: "type-1" } as never);

      await POST(requestDouble({ body: { name: "Birth certificate" } }), responseDouble());

      expect(createDocumentType).toHaveBeenCalledWith({ name: "Birth certificate" });
    });

    it("should reject a body with no name", async () => {
      await expect(POST(requestDouble({ body: {} }), responseDouble())).rejects.toThrow(ZodError);

      expect(createDocumentType).not.toHaveBeenCalled();
    });

    it("should reject a name longer than the source column allows", async () => {
      await expect(POST(requestDouble({ body: { name: "x".repeat(101) } }), responseDouble())).rejects.toThrow(ZodError);

      expect(createDocumentType).not.toHaveBeenCalled();
    });

    it("should reject non-integer applicability values, which are Dynamics option-set integers", async () => {
      await expect(POST(requestDouble({ body: { ...documentType, applicableTypes: ["Adult"] } }), responseDouble())).rejects.toThrow(ZodError);

      expect(createDocumentType).not.toHaveBeenCalled();
    });

    it("should strip unknown keys, as the global ValidationPipe's whitelist option did", async () => {
      vi.mocked(createDocumentType).mockResolvedValue({ id: "type-1" } as never);

      await POST(requestDouble({ body: { ...documentType, notAField: "dropped" } }), responseDouble());

      expect(createDocumentType).toHaveBeenCalledWith(documentType);
    });
  });
});
