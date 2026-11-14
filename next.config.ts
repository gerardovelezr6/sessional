import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Logo and icon uploads go through server actions (images are capped at 2 MB by the app itself).
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
  // PDF exports read these fonts from disk at run time.
  outputFileTracingIncludes: { '/t/[tenant]/grades/export': ['./assets/fonts/*.ttf'] },
  // Spreadsheet and PDF builders stay outside the server bundle.
  serverExternalPackages: ['exceljs', 'pdf-lib', '@pdf-lib/fontkit'],
};

export default config;
