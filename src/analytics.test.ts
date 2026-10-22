/**
 * Admin carries no Google Tag Manager (review finding R12), pinned through the real app: the real starter, helmet and
 * router, rendering a real page. Only what reaches out of the process is doubled — Redis, and the session store on it.
 *
 * The starter renders GTM whenever the `gtm` global has a container id, and its CSP admits Google's hosts unless told
 * not to, so either half coming back is a one-line change in `app.ts` that every page test would miss.
 */
import session from "express-session";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

vi.hoisted(() => {
  // Assets from `dist` rather than the vite dev server, which this test has no use for. `app.ts` reads it at import.
  process.env.VITE_MIDDLEWARE = "false";
});

vi.mock("redis", () => {
  const client = {
    on: () => undefined,
    connect: async () => undefined,
    isReady: true,
    ping: async () => "PONG",
    withCommandOptions: () => ({ eval: async () => 1 })
  };
  return { createClient: () => client };
});
vi.mock("@hmcts-cft/express-session-redis", () => ({
  expressSessionRedis: ({ sessionOptions }: { sessionOptions: session.SessionOptions }) => session({ ...sessionOptions, store: new session.MemoryStore() })
}));

describe("analytics", () => {
  it("should render a page with no Google Tag Manager markup", async () => {
    const app = await createApp();

    const response = await request(app).get("/signed-out");

    expect(response.status).toBe(200);
    expect(response.text).toContain("govuk-template");
    expect(response.text).not.toMatch(/googletagmanager/i);
    expect(response.text).not.toContain("GTM-");
  });

  it("should send a Content-Security-Policy naming no Google Tag Manager or Google Analytics host, with its other directives intact", async () => {
    const app = await createApp();

    const response = await request(app).get("/signed-out");
    const policy = response.headers["content-security-policy"];

    // The test runner is not production, so helmet's two dev-server sources are present. `frame-src` goes with GTM, its
    // only source, leaving frames to `default-src 'self'`.
    expect(policy?.replace(/'nonce-[A-Za-z0-9+/=]+'/, "'nonce-…'")).toBe(
      [
        "default-src 'self'",
        "base-uri 'self'",
        "font-src 'self' data:",
        "form-action 'self'",
        "frame-ancestors 'self'",
        "img-src 'self' data:",
        "object-src 'none'",
        "script-src 'self' 'nonce-…' ws://localhost:5173",
        "script-src-attr 'none'",
        "style-src 'self' 'unsafe-inline'",
        "upgrade-insecure-requests",
        "connect-src 'self' ws://localhost:5173 ws://localhost:24678"
      ].join(";")
    );
    expect(policy).not.toMatch(/googletagmanager\.com|google-analytics\.com/);
  });
});
