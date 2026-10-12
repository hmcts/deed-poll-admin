import { currentUser, DEEDPOLL_ADMIN, DEEDPOLL_CASEWORKER, DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_JUDICIAL, DEEDPOLL_TEAM_LEADER } from "@hmcts/deed-poll";
import { describe, expect, it } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { GET } from "./index.js";

describe("service root", () => {
  describe("GET", () => {
    it("should redirect a caseworker to the case list", async () => {
      const res = pageResponse();

      await GET(pageRequest({ admin: true }), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls");
    });

    // Decision 2: the pool is a judge's home the way the case list is a caseworker's, and this is the only
    // place the roles are known — a judge landing on `/deed-polls` gets a list api answers 403 to.
    it("should redirect a judge to the judicial pool", async () => {
      const res = pageResponse();

      await GET(pageRequest({ judicial: true }), res);

      expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals");
    });

    // Caseworker-first, deliberately: the caseworker surface is the richer one, where the reverse leaves a
    // caseworker on a screen with no case list. It is not free — the judicial lists' own navigation renders only
    // inside that area, so there is nothing on the caseworker surface that reaches the pool and such a user types
    // the URL. See the `landingPath` docblock, which states the cost.
    it("should redirect a user holding both roles to the case list", async () => {
      const res = pageResponse();

      await GET(pageRequest({ admin: true, judicial: true }), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls");
    });

    it("should redirect a signed-in user with neither role to the case list", async () => {
      const res = pageResponse();

      await GET(pageRequest(), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls");
    });

    // Back here after signing in, not to either home: the persona cannot be resolved before the token
    // exists, so pinning `/deed-polls` as the `returnTo` is what used to strand a judge.
    it("should send an anonymous visitor to log in and back to the root", async () => {
      const res = pageResponse();

      await GET(pageRequest({ signedIn: false }), res);

      expect(res.redirect).toHaveBeenCalledWith("/login?returnTo=%2F");
    });

    // The template's marketing home page rendered here. Asserting it does not render guards against
    // it coming back in a re-scaffold, which is how the file arrived in the first place.
    it("should not render a page of its own", async () => {
      const res = pageResponse();

      await GET(pageRequest({ admin: true }), res);

      expect(res.render).not.toHaveBeenCalled();
    });

    it("should redirect exactly once", async () => {
      const res = pageResponse();

      await GET(pageRequest({ judicial: true }), res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
    });
  });
});

describe("staff role landing", () => {
  it.each([DEEDPOLL_TEAM_LEADER, DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_ADMIN, DEEDPOLL_CASEWORKER])(
    "should keep %s independent of judicial access",
    async (role) => {
      for (const judicial of [false, true]) {
        const req = pageRequest();
        req.session.deedPoll.user = currentUser(judicial ? [role, DEEDPOLL_JUDICIAL] : [role]);
        const res = pageResponse();
        await GET(req, res);
        expect(res.redirect).toHaveBeenCalledWith(judicial && role === DEEDPOLL_CASEWORKER ? "/judicial/referrals" : "/deed-polls");
      }
    }
  );
});
