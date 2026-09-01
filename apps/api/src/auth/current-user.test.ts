/**
 * What this file decides is narrow: a caller attached by `authenticate()` comes back unchanged, and
 * reading one that was never attached is an error rather than a quietly role-less user. The reduction
 * of IDAM's claims to a `CurrentUser` is `libs/deed-poll/src/auth/idam-claims.test.ts`'s, and the token
 * validation that produces those claims is `idam.test.ts`'s.
 */
import { currentUser, DEEDPOLL_ADMIN } from "@hmcts/deed-poll";
import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { setCurrentUser, userFromRequest } from "./current-user.js";

function request(): Request {
  return {} as Request;
}

describe("userFromRequest", () => {
  it("returns the caller that was attached to the request", () => {
    const req = request();
    setCurrentUser(req, currentUser([DEEDPOLL_ADMIN], "A Caseworker"));

    const user = userFromRequest(req);

    expect(user.isAdmin).toBe(true);
    expect(user.name).toBe("A Caseworker");
  });

  it("throws rather than inventing a role-less caller when none was attached", () => {
    // A role-less fallback also fails closed, but it fails as a 403 on a route that should have
    // worked — which reads as a permissions problem and sends whoever debugs it to IDAM.
    expect(() => userFromRequest(request())).toThrow(/authenticate\(\)/);
  });

  it("does not expose the caller as an enumerable property, so it cannot be serialised by accident", () => {
    // A JSON-serialised request is a plausible thing for logging middleware to do, and the caller is
    // not something to write to a log by accident. A symbol key is not visited by JSON.stringify or
    // Object.keys.
    const req = request();
    setCurrentUser(req, currentUser([DEEDPOLL_ADMIN], "A Caseworker"));

    expect(Object.keys(req)).toHaveLength(0);
    expect(JSON.stringify(req)).toBe("{}");
  });

  it("replaces the caller when set twice, so a re-authenticated request cannot keep the old one", () => {
    const req = request();
    setCurrentUser(req, currentUser([DEEDPOLL_ADMIN], "First"));
    setCurrentUser(req, currentUser([], "Second"));

    expect(userFromRequest(req)).toMatchObject({ isAdmin: false, name: "Second" });
  });
});
