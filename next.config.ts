import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The capture route drives a real browser; keep Playwright and the serverless Chromium loader out
  // of the server bundle. Neither ships a browser binary: Playwright's own Chromium lives outside the
  // project (local use) and chromium-min downloads its build at run time (Vercel).
  serverExternalPackages: ['playwright', 'playwright-core', '@sparticuz/chromium-min'],
  // The capture route reads the banner selectors from disk at run time.
  outputFileTracingIncludes: { '/api/capture': ['./lib/capture/banners.css'] },
  // The dev badge sits over the Frame panel's shadow chips.
  devIndicators: false,
};

export default nextConfig;
