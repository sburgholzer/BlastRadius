import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@blast-radius/core': '/packages/core/src',
      '@blast-radius/lambdas': '/packages/lambdas/src',
      '@blast-radius/cli': '/packages/cli/src',
    },
  },
});
