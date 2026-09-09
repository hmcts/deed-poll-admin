import { findDocument, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestDouble, responseDouble } from "../../../../express-doubles.js";
import * as route from "./[documentId].js";
import { GET } from "./[documentId].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDocument: vi.fn()
}));

const params = { id: "case-1", documentId: "doc-1" };

/** The caller's bearer token, which is the whole of what this handler passes on. */
const bearer = { headers: { authorization: "Bearer caseworker-token" } };
const CALLER = { accessToken: "caseworker-token" };

describe("/deed-polls/:id/documents/:documentId routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("should scope the lookup to both the case and the document", async () => {
      const doc = { id: "doc-1", name: "birth.pdf" };
      vi.mocked(findDocument).mockResolvedValue(doc as never);
      const res = responseDouble();

      await GET(requestDouble({ params, ...bearer }), res);

      expect(findDocument).toHaveBeenCalledWith("case-1", "doc-1", CALLER);
      expect(res.json).toHaveBeenCalledWith(doc);
    });

    it("should 404 a document belonging to another case", async () => {
      vi.mocked(findDocument).mockRejectedValue(new NotFoundError("Document doc-1 not found"));

      await expect(GET(requestDouble({ params: { id: "other", documentId: "doc-1" } }), responseDouble())).rejects.toThrow(NotFoundError);
    });
  });

  // api publishes neither a document patch nor a document delete, so both went rather than being left as
  // routes that could only fail. The blob cleanup the delete did went with them: api owns the bytes.
  it("should export neither PATCH nor DELETE, because api publishes neither document write", () => {
    expect(route).not.toHaveProperty("PATCH");
    expect(route).not.toHaveProperty("DELETE");
  });
});
