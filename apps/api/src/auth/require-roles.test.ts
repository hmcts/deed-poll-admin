import { currentUser, DEEDPOLL_ADMIN, ForbiddenError, type Role } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setCurrentUser } from "./current-user.js";
import { requireRoles } from "./require-roles.js";

/** A request already authenticated, holding the given roles — as `authenticate()` leaves it. */
function requestWith(...roles: string[]): Request {
  const req = {} as Request;
  setCurrentUser(req, currentUser(roles as Role[]));
  return req;
}

const res = {} as Response;

describe("requireRoles", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it("should allow the request when no roles are required", () => {
    requireRoles()(requestWith(), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("should allow the request when the caller holds the required role", () => {
    requireRoles(DEEDPOLL_ADMIN)(requestWith(DEEDPOLL_ADMIN), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("should allow the request when the caller holds one of several required roles", () => {
    requireRoles("other-role" as typeof DEEDPOLL_ADMIN, DEEDPOLL_ADMIN)(requestWith(DEEDPOLL_ADMIN), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("should forbid the request when the caller has no roles", () => {
    requireRoles(DEEDPOLL_ADMIN)(requestWith(), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it("should forbid the request when the caller holds only an unrelated role", () => {
    requireRoles(DEEDPOLL_ADMIN)(requestWith("some-other-role"), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it("should name the required roles in the error, so the caller knows what is missing", () => {
    requireRoles(DEEDPOLL_ADMIN)(requestWith(), res, next);

    expect(vi.mocked(next).mock.calls[0]?.[0]).toMatchObject({
      message: `Requires one of the following roles: ${DEEDPOLL_ADMIN}`
    });
  });

  it("should defer to the error handler rather than respond itself", () => {
    // Passing the error on keeps the 403 body in one place; a middleware that wrote its own
    // would diverge from the shape errorHandler produces.
    const responded = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    requireRoles(DEEDPOLL_ADMIN)(requestWith(), responded, next);

    expect(responded.status).not.toHaveBeenCalled();
    expect(responded.json).not.toHaveBeenCalled();
  });
});
