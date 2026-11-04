import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.js";

// The document viewer's two journeys switch the mock's preview scenario, so they get a fresh mock of their own rather
// than the shared developer mock on 3200. Redis on 6379 (database 4) and the local IDAM simulator on 5556 must
// already be running (see README).
export default defineConfig({
  ...base,
  fullyParallel: false,
  testIgnore: [],
  workers: 1,
  retries: 0,
  use: { ...base.use, baseURL: "http://localhost:3319", acceptDownloads: true },
  projects: [{ name: "document-viewer", testMatch: /document-viewer\.spec\.ts/, use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "yarn mock:api --port 3219",
      url: "http://localhost:3219/health",
      reuseExistingServer: false,
      cwd: "..",
      timeout: 60_000
    },
    {
      command: "yarn dev:app",
      url: "http://localhost:3319",
      reuseExistingServer: false,
      cwd: "..",
      timeout: 120_000,
      env: {
        PORT: "3319",
        DEED_POLL_API_URL: "http://localhost:3219",
        REDIS_URL: "redis://127.0.0.1:6379/4",
        IDAM_REDIRECT_URI: "http://localhost:3319/oauth2/callback"
      }
    }
  ]
});
