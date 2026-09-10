import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI
    ? [["dot"], ["github"], ["junit", { outputFile: "junit-results.xml" }], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : "list",
  use: {
    baseURL: process.env.EXPRESSJS_MONOREPO_TEMPLATE_WEB_URL || process.env.TEST_URL || "http://localhost:3000",
    trace: "on-first-retry",
    headless: true,
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off"
  },
  projects: [
    // Signs in once through the real local IDAM and saves the session, so the journeys that need a
    // caseworker do not each pay for the OIDC round trip. `requireAuth` in apps/web is global, so
    // every page but the public allowlist needs one. See ./tests/idam-session.ts.
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"]
    }
  ],
  // Two servers, and the mock is its own entry rather than being backgrounded inside the app's command.
  // `yarn dev:nowatch` starts it with `&` and nothing gates on it, so a first case-page request that beat
  // the mock's bind rendered the 500 page — a flake that reads as an application bug. The mock serves
  // /health for exactly this.
  webServer:
    process.env.EXPRESSJS_MONOREPO_TEMPLATE_WEB_URL || process.env.TEST_URL
      ? undefined
      : [
          {
            command: "yarn mock:api",
            url: "http://localhost:3200/health",
            reuseExistingServer: !process.env.CI,
            timeout: 60 * 1000,
            cwd: "..",
            stdout: "pipe",
            stderr: "pipe"
          },
          {
            command: "yarn dev:nowatch:web",
            url: "http://localhost:3000",
            reuseExistingServer: !process.env.CI,
            timeout: 120 * 1000,
            cwd: "..",
            stdout: "pipe",
            stderr: "pipe"
          }
        ]
});
