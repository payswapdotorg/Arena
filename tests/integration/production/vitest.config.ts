/**
 * tests/integration/production battery — the P006 integrated
 * generic-AI-app + Epoch end-to-end acceptance battery (NOT a pnpm
 * workspace project; run via `node tests/integration/production/run.mjs`,
 * which drives services/runtime-host's typescript + vitest — the
 * tests/runtime-host precedent, chosen because services/runtime-host owns
 * the @electric-sql/pglite pin this battery composes as its embedded real
 * Postgres engine).
 *
 * Every proof boots the REAL integrated deployment:
 *   - the REAL durable components over ONE shared SqlTransport (the
 *     embedded real PostgreSQL 17 engine — PGlite WASM — for the CI
 *     zero-credential path; the P002 battery precedent);
 *   - the REAL service engines (EscalationApiService with the REAL
 *     routing service over a REAL capability graph + routing-candidate
 *     directory, JobOrchestrator) injected through the frozen host seam
 *     (createRuntimeHost) — mirroring deploy/runtime/src/composition.ts
 *     (the production composition is ALSO booted verbatim in
 *     composition.e2e.test.ts through composeRuntimeHost);
 *   - the REAL public transport: services/escalation-api/src/http-host
 *     listener on a REAL port (the ACTUAL local URL both clients talk
 *     to) + the REAL webhook-delivery service draining the REAL durable
 *     outbox to a REAL webhook receiver + the REAL developer-platform
 *     key model;
 *   - TWO clients, both over PUBLIC TRANSPORT ONLY (ADR-P001-07/08):
 *     the generic AI application client harness (plain fetch + signed
 *     webhook consumption) and the Epoch adapter
 *     (adapters/epoch-escalation, driven through its host-integration
 *     surface and re-driven here for the identical-public-flow proof).
 */

import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * NOTE: this config deliberately does NOT import 'vitest/config' —
 * tests/integration/production has no node_modules of its own (it is not
 * a workspace project), and vitest loads a plain default-export config
 * just fine (the tests/api-host precedent).
 */
export default {
  resolve: {
    alias: {
      // The battery's bare imports, resolved into the REAL workspace
      // sources (type-source identities, not built artifacts).
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
      '@arena/epoch-escalation-adapter': `${here}../../../adapters/epoch-escalation/src/index.ts`,
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
    // Each suite boots a full embedded PostgreSQL 17 (WASM) + a real
    // HTTP listener + real webhook round-trips.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
    // Evidence capture (fresh timestamps; the honest classification
    // lives in docs/evidence/production/integration/README.md).
    env: {
      ARENA_P006_EVIDENCE_OUT:
        process.env.ARENA_P006_EVIDENCE_OUT ?? `${here}../../../../docs/evidence/production/integration`,
    },
  },
};
