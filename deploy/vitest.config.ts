import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const aliases: Record<string, string> = {
  '@arena/protocol-core': '../packages/protocol-core/src/index.ts',
  '@arena/observability': '../packages/observability/src/index.ts',
  '@arena/deploy': './src/index.ts',
};

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      Object.entries(aliases).map(([key, value]) => [key, resolve(__dirname, value)]),
    ),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
