import { describe, expect, it } from "vitest";
import { SERVICE_ACCOUNT_NAME } from "./current-user.js";
import { userFromClaims } from "./idam-claims.js";
import { DEEDPOLL_ADMIN, DEEDPOLL_CASEWORKER, DEEDPOLL_JUDICIAL } from "./roles.js";

describe("auth/idam-claims", () => {
  it("keeps the ordinary caseworker role without granting admin or judicial powers", () => {
    expect(userFromClaims({ roles: [DEEDPOLL_CASEWORKER] })).toMatchObject({
      roles: [DEEDPOLL_CASEWORKER],
      isAdmin: false,
      isJudicial: false
    });
  });

  it("keeps a role this service recognises", () => {
    const user = userFromClaims({ roles: [DEEDPOLL_ADMIN] });

    expect(user.roles).toEqual([DEEDPOLL_ADMIN]);
    expect(user.isAdmin).toBe(true);
  });

  it("keeps the judicial role, which the whole judicial screen depends on surviving into the session", () => {
    // The role was dropped here before it was listed in KNOWN_ROLES, which fails closed and so presents
    // as a judge being refused their own area rather than as a missing list entry.
    const user = userFromClaims({ roles: [DEEDPOLL_JUDICIAL] });

    expect(user.roles).toEqual([DEEDPOLL_JUDICIAL]);
    expect(user.isJudicial).toBe(true);
  });

  it("does not make a judge an admin, or an admin a judge", () => {
    // Alternatives, not a ladder: the judicial api surface returns a narrower view of an application
    // than any caseworker sees, so neither role implies the other.
    expect(userFromClaims({ roles: [DEEDPOLL_JUDICIAL] }).isAdmin).toBe(false);
    expect(userFromClaims({ roles: [DEEDPOLL_ADMIN] }).isJudicial).toBe(false);
  });

  it("keeps all recognised roles for a caller who holds them", () => {
    const user = userFromClaims({ roles: [DEEDPOLL_ADMIN, DEEDPOLL_CASEWORKER, DEEDPOLL_JUDICIAL] });

    expect(user.roles).toEqual([DEEDPOLL_ADMIN, DEEDPOLL_CASEWORKER, DEEDPOLL_JUDICIAL]);
    expect(user.isAdmin).toBe(true);
    expect(user.isJudicial).toBe(true);
  });

  it("drops roles from other CFT services rather than carrying them", () => {
    // IDAM issues roles across the whole estate, so a caseworker's token names roles this service has
    // no rules for. Carrying them would put unmanaged strings into the object authorization decisions
    // are made from.
    const user = userFromClaims({ roles: ["caseworker-civil", "citizen", DEEDPOLL_ADMIN, "judiciary"] });

    expect(user.roles).toEqual([DEEDPOLL_ADMIN]);
  });

  it("is not an admin when the token names no role this service knows", () => {
    const user = userFromClaims({ roles: ["caseworker-civil"] });

    expect(user.roles).toEqual([]);
    expect(user.isAdmin).toBe(false);
    expect(user.isJudicial).toBe(false);
  });

  it("does not mistake another service's judicial-sounding role for this one", () => {
    // IDAM issues `judiciary` and per-service judicial roles across the estate; only this service's own
    // string reaches a judicial screen here.
    for (const role of ["judiciary", "caseworker-judicial", "caseworker-deedpoll-judge"]) {
      expect(userFromClaims({ roles: [role] }).isJudicial, role).toBe(false);
    }
  });

  it("accepts roles as a comma-separated string, which some IDAM configurations send", () => {
    // Getting this wrong yields an empty role list: fails closed, but looks like a permissions bug
    // rather than a parsing one, which is the expensive kind to diagnose.
    expect(userFromClaims({ roles: `citizen, ${DEEDPOLL_ADMIN}` }).isAdmin).toBe(true);
  });

  it("trims whitespace around a role", () => {
    expect(userFromClaims({ roles: [` ${DEEDPOLL_ADMIN} `] }).isAdmin).toBe(true);
  });

  it("fails closed when roles are absent or an unexpected shape", () => {
    for (const roles of [undefined, null, 42, {}, true]) {
      expect(userFromClaims({ roles }).roles).toEqual([]);
    }
  });

  it("prefers the name claim for the audit columns", () => {
    expect(userFromClaims({ name: "A Caseworker" }).name).toBe("A Caseworker");
  });

  it("composes given and family names when there is no name claim", () => {
    expect(userFromClaims({ given_name: "Ada", family_name: "Lovelace" }).name).toBe("Ada Lovelace");
  });

  it("uses whichever of given or family name is present", () => {
    expect(userFromClaims({ given_name: "Ada" }).name).toBe("Ada");
    expect(userFromClaims({ family_name: "Lovelace" }).name).toBe("Lovelace");
  });

  it("falls back to sub before the service account, so a real person is not logged as automation", () => {
    // createdBy reading as an opaque identifier is still traceable; attributing a person's write to
    // the service account is not.
    expect(userFromClaims({ sub: "idam-user-123" }).name).toBe("idam-user-123");
  });

  it("falls back to the service account only when nothing identifies the user", () => {
    expect(userFromClaims({}).name).toBe(SERVICE_ACCOUNT_NAME);
  });

  it("ignores a blank name rather than storing an empty audit value", () => {
    expect(userFromClaims({ name: "   ", sub: "idam-user-123" }).name).toBe("idam-user-123");
  });

  it("ignores extra claims it does not read", () => {
    const user = userFromClaims({ roles: [DEEDPOLL_ADMIN], name: "A", iss: "x", aud: "y", exp: 1, custom: {} });

    expect(user.isAdmin).toBe(true);
    expect(user.name).toBe("A");
  });
});
