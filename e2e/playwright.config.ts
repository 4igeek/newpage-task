import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: a real browser against the real stack (nginx, API,
 * worker, Postgres) started by run.sh. No API key is configured, so no test
 * can call a paid API; the "answers are turned off" path is what's exercised.
 */
export default defineConfig({
  testDir: './tests',
  // The tests share one database, so run them one at a time, in file order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:18080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // SLOW_MO=500 pauses 500 ms between actions, to watch a --headed run.
    launchOptions: { slowMo: Number(process.env.SLOW_MO ?? 0) },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
