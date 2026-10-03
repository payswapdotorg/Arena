import { defineConfig } from 'vitest/config';

// Pure view-model package: node environment, no DOM, no framework imports.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
