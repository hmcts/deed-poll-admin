import { findDocumentTypes, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestDouble, responseDouble } from "../../express-doubles.js";
import * as route from "./index.js";
import { GET } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDocumentTypes: vi.fn()
}));

/** The caller's bearer token, which is the whole of what this handler passes on. */
const bearer = { headers: { authorization: "Bearer caseworker-token" } };
const CALLER = { accessToken: "caseworker-token" };

describe("/document-types collection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /document-types", () => {
    it("should return every type, taking no case id because types are global", async () => {
      const types = [{ id: "type-1" }, { id: "type-2" }];
      vi.mocked(findDocumentTypes).mockResolvedValue(types as never);
      const res = responseDouble();

      await GET(requestDouble(bearer), res);

      expect(findDocumentTypes).toHaveBeenCalledWith(CALLER);
      expect(res.json).toHaveBeenCalledWith(types);
    });

    it("should let a classified failure propagate to the error middleware", async () => {
      vi.mocked(findDocumentTypes).mockRejectedValue(new NotFoundError("no types"));

      await expect(GET(requestDouble(), responseDouble())).rejects.toThrow(NotFoundError);
    });
  });

  // api publishes no document-type writes, so the create went and `[id].ts` with it. Asserted rather
  // than left implicit: reference data that silently accepts a write nothing persists is worse than a
  // route that is not there.
  it("should export no POST, because api publishes no document-type writes", () => {
    expect(route).not.toHaveProperty("POST");
  });
});
