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
        launchOptions: { args: ['--host-resolver-rules=MAP mun.example.test 127.0.0.1, MAP unknown.example.test 127.0.0.1, MAP mun.brand.test 127.0.0.1'] },
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
        // Billing against the Stripe stand-in in the mock server.
        STRIPE_SECRET_KEY: 'sk_test_mock',
        STRIPE_API_BASE: `http://localhost:${MOCK_PORT}/stripe`,
        STRIPE_WEBHOOK_SECRET: 'whsec_test',
        CRON_SECRET: 'cron-test-secret',
        // Email (signup links) through the Resend stand-in, which keeps what was sent.
        RESEND_API_KEY: 're_test_mock',
        RESEND_API_URL: `http://localhost:${MOCK_PORT}/resend`,
        // Custom domains: the hosting provider and public DNS, both stand-ins in the mock server.
        VERCEL_TOKEN: 'vercel_test_mock',
        VERCEL_PROJECT_ID: 'prj_test',
        VERCEL_API_URL: `http://localhost:${MOCK_PORT}/vercel`,
        DOH_URL: `http://localhost:${MOCK_PORT}/doh`,
        // The "are you a person" check on public forms, against a stand-in that always passes.
        TURNSTILE_SITE_KEY: 'turnstile-site',
        TURNSTILE_SECRET_KEY: 'turnstile-secret',
        TURNSTILE_SCRIPT_URL: `http://localhost:${MOCK_PORT}/turnstile.js`,
        TURNSTILE_VERIFY_URL: `http://localhost:${MOCK_PORT}/turnstile/verify`,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
