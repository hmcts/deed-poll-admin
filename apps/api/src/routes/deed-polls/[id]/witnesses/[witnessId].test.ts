import { findWitness, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestDouble, responseDouble } from "../../../../express-doubles.js";
import * as route from "./[witnessId].js";
import { GET } from "./[witnessId].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findWitness: vi.fn()
}));

const params = { id: "case-1", witnessId: "witness-1" };

/** The caller's bearer token, which is the whole of what this handler passes on. */
const bearer = { headers: { authorization: "Bearer caseworker-token" } };
const CALLER = { accessToken: "caseworker-token" };

describe("/deed-polls/:id/witnesses/:witnessId routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("should scope the lookup to both the case and the witness", async () => {
      const witness = { id: "witness-1", witnessName: "Grace Hopper" };
      vi.mocked(findWitness).mockResolvedValue(witness as never);
      const res = responseDouble();

      await GET(requestDouble({ params, ...bearer }), res);

      expect(findWitness).toHaveBeenCalledWith("case-1", "witness-1", CALLER);
      expect(res.json).toHaveBeenCalledWith(witness);
    });

    it("should let a NotFoundError propagate for a witness belonging to another case", async () => {
      vi.mocked(findWitness).mockRejectedValue(new NotFoundError("Witness witness-1 not found"));

      await expect(GET(requestDouble({ params: { id: "other-case", witnessId: "witness-1" } }), responseDouble())).rejects.toThrow(NotFoundError);
    });
  });

  // Witnesses are read-only: api publishes no witness writes, so the PATCH and the admin-only DELETE
  // went with them rather than being left as routes that could only fail.
  it("should export neither PATCH nor DELETE, because api publishes no witness writes", () => {
    expect(route).not.toHaveProperty("PATCH");
    expect(route).not.toHaveProperty("DELETE");
  });
});
