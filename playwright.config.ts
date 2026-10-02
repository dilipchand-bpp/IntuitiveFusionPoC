import { defineConfig } from '@playwright/test';

// Locally we drive the system Edge/Chrome (no browser download needed); CI installs Playwright's Chromium.
const channel = process.env.PW_CHANNEL || undefined;
const env = { NODE_ENV: 'test', SESSION_SECRET: 'e2e-only-secret-not-for-production-use-0123456789' };

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure', channel },
  webServer: [
    {
      command: 'npm run dev -w @if/api',
      url: 'http://localhost:4000/health',
      env: { ...env, API_PORT: '4000' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -w @if/web',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
