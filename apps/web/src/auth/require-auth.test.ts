import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPublicPath, requireAuth } from "./require-auth.js";

function request(path: string, method = "GET", user?: unknown): Request {
  return { path, method, originalUrl: path, session: { deedPoll: user ? { user } : {} } } as unknown as Request;
}

function response() {
  const res = { redirect: vi.fn(), render: vi.fn(), status: vi.fn() } as unknown as Response & {
    redirect: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
  };
  res.status.mockReturnValue(res);
  return res;
}

describe("requireAuth", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
    vi.clearAllMocks();
  });

  it("redirects an unauthenticated GET to login, remembering where it was going", () => {
    const res = response();

    requireAuth()(request("/deed-polls"), res, next);

    expect(res.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fdeed-polls");
    expect(next).not.toHaveBeenCalled();
  });

  it("403s an unauthenticated POST rather than redirecting", () => {
    // Replaying a POST after login would resubmit a form the user has not seen since — for the edit
    // tab that is 46 fields they may not have intended.
    const res = response();

    requireAuth()(request("/deed-polls/new", "POST"), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("lets an authenticated request through", () => {
    requireAuth()(request("/deed-polls", "GET", { roles: [], isAdmin: false, name: "A" }), response(), next);

    expect(next).toHaveBeenCalled();
  });

  it("guards a page it has never heard of, because the allowlist is the exception", () => {
    // The polarity that matters: a page added tomorrow is protected by default rather than protected
    // when someone remembers.
    const res = response();

    requireAuth()(request("/some/page/added/later"), res, next);

    expect(res.redirect).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  describe("the allowlist", () => {
    it("allows the flow's own pages, or login would be a loop", () => {
      for (const path of ["/login", "/oauth2/callback", "/logout"]) {
        expect(isPublicPath(path), path).toBe(true);
      }
    });

    it("allows the landing page and the statutory footer pages", () => {
      for (const path of ["/", "/accessibility-statement", "/privacy-policy", "/terms-and-conditions", "/contact-us", "/cookies"]) {
        expect(isPublicPath(path), path).toBe(true);
      }
    });

    it("allows health probes, which have no session", () => {
      expect(isPublicPath("/health")).toBe(true);
      expect(isPublicPath("/health/readiness")).toBe(true);
    });

    it("allows asset paths in both development and built form", () => {
      for (const path of ["/assets/css/index.css", "/@vite/client", "/@fs/x", "/src/assets/js/index.ts", "/favicon.ico"]) {
        expect(isPublicPath(path), path).toBe(true);
      }
    });

    it("does not allow any deed-poll page", () => {
      for (const path of ["/deed-polls", "/deed-polls/new", "/deed-polls/abc", "/deed-polls/abc/edit/application", "/deed-polls/abc/notes/new"]) {
        expect(isPublicPath(path), path).toBe(false);
      }
    });

    it("matches a path exactly rather than by prefix, so /logout-everything is not public", () => {
      expect(isPublicPath("/logout-everything")).toBe(false);
      expect(isPublicPath("/loginx")).toBe(false);
    });
  });
});
