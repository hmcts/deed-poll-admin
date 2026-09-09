/**
 * Wired-router tests for the document-type routes.
 *
 * Its own file rather than a block in `routes/deed-polls/routes.wiring.test.ts`, because that one
 * builds a router over *its* directory and document-types is a sibling, not a child — which is the
 * substantive fact about this resource: it is global reference data, mounted at the top level.
 *
 * **This used to be about the 409.** `removeDocumentType` refused to delete a type any document still
 * referenced, and before that check existed the FK refusal arrived as a `DriverAdapterError` the error
 * middleware could not recognise, so an ordinary caseworker deleting a type in use was told the server
 * had broken. The whole resource is read-only now — `deed-poll-api` publishes no document-type writes —
 * so the constraint, and the responsibility for answering a 409 for it, are api's. What is left worth
 * pinning is that the collection is mounted where it claims to be and that the retired routes answer
 * 404 rather than something worse.
 */
import { fileURLToPath } from "node:url";
import { DEEDPOLL_ADMIN, findDocumentTypes, NotFoundError } from "@hmcts/deed-poll";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../errors.js";
import { attachUserDouble } from "../../express-doubles.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDocumentTypes: vi.fn()
}));

const routesDir = fileURLToPath(new URL(".", import.meta.url));

/** The token the request arrives with, which the handler forwards and nothing else. */
const CALLER = { accessToken: "caseworker-token" };

async function appWithDocumentTypeRoutes(): Promise<Express> {
  const app = express();
  app.use(express.json());
  app.use(attachUserDouble(DEEDPOLL_ADMIN));
  app.use(await createSimpleRouter({ path: routesDir, prefix: "/document-types" }));
  app.use(errorHandler());
  return app;
}

describe("document-type routes wired through simple-router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
  });

  it("should mount the collection at the top level, not under a case", async () => {
    vi.mocked(findDocumentTypes).mockResolvedValue([] as never);

    const response = await request(await appWithDocumentTypeRoutes())
      .get("/document-types")
      .set("authorization", "Bearer caseworker-token");

    expect(response.status).toBe(200);
    expect(findDocumentTypes).toHaveBeenCalledWith(CALLER);
  });

  it("should let a NotFoundError become a 404 rather than a 500", async () => {
    vi.mocked(findDocumentTypes).mockRejectedValue(new NotFoundError("Document types not found"));

    const response = await request(await appWithDocumentTypeRoutes()).get("/document-types");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Document types not found" });
  });

  // The single-type read, the create, the patch and the 409-answering delete all went in task 4 of
  // docs/plans/02-dal-cutover-to-api.md: api publishes none of them. A 404 here rather than a 200 or a
  // 204 is the whole of the behaviour change, and it would otherwise be provable only by absence.
  it.each([
    { what: "a single-type read", send: (app: Express) => request(app).get("/document-types/type-1") },
    { what: "a create", send: (app: Express) => request(app).post("/document-types").send({ name: "Birth certificate" }) },
    { what: "a patch", send: (app: Express) => request(app).patch("/document-types/type-1").send({ name: "Renamed" }) },
    { what: "a delete", send: (app: Express) => request(app).delete("/document-types/type-1") }
  ])("should answer 404 for $what, which api has no endpoint for", async ({ send }) => {
    const response = await send(await appWithDocumentTypeRoutes());

    expect(response.status).toBe(404);
  });
});
