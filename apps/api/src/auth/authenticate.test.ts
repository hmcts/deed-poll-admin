import { currentUser, DEEDPOLL_ADMIN, UnauthorizedError } from "@hmcts/deed-poll";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../errors.js";
import { authenticate, type TokenResolver } from "./authenticate.js";
import { userFromRequest } from "./current-user.js";

const config = { issuerUrl: "https://idam.example/o", audiences: ["deed-poll-admin"] };

function requestWith(authorization?: string): Request {
  return { header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined) } as unknown as Request;
}

describe("authenticate", () => {
  let next: NextFunction;
  let resolve: TokenResolver;

  beforeEach(() => {
    next = vi.fn();
    resolve = vi.fn(async () => currentUser([DEEDPOLL_ADMIN], "A Caseworker"));
  });

  it("attaches the resolved caller and continues", async () => {
    const req = requestWith("Bearer a.valid.token");

    await authenticate(config, resolve)(req, {} as Response, next);

    expect(resolve).toHaveBeenCalledWith(config, "a.valid.token");
    expect(next).toHaveBeenCalledWith();
    expect(userFromRequest(req)).toMatchObject({ isAdmin: true, name: "A Caseworker" });
  });

  it("refuses a request with no Authorization header", async () => {
    await authenticate(config, resolve)(requestWith(), {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses a request using another authentication scheme", async () => {
    await authenticate(config, resolve)(requestWith("Basic dXNlcjpwYXNz"), {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(resolve).not.toHaveBeenCalled();
  });

  it("forwards a rejected token as the 401 it is", async () => {
    resolve = vi.fn(async () => {
      throw new UnauthorizedError("Invalid access token");
    });

    await authenticate(config, resolve)(requestWith("Bearer forged"), {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("forwards an IDAM outage as itself, not as a 401", async () => {
    // Answering 401 because IDAM is unreachable tells every caller their credentials are wrong and
    // hides the outage behind a status code that reads as a client error.
    resolve = vi.fn(async () => {
      throw new Error("fetch failed");
    });

    await authenticate(config, resolve)(requestWith("Bearer a.valid.token"), {} as Response, next);

    const forwarded = vi.mocked(next).mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Error);
    expect(forwarded).not.toBeInstanceOf(UnauthorizedError);
  });

  it("defers to the error handler rather than responding itself", async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await authenticate(config, resolve)(requestWith(), res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe("authenticate mounted globally", () => {
  function app(resolve: TokenResolver) {
    const built = express();
    built.use(authenticate(config, resolve));
    built.get("/thing", (req, res) => res.json({ name: userFromRequest(req).name }));
    built.use((_req, res) => {
      res.status(404).json({ error: "Not found" });
    });
    built.use(errorHandler());
    return built;
  }

  const admin: TokenResolver = async () => currentUser([DEEDPOLL_ADMIN], "A Caseworker");

  it("answers 401 with a WWW-Authenticate challenge, as RFC 9110 requires", async () => {
    const response = await request(app(admin)).get("/thing");

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    expect(response.body).toEqual({ error: "An IDAM access token is required" });
  });

  it("lets an authenticated request reach the handler", async () => {
    const response = await request(app(admin)).get("/thing").set("authorization", "Bearer a.valid.token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ name: "A Caseworker" });
  });

  it("answers 401 rather than 404 for an unknown path, since it runs before routing", async () => {
    // Which paths exist is not something an unauthenticated caller needs to learn.
    const response = await request(app(admin)).get("/no-such-route");

    expect(response.status).toBe(401);
  });

  it("still answers 404 for an unknown path once authenticated", async () => {
    const response = await request(app(admin)).get("/no-such-route").set("authorization", "Bearer a.valid.token");

    expect(response.status).toBe(404);
  });
});
