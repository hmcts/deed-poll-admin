import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.js";

// The referral queue's journeys move the mock's referral clock out of a window and lower the window's cap, both of
// which are the whole service's, so they get a fresh mock of their own rather than the shared developer mock on
// 3200. Redis on 6379 (database 5) and the local IDAM simulator on 5556 must already be running (see README).
export default defineConfig({
  ...base,
  fullyParallel: false,
  testIgnore: [],
  workers: 1,
  retries: 0,
  use: { ...base.use, baseURL: "http://localhost:3317" },
  projects: [{ name: "referrals", testMatch: /referral-queue\.spec\.ts/, use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "yarn mock:api --port 3217",
      url: "http://localhost:3217/health",
      reuseExistingServer: false,
      cwd: "..",
      timeout: 60_000
    },
    {
      command: "yarn dev:app",
      url: "http://localhost:3317",
      reuseExistingServer: false,
      cwd: "..",
      timeout: 120_000,
      env: {
        PORT: "3317",
        DEED_POLL_API_URL: "http://localhost:3217",
        REDIS_URL: "redis://127.0.0.1:6379/5",
        IDAM_REDIRECT_URI: "http://localhost:3317/oauth2/callback"
      }
    }
  ]
});
