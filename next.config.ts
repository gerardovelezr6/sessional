import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Logo and icon uploads go through server actions (images are capped at 2 MB by the app itself).
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
};

export default config;
