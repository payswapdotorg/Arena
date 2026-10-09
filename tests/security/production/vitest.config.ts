/**
 * tests/security/production battery — the P007 integrated adversarial
 * security pass (NOT a pnpm workspace project; run via
 * `node tests/security/production/run.mjs`, which drives
 * services/escalation-api's typescript + vitest — the tests/api-host and
 * tests/runtime-house precedents).
 *
 * Every attack boots the REAL production composition:
 *   - the embedded REAL PostgreSQL engine (@electric-sql/pglite — the
 *     P002 tests/runtime-host battery pattern; real DDL, real named
 *     statement set, real ON CONFLICT / RETURNING semantics);
 *   - the REAL durable components + REAL service engines
 *     (EscalationApiService + EscalationRoutingService + JobOrchestrator)
 *     through the frozen host seam (createRuntimeHost);
 *   - the REAL public transport (startEscalationHttpHost — HTTP + MCP on
 *     an actual local URL) and the REAL signed-webhook delivery service
 *     draining the REAL durable outbox;
 *   - the REAL developer-platform key model behind the boundary
 *     authenticator.
 *
 * Attack classes executed here map 1:1 to
 * docs/security/post-roadmap/threat-model.md §4 (AC-01 … AC-14).
 *
 * EVIDENCE CLASS (release-gate §3): AUTOMATED-TEST-ONLY (embedded-PG
 * engine class). A live-Neon re-run of the same suites would be the
 * optional DEMONSTRATED-LIVE addition (release-owner decision).
 */

import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * NOTE: this config deliberately does NOT import 'vitest/config' —
 * tests/security/production has no node_modules of its own (it is not a
 * workspace project), and vitest loads a plain default-export config
 * just fine (the tests/runtime-host precedent).
 */
export default {
  resolve: {
    alias: {
      // The battery's bare imports, resolved into the REAL workspace
      // sources (type-source identities, not built artifacts).
      '@arena/escalation-api/http-host': `${here}../../../services/escalation-api/src/http-host/index.ts`,
      '@arena/escalation-api/mcp-host': `${here}../../../services/escalation-api/src/mcp-host/index.ts`,
      '@arena/escalation-api': `${here}../../../services/escalation-api/src/index.ts`,
      '@arena/webhook-delivery': `${here}../../../services/webhook-delivery/src/index.ts`,
      '@arena/escalation-adapters': `${here}../../../adapters/escalation/src/index.ts`,
      '@arena/developer-platform': `${here}../../../packages/developer-platform/src/index.ts`,
      '@arena/runtime-host': `${here}../../../packages/runtime-host/src/index.ts`,
      // Subpath aliases MUST precede their bare-package key (the vite
      // alias engine matches in order — the tests/api-host precedent).
      '@arena/runtime-host-service/memory-transport': `${here}../../../services/runtime-host/src/memory-transport.ts`,
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
      '@arena/payments-adapters': `${here}../../../adapters/payments/src/index.ts`,
      '@arena/payments': `${here}../../../packages/payments/src/index.ts`,
      '@arena/payments-service': `${here}../../../services/payments/src/index.ts`,
      '@arena/intervention': `${here}../../../packages/intervention/src/index.ts`,
      '@arena/persistence': `${here}../../../packages/persistence/src/index.ts`,
      '@arena/protocol-core': `${here}../../../packages/protocol-core/src/index.ts`,
      '@arena/escalation': `${here}../../../packages/escalation/src/index.ts`,
      '@arena/job-protocol': `${here}../../../packages/job-protocol/src/index.ts`,
      '@arena/expert-session/test-support': `${here}../../../packages/expert-session/src/test-support.ts`,
      '@arena/expert-session': `${here}../../../packages/expert-session/src/index.ts`,
      '@arena/expert-session-policy/test-support': `${here}../../../packages/expert-session-policy/src/test-support.ts`,
      '@arena/expert-session-policy': `${here}../../../packages/expert-session-policy/src/index.ts`,
      '@arena/capability-learning/test-support': `${here}../../../packages/capability-learning/src/test-support.ts`,
      '@arena/capability-learning': `${here}../../../packages/capability-learning/src/index.ts`,
      '@arena/security': `${here}../../../packages/security/src/index.ts`,
      '@arena/security-service': `${here}../../../services/security/src/index.ts`,
      // The battery's embedded real-Postgres engine, resolved into the
      // workspace package that owns the exact pin (the tests/runtime-host
      // alias precedent).
      '@electric-sql/pglite': `${here}../../../services/runtime-host/node_modules/@electric-sql/pglite/dist/index.js`,
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // The embedded real Postgres boots a full PostgreSQL 17 instance in
    // WASM per suite; adversarial race batteries fire real concurrent
    // HTTP requests through a real listener.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
    // Evidence capture (redacted at capture time; see run.mjs transcript).
    env: {
      ARENA_P007_EVIDENCE_OUT:
        process.env.ARENA_P007_EVIDENCE_OUT ?? `${here}../../../docs/evidence/production/security`,
    },
  },
};
