import { describe, expect, it } from "vitest";
import { ACCESS_GAZETTE, OVERRIDE_PRIVACY } from "./capabilities.js";
import { SERVICE_ACCOUNT_NAME } from "./current-user.js";
import { userFromClaims } from "./idam-claims.js";
import { DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_JUDICIAL, DEEDPOLL_TEAM_LEADER } from "./roles.js";

describe("auth/idam-claims", () => {
  it("should grant nothing from IDAM roles, because access is api's answer", () => {
    const user = userFromClaims({ roles: [DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_TEAM_LEADER, DEEDPOLL_JUDICIAL], name: "A" });

    expect(user).toEqual({ staff: false, judicial: false, capabilities: [], isAdmin: false, isJudicial: false, name: "A" });
    expect(user).not.toHaveProperty("roles");
  });

  it("should carry the access it is given beside the claims", () => {
    const user = userFromClaims({ name: "A" }, { staff: true, judicial: true, capabilities: [OVERRIDE_PRIVACY, ACCESS_GAZETTE] });

    expect(user).toMatchObject({ staff: true, judicial: true, capabilities: [OVERRIDE_PRIVACY, ACCESS_GAZETTE], isAdmin: true, isJudicial: true });
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
    const user = userFromClaims({ name: "A", iss: "x", aud: "y", exp: 1, custom: {} });

    expect(user.name).toBe("A");
  });
});
