/**
 * Wired-router tests for the document-type routes.
 *
 * Its own file rather than a block in `routes/deed-polls/routes.wiring.test.ts`, because that one
 * builds a router over *its* directory and document-types is a sibling, not a child — which is the
 * substantive fact about this resource: it is global reference data, mounted at the top level.
 *
 * The thing worth pinning here is the **409**. It is the only one in this phase, it is reachable by
 * an ordinary caseworker action (deleting a type that happens to be in use), and before
 * `removeDocumentType` checked for references it was a 500 — the FK refusal arrived as a
 * `DriverAdapterError` that the error middleware could not recognise. A unit test on the handler
 * cannot show which status a caller receives; only a real request can.
 */
import { fileURLToPath } from "node:url";
import { ConflictError, findDocumentType, findDocumentTypes, NotFoundError, removeDocumentType } from "@hmcts/deed-poll";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../errors.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDocumentTypes: vi.fn(),
  createDocumentType: vi.fn(),
  findDocumentType: vi.fn(),
  updateDocumentType: vi.fn(),
  removeDocumentType: vi.fn()
}));

const routesDir = fileURLToPath(new URL(".", import.meta.url));

async function appWithDocumentTypeRoutes(): Promise<Express> {
  const app = express();
  app.use(express.json());
  app.use(await createSimpleRouter({ path: routesDir, prefix: "/document-types" }));
  app.use(errorHandler());
  return app;
}

describe("document-type routes wired through simple-router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
  });

  it("should answer 409 when deleting a type that documents still reference", async () => {
    vi.mocked(removeDocumentType).mockRejectedValue(new ConflictError("Cannot delete this document type: 2 document(s) still reference it"));

    const response = await request(await appWithDocumentTypeRoutes()).delete("/document-types/type-1");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Cannot delete this document type: 2 document(s) still reference it" });
  });

  it("should answer 204 when deleting a type nothing references", async () => {
    vi.mocked(removeDocumentType).mockResolvedValue(undefined);

    const response = await request(await appWithDocumentTypeRoutes()).delete("/document-types/type-1");

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
  });

  it("should keep 404 and 409 distinct, since one means the type is gone and the other that it is in use", async () => {
    vi.mocked(removeDocumentType).mockRejectedValue(new NotFoundError("Document type type-1 not found"));

    const response = await request(await appWithDocumentTypeRoutes()).delete("/document-types/type-1");

    expect(response.status).toBe(404);
  });

  it("should mount the collection at the top level, not under a case", async () => {
    vi.mocked(findDocumentTypes).mockResolvedValue([] as never);

    const response = await request(await appWithDocumentTypeRoutes()).get("/document-types");

    expect(response.status).toBe(200);
    expect(findDocumentTypes).toHaveBeenCalledWith();
  });

  it("should route an id to the dynamic route", async () => {
    vi.mocked(findDocumentType).mockResolvedValue({ id: "type-1" } as never);

    const response = await request(await appWithDocumentTypeRoutes()).get("/document-types/type-1");

    expect(response.status).toBe(200);
    expect(findDocumentType).toHaveBeenCalledWith("type-1");
  });

  it("should answer 400 with a field error for a create with no name", async () => {
    const response = await request(await appWithDocumentTypeRoutes())
      .post("/document-types")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([expect.objectContaining({ field: "name" })]);
  });

  it("should answer 201 on create", async () => {
    const { createDocumentType } = await import("@hmcts/deed-poll");
    vi.mocked(createDocumentType).mockResolvedValue({ id: "type-1" } as never);

    const response = await request(await appWithDocumentTypeRoutes())
      .post("/document-types")
      .send({ name: "Birth certificate" });

    expect(response.status).toBe(201);
  });
});
