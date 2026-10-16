// Type-level tests, which vitest's typecheck mode runs through `tsc`: `yarn build` excludes every test file, so a
// `@ts-expect-error` in a `.test.ts` would never be checked by anything.
import type { Request } from "express";
import { describe, expectTypeOf, it } from "vitest";
import { type SecurityEventName, type SecurityEventProps, securityEvent } from "./security-events.js";

declare const req: Request;

describe("securityEvent's types", () => {
  it("should name exactly the agreed vocabulary", () => {
    expectTypeOf<SecurityEventName>().toEqualTypeOf<
      | "auth.login.succeeded"
      | "auth.login.failed"
      | "auth.logout"
      | "auth.session.ended"
      | "auth.persona.switched"
      | "auth.persona.switch_failed"
      | "authz.denied"
      | "csrf.refused"
    >();
  });

  it("should refuse an unknown event name", () => {
    // @ts-expect-error not in the vocabulary
    securityEvent("auth.something_else", req);
  });

  it("should refuse an unknown property key", () => {
    // @ts-expect-error not on the allowlist
    securityEvent("auth.logout", req, { email: "someone@example.com" });
  });

  it("should refuse the properties the emitter fills in itself", () => {
    // @ts-expect-error the route is `baseUrl + path`, never a caller's `originalUrl`
    securityEvent("authz.denied", req, { route: "/deed-polls?surname=Smith" });
    expectTypeOf<SecurityEventProps>().not.toHaveProperty("sid");
  });
});
