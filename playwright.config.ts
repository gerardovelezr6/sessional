import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const MOCK_PORT = 3199;
const SERVICE_KEY = 'test-service-role-key';
const ANON_KEY = 'test-anon-key';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Lets the browser reach a pretend customer domain on this machine.
        launchOptions: { args: ['--host-resolver-rules=MAP mun.example.test 127.0.0.1, MAP unknown.example.test 127.0.0.1'] },
      },
    },
  ],
  // Tests run against the production build, the same thing that is deployed, with a stand-in for
  // the database endpoint.
  webServer: [
    {
      command: 'node tests/e2e/support/mock-supabase.mjs',
      url: `http://localhost:${MOCK_PORT}/health`,
      env: { MOCK_SUPABASE_PORT: String(MOCK_PORT), SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npm run start -- -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      env: {
        ROOT_DOMAIN: `localhost:${PORT}`,
        NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${MOCK_PORT}`,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
