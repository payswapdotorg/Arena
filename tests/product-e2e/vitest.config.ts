import { fileURLToPath } from 'node:url';

/**
 * The B017 full-product E2E battery configuration.
 *
 * tests/product-e2e is NOT a pnpm workspace project (the workspace root
 * does not include tests/* — adding it would be a root-manifest edit,
 * which B017 must not make; the tests/security and tests/epoch-e2e
 * precedent). Instead the battery runs through apps/web, which owns
 * vitest + react + react-dom:
 *
 *   node tests/product-e2e/run.mjs
 *     (= cd apps/web && pnpm exec vitest run --root ../../tests/product-e2e)
 *
 * App-surface imports go through RELATIVE paths into the real
 * apps/web/src sources (the same sources the route mounts import), so
 * the battery exercises the REAL product composition code. Their own
 * bare imports (react, @arena/*, next/headers) resolve naturally from
 * inside apps/web. Only the battery's OWN bare imports need explicit
 * aliases below.
 *
 * NOTE: this config deliberately does NOT import 'vitest/config' —
 * tests/product-e2e has no node_modules of its own (it is not a
 * workspace project), and vitest loads a plain default-export config
 * just fine (the tests/security precedent).
 */
const here = fileURLToPath(new URL('.', import.meta.url));

export default {
  resolve: {
    alias: {
      // The battery's own bare imports, resolved into apps/web's
      // node_modules (the workspace package that owns them).
      react: `${here}../../apps/web/node_modules/react`,
      'react-dom/server': `${here}../../apps/web/node_modules/react-dom/server.node.js`,
    },
  },
  oxc: {
    // The app tsconfig keeps `jsx: preserve` for Next.js, so the app's
    // own vitest config compiles JSX with the automatic runtime through
    // the oxc transform; the same setting applies here for any TSX the
    // battery renders.
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // The E2E walk boots the app composition and walks a full lifecycle;
    // give the file-level suites a generous, deterministic ceiling.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
};
