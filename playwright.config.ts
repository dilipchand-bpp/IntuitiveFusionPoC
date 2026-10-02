import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against a PRODUCTION build on their own ports (web 3100, API 4100), never the ports used for
 * day-to-day development (3000 / 4000). So running the tests can neither disturb nor be disturbed by `npm run dev`,
 * and results do not depend on a cold dev-server compile. Each run starts from a freshly seeded database.
 *
 * Locally we drive the system Edge/Chrome (PW_CHANNEL=msedge); CI installs Playwright's Chromium.
 */
const channel = process.env.PW_CHANNEL || undefined;
export const E2E_PASSWORD = 'E2e-Only-Passw0rd!2026'; // synthetic test users only
export const WEB_URL = 'http://localhost:3100';
export const API_URL = 'http://localhost:4100';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: WEB_URL, trace: 'retain-on-failure', channel },
  webServer: [
    {
      command:
        'npm run build -w @if/shared && npm run build -w @if/api && npm run db:reset && npm run start -w @if/api',
      url: `${API_URL}/health`,
      env: {
        NODE_ENV: 'test',
        SESSION_SECRET: 'e2e-only-secret-not-for-production-use-0123456789',
        API_PORT: '4100',
        DATABASE_URL: 'pglite://./var/e2e-db',
        SEED_PASSWORD: E2E_PASSWORD,
        LOGIN_RATE_LIMIT_MAX: '1000',
      },
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      // API_URL is read at build time (rewrites) and at run time (route guard); NEXT_PUBLIC_UI_KIT exposes the gallery.
      command: 'npm run build -w @if/web && npm exec -w @if/web -- next start -p 3100',
      url: WEB_URL,
      env: { API_URL, NEXT_PUBLIC_UI_KIT: 'true' },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
