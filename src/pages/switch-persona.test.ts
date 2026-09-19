/**
 * The switch itself: what lands in the session, and the two ways it must refuse.
 *
 * **`config` is mocked, and `personaSwitcherEnabled` is not.** The route's own gate runs for real — what a test
 * here can show is that the route consults it and refuses when it is shut. Steering the real package is not an
 * option: it resolves the environment once when first loaded, and it is an externalized CommonJS dependency, so
 * `vi.resetModules()` does not give a second reading either. Which pair of resolved values opens the gate is
 * `persona-switcher.test.ts`'s subject.
 *
 * **The forced-refresh block at the bottom is the point of this task.** Replacing the access token alone leaves
 * the previous user's refresh token and subject in the session, and `refreshMiddleware` renews five minutes
 * before expiry — so the session reverts to whoever was signed in before, mid-test, presenting as the app
 * randomly losing your persona rather than as anything traceable to here. Nothing about a switch that has just
 * happened would reveal it, which is why the renewal is driven rather than reasoned about.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentUser, DEEDPOLL_JUDICIAL } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshTokens } from "../auth/idam.js";
import { passwordGrantLogin } from "../auth/password-grant.js";
import { PERSONA_SWITCH_PATH } from "../auth/persona-switcher.js";
import { refreshMiddleware } from "../auth/refresh-middleware.js";
import { pageRequest, pageResponse, type RequestDouble } from "../express-doubles.js";
import * as route from "./switch-persona.js";

/** Every `config` key this route's graph reads: the gate's two, the persona password, and IDAM's settings. */
const settings = vi.hoisted(() => {
  const values = new Map<string, unknown>([
    ["personaSwitcher.enabled", true],
    ["personaSwitcher.password", "Pa55word11"],
    ["environmentName", "development"],
    ["idam.issuerUrl", "http://localhost:5556/o"],
    ["idam.clientId", "deed-poll-admin"],
    ["idam.clientSecret", ""],
    ["idam.redirectUri", "http://localhost:3000/oauth2/callback"],
    ["idam.scope", "openid profile roles offline_access"]
  ]);
  return values;
});

vi.mock("config", () => ({
  default: {
    get: (key: string) => {
      if (!settings.has(key)) throw new Error(`Configuration property "${key}" is not defined`);
      return settings.get(key);
    }
  }
}));

vi.mock("../auth/password-grant.js", () => ({ passwordGrantLogin: vi.fn() }));
// Partial, because `refreshMiddleware` is driven for real below and everything else it reaches should be real.
vi.mock("../auth/idam.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/idam.js")>()),
  refreshTokens: vi.fn()
}));

const JUDGE = {
  user: currentUser([DEEDPOLL_JUDICIAL], "A Judge"),
  subject: "judge@example.com",
  tokens: { idToken: "a-judge-id-token", accessToken: "a-judge-access-token", refreshToken: "a-judge-refresh-token", expiresAt: 1_800_000_000 }
};

/** A caseworker part-way through a session, which is who every test here starts as. */
function signedInCaseworker(body: unknown = { persona: "judge" }): RequestDouble {
  const req = pageRequest({ subject: "caseworker@example.com", accessToken: "a-caseworker-access-token", body });
  req.session.deedPoll.refreshToken = "a-caseworker-refresh-token";
  req.session.deedPoll.tokenExpiresAt = 1_700_000_000;
  return req;
}

