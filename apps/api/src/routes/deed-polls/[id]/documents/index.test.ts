import { findDocuments, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestDouble, responseDouble } from "../../../../express-doubles.js";
import * as route from "./index.js";
import { GET } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDocuments: vi.fn()
}));

/** The caller's bearer token, which is the whole of what this handler passes on. */
const bearer = { headers: { authorization: "Bearer caseworker-token" } };
const CALLER = { accessToken: "caseworker-token" };

describe("/deed-polls/:id/documents collection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("should return the documents for the case in the path", async () => {
      const documents = [{ id: "doc-1" }];
      vi.mocked(findDocuments).mockResolvedValue(documents as never);
      const res = responseDouble();

      await GET(requestDouble({ params: { id: "case-1" }, ...bearer }), res);

      expect(findDocuments).toHaveBeenCalledWith("case-1", CALLER);
      expect(res.json).toHaveBeenCalledWith(documents);
    });

    it("should let a NotFoundError propagate, so a missing case 404s rather than answering []", async () => {
      vi.mocked(findDocuments).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));

      await expect(GET(requestDouble({ params: { id: "nope" } }), responseDouble())).rejects.toThrow(NotFoundError);
    });
  });

  // The metadata-only create is gone: api has no endpoint for a document row with no file, and nothing in
  // this app logged one. Uploading bytes is `upload.ts`, which is the operation api does publish.
  it("should export no POST, because api has no metadata-only document create", () => {
    expect(route).not.toHaveProperty("POST");
  });
});
