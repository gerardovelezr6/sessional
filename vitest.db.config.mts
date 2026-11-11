import { defineConfig } from 'vitest/config';

// Database tests run against a scratch Postgres. Start them with `npm run test:db`.
export default defineConfig({
  test: { include: ['tests/db/**/*.test.ts'], fileParallelism: false },
});
