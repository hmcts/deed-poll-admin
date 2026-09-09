import { listDocumentTypes } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../errors.js";
import { findDocumentTypes } from "./document-types.js";

// One operation, because api publishes one: `GET /caseworker/document-types`. The create, patch and
// delete this file used to hold — including the in-use check that made the delete a 409 rather than a
// foreign-key 500 — went with the cutover, because api has no endpoint for any of them and nothing in
// this app asks. See the note at the head of `document-types.ts`.
vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  listDocumentTypes: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };

const ok = <T>(data: T) => ({ ok: true as const, data });

describe("findDocumentTypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  it("should return the types in api's order, so the dropdown is not re-sorted here", async () => {
    const types = [
      { id: "type-1", name: "Birth certificate" },
      { id: "type-2", name: "Passport" }
    ];
    vi.mocked(listDocumentTypes).mockResolvedValue(ok(types) as never);

    expect(await findDocumentTypes(CALLER)).toEqual(types);
    expect(listDocumentTypes).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "http://api.test" }));
  });

  it("should answer an empty list when no types have been set up, which the upload form renders as a message", async () => {
    vi.mocked(listDocumentTypes).mockResolvedValue(ok([]) as never);

    expect(await findDocumentTypes(CALLER)).toEqual([]);
  });

  it("should present the caller's token, because api authenticates the read", async () => {
    vi.mocked(listDocumentTypes).mockResolvedValue(ok([]) as never);

    await findDocumentTypes({ accessToken: "a-token" });

    expect(vi.mocked(listDocumentTypes).mock.calls[0][0].accessToken).toBe("a-token");
  });

  it("should let a classified failure arrive as the domain error the pages already render", async () => {
    vi.mocked(listDocumentTypes).mockResolvedValue({ ok: false, error: { kind: "not-found", status: 404, message: "no types" } } as never);

    await expect(findDocumentTypes(CALLER)).rejects.toBeInstanceOf(NotFoundError);
  });
});
