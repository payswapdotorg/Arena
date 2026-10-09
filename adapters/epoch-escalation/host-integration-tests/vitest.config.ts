/**
 * adapters/epoch-escalation/host-integration-tests battery — the P006
 * EPOCH ADAPTER host-integration surface (Work Order P006; issue #158;
 * ADR-P001-08: Epoch consumes over the PUBLIC transport — no
 * Epoch-specific Arena API).
 *
 * NOT part of the adapter package's own `vitest run` (its frozen config
 * includes src/** only); this is a SELF-CONTAINED battery exactly like
 * tests/integration/production (also not a pnpm workspace project — the
 * workspace root does not include tests/* or extra adapter subtrees, and
 * adding one would be a root-manifest edit this worker must not make).
 * Run it either way:
 *
 *   node adapters/epoch-escalation/host-integration-tests/run.mjs
 *   node tests/integration/production/run.mjs   # the FULL integrated battery (both clients)
 *
 * The battery boots the REAL integrated deployment through the SHARED
 * harness imported from tests/integration/production/support/ (imported,
 * not replicated — one composition site, two clients) and drives the
 * Epoch adapter through the identical §15 public flow plus the adapter's
 * own fail-closed walls.
 *
 * NOTE: this config deliberately does NOT import 'vitest/config' — the
 * battery has no node_modules of its own; vitest (owned by
 * services/runtime-host, driven via run.mjs) loads a plain
 * default-export config just fine (the tests/integration/production
 * precedent).
 */

import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default {
  resolve: {
    alias: {
      // The battery's bare imports, resolved into the REAL workspace
      // sources (type-source identities, not built artifacts) — the SAME
      // alias set the tests/integration/production battery uses.
      '@arena/capability-learning/test-support': `${here}../../../packages/capability-learning/src/test-support.ts`,
      '@arena/runtime-host-service/test-support': `${here}../../../services/runtime-host/src/test-support.ts`,
      '@arena/runtime-host-composition': `${here}../../../deploy/runtime/src/composition.ts`,
      '@arena/escalation-api/http-host': `${here}../../../services/escalation-api/src/http-host/index.ts`,
      '@arena/escalation-api/mcp-host': `${here}../../../services/escalation-api/src/mcp-host/index.ts`,
      '@arena/escalation-api': `${here}../../../services/escalation-api/src/index.ts`,
      '@arena/webhook-delivery': `${here}../../../services/webhook-delivery/src/index.ts`,
      '@arena/escalation-routing-service': `${here}../../../services/escalation-routing/src/index.ts`,
      '@arena/job-orchestrator': `${here}../../../services/job-orchestrator/src/index.ts`,
      '@arena/runtime-host-service': `${here}../../../services/runtime-host/src/index.ts`,
      '@arena/payments-service': `${here}../../../services/payments/src/index.ts`,
      '@arena/escalation-adapters': `${here}../../../adapters/escalation/src/index.ts`,
      '@arena/payments-adapters': `${here}../../../adapters/payments/src/index.ts`,
      '@arena/hosted-neon-postgres': `${here}../../../adapters/hosted/neon-postgres/src/index.ts`,
      '@arena/epoch-escalation-adapter': `${here}../src/index.ts`,
      '@arena/runtime-host': `${here}../../../packages/runtime-host/src/index.ts`,
      '@arena/developer-platform': `${here}../../../packages/developer-platform/src/index.ts`,
      '@arena/capability-learning': `${here}../../../packages/capability-learning/src/index.ts`,
      '@arena/escalation-observability': `${here}../../../packages/escalation-observability/src/index.ts`,
      '@arena/escalation-routing': `${here}../../../packages/escalation-routing/src/index.ts`,
      '@arena/capability-graph': `${here}../../../packages/capability-graph/src/index.ts`,
      '@arena/expert-qualification': `${here}../../../packages/expert-qualification/src/index.ts`,
      '@arena/expert-session': `${here}../../../packages/expert-session/src/index.ts`,
      '@arena/intervention': `${here}../../../packages/intervention/src/index.ts`,
      '@arena/escalation': `${here}../../../packages/escalation/src/index.ts`,
      '@arena/learning': `${here}../../../packages/learning/src/index.ts`,
      '@arena/payments': `${here}../../../packages/payments/src/index.ts`,
      '@arena/persistence': `${here}../../../packages/persistence/src/index.ts`,
      '@arena/job-protocol': `${here}../../../packages/job-protocol/src/index.ts`,
      '@arena/protocol-core': `${here}../../../packages/protocol-core/src/index.ts`,
      '@arena/trajectory': `${here}../../../packages/trajectory/src/index.ts`,
      '@arena/environment-protocol': `${here}../../../packages/environment-protocol/src/index.ts`,
      '@arena/evaluation': `${here}../../../packages/evaluation/src/index.ts`,
      '@arena/verification': `${here}../../../packages/verification/src/index.ts`,
      '@arena/artifact-protocol': `${here}../../../packages/artifact-protocol/src/index.ts`,
      '@arena/security': `${here}../../../packages/security/src/index.ts`,
      '@arena/observability': `${here}../../../packages/observability/src/index.ts`,
      '@arena/expert-engagement': `${here}../../../packages/expert-engagement/src/index.ts`,
      // The battery's embedded real-Postgres engine, resolved into the
      // workspace package that owns the exact pin (the P002
      // tests/runtime-host precedent).
      '@electric-sql/pglite': `${here}../../../services/runtime-host/node_modules/@electric-sql/pglite/dist/index.js`,
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // The suite boots a full embedded PostgreSQL 17 (WASM) + a real HTTP
    // listener + real webhook round-trips.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
    // Evidence capture (fresh timestamps; the honest classification
    // lives in docs/evidence/production/integration/README.md).
    env: {
      ARENA_P006_EVIDENCE_OUT:
        process.env.ARENA_P006_EVIDENCE_OUT ?? `${here}../../../docs/evidence/production/integration`,
    },
  },
};
