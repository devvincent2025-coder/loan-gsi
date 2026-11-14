import { defineConfig, devices } from '@playwright/test';

// The web server and API are NOT started automatically: run `npm run dev` (api + web) first.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
