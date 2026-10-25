import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 3100);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  expect: { toMatchSnapshot: { maxDiffPixelRatio: 0.002, threshold: 0.1 } },
  snapshotPathTemplate: '{testDir}/__golden__/{arg}{ext}',
  use: { baseURL: `http://localhost:${PORT}`, ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