describe("the persona switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(passwordGrantLogin).mockResolvedValue(JUDGE);
  });

  it("should obtain a real token for the persona's own user rather than rewriting the session's roles", async () => {
    // The finding the feature rests on: api derives roles from userinfo with the token it is given, so a
    // synthesised role list would render the judicial chrome and then collect a 403 on every call behind it.
    await route.POST(signedInCaseworker(), pageResponse(), vi.fn());

    expect(passwordGrantLogin).toHaveBeenCalledWith(expect.anything(), "judge@example.com", "Pa55word11");
  });

  it("should put the persona's user, subject and tokens in the session", async () => {
    const req = signedInCaseworker();

    await route.POST(req, pageResponse(), vi.fn());

    expect(req.session.deedPoll).toMatchObject({
      user: JUDGE.user,
      subject: "judge@example.com",
      accessToken: "a-judge-access-token",
      idToken: "a-judge-id-token"
    });
  });

  // The trap. `updateTokens` would have left this one alone, and the symptom arrives minutes later.
  it("should replace the refresh token, not only the access token", async () => {
    const req = signedInCaseworker();

    await route.POST(req, pageResponse(), vi.fn());

    expect(req.session.deedPoll.refreshToken).toBe("a-judge-refresh-token");
  });

  it("should regenerate the session id, since the authenticated identity has changed", async () => {
    const req = signedInCaseworker();

    await route.POST(req, pageResponse(), vi.fn());

    expect(req.session.regenerate).toHaveBeenCalled();
    expect(req.session.save).toHaveBeenCalled();
  });

  it("should redirect to the root, leaving index.ts to decide the new persona's home", async () => {
    // Not `/judicial/referrals`: a destination chosen here would be a second copy of that routing, wrong for
    // whichever persona it drifted away from.
    const res = pageResponse();

    await route.POST(signedInCaseworker(), res, vi.fn());

    expect(res.redirect).toHaveBeenCalledWith("/");
  });

  it("should accept POST and nothing else, so no crafted URL can change a persona", async () => {
    // `simple-router` registers a route per exported method, so a `GET` export is the only way one could
    // exist — there is no handler refusing the method, and a GET is a 404.
    expect(Object.keys(route)).toEqual(["POST"]);
  });

  it("should be the path the form posts to", async () => {
    // The URL is derived from this file's name, so the constant in `persona-switcher.ts` and the file are two
    // halves of one route. A rename of either alone leaves a form posting to a 404.
    expect(PERSONA_SWITCH_PATH).toBe(`/${path.basename(fileURLToPath(import.meta.url), ".test.ts")}`);
  });

  describe("when the switcher is not on offer", () => {
    // `next()` reaches `notFoundHandler()`, which `app.ts` mounts after the router — so a deployed environment
    // outside the allowlist answers exactly as it would for a route that does not exist. Same non-enumerability
    // argument as `/judicial/**`'s 404.
    it("should hand the request on to the not-found handler when the flag is off", async () => {
      settings.set("personaSwitcher.enabled", false);
      const req = signedInCaseworker();
      const next = vi.fn();

      try {
        await route.POST(req, pageResponse(), next);
      } finally {
        settings.set("personaSwitcher.enabled", true);
      }

      expect(next).toHaveBeenCalledWith();
      expect(passwordGrantLogin).not.toHaveBeenCalled();
      expect(req.session.deedPoll.accessToken).toBe("a-caseworker-access-token");
    });

    it("should hand it on in an environment outside the allowlist, whatever the flag says", async () => {
      // The second half of the gate, which is what a `demo` or `prod` deploy carrying the flag by accident runs
      // into. Both halves are consulted here rather than only the one the route happens to call.
      settings.set("environmentName", "production");
      const next = vi.fn();

      try {
        await route.POST(signedInCaseworker(), pageResponse(), next);
      } finally {
        settings.set("environmentName", "development");
      }

      expect(next).toHaveBeenCalledWith();
      expect(passwordGrantLogin).not.toHaveBeenCalled();
    });

    it("should refuse a request carrying no body at all", async () => {
      // A POST with nothing in it, which is what a crafted request tends to be.
      const req = pageRequest({ subject: "caseworker@example.com" });
      const next = vi.fn();

      await route.POST(req, pageResponse(), next);

      expect(next).toHaveBeenCalledWith();
      expect(passwordGrantLogin).not.toHaveBeenCalled();
    });

    it.each([{ persona: "root" }, { persona: "someone@example.com" }, { persona: ["judge"] }, {}])(
      "should refuse the body %o rather than minting a token for whatever it names",
      async (body) => {
        // The security posture's second prohibition. An id is looked up in `PERSONAS` and nothing else, so there
        // is no path from a request to an arbitrary username — and the refusal is the same 404, which says
        // nothing about which ids would have worked.
        const req = signedInCaseworker(body);
        const next = vi.fn();

        await route.POST(req, pageResponse(), next);

        expect(next).toHaveBeenCalledWith();
        expect(passwordGrantLogin).not.toHaveBeenCalled();
        expect(req.session.deedPoll.user).toBeDefined();
      }
    );
  });
});

/**
 * A renewal forced immediately after a switch, through the real `refreshMiddleware`.
 *
 * This is the assertion that the replacement is complete: the middleware has to renew with the *judge's*
 * refresh token and check the response against the *judge's* subject. Either half left at the caseworker's
 * value breaks it — the wrong token renews the wrong session, and the wrong subject makes `refreshTokens`
 * refuse the response and sign the tester out instead.
 */
describe("a forced refresh after switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(passwordGrantLogin).mockResolvedValue(JUDGE);
    vi.mocked(refreshTokens).mockResolvedValue({
      idToken: "a-renewed-judge-id-token",
      accessToken: "a-renewed-judge-access-token",
      refreshToken: "a-rotated-judge-refresh-token",
      expiresAt: 1_900_000_000
    });
  });

  async function switchedThenRenewed(): Promise<RequestDouble> {
    const req = signedInCaseworker();
    await route.POST(req, pageResponse(), vi.fn());
    // Inside the five-minute window, which is the only way to make the middleware act without waiting for it.
    req.session.deedPoll.tokenExpiresAt = Math.floor(Date.now() / 1000) + 60;

    await refreshMiddleware(req, pageResponse(), vi.fn());
    return req;
  }

  it("should renew with the persona's own refresh token and subject", async () => {
    await switchedThenRenewed();

    expect(refreshTokens).toHaveBeenCalledWith(expect.anything(), "a-judge-refresh-token", "judge@example.com");
  });

  it("should leave the session as the persona, not the user who was signed in before", async () => {
    const req = await switchedThenRenewed();

    expect(req.session.deedPoll).toMatchObject({
      user: JUDGE.user,
      subject: "judge@example.com",
      accessToken: "a-renewed-judge-access-token",
      refreshToken: "a-rotated-judge-refresh-token"
    });
  });
});
