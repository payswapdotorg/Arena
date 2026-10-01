import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'neon-postgres/src/**/*.test.ts',
      'r2-object-store/src/**/*.test.ts',
      'upstash-redis/src/**/*.test.ts',
    ],
  },
});
