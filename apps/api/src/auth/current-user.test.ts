import { DEEDPOLL_ADMIN, SERVICE_ACCOUNT_NAME } from "@hmcts/deed-poll";
import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A request carrying only the headers a test cares about. */
function requestWith(headers: Record<string, string | undefined>): Request {
  return { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

/**
 * The production warning is emitted once per module instance, so each test that depends on
 * NODE_ENV needs a fresh import rather than a shared one.
 */
async function freshUserFromRequest() {
  vi.resetModules();
  const module = await import("./current-user.js");
  return module.userFromRequest;
}

describe("userFromRequest", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it("should parse a comma-separated header and flag admin", async () => {
    const userFromRequest = await freshUserFromRequest();

    const user = userFromRequest(requestWith({ "x-user-roles": ` ${DEEDPOLL_ADMIN} , other ` }));

    expect(user.roles).toContain(DEEDPOLL_ADMIN);
    expect(user.isAdmin).toBe(true);
  });

  it("should be non-admin when the header is absent or empty", async () => {
    const userFromRequest = await freshUserFromRequest();

    expect(userFromRequest(requestWith({})).isAdmin).toBe(false);
    expect(userFromRequest(requestWith({ "x-user-roles": "" })).isAdmin).toBe(false);
    expect(userFromRequest(requestWith({ "x-user-roles": "" })).roles).toEqual([]);
  });

  it("should use x-user-name as the audit name when present", async () => {
    const userFromRequest = await freshUserFromRequest();

    const user = userFromRequest(requestWith({ "x-user-name": " A Caseworker " }));

    expect(user.name).toBe("A Caseworker");
  });

  it("should fall back to the service account when no name is given", async () => {
    const userFromRequest = await freshUserFromRequest();

    expect(userFromRequest(requestWith({})).name).toBe(SERVICE_ACCOUNT_NAME);
  });

  it("should ignore the role header entirely in production, so an accidental deploy fails closed", async () => {
    // The header scheme is an admin bypass; it must not grant anything off a developer's
    // machine. Phase 5 replaces it with IDAM.
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "production";
    const userFromRequest = await freshUserFromRequest();

    const user = userFromRequest(requestWith({ "x-user-roles": DEEDPOLL_ADMIN, "x-user-name": "Attacker" }));

    expect(user.roles).toEqual([]);
    expect(user.isAdmin).toBe(false);
    expect(user.name).toBe(SERVICE_ACCOUNT_NAME);
  });

  it("should explain the production lockout once, not on every request", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "production";
    const userFromRequest = await freshUserFromRequest();

    userFromRequest(requestWith({}));
    userFromRequest(requestWith({}));

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]?.[0]).toContain("Phase 5");
  });

  it("should not warn in development, where the scheme is the intended one", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const userFromRequest = await freshUserFromRequest();

    userFromRequest(requestWith({ "x-user-roles": DEEDPOLL_ADMIN }));

    expect(consoleError).not.toHaveBeenCalled();
  });
});
