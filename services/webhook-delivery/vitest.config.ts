import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The delivery suite boots real node:http receivers and exercises
    // real transport timeouts.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
