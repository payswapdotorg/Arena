/**
 * @arena/trajectory-store — the in-process REFERENCE STORE for Arena
 * trajectories (Work Order A011 gate 6; requirements R10, R11, R24).
 *
 * Pure TypeScript, ZERO external runtime dependencies: only
 * @arena/protocol-core and @arena/trajectory (workspace packages). The
 * store is the storage-neutral reference implementation of the
 * trajectory protocol boundary:
 *
 *   - open — idempotent by trajectory id (same header ⇒ same record;
 *     different header ⇒ identity conflict);
 *   - append — domain validation + chained-digest computation (the store
 *     never trusts caller-side digests); optional idempotency keys;
 *   - getById / getByDigest — latest version by id; the EXACT historical
 *     version by chain-head digest (every version retained:
 *     content-addressed, append-only storage);
 *   - findByRunRef / findByBodyRef / findByTimeRange — pure projections;
 *   - replay / replayAt — the ordered entry stream (latest, or pinned by
 *     digest);
 *   - NO update/delete APIs — append-only is a persistence guarantee,
 *     not a convention (negative tests assert both the frozen record
 *     objects and the absence of any mutation surface).
 *
 * Durable persistence is a deployment-tier concern and is deliberately
 * NOT modeled here.
 */

export * from './store.js';

import { TrajectoryStore } from './store.js';

/** Factory: a fresh, empty in-process reference store. */
export function createTrajectoryStore(): TrajectoryStore {
  return new TrajectoryStore();
}
