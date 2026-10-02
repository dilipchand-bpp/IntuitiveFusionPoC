import { defineConfig } from '@playwright/test';

// Locally we drive the system Edge/Chrome (no browser download needed); CI installs Playwright's Chromium.
const channel = process.env.PW_CHANNEL || undefined;
export const E2E_PASSWORD = 'E2e-Only-Passw0rd!2026';
const env = { NODE_ENV: 'test', SESSION_SECRET: 'e2e-only-secret-not-for-production-use-0123456789' };

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure', channel },
  webServer: [
    {
      // Fresh seeded database for every run (separate directory from the dev database).
      command: 'npm run build -w @if/shared && npm run db:reset && npm run dev -w @if/api',
      url: 'http://localhost:4000/health',
      env: {
        ...env,
        API_PORT: '4000',
        DATABASE_URL: 'pglite://./var/e2e-db',
        SEED_PASSWORD: E2E_PASSWORD,
        LOGIN_RATE_LIMIT_MAX: '1000',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'npm run dev -w @if/web',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
