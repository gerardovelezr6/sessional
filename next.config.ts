import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Logo and icon uploads go through server actions (images are capped at 2 MB by the app itself).
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
  // PDF exports read these fonts (and printables these flags) from disk at run time.
  outputFileTracingIncludes: { '/t/[tenant]/grades/export': ['./assets/fonts/*.ttf'], '/t/[tenant]/owner/export': ['./assets/fonts/*.ttf'], '/t/[tenant]/print/[kind]': ['./assets/fonts/*.ttf', './node_modules/flag-icons/flags/4x3/*.svg', './public/flags/us/*.svg'], '/help': ['./content/help/**/*.md'], '/help/[slug]': ['./content/help/**/*.md'] },
  // Spreadsheet and PDF builders stay outside the server bundle.
  serverExternalPackages: ['exceljs', 'pdf-lib', '@pdf-lib/fontkit', 'sharp'],
  // Security headers on every response (docs/SECURITY.md). Pages may be shown in a frame only by
  // the same site (the website editor's preview). Links out never carry a path or query (set-password
  // links hold a one-time token). Plugins and <base> are off. Camera, microphone and location are off (QR check-in uses the phone's own camera app).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
        ],
      },
    ];
  },
};

export default config;
