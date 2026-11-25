import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.js";

// The deletion journeys switch the mock's deletion outcomes (a lost admission response, an injected refusal, status
// reads down) and move requests on, all of which are the whole mock's, so they get a fresh mock of their own rather
// than the shared developer mock on 3200. Redis on 6379 (database 6) and the local IDAM simulator on 5556 must
// already be running (see README).
export default defineConfig({
  ...base,
  fullyParallel: false,
  testIgnore: [],
  workers: 1,
  retries: 0,
  use: { ...base.use, baseURL: "http://localhost:3320" },
  projects: [{ name: "application-deletion", testMatch: /application-deletion\.spec\.ts/, use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "yarn mock:api --port 3220",
      url: "http://localhost:3220/health",
      reuseExistingServer: false,
      cwd: "..",
      timeout: 60_000
    },
    {
      command: "yarn dev:app",
      url: "http://localhost:3320",
      reuseExistingServer: false,
      cwd: "..",
      timeout: 120_000,
      env: {
        PORT: "3320",
        DEED_POLL_API_URL: "http://localhost:3220",
        REDIS_URL: "redis://127.0.0.1:6379/6",
        IDAM_REDIRECT_URI: "http://localhost:3320/oauth2/callback"
      }
    }
  ]
});
