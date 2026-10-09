/**
 * tests/api-host battery — the P003 public-transport acceptance battery
 * (NOT a pnpm workspace project; run via `node tests/api-host/run.mjs`,
 * which drives services/escalation-api's typescript + vitest — the
 * tests/runtime-host precedent).
 *
 * Every proof runs a generic plain-fetch client against an ACTUAL local
 * URL (a real node:http listener on an ephemeral port) over the
 * production composition: frozen host seam + REAL engines + REAL
 * durable components + REAL developer-platform key model. The webhook
 * proofs drive the REAL webhook-delivery service draining the REAL
 * durable outbox into a REAL webhook receiver.
 */

import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * NOTE: this config deliberately does NOT import 'vitest/config' —
 * tests/api-host has no node_modules of its own (it is not a workspace
 * project), and vitest loads a plain default-export config just fine
 * (the tests/runtime-host precedent).
 */
export default {
  resolve: {
    alias: {
      // The battery's bare imports, resolved into the REAL workspace
      // sources (type-source identities, not built artifacts).
      '@arena/escalation-api/http-host': `${here}../../services/escalation-api/src/http-host/index.ts`,
      '@arena/escalation-api/mcp-host': `${here}../../services/escalation-api/src/mcp-host/index.ts`,
      '@arena/escalation-api': `${here}../../services/escalation-api/src/index.ts`,
      '@arena/webhook-delivery': `${here}../../services/webhook-delivery/src/index.ts`,
      '@arena/escalation-adapters': `${here}../../adapters/escalation/src/index.ts`,
      '@arena/developer-platform': `${here}../../packages/developer-platform/src/index.ts`,
      '@arena/runtime-host': `${here}../../packages/runtime-host/src/index.ts`,
      '@arena/runtime-host-service/memory-transport': `${here}../../services/runtime-host/src/memory-transport.ts`,
      '@arena/runtime-host-service/test-support': `${here}../../services/runtime-host/src/test-support.ts`,
      '@arena/runtime-host-service': `${here}../../services/runtime-host/src/index.ts`,
      '@arena/escalation-routing-service': `${here}../../services/escalation-routing/src/index.ts`,
      '@arena/job-orchestrator': `${here}../../services/job-orchestrator/src/index.ts`,
      '@arena/hosted-neon-postgres': `${here}../../adapters/hosted/neon-postgres/src/index.ts`,
      '@arena/persistence': `${here}../../packages/persistence/src/index.ts`,
      '@arena/protocol-core': `${here}../../packages/protocol-core/src/index.ts`,
      '@arena/escalation': `${here}../../packages/escalation/src/index.ts`,
      '@arena/job-protocol': `${here}../../packages/job-protocol/src/index.ts`,
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // The suites boot real HTTP listeners and exercise real transport
    // timeouts (bounded at ~150ms per hanging attempt).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
};
