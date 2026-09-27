/**
 * @arena/job-protocol — Arena durable jobs, events and audit protocol
 * (Work Order A015; requirements R26, R27, R28, R33).
 *
 * Pure TypeScript domain package whose ONLY workspace import is
 * @arena/protocol-core (protocol layer). Everything protocol-visible is
 * versioned, content-addressed and append-only:
 *
 *   - JobError taxonomy (closed code set, strict parsing)
 *   - JobDefinition — versioned, content-addressed job blueprints (sha256
 *     canonical digest, registry-style dedup, pure timeout/retry policies)
 *   - JobRecord — append-only lifecycle (queued → running →
 *     succeeded/failed/cancelled; terminal states are final) with an
 *     embedded, immutable, deep-frozen event history
 *   - JobEvent taxonomy — submitted/started/progressed/retried/completed/
 *     failed/cancelled + the generic consequential-mutation audit event,
 *     each travelling inside Envelope<T> with correlation ids and
 *     idempotency keys; per-job sequences are contiguous, gap/duplicate/
 *     out-of-order appends are rejected
 *   - AuditLog — append-only, tamper-evident sha256 chain over
 *     consequential mutations (each digest includes the previous digest)
 *   - Idempotency + correlation addressability — submission identity
 *     (scope, idempotency key, correlation id); conflicting re-submissions
 *     are rejected as JOB_IDENTITY_CONFLICT
 *
 * Generated contracts live in ../../../contracts/events (see
 * scripts/generate-contracts.mjs; drift is checked by pnpm governance G9,
 * which runs every package-level generator under packages with a --check).
 */

export * from './errors.js';
export * from './shared.js';
export * from './definition.js';
export * from './events.js';
export * from './record.js';
export * from './audit.js';
export * from './idempotency.js';
export * from './envelopes.js';

import { JOB_SCHEMA_VERSION } from './envelopes.js';

/** Version of this package's protocol surface. */
export const JOB_PROTOCOL_VERSION = JOB_SCHEMA_VERSION;
