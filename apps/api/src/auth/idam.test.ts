/**
 * Bearer-token validation, against a real signed token and a real JWKS served over HTTP.
 *
 * **Deliberately not a stub of IDAM.** The last IDAM stub written in this repo put roles in the ID
 * token because that is where the code looked for them, passed, and would have failed against real
 * IDAM — so a hand-written issuer is not allowed to decide the *contract* here either. What it decides
 * is only the cryptography and the claim checks: whether a token signed by the wrong key, expired,
 * addressed to another audience, or issued by another issuer is refused. Those questions have the same
 * answer whoever the issuer is, and they cannot be asked at all without a key to sign with.
 *
 * The contract — RS256, `tokenName`, `aud` as the client id, roles from `/o/userinfo` and not from the
 * token — is taken from `hmcts/rse-idam-simulator`'s `JwTokenGeneratorService` and `IdamUserInfo`, and
 * re-verified by running against the simulator itself.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DEEDPOLL_ADMIN, SERVICE_ACCOUNT_NAME, UnauthorizedError } from "@hmcts/deed-poll";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bearerToken, type IdamApiConfig, idamApiConfig, resetIdamDiscovery, userFromBearerToken } from "./idam.js";

const KID = "test-key";
const AUDIENCE = "deed-poll-admin";
const SUBJECT = "admin@example.com";

let issuerKey: CryptoKey;
let otherKey: CryptoKey;
let publicJwk: JWK;
let server: Server;
let base: string;
let config: IdamApiConfig;

/** What `/o/userinfo` answers with, per test. Shaped like the simulator's `IdamUserInfo`. */
let userInfoStatus = 200;
let userInfoBody: unknown;
/** Counts requests, so "not cached" can be asserted rather than assumed. */
let userInfoCalls = 0;
let discoveryCalls = 0;
let discoveryStatus = 200;
let advertisedIssuer: string | undefined;

