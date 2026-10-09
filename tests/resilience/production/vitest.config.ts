/**
 * tests/resilience/production battery — the P007 integrated resilience
 * pass (NOT a pnpm workspace project; run via
 * `node tests/resilience/production/run.mjs`, which drives
 * services/escalation-api's typescript + vitest — the tests/api-host and
 * tests/runtime-host precedents).
 *
 * Every scenario boots the REAL production composition (embedded real
 * PostgreSQL engine + REAL engines + REAL public transport + REAL
 * hosted-provider adapters behind injected fake transports — the P004
 * CI pattern) and attacks the failure-mode classes the work-items
 * §P007 names: provider outage/recovery windows, timeout/retry storms,
 * dead-letter behavior, restart recovery sweeps.
 *
 * EVIDENCE CLASS (release-gate §3): AUTOMATED-TEST-ONLY (embedded-PG
 * engine class).
 */

import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * NOTE: this config deliberately does NOT import 'vitest/config' —
 * tests/resilience/production has no node_modules of its own (it is not
 * a workspace project), and vitest loads a plain default-export config
 * just fine (the tests/runtime-host precedent).
 */
export default {
  resolve: {
    alias: {
      '@arena/escalation-api/http-host': `${here}../../../services/escalation-api/src/http-host/index.ts`,
      '@arena/escalation-api': `${here}../../../services/escalation-api/src/index.ts`,
      '@arena/webhook-delivery': `${here}../../../services/webhook-delivery/src/index.ts`,
      '@arena/escalation-adapters': `${here}../../../adapters/escalation/src/index.ts`,
      '@arena/developer-platform': `${here}../../../packages/developer-platform/src/index.ts`,
      '@arena/runtime-host': `${here}../../../packages/runtime-host/src/index.ts`,
      // Subpath aliases MUST precede their bare-package key (the vite
      // alias engine matches in order — the tests/api-host precedent).
      '@arena/runtime-host-service/test-support': `${here}../../../services/runtime-host/src/test-support.ts`,
      '@arena/runtime-host-service': `${here}../../../services/runtime-host/src/index.ts`,
      '@arena/runtime-host-composition': `${here}../../../deploy/runtime/src/composition.ts`,
      '@arena/escalation-routing-service': `${here}../../../services/escalation-routing/src/index.ts`,
      '@arena/job-orchestrator': `${here}../../../services/job-orchestrator/src/index.ts`,
      '@arena/hosted-neon-postgres': `${here}../../../adapters/hosted/neon-postgres/src/index.ts`,
      '@arena/hosted-r2-object-store/test-support': `${here}../../../adapters/hosted/r2-object-store/src/test-support.ts`,
      '@arena/hosted-r2-object-store': `${here}../../../adapters/hosted/r2-object-store/src/index.ts`,
      '@arena/hosted-upstash-redis/test-support': `${here}../../../adapters/hosted/upstash-redis/src/test-support.ts`,
      '@arena/hosted-upstash-redis': `${here}../../../adapters/hosted/upstash-redis/src/index.ts`,
      '@arena/persistence': `${here}../../../packages/persistence/src/index.ts`,
      '@arena/protocol-core': `${here}../../../packages/protocol-core/src/index.ts`,
      '@arena/escalation': `${here}../../../packages/escalation/src/index.ts`,
      '@arena/job-protocol': `${here}../../../packages/job-protocol/src/index.ts`,
      '@electric-sql/pglite': `${here}../../../services/runtime-host/node_modules/@electric-sql/pglite/dist/index.js`,
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // The embedded real Postgres boots a full PostgreSQL 17 instance in
    // WASM per suite; webhook retry scenarios run real HTTP deliveries.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
  },
};
