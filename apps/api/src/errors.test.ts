import { ForbiddenError, InvalidInputError, NotFoundError } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { errorHandler } from "./errors.js";

const req = {} as Request;

function responseSpy(headersSent = false) {
  return {
    headersSent,
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe("errorHandler", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
    vi.restoreAllMocks();
  });

  it("should map NotFoundError to 404 with its message", () => {
    const res = responseSpy();

    errorHandler()(new NotFoundError("Deed poll not found"), req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Deed poll not found" });
  });

  it("should map ForbiddenError to 403 with its message", () => {
    const res = responseSpy();

    errorHandler()(new ForbiddenError("Requires one of the following roles: deedpoll-admin"), req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Requires one of the following roles: deedpoll-admin" });
  });

  it("should map InvalidInputError to 400 and preserve its field errors", () => {
    // The SSR forms render these against individual inputs, so dropping them would
    // downgrade every field-level failure to an unattributed one.
    const res = responseSpy();
    const errors = [{ field: "surname", message: "Enter a surname" }];

    errorHandler()(new InvalidInputError("Validation failed", errors), req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Validation failed", errors });
  });

  it("should map an InvalidInputError with no field errors to an empty array, not undefined", () => {
    const res = responseSpy();

    errorHandler()(new InvalidInputError("Bad request"), req, res, next);

    expect(res.json).toHaveBeenCalledWith({ error: "Bad request", errors: [] });
  });

  it("should map a ZodError to 400 with field errors in the same shape", () => {
    const res = responseSpy();
    const result = z.object({ surname: z.string().min(1, "Enter a surname") }).safeParse({ surname: "" });

    errorHandler()(result.error!, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Validation failed",
      errors: [{ field: "surname", message: "Enter a surname" }]
    });
  });

  it("should map an unrecognised error to a generic 500", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = responseSpy();

    errorHandler()(new Error("connect ECONNREFUSED 127.0.0.1:5432"), req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });

  it("should not leak an unrecognised error's message to the caller", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = responseSpy();

    errorHandler()(new Error("password=hunter2"), req, res, next);

    expect(JSON.stringify(res.json.mock.calls)).not.toContain("hunter2");
  });

  it("should log an unrecognised error so the detail is not simply lost", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const unexpected = new Error("boom");

    errorHandler()(unexpected, req, responseSpy(), next);

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Unhandled error"), unexpected);
  });

  it("should delegate to Express when the response has already started", () => {
    const res = responseSpy(true);
    const error = new NotFoundError("too late");

    errorHandler()(error, req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});
