import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 3100);
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Golden exports render exactly (0 px diff) run to run on one machine. threshold 0.02 (~5 grey
  // levels per pixel) and 0.1% of pixels catch a +0.05 darken, a +0.05 shadow strength, a 1-unit
  // border or a 2% pan, which 0.1 / 0.2% let through; the slack still absorbs edge antialiasing.
  expect: { toMatchSnapshot: { maxDiffPixelRatio: 0.001, threshold: 0.02 } },
  snapshotPathTemplate: '{testDir}/__golden__/{arg}{ext}',
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    trace: CI ? 'on-first-retry' : 'off',
  },
  webServer: {
    // CI runs `next build` first and tests the production server; locally the dev server compiles on demand.
    command: CI ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
