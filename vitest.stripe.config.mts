import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The Stripe acceptance run: real Stripe in test mode (a test clock) against a scratch database.
// Run with `npm run test:stripe`; needs network access to api.stripe.com and a test secret key.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/stripe/**/*.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
