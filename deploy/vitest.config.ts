import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Source-level imports of the workspace packages this wiring composes
// (the A036 @arena/deploy precedent). More-specific keys come FIRST so
// prefix matching cannot shadow the subpath entries. The B002 hosted
// adapters keep test-support private to their public barrels; the deploy
// composition layer reaches the source files directly.
const aliases: Record<string, string> = {
  '@arena/hosted-neon-postgres/test-support': '../adapters/hosted/neon-postgres/src/test-support.ts',
  '@arena/hosted-r2-object-store/test-support': '../adapters/hosted/r2-object-store/src/test-support.ts',
  '@arena/hosted-upstash-redis/test-support': '../adapters/hosted/upstash-redis/src/test-support.ts',
  '@arena/protocol-core': '../packages/protocol-core/src/index.ts',
  '@arena/observability': '../packages/observability/src/index.ts',
  '@arena/persistence': '../packages/persistence/src/index.ts',
  '@arena/persistence-service': '../services/persistence/src/index.ts',
  '@arena/hosted-neon-postgres': '../adapters/hosted/neon-postgres/src/index.ts',
  '@arena/hosted-r2-object-store': '../adapters/hosted/r2-object-store/src/index.ts',
  '@arena/hosted-upstash-redis': '../adapters/hosted/upstash-redis/src/index.ts',
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
