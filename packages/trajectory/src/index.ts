/**
 * @arena/trajectory — the ARENA TRAJECTORY PROTOCOL (Work Order A011;
 * requirements R10, R11, R24; architecture-lock rule 6 — trajectories
 * are append-only and content-addressed; spec/task-spec.md TaskSpec
 * §actions/observations; spec/environment.md ENV1.0 "Evidence";
 * docs/architecture.md §5 (trajectories), §18 (layers)).
 *
 * A trajectory is the append-only, digest-addressed record of what an
 * agent DID inside a run: actions taken, observations received, and
 * their ordering. Pure TypeScript; the ONLY runtime dependency is
 * @arena/protocol-core (envelopes, canonical JSON + sha256 digests,
 * branded identifiers, ProtocolError) — reused throughout, never
 * reimplemented. The one sibling type reused (A009's TaskVersionRef)
 * enters strictly as a TYPE-ONLY import from
 * @arena/environment-protocol (domain→domain composition permitted by
 * the boundary checker on this base); its runtime guard is a local
 * mirror. STORAGE-NEUTRAL by construction: the protocol knows nothing
 * about any persistence backend (gate 7 — enforced at the source level
 * by the hygiene suite); the reference store lives in
 * @arena/trajectory-store and is in-process, zero external runtime
 * dependencies.
 *
 * Core objects (all deep-frozen, append-only, no mutation API):
 *   - TrajectoryRunRef — the run binding: the four input parts of the
 *     run's ENV1.0 evidence address (task version, environment version,
 *     run id, initial snapshot digest) plus the optional A010 RunRecord
 *     digest pin; the trajectory/output digests are bound downstream by
 *     A010's RunResult, never here (that would be circular);
 *   - TrajectoryHeader — the content-addressed declaration: trajectory
 *     id, run ref, agent/body ref (digest), substrate ref (digest),
 *     started-at, seed. Same header ⇒ same digest;
 *   - TrajectoryEntry — one ordered step: sequence (1..n, contiguous —
 *     gaps rejected), kind (action | observation | checkpoint | error |
 *     completion), typed payload per kind, occurred-at, and the CHAINED
 *     stepDigest (entry N commits to entry N-1's digest; entry 1 is
 *     anchored to the header digest) — mutating history changes every
 *     subsequent digest;
 *   - TrajectoryRecord — header + entries + chainHead (the final digest
 *     over the full chain, i.e. the trajectory digest referenced by
 *     ENV1.0's RunAddress); frozen at completion (append-after-complete
 *     rejected); pure replay view; full-chain verification;
 *   - Envelope<T> wiring — open-trajectory-command /
 *     trajectory-opened-event, append-trajectory-entry-command /
 *     trajectory-entry-appended-event, with REQUIRED idempotency keys
 *     on commands (architecture-lock rule 17), mirroring
 *     artifact-protocol / job-protocol exactly.
 *
 * Generated contracts live in ../../contracts/trajectory (repo root —
 * A011 owned surface; see scripts/generate-contracts.mjs). Drift is
 * checked by the drift suite and governance G9 (which auto-discovers
 * package-level generators), and parity is asserted against this TS
 * surface by contracts.parity.test.ts.
 */

export * from './errors.js';
export * from './shared.js';
export * from './run-ref.js';
export * from './header.js';
export * from './entry.js';
export * from './record.js';
export * from './envelopes.js';

import { TRAJECTORY_SCHEMAS } from './envelopes.js';
import { TRAJECTORY_SCHEMA_VERSION } from './envelopes.js';

/** Version of this package's protocol surface. */
export const TRAJECTORY_PROTOCOL_VERSION = TRAJECTORY_SCHEMA_VERSION;

/** The schema registry (parity-checked against contracts). */
export const TRAJECTORY_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...TRAJECTORY_SCHEMAS,
});
