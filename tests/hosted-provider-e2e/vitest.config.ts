import { fileURLToPath } from 'node:url';

/**
 * The P004 hosted-provider E2E battery configuration.
 *
 * tests/hosted-provider-e2e is NOT a pnpm workspace project (the workspace
 * root does not include tests/* — adding it would be a root-manifest edit
 * the worker must not make; the tests/product-e2e, tests/ux and
 * tests/epoch-e2e precedent). Instead the battery runs through
 * adapters/hosted, the workspace package that owns vitest AND the hosted
 * adapters' provider dependency (@aws-sdk/client-s3):
 *
 *   node tests/hosted-provider-e2e/run.mjs
 *     (= node adapters/hosted/node_modules/vitest/vitest.mjs run
 *        --root tests/hosted-provider-e2e)
 *
 * The battery exercises the REAL adapter sources (the same sources the
 * runtime composes) through explicit aliases to their TypeScript sources
 * (the same sources the adapters' package.json exports map points at).
 *
 * NOTE: this config deliberately does NOT import 'vitest/config' —
 * tests/hosted-provider-e2e has no node_modules of its own (it is not a
 * workspace project), and vitest loads a plain default-export config
 * just fine (the tests/product-e2e precedent).
 */
const here = fileURLToPath(new URL('.', import.meta.url));

export default {
  resolve: {
    alias: {
      // The battery's bare imports, resolved into the REAL workspace
      // sources (type-source identities, not built artifacts).
      '@arena/persistence': `${here}../../packages/persistence/src/index.ts`,
      '@arena/protocol-core': `${here}../../packages/protocol-core/src/index.ts`,
      '@arena/hosted-r2-object-store': `${here}../../adapters/hosted/r2-object-store/src/index.ts`,
      '@arena/hosted-upstash-redis': `${here}../../adapters/hosted/upstash-redis/src/index.ts`,
      '@arena/deploy/env-contract': `${here}../../deploy/src/hosted/env-contract.ts`,
      // The R2 provider dependency, resolved into adapters/hosted's
      // node_modules (the workspace package that owns the exact pin).
      '@aws-sdk/client-s3': `${here}../../adapters/hosted/node_modules/@aws-sdk/client-s3`,
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // Live-provider round-trips (R2 lifecycle, TTL expiry waits, the
    // sanitized-env app boot) need generous, deterministic ceilings.
    testTimeout: 90_000,
    hookTimeout: 90_000,
    teardownTimeout: 30_000,
  },
};
