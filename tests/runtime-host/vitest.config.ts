/**
 * tests/runtime-host battery — the P002 durable host runtime acceptance
 * battery (NOT a pnpm workspace project; run via
 * `node tests/runtime-host/run.mjs`, which drives services/runtime-host's
 * typescript + vitest — the tests/hosted-provider-e2e precedent).
 *
 * Evidence classes:
 *   1. composition parity (always): the REAL service engines composed
 *      through deploy/runtime/src/composition.ts over the in-memory
 *      reference transport — the structural-parity pinning the frozen
 *      interface package names (packages/runtime-host/src/surfaces.ts);
 *   2. embedded real Postgres (always): @electric-sql/pglite — a REAL
 *      PostgreSQL 17 engine (WASM build) executing the REAL migration
 *      DDL and the named durable-runtime statement set, proving the
 *      five P002 acceptance criteria end-to-end with zero credentials;
 *   3. live Neon (self-skipping): when ARENA_P002_NEON_EVIDENCE_URL (or
 *      DATABASE_URL / NEON_CONNECTION_STRING with a postgres:// scheme)
 *      points at the DEDICATED evidence project, the same proofs run
 *      against the live hosted database through the REAL Neon HTTP
 *      driver, with redacted transcripts captured into
 *      tests/runtime-host/evidence/.
 */

import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * NOTE: this config deliberately does NOT import 'vitest/config' —
 * tests/runtime-host has no node_modules of its own (it is not a
 * workspace project), and vitest loads a plain default-export config
 * just fine (the tests/hosted-provider-e2e precedent).
 */
export default {
  resolve: {
    alias: {
      // The battery's bare imports, resolved into the REAL workspace
      // sources (type-source identities, not built artifacts).
      '@arena/runtime-host-service/test-support': `${here}../../services/runtime-host/src/test-support.ts`,
      '@arena/runtime-host-service/memory-transport': `${here}../../services/runtime-host/src/memory-transport.ts`,
      '@arena/runtime-host-service': `${here}../../services/runtime-host/src/index.ts`,
      '@arena/runtime-host-composition': `${here}../../deploy/runtime/src/composition.ts`,
      '@arena/escalation-api': `${here}../../services/escalation-api/src/index.ts`,
      '@arena/escalation-routing-service': `${here}../../services/escalation-routing/src/index.ts`,
      '@arena/job-orchestrator': `${here}../../services/job-orchestrator/src/index.ts`,
      '@arena/runtime-host': `${here}../../packages/runtime-host/src/index.ts`,
      '@arena/hosted-neon-postgres': `${here}../../adapters/hosted/neon-postgres/src/index.ts`,
      '@arena/persistence': `${here}../../packages/persistence/src/index.ts`,
      '@arena/protocol-core': `${here}../../packages/protocol-core/src/index.ts`,
      '@arena/escalation': `${here}../../packages/escalation/src/index.ts`,
      '@arena/job-protocol': `${here}../../packages/job-protocol/src/index.ts`,
      // The Neon HTTP driver (runtime dep of the hosted adapters), and
      // the battery's embedded real-Postgres engine, resolved into the
      // workspace packages that own the exact pins (the P004
      // @aws-sdk-in-adapters/hosted alias precedent).
      '@neondatabase/serverless': `${here}../../adapters/hosted/node_modules/@neondatabase/serverless`,
      '@electric-sql/pglite': `${here}../../services/runtime-host/node_modules/@electric-sql/pglite/dist/index.js`,
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // The embedded real Postgres boots a full PostgreSQL 17 instance in
    // WASM per suite; live-Neon round-trips cross the real network.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
    // Live evidence capture (redacted at capture time).
    env: {
      ARENA_P002_EVIDENCE_OUT: process.env.ARENA_P002_EVIDENCE_OUT ?? `${here}evidence`,
    },
  },
};
