import { describe, expect, it } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { GET } from "./index.js";

describe("service root", () => {
  describe("GET", () => {
    it("should redirect a caseworker to the case list", () => {
      const res = pageResponse();

      GET(pageRequest({ teamLeader: true }), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls");
    });

    // Decision 2: My referrals is a judge's home the way the case list is a caseworker's, and this is the only
    // place the roles are known — a judge landing on `/deed-polls` gets a list api answers 403 to.
    it("should redirect a judge to My referrals, since there is no pool to start from", () => {
      const res = pageResponse();

      GET(pageRequest({ judicial: true }), res);

      expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/mine");
    });

    // Caseworker-first, deliberately: the caseworker surface is the richer one, where the reverse leaves a
    // caseworker on a screen with no case list. It is not free — the judicial lists' own navigation renders only
    // inside that area, so there is nothing on the caseworker surface that reaches My referrals and such a user types
    // the URL. See the `landingPath` docblock, which states the cost.
    it("should redirect a user holding both roles to the case list", () => {
      const res = pageResponse();

      GET(pageRequest({ teamLeader: true, judicial: true }), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls");
    });

    // OWASP plan 01 Task 7. `/` is public, so the global gate skips it and the refusal has to be made here, the same
    // way: the no-access page, not a redirect to a case list that would refuse them in turn.
    it("should refuse a signed-in user api gives neither area to, rather than redirecting them", () => {
      const res = pageResponse();

      expect(() => GET(pageRequest({ persona: "none" }), res)).toThrow(expect.objectContaining({ name: "ForbiddenError", reason: "no-access" }));
      expect(res.redirect).not.toHaveBeenCalled();
    });

    // Back here after signing in, not to either home: the persona cannot be resolved before the token
    // exists, so pinning `/deed-polls` as the `returnTo` is what used to strand a judge.
    it("should send an anonymous visitor to log in and back to the root", () => {
      const res = pageResponse();

      GET(pageRequest({ signedIn: false }), res);

      expect(res.redirect).toHaveBeenCalledWith("/login?returnTo=%2F");
    });

    // The template's marketing home page rendered here. Asserting it does not render guards against
    // it coming back in a re-scaffold, which is how the file arrived in the first place.
    it("should not render a page of its own", () => {
      const res = pageResponse();

      GET(pageRequest({ teamLeader: true }), res);

      expect(res.render).not.toHaveBeenCalled();
    });

    it("should redirect exactly once", () => {
      const res = pageResponse();

      GET(pageRequest({ judicial: true }), res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
    });
  });
});

describe("staff role landing", () => {
  it.each(["teamLeader", "deliveryManager", "legacyAdmin", "caseworker"] as const)("should keep %s independent of judicial access", (persona) => {
    for (const judicial of [false, true]) {
      const res = pageResponse();

      GET(pageRequest({ persona, judicial }), res);

      expect(res.redirect).toHaveBeenCalledWith(judicial && persona === "caseworker" ? "/judicial/referrals/mine" : "/deed-polls");
    }
  });

  // A malformed (pre-`/me`) answer reads as no access, so it is refused here as the global gate refuses it everywhere
  // else (OWASP plan 01 Task 7), and is never sent to My referrals on the strength of its stale judicial flag.
  it("should refuse a session whose stored answer is malformed, rather than trust a stale judicial flag", () => {
    const res = pageResponse();

    expect(() => GET(pageRequest({ access: { roles: ["caseworker-deedpoll-judicial"], isJudicial: true } }), res)).toThrow(
      expect.objectContaining({ name: "ForbiddenError", reason: "no-access" })
    );
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