beforeAll(async () => {
  const issuer = await generateKeyPair("RS256", { extractable: true });
  issuerKey = issuer.privateKey;
  ({ privateKey: otherKey } = await generateKeyPair("RS256"));

  // Only the public half is published, which is the point: every token below is signed with a key the
  // verifier never sees.
  publicJwk = { ...(await exportJWK(issuer.publicKey)), kid: KID, alg: "RS256" };

  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (path === "/o/.well-known/openid-configuration") {
      discoveryCalls += 1;
      if (discoveryStatus !== 200) {
        res.writeHead(discoveryStatus).end("{}");
        return;
      }
      json(res, 200, {
        issuer: advertisedIssuer ?? `${base}/o`,
        jwks_uri: `${base}/o/jwks`,
        userinfo_endpoint: `${base}/o/userinfo`
      });
      return;
    }

    if (path === "/o/jwks") {
      json(res, 200, { keys: [publicJwk] });
      return;
    }

    if (path === "/o/userinfo") {
      userInfoCalls += 1;
      json(res, userInfoStatus, userInfoBody);
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config = { issuerUrl: `${base}/o`, audiences: [AUDIENCE] };
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  resetIdamDiscovery();
  userInfoStatus = 200;
  userInfoCalls = 0;
  discoveryCalls = 0;
  discoveryStatus = 200;
  advertisedIssuer = undefined;
  userInfoBody = { sub: SUBJECT, uid: "uid-1", email: SUBJECT, name: "A Caseworker", roles: [DEEDPOLL_ADMIN] };
  // The rejection reason is logged, not returned; silence it so expected noise does not read as failure.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("userFromBearerToken", () => {
  it("accepts a valid token and takes the roles and name from userinfo", async () => {
    const user = await userFromBearerToken(config, await accessToken());

    expect(user.isAdmin).toBe(true);
    expect(user.name).toBe("A Caseworker");
  });

  it("gives a caller with no roles no admin, rather than refusing them", async () => {
    // A signed-in caseworker without the role is a normal caller, not an authentication failure. The
    // role gate is `requireRoles`' job and answers 403 where it applies.
    userInfoBody = { sub: SUBJECT, name: "A Caseworker", roles: [] };

    const user = await userFromBearerToken(config, await accessToken());

    expect(user.isAdmin).toBe(false);
    expect(user.name).toBe("A Caseworker");
  });

  it("drops roles from other CFT services", async () => {
    userInfoBody = { sub: SUBJECT, name: "A Caseworker", roles: ["caseworker-divorce", "ccd-import"] };

    expect((await userFromBearerToken(config, await accessToken())).isAdmin).toBe(false);
  });

  it("falls back to the subject for the audit name when userinfo carries no name", async () => {
    userInfoBody = { sub: SUBJECT, roles: [DEEDPOLL_ADMIN] };

    const user = await userFromBearerToken(config, await accessToken());

    expect(user.name).toBe(SUBJECT);
    expect(user.name).not.toBe(SERVICE_ACCOUNT_NAME);
  });

  describe("refuses a token that", () => {
    it("is signed by a key the issuer does not publish", async () => {
      // The whole point of the JWKS check. A token that fails only this one is otherwise perfect —
      // right issuer, right audience, unexpired — which is what an attacker would mint.
      await expect(userFromBearerToken(config, await accessToken({ key: otherKey }))).rejects.toThrow(UnauthorizedError);
    });

    it("has expired", async () => {
      await expect(userFromBearerToken(config, await accessToken({ expiresIn: "-1s" }))).rejects.toThrow(UnauthorizedError);
    });

    it("is addressed to another audience", async () => {
      // An access token minted for a different CFT client, replayed here. Signature and issuer are
      // genuine, so `aud` is the only thing that separates it from ours.
      await expect(userFromBearerToken(config, await accessToken({ audience: "some-other-service" }))).rejects.toThrow(UnauthorizedError);
    });

    it("names another issuer", async () => {
      await expect(userFromBearerToken(config, await accessToken({ issuer: "https://evil.example/o" }))).rejects.toThrow(UnauthorizedError);
    });

    it("is an ID token rather than an access token", async () => {
      // Both carry the same `aud` and the same signature, so nothing above catches this. An ID token
      // is issued *to* the client to describe the user, and is not a credential for calling an API.
      await expect(userFromBearerToken(config, await accessToken({ tokenName: "id_token" }))).rejects.toThrow(/not a id_token/);
    });

    it("is symmetrically signed, whatever its alg header claims", async () => {
      const hmac = await new SignJWT({ tokenName: "access_token" })
        .setProtectedHeader({ alg: "HS256", kid: KID })
        .setIssuer(`${base}/o`)
        .setAudience(AUDIENCE)
        .setSubject(SUBJECT)
        .setExpirationTime("8h")
        .sign(new TextEncoder().encode("a".repeat(32)));

      await expect(userFromBearerToken(config, hmac)).rejects.toThrow(UnauthorizedError);
    });

    it("carries no subject", async () => {
      const anonymous = await new SignJWT({ tokenName: "access_token" })
        .setProtectedHeader({ alg: "RS256", kid: KID })
        .setIssuer(`${base}/o`)
        .setAudience(AUDIENCE)
        .setExpirationTime("8h")
        .sign(issuerKey);

      await expect(userFromBearerToken(config, anonymous)).rejects.toThrow(/no subject/);
    });

    it("is not a JWT at all", async () => {
      await expect(userFromBearerToken(config, "not-a-token")).rejects.toThrow(UnauthorizedError);
    });

    it("IDAM itself will no longer resolve, because it has been revoked", async () => {
      userInfoStatus = 401;

      await expect(userFromBearerToken(config, await accessToken())).rejects.toThrow(UnauthorizedError);
    });

    it("userinfo answers for a different subject", async () => {
      userInfoBody = { sub: "someone.else@example.com", roles: [DEEDPOLL_ADMIN] };

      await expect(userFromBearerToken(config, await accessToken())).rejects.toThrow(/different subject/);
    });
  });

  describe("distinguishes our faults from the caller's", () => {
    it("does not answer 401 when no audience is configured", async () => {
      // Fail closed — but as a 500, because the caller cannot fix it and a 401 would send them to
      // re-authenticate against a service that will refuse them just as firmly next time.
      const misconfigured = { issuerUrl: `${base}/o`, audiences: [] };

      const error = await userFromBearerToken(misconfigured, await accessToken()).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(UnauthorizedError);
      expect(error.message).toMatch(/IDAM_API_AUDIENCES/);
    });

    it("does not answer 401 when userinfo fails for IDAM's own reasons", async () => {
      userInfoStatus = 503;

      const error = await userFromBearerToken(config, await accessToken()).catch((e) => e);

      expect(error).not.toBeInstanceOf(UnauthorizedError);
      expect(error.message).toMatch(/503/);
    });

    it("does not answer 401 when discovery fails", async () => {
      discoveryStatus = 500;

      const error = await userFromBearerToken(config, await accessToken()).catch((e) => e);

      expect(error).not.toBeInstanceOf(UnauthorizedError);
      expect(error.message).toMatch(/discovery failed/);
    });

    it("refuses to start against an issuer that advertises a different identity", async () => {
      advertisedIssuer = "https://elsewhere.example/o";

      await expect(userFromBearerToken(config, await accessToken())).rejects.toThrow(/advertises a different issuer/);
    });

    it("refuses a cleartext issuer outside development and test", async () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = "aat";

      try {
        await expect(userFromBearerToken(config, "irrelevant")).rejects.toThrow(/cleartext/);
      } finally {
        process.env.NODE_ENV = original;
      }
    });
  });

  describe("caching", () => {
    it("discovers once and reuses it, so IDAM is not called for metadata per request", async () => {
      await userFromBearerToken(config, await accessToken());
      await userFromBearerToken(config, await accessToken());

      expect(discoveryCalls).toBe(1);
    });

    it("does not cache a failed discovery, so a blip does not persist until the pod cycles", async () => {
      discoveryStatus = 500;
      await expect(userFromBearerToken(config, await accessToken())).rejects.toThrow();

      discoveryStatus = 200;

      await expect(userFromBearerToken(config, await accessToken())).resolves.toMatchObject({ isAdmin: true });
    });

    it("asks userinfo every request, so a withdrawn role takes effect immediately", async () => {
      // The opposite trade-off to discovery, deliberately: this is authorisation data, and the
      // operations the admin role gates are the ones worth withdrawing it for.
      await userFromBearerToken(config, await accessToken());
      await userFromBearerToken(config, await accessToken());

      expect(userInfoCalls).toBe(2);
    });
  });
});

