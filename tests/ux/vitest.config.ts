import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The B017 UX/operational conformance battery configuration.
 *
 * tests/ux is NOT a pnpm workspace project (the workspace root does not
 * include tests/* — the tests/security and tests/epoch-e2e precedent).
 * The battery runs through apps/web, which owns vitest + react +
 * react-dom:
 *
 *   node tests/ux/run.mjs
 *     (= cd apps/web && pnpm exec vitest run --root ../../tests/ux)
 *
 * App-surface imports go through RELATIVE paths into the real
 * apps/web/src sources. The battery's OWN bare imports (react,
 * react-dom/server) resolve through the aliases below.
 *
 * The real-browser viewport suite additionally needs Playwright. The
 * repo carries no Playwright dependency (a root-manifest/lockfile edit
 * is forbidden for B017), so the module is resolved through the
 * ARENA_PLAYWRIGHT_MODULE env knob when the host machine provides a
 * global install; when absent the viewport suite SELF-SKIPS and the
 * static overflow-risk analysis still runs (the manifest records the
 * environment-dependence honestly).
 */
const here = fileURLToPath(new URL('.', import.meta.url));

const playwrightModule =
  process.env.ARENA_PLAYWRIGHT_MODULE ??
  `${process.env.HOME ?? '/home/z'}/.npm-global/lib/node_modules/playwright/index.mjs`;

export default {
  resolve: {
    alias: {
      react: `${here}../../apps/web/node_modules/react`,
      'react-dom/server': `${here}../../apps/web/node_modules/react-dom/server.node.js`,
      ...(existsSync(playwrightModule) ? { playwright: playwrightModule } : {}),
    },
  },
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
};
