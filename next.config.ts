import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The capture route drives a real browser; keep Playwright out of the server bundle.
  serverExternalPackages: ['playwright', 'playwright-core'],
  // The dev badge sits over the Frame panel's shadow chips.
  devIndicators: false,
};

export default nextConfig;
