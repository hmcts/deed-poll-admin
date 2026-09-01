/**
 * The scheme itself — the fail-closed NODE_ENV allowlist, the header parsing, the once-only
 * warning — is tested in `libs/deed-poll/src/auth/header-user.test.ts`, where it now lives. What is
 * left to test here is the adapter: that it reads through Express's case-insensitive `req.header`
 * rather than poking at `req.headers` directly, which is the one thing this file decides.
 */
import { DEEDPOLL_ADMIN, SERVICE_ACCOUNT_NAME } from "@hmcts/deed-poll";
import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userFromRequest } from "./current-user.js";

function requestWith(headers: Record<string, string | undefined>): Request {
  return { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

describe("userFromRequest", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("should resolve roles and name from the request's headers", async () => {
    const user = userFromRequest(requestWith({ "x-user-roles": DEEDPOLL_ADMIN, "x-user-name": "A Caseworker" }));

    expect(user.isAdmin).toBe(true);
    expect(user.name).toBe("A Caseworker");
  });

  it("should read headers through req.header, so casing does not matter", async () => {
    // Express lower-cases incoming header names, but a caller may not. Going through req.header is
    // what makes that irrelevant; reading req.headers directly would not.
    const user = userFromRequest({ header: (name: string) => (name === "x-user-roles" ? DEEDPOLL_ADMIN : undefined) } as unknown as Request);

    expect(user.isAdmin).toBe(true);
  });

  it("should fall back to the service account when the request carries no name", async () => {
    expect(userFromRequest(requestWith({})).name).toBe(SERVICE_ACCOUNT_NAME);
  });
});
