import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI
    ? [
        ['dot'],
        ['github'],
        ['junit', { outputFile: 'junit-results.xml' }],
        ['html', { outputFolder: 'playwright-report', open: 'never' }]
      ]
    : 'list',
  use: {
    baseURL: process.env.EXPRESSJS_MONOREPO_TEMPLATE_WEB_URL || process.env.TEST_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    headless: true,
    screenshot: "only-on-failure",
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.EXPRESSJS_MONOREPO_TEMPLATE_WEB_URL || process.env.TEST_URL ? undefined : {
    command: 'yarn dev:nowatch',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    cwd: '..',
    stdout: 'pipe',
    stderr: 'pipe',
  },
});