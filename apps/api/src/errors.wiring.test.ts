/**
 * Pins the assumption the whole error-mapping approach rests on: that a domain error thrown
 * out of an async route handler reaches `errorHandler` without a try/catch in the handler.
 *
 * Express 5 forwards a rejected handler promise to error middleware; Express 4 did not. If
 * that ever regresses, every ported handler silently starts returning 500 instead of its
 * mapped status, and unit-testing `errorHandler` in isolation would not notice. Hence a real
 * request through a real router.
 */
import { DEEDPOLL_ADMIN, InvalidInputError, NotFoundError } from "@hmcts/deed-poll";
import express, { type Express, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireRoles } from "./auth/require-roles.js";
import { errorHandler } from "./errors.js";

function appThrowing(error: Error): Express {
  const app = express();
  app.get("/thing", async (_req: Request, _res: Response) => {
    throw error;
  });
  app.use(errorHandler());
  return app;
}

describe("error handling wired into an app", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 404 when an async handler throws NotFoundError, with no try/catch", async () => {
    const response = await request(appThrowing(new NotFoundError("Deed poll not found"))).get("/thing");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Deed poll not found" });
  });

  it("should return 400 and the field errors when an async handler throws InvalidInputError", async () => {
    const error = new InvalidInputError("Validation failed", [{ field: "surname", message: "Enter a surname" }]);

    const response = await request(appThrowing(error)).get("/thing");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Validation failed",
      errors: [{ field: "surname", message: "Enter a surname" }]
    });
  });

  it("should return 403 when requireRoles rejects the caller", async () => {
    const app = express();
    app.get("/thing", requireRoles(DEEDPOLL_ADMIN), (_req, res) => res.json({ ok: true }));
    app.use(errorHandler());

    const response = await request(app).get("/thing");

    expect(response.status).toBe(403);
    expect(response.body.error).toContain(DEEDPOLL_ADMIN);
  });

  it("should let the request through when requireRoles is satisfied", async () => {
    const app = express();
    app.get("/thing", requireRoles(DEEDPOLL_ADMIN), (_req, res) => res.json({ ok: true }));
    app.use(errorHandler());

    const response = await request(app).get("/thing").set("x-user-roles", DEEDPOLL_ADMIN);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("should return a generic 500 for an unexpected error, leaking nothing", async () => {
    // errorHandler logs the real error by design; silence it so the expected noise does not
    // read as a failure in test output.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(appThrowing(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).get("/thing");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal server error" });
  });

  it("should map an error thrown from a handler mounted as an array, as guarded routes are", async () => {
    // simple-router normalises `export const DELETE = [requireRoles(...), handler]` into an
    // array of handlers, so the throw happens in the second element rather than the first.
    const app = express();
    app.delete("/thing", [
      requireRoles(DEEDPOLL_ADMIN),
      async () => {
        throw new NotFoundError("Deed poll not found");
      }
    ]);
    app.use(errorHandler());

    const response = await request(app).delete("/thing").set("x-user-roles", DEEDPOLL_ADMIN);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Deed poll not found" });
  });
});
