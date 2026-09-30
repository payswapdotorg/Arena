import { fileURLToPath } from 'node:url';

/**
 * The A034 adversarial battery configuration.
 *
 * tests/security is NOT a pnpm workspace project (the workspace root
 * does not include tests/* — adding it would be a root-manifest edit,
 * which A034 must not make). Instead the battery runs via the
 * services/security workspace package, which owns vitest:
 *
 *   cd services/security && pnpm run battery:test
 *     (= vitest run --root ../../tests/security)
 *
 * Workspace package imports resolve through explicit aliases to their
 * TypeScript sources (the same sources the workspace exports map
 * points at), so the battery exercises the REAL protocol code.
 *
 * NOTE: this config deliberately does NOT import 'vitest/config' —
 * tests/security has no node_modules of its own (it is not a workspace
 * project), and vitest loads a plain default-export config just fine.
 */
const here = fileURLToPath(new URL('.', import.meta.url));

export default {
  resolve: {
    alias: {
      '@arena/security': `${here}../../packages/security/src/index.ts`,
      '@arena/protocol-core': `${here}../../packages/protocol-core/src/index.ts`,
      '@arena/security-service': `${here}../../services/security/src/index.ts`,
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
};
