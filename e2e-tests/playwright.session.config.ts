import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.js";

// The session timeout warning (OWASP plan 03, Task 7) against a real clock, so its own app with a 330-second idle
// limit: the warning appears at 210 s. Long-running by design (about twelve minutes), so it is outside `test:e2e`.
// Redis on 6379 and the local IDAM simulator on 5556 must already be running (see README).
export default defineConfig({
  ...base,
  fullyParallel: true,
  testIgnore: [],
  workers: 2,
  retries: 0,
  use: { ...base.use, baseURL: "http://localhost:3317" },
  projects: [{ name: "session-timeout", testMatch: /session-timeout\.spec\.ts/, use: { ...devices["Desktop Chrome"] } }],
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
        REDIS_URL: "redis://127.0.0.1:6379/2",
        IDAM_REDIRECT_URI: "http://localhost:3317/oauth2/callback",
        SESSION_IDLE_TIMEOUT_SECONDS: "330",
        SESSION_TIMEOUT_LOGOUT_PATH_REGISTERED: "true"
      }
    }
  ]
});