describe("bearerToken", () => {
  it("reads the token out of an Authorization header", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("accepts the scheme in any case, since RFC 9110 makes it case-insensitive", () => {
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("BEARER abc")).toBe("abc");
  });

  it.each([undefined, "", "   ", "Bearer", "Bearer ", "Basic dXNlcjpwYXNz", "abc.def.ghi"])("finds no token in %o", (header) => {
    expect(bearerToken(header)).toBeUndefined();
  });
});

describe("idamApiConfig", () => {
  it("splits the comma-separated audience list Helm supplies", () => {
    expect(idamApiConfig({ issuerUrl: "https://idam.example/o", audiences: "one, two ,three" }).audiences).toEqual(["one", "two", "three"]);
  });

  it("yields no audiences for an unset value, which refuses every token rather than accepting any", () => {
    expect(idamApiConfig({ issuerUrl: "https://idam.example/o", audiences: "" }).audiences).toEqual([]);
  });
});

async function accessToken({
  key = issuerKey,
  audience = AUDIENCE,
  issuer,
  expiresIn = "8h",
  tokenName = "access_token",
  subject = SUBJECT
}: {
  key?: CryptoKey;
  audience?: string;
  issuer?: string;
  expiresIn?: string;
  tokenName?: string;
  subject?: string;
} = {}): Promise<string> {
  return new SignJWT({ tokenName, scope: ["openid", "profile", "roles"] })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(issuer ?? `${base}/o`)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

function json(res: Parameters<Parameters<typeof createServer>[0]>[1], status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}
