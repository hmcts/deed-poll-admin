import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.js";

// A fresh mock is required to verify the empty-to-populated journey without resetting a developer's data.
// Redis on 6316 and the local IDAM simulator on 5556 must already be running (see README).
export default defineConfig({
  ...base,
  fullyParallel: false,
  testIgnore: [],
  workers: 1,
  retries: 0,
  use: { ...base.use, baseURL: "http://localhost:3316" },
  projects: [{ name: "gazette", testMatch: /gazette\.spec\.ts/, use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "yarn mock:api --port 3216",
      url: "http://localhost:3216/health",
      reuseExistingServer: false,
      cwd: "..",
      timeout: 60_000
    },
    {
      command: "yarn dev:app",
      url: "http://localhost:3316",
      reuseExistingServer: false,
      cwd: "..",
      timeout: 120_000,
      env: {
        PORT: "3316",
        DEED_POLL_API_URL: "http://localhost:3216",
        REDIS_URL: "redis://127.0.0.1:6316/1",
        IDAM_REDIRECT_URI: "http://localhost:3316/oauth2/callback"
      }
    }
  ]
});
