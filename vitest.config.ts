import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@if/shared': src('./packages/shared/src/index.ts'),
      '@if/ui/theme': src('./packages/ui/src/theme.ts'),
      '@if/ui': src('./packages/ui/src/index.ts'),
    },
  },
  test: {
    include: ['apps/**/src/**/*.test.{ts,tsx}', 'packages/**/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['apps/api/src/**', 'packages/**/src/**'],
      exclude: ['**/*.test.{ts,tsx}', 'apps/api/src/main.ts', '**/*.css'],
    },
  },
});
