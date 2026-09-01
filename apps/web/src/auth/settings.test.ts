import { afterEach, describe, expect, it } from "vitest";
import type { IdamConfig } from "./idam.js";
import { assertIdamSettings } from "./settings.js";

const DEPLOYED: IdamConfig = {
  issuerUrl: "https://idam-web-public.aat.platform.hmcts.net/o",
  clientId: "deed-poll-admin",
  clientSecret: "a-secret-from-the-key-vault",
  redirectUri: "https://deed-poll-deed-poll-admin-staging-web.aat.platform.hmcts.net/oauth2/callback",
  scope: "openid profile roles"
};

/** What `config/default.json` supplies, and therefore what a deployment that sets nothing inherits. */
const LOCAL_DEFAULTS: IdamConfig = {
  ...DEPLOYED,
  clientSecret: "",
  redirectUri: "http://localhost:3000/oauth2/callback"
};

describe("assertIdamSettings", () => {
  const original = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it("accepts the local defaults in development, where they are correct", () => {
    process.env.NODE_ENV = "development";

    expect(() => assertIdamSettings(LOCAL_DEFAULTS)).not.toThrow();
  });

  it("accepts real deployed settings", () => {
    process.env.NODE_ENV = "aat";

    expect(() => assertIdamSettings(DEPLOYED)).not.toThrow();
  });

  // This is the accident the check exists for: it is what happened when IDAM_REDIRECT_URI was set in
  // apps/web/helm/values.yaml, whose ingressHost the root chart overrides — so the value applied
  // nowhere it was deployed and the app inherited default.json's localhost instead.
  it.each(["production", "aat", "preview", "demo", "ithc", ""])("refuses a localhost redirect URI under NODE_ENV=%o", (env) => {
    process.env.NODE_ENV = env;

    expect(() => assertIdamSettings(LOCAL_DEFAULTS)).toThrow(/IDAM_REDIRECT_URI/);
  });

  it("refuses a 127.0.0.1 redirect URI as well as a named localhost", () => {
    process.env.NODE_ENV = "aat";

    expect(() => assertIdamSettings({ ...DEPLOYED, redirectUri: "http://127.0.0.1:3000/oauth2/callback" })).toThrow(/IDAM_REDIRECT_URI/);
  });

  it("refuses a cleartext redirect URI even on a real hostname", () => {
    // The code and the session cookie both cross this URL.
    process.env.NODE_ENV = "aat";

    expect(() => assertIdamSettings({ ...DEPLOYED, redirectUri: "http://deed-poll-admin-web.aat.platform.hmcts.net/oauth2/callback" })).toThrow(
      /IDAM_REDIRECT_URI/
    );
  });

  it("refuses an empty client secret, which would fail every code exchange", () => {
    process.env.NODE_ENV = "aat";

    expect(() => assertIdamSettings({ ...DEPLOYED, clientSecret: "" })).toThrow(/IDAM_CLIENT_SECRET/);
  });

  it("refuses a whitespace-only client secret, which a blank key vault entry yields", () => {
    process.env.NODE_ENV = "aat";

    expect(() => assertIdamSettings({ ...DEPLOYED, clientSecret: "   " })).toThrow(/IDAM_CLIENT_SECRET/);
  });

  it("names the environment in the message, since an unexpected NODE_ENV is the likeliest cause", () => {
    process.env.NODE_ENV = "aat";

    expect(() => assertIdamSettings(LOCAL_DEFAULTS)).toThrow(/"aat"/);
  });
});
