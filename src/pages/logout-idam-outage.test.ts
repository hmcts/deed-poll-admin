/**
 * Logout during an IDAM discovery outage (review finding R04, plan `docs/plans/20261021-r04-timeout-during-idam-outage.md`).
 *
 * `openid-client` runs for real against a loopback discovery endpoint, so the failure is the one a pod sees: a 503, and
 * then the cooldown's refusal on the next attempt. The end-session lookup used to be awaited before `Clear-Site-Data`
 * and the redirect, so an outage answered a signed-out user with a 500.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { trackEvent } from "@hmcts-cft/cloud-native-platform";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetIdamDiscovery } from "../auth/idam.js";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { GET } from "./logout.js";

vi.mock("../auth/settings.js", () => ({ idamSettings: () => idam.config }));
vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  trackEvent: vi.fn()
}));

const idam = vi.hoisted(() => ({ config: { issuerUrl: "", clientId: "deed-poll-admin", clientSecret: "a-secret", redirectUri: "", scope: "openid" } }));

describe("logout while IDAM discovery fails", () => {
  let server: Server;
  let base: string;
  let discoveryHealthy: boolean;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      if (!discoveryHealthy) return void res.writeHead(503).end();
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          issuer: `${base}/o`,
          authorization_endpoint: `${base}/o/authorize`,
          token_endpoint: `${base}/o/token`,
          jwks_uri: `${base}/o/jwks`,
          end_session_endpoint: `${base}/o/endSession`,
          response_types_supported: ["code"]
        })
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    idam.config.issuerUrl = `${base}/o`;
    idam.config.redirectUri = "http://localhost:3000/oauth2/callback";
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetIdamDiscovery();
    discoveryHealthy = false;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("should destroy the session, clear the cache and redirect to / with one auth.logout event", async () => {
    const req = signedIn();
    const res = pageResponse();

    await GET(req, res);

    expect(req.session.destroy).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("Clear-Site-Data", '"cache"');
    expect(res.redirect).toHaveBeenCalledWith("/");
    expect(vi.mocked(trackEvent).mock.calls.map(([name]) => name)).toEqual(["auth.logout"]);
  });

  it("should do the same inside the cooldown that follows a failed discovery", async () => {
    await GET(signedIn(), pageResponse());
    const res = pageResponse();

    await GET(signedIn(), res);

    expect(res.setHeader).toHaveBeenCalledWith("Clear-Site-Data", '"cache"');
    expect(res.redirect).toHaveBeenCalledWith("/");
  });

  it("should still send the browser to IDAM's end-session page when discovery succeeds", async () => {
    discoveryHealthy = true;
    const res = pageResponse();

    await GET(signedIn(), res);

    const away = new URL(res.redirect.mock.calls[0][0] as string);
    expect(`${away.origin}${away.pathname}`).toBe(`${base}/o/endSession`);
    expect(away.searchParams.get("id_token_hint")).toBe("an-id-token");
    expect(away.searchParams.get("post_logout_redirect_uri")).toBe("http://localhost:3000/");
    expect(res.setHeader).toHaveBeenCalledWith("Clear-Site-Data", '"cache"');
  });
});

function signedIn() {
  return Object.assign(pageRequest({ idToken: "an-id-token", subject: "idam-subject-1" }), {
    sessionID: "a-session-id",
    method: "GET",
    baseUrl: "",
    path: "/logout"
  });
}
