import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  // `CI`-gated, and Jenkins does not set `CI` — which is why `test:smoke` overrides the reporters on the
  // command line rather than relying on this. `YarnBuilder.smokeTest()` collects
  // `smoke-output/**/*result.xml` relative to the repo root with `allowEmptyResults: true`, so a smoke run
  // reporting to the console only would be swallowed: the one check a deployed environment gets would
  // publish nothing and still look green.
  reporter: process.env.CI
    ? [["dot"], ["github"], ["junit", { outputFile: "junit-results.xml" }], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : "list",
  use: {
    // `TEST_URL` is the only override, and it is load-bearing: `sectionDeployToAKS` sets it to the
    // environment it has just deployed and then runs `yarn test:smoke`. The template's
    // `EXPRESSJS_MONOREPO_TEMPLATE_WEB_URL` used to be read *first* here and is set by nothing in this repo
    // or the pipeline — set on an agent it would have outranked `TEST_URL`, pointing the post-deploy gate at
    // the wrong host while still reporting green.
    baseURL: process.env.TEST_URL || "http://localhost:3000",
    trace: "on-first-retry",
    headless: true,
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off"
  },
  projects: [
    // Signs in through the real local IDAM once per fixture — the administrator and the roleless
    // caseworker — and saves each session, so the journeys do not each pay for the OIDC round trip.
    // `requireAuth` is global, so every page but the public allowlist needs one.
    // See ./tests/idam-session.ts.
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
  webServer: process.env.TEST_URL
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
