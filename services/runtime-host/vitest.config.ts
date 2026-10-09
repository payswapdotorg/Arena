import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * The runtime-host composition-root service vitest configuration.
 *
 * The bare import `@arena/hosted-neon-postgres` resolves through the
 * tsconfig path alias in TYPE space; vitest needs the matching RUNTIME
 * alias (the deploy/src/hosted precedent for the TL-flagged nested-
 * adapter glob gap: pnpm-workspace.yaml's `adapters/*` glob matches
 * adapters/hosted itself, not the nested adapters/hosted/* packages, so
 * the dependency manifests materialize only through the TL-owned
 * adapters/hosted container manifest — disclosed in the P002 PR body).
 */
const here = fileURLToPath(new URL('.', import.meta.url));

export default {
  resolve: {
    alias: {
      '@arena/hosted-neon-postgres': resolve(
        here,
        '../../adapters/hosted/neon-postgres/src/index.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
};
