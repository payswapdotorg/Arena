import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const aliases: Record<string, string> = {
  '@arena/protocol-core': '../packages/protocol-core/src/index.ts',
  '@arena/observability': '../packages/observability/src/index.ts',
  '@arena/arena-sdk': '../packages/arena-sdk/src/index.ts',
  '@arena/api-fabric': '../services/api/src/index.ts',
  '@arena/deploy': '../deploy/src/index.ts',
  '@arena/ops': '../ops/src/index.ts',
  '@arena/performance': '../tests/performance/src/index.ts',
  '@arena/release': './src/index.ts',
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
