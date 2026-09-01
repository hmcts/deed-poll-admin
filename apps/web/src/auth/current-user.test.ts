/**
 * One decision, and it is the fallback: what a page sees if it somehow runs without a session.
 * `requireAuth` should make that impossible, which is exactly why the fallback matters — it is the
 * behaviour nobody will notice until the gate has a hole.
 */
import { SERVICE_ACCOUNT_NAME } from "@hmcts/deed-poll";
import { describe, expect, it } from "vitest";
import { pageRequest } from "../express-doubles.js";
import { userFromRequest } from "./current-user.js";

describe("userFromRequest", () => {
  it("returns the signed-in user from the session", () => {
    const user = userFromRequest(pageRequest({ admin: true, name: "A Caseworker" }));

    expect(user).toMatchObject({ isAdmin: true, name: "A Caseworker" });
  });

  it("gives a caller with no roles no admin", () => {
    expect(userFromRequest(pageRequest({ name: "A Caseworker" }))).toMatchObject({ isAdmin: false });
  });

  it("falls back to no roles at all when there is no session user", () => {
    // Fails closed. The alternative — inheriting anything from the request — is how an unauthenticated
    // request would end up acting as an admin, silently.
    const user = userFromRequest(pageRequest({ signedIn: false }));

    expect(user.isAdmin).toBe(false);
    expect(user.roles).toEqual([]);
  });

  it("attributes a write with no session user to the service account", () => {
    // So an unattributed write is labelled as one in the audit columns rather than left blank.
    expect(userFromRequest(pageRequest({ signedIn: false })).name).toBe(SERVICE_ACCOUNT_NAME);
  });
});
