import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVICE_ACCOUNT_NAME } from "./current-user.js";
import { DEEDPOLL_ADMIN } from "./roles.js";

/** A header reader over a fixed set of headers, matching Express's case-insensitive `req.header`. */
function headers(values: Record<string, string | undefined>) {
  return (name: string) => values[name.toLowerCase()];
}

/**
 * The lockout warning is emitted once per module instance, so a test that asserts on it needs a
 * fresh import. `resetHeaderAuthWarning` exists for the same reason, but a fresh module also proves
 * the once-only behaviour rather than relying on the reset.
 */
async function freshUserFromHeaders() {
  vi.resetModules();
  const module = await import("./header-user.js");
  return module.userFromHeaders;
}

describe("auth/header-user", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it("should parse a comma-separated header and flag admin", async () => {
    const userFromHeaders = await freshUserFromHeaders();

    const user = userFromHeaders(headers({ "x-user-roles": `other, ${DEEDPOLL_ADMIN} ` }));

    expect(user.roles).toEqual(["other", DEEDPOLL_ADMIN]);
    expect(user.isAdmin).toBe(true);
  });

  it("should be non-admin when the header is absent or empty", async () => {
    const userFromHeaders = await freshUserFromHeaders();

    expect(userFromHeaders(headers({})).isAdmin).toBe(false);
    expect(userFromHeaders(headers({ "x-user-roles": "" })).isAdmin).toBe(false);
    expect(userFromHeaders(headers({ "x-user-roles": "" })).roles).toEqual([]);
  });

  it("should read the header case-insensitively, as Express does", async () => {
    // Guards the reason a getter is passed rather than a plain headers object: a test that set
    // "X-User-Roles" against a naive lookup would pass while the real thing found nothing.
    const userFromHeaders = await freshUserFromHeaders();

    expect(userFromHeaders((name) => (name.toLowerCase() === "x-user-roles" ? DEEDPOLL_ADMIN : undefined)).isAdmin).toBe(true);
  });

  it("should use x-user-name as the audit name when present", async () => {
    const userFromHeaders = await freshUserFromHeaders();

    expect(userFromHeaders(headers({ "x-user-name": "A Caseworker" })).name).toBe("A Caseworker");
  });

  it("should fall back to the service account when no name is given", async () => {
    const userFromHeaders = await freshUserFromHeaders();

    expect(userFromHeaders(headers({})).name).toBe(SERVICE_ACCOUNT_NAME);
  });

  it("should ignore the role header entirely in production, so an accidental deploy fails closed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "production";
    const userFromHeaders = await freshUserFromHeaders();

    const user = userFromHeaders(headers({ "x-user-roles": DEEDPOLL_ADMIN }));

    expect(user.roles).toEqual([]);
    expect(user.isAdmin).toBe(false);
  });

  it("should fail closed when NODE_ENV is not set at all", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.NODE_ENV;
    const userFromHeaders = await freshUserFromHeaders();

    expect(userFromHeaders(headers({ "x-user-roles": DEEDPOLL_ADMIN })).isAdmin).toBe(false);
  });

  it("should fail closed for an environment name it does not recognise", async () => {
    // The case the allowlist exists for: `aat` is not "production", so a polarity-inverted check
    // would leave the bypass live there.
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "aat";
    const userFromHeaders = await freshUserFromHeaders();

    expect(userFromHeaders(headers({ "x-user-roles": DEEDPOLL_ADMIN })).isAdmin).toBe(false);
  });

  it("should honour the header under NODE_ENV=test, which is what vitest sets", async () => {
    process.env.NODE_ENV = "test";
    const userFromHeaders = await freshUserFromHeaders();

    expect(userFromHeaders(headers({ "x-user-roles": DEEDPOLL_ADMIN })).isAdmin).toBe(true);
  });

  it("should name the offending NODE_ENV in the warning, since that is the likely cause", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "aat";
    const userFromHeaders = await freshUserFromHeaders();

    userFromHeaders(headers({ "x-user-roles": DEEDPOLL_ADMIN }));

    expect(logged.mock.calls[0][0]).toContain('"aat"');
  });

  it("should explain the lockout once, not on every request", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "production";
    const userFromHeaders = await freshUserFromHeaders();

    userFromHeaders(headers({}));
    userFromHeaders(headers({}));
    userFromHeaders(headers({}));

    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("should not warn in development, where the scheme is the intended one", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const userFromHeaders = await freshUserFromHeaders();

    userFromHeaders(headers({ "x-user-roles": DEEDPOLL_ADMIN }));

    expect(logged).not.toHaveBeenCalled();
  });

  it("should warn again after a reset, which is what the reset is for", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "production";
    vi.resetModules();
    const { userFromHeaders, resetHeaderAuthWarning } = await import("./header-user.js");

    userFromHeaders(headers({}));
    resetHeaderAuthWarning();
    userFromHeaders(headers({}));

    expect(logged).toHaveBeenCalledTimes(2);
  });
});
