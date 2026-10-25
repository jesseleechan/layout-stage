import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The capture route drives a real browser; keep Playwright out of the server bundle.
  serverExternalPackages: ['playwright', 'playwright-core'],
};

export default nextConfig;
