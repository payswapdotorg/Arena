/**
 * @arena/environment-runtime — the RUNTIME PROTOCOL layer for Arena
 * environment runs (Work Order A010; spec/environment.md ENV1.0
 * lifecycle; docs/architecture.md §7 (Environment), §16
 * (multi-tenancy); architecture-lock rules 8, 21; requirements R9,
 * R29, R30, R33).
 *
 * Pure TypeScript. The ONLY runtime dependency is @arena/protocol-core
 * (envelopes, canonical JSON + sha256 digests, branded identifiers,
 * ProtocolError) — reused throughout, never reimplemented. The sibling
 * domain types this package composes enter strictly as TYPE-ONLY
 * imports (A009 isolation envelopes, environment version refs, run
 * addresses; A015 job ids) — the boundary checker permits domain→domain
 * composition on this base, and the guards for those shapes live here,
 * typed against the imported types (gate 12). Runtime-neutral by
 * construction: no runner/provider string ever enters a canonical or
 * digested object (gate 13).
 *
 * Core objects (all deep-frozen, append-only, no mutation API):
 *   - RunRecord — the content-addressed declaration of a run
 *     (tenant-scoped run id, content-addressed environment ref, job
 *     reference, initial snapshot digest, seed, submitted-at, tenant id,
 *     isolation envelope of A009 policy types);
 *   - the lifecycle state machine — requested → provisioning → ready →
 *     running → (checkpointing → running)* → completed | failed |
 *     timed-out → cleaned, with a pure transition function that rejects
 *     every illegal pair with a typed error carrying the offending
 *     from/to states;
 *   - RuntimeEvent taxonomy + EnvironmentEventLog — the append-only,
 *     enveloped, idempotency-keyed event stream of every run
 *     (lifecycle transitions, admission decisions, checkpoint records,
 *     workload steps, results, cleanup), queryable by run, by tenant
 *     and by state;
 *   - admission — the pure fit check of a run's isolation envelope
 *     inside the target environment's bounds (over-quota and
 *     least-privilege violations are rejected with typed errors);
 *   - tenant isolation — run ids are namespaced by tenant; the tenant
 *     is part of the RunRecord digest; cross-tenant run references
 *     fail closed;
 *   - RunCheckpoint / restoreToCheckpoint — content-addressed
 *     checkpoints with per-run restore validation (foreign-run
 *     checkpoints are rejected);
 *   - RunResult — the evidence-addressable outcome of a completed run,
 *     binding A009's RunAddress (all digests required);
 *   - SeededLcg — the determinism primitive for reproducible runs.
 *
 * Generated contracts live in ../contracts (see
 * scripts/generate-contracts.mjs — package-local artifacts; the
 * repository-root contracts/ intake is a Tech Lead wiring step). Drift
 * is checked by the drift suite and governance G9 (which auto-discovers
 * package-level generators), and parity is asserted against this TS
 * surface by contracts.parity.test.ts.
 */

export * from './errors.js';
export * from './shared.js';
export * from './run-id.js';
export * from './lifecycle.js';
export * from './isolation-envelope.js';
export * from './run-record.js';
export * from './events.js';
export * from './run-state.js';
export * from './checkpoint.js';
export * from './admission.js';
export * from './event-log.js';
export * from './run-result.js';
export * from './envelopes.js';
export * from './determinism.js';
export * from './queries.js';

import { ENVIRONMENT_RUNTIME_ERROR_CODES } from './errors.js';
import {
  ENVIRONMENT_RUNTIME_SCHEMAS,
  ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
} from './envelopes.js';

/** Version of this package's protocol surface. */
export const ENVIRONMENT_RUNTIME_VERSION = ENVIRONMENT_RUNTIME_SCHEMA_VERSION;

/** The environment-runtime error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_ENVIRONMENT_RUNTIME_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(ENVIRONMENT_RUNTIME_ERROR_CODES),
);

/** The environment-runtime schema registry (parity-checked against contracts). */
export const ENVIRONMENT_RUNTIME_SCHEMA_REGISTRY: Readonly<Record<string, string>> =
  Object.freeze({ ...ENVIRONMENT_RUNTIME_SCHEMAS });
