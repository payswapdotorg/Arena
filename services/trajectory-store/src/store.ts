/**
 * TrajectoryStore — the in-process REFERENCE STORE for trajectories
 * (Work Order A011 gate 6; requirements R10, R11, R24).
 *
 * Pure TypeScript, ZERO external runtime dependencies (only
 * @arena/protocol-core + @arena/trajectory workspace packages). Storage
 * is neutral by construction: everything lives in Maps inside this
 * object — durable persistence is a deployment-tier concern and is NOT
 * modeled here (the protocol in @arena/trajectory knows nothing about
 * backends; this reference store demonstrates the protocol boundary).
 *
 * Append-only persistence guarantee (architecture-lock rule 6):
 *   - the ONLY mutating operations are `open` (idempotent by trajectory
 *     id — re-opening with the SAME header returns the same record,
 *     re-opening with a DIFFERENT header is an identity conflict) and
 *     `append` (validation + chained-digest computation through the
 *     domain protocol's appendTrajectoryEntry — gaps, regressions,
 *     timestamp regressions, malformed payloads and appends after
 *     completion are all rejected with typed errors);
 *   - there are NO update/delete APIs, and every previously returned
 *     record version stays valid forever: each append produces a NEW
 *     frozen record, and EVERY historical version remains addressable
 *     by its chain-head digest (getByDigest) — content-addressed,
 *     append-only storage;
 *   - appends may carry an idempotency key (architecture-lock rule 17):
 *     replaying the same key with the same input is a no-op returning
 *     the current record; the same key with a different input is an
 *     idempotency conflict.
 *
 * Queries are pure projections: by trajectory id (latest version), by
 * chain-head digest (exact historical version), by run ref, by agent/body
 * ref, by started-at time range, plus the replay API (the ordered entry
 * stream — latest version, or the version pinned by a digest).
 */

import { canonicalJson } from '@arena/protocol-core';
import {
  TRAJECTORY_ERROR_CODES,
  TrajectoryError,
  appendTrajectoryEntry,
  createTrajectoryHeader,
  createTrajectoryRecord,
  isTrajectoryRecord,
  replayTrajectory,
  toTrajectoryRunRef,
  trajectoryRunRefKey,
  toTrajectoryTimestamp,
} from '@arena/trajectory';
import type {
  ContentDigest,
  CreateTrajectoryEntryInput,
  CreateTrajectoryHeaderInput,
  TrajectoryEntry,
  TrajectoryId,
  TrajectoryRecord,
  TrajectoryRunRefInput,
} from '@arena/trajectory';

/** The authoritative result of a successful (or idempotently replayed) append. */
export interface TrajectoryAppendReceipt {
  readonly trajectoryId: TrajectoryId;
  readonly sequence: number;
  readonly stepDigest: ContentDigest;
  readonly chainHead: ContentDigest;
  readonly record: TrajectoryRecord;
}

/** Options shared by the mutating operations. */
export interface TrajectoryStoreOptions {
  /** Idempotency key (architecture-lock rule 17). */
  readonly idempotencyKey?: string;
}

/** Inclusive started-at bounds; both ends optional. */
export interface TrajectoryTimeRange {
  readonly from?: string;
  readonly to?: string;
}

interface AppendKeyBinding {
  readonly trajectoryId: string;
  readonly sequence: number;
  readonly stepDigest: ContentDigest;
  readonly inputCanonical: string;
}

function latestSortKey(record: TrajectoryRecord): string {
  return `${record.header.startedAt}|${record.header.trajectoryId}`;
}

/**
 * The in-process reference store. Construct with `new TrajectoryStore()`;
 * every operation is async so a durable implementation can substitute
 * 1:1 behind the same surface.
 */
export class TrajectoryStore {
  /** Latest version per trajectory id. */
  private readonly byId = new Map<string, TrajectoryRecord>();
  /** EVERY historical version, addressable by its chain-head digest. */
  private readonly versionsByDigest = new Map<string, TrajectoryRecord>();
  /** Run-ref key → trajectory ids (header-derived, immutable per trajectory). */
  private readonly runRefIndex = new Map<string, Set<string>>();
  /** Agent/body digest → trajectory ids. */
  private readonly bodyIndex = new Map<string, Set<string>>();
  /** Append idempotency keys → the append they authorized. */
  private readonly appendKeys = new Map<string, AppendKeyBinding>();

  // -------------------------------------------------------------------------
  // Mutations (the ONLY two: open + append — no update, no delete)
  // -------------------------------------------------------------------------

  /**
   * Open a trajectory. Idempotent by trajectory id: re-opening with the
   * SAME header returns the existing record untouched; re-opening with a
   * DIFFERENT header under the same trajectory id is an identity
   * conflict (fail closed).
   */
  async open(
    input: CreateTrajectoryHeaderInput,
    _options: TrajectoryStoreOptions = {},
  ): Promise<TrajectoryRecord> {
    const header = await createTrajectoryHeader(input);
    const existing = this.byId.get(header.trajectoryId);
    if (existing !== undefined) {
      if (existing.header.digest === header.digest) {
        return existing; // idempotent open — same content, no new state
      }
      throw new TrajectoryError(TRAJECTORY_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `trajectory id ${JSON.stringify(header.trajectoryId)} is already open with a different header digest (trajectories are append-only; re-declaring a different run binding is an identity conflict)`,
        details: {
          trajectoryId: header.trajectoryId,
          existingDigest: existing.header.digest,
          attemptedDigest: header.digest,
        },
      });
    }
    const record = createTrajectoryRecord(header);
    this.index(record);
    return record;
  }

  /**
   * Append one entry: full domain validation (contiguous sequences,
   * monotonic timestamps, typed payloads, completion finality) plus the
   * chained-digest computation — the store NEVER trusts caller-side
   * digests. Optionally idempotent by key: the same key + the same
   * input replays as a no-op; the same key + a different input is an
   * idempotency conflict.
   */
  async append(
    trajectoryId: string,
    input: CreateTrajectoryEntryInput,
    options: TrajectoryStoreOptions = {},
  ): Promise<TrajectoryAppendReceipt> {
    const current = this.requireLatest(trajectoryId);
    if (options.idempotencyKey !== undefined) {
      const binding = this.appendKeys.get(options.idempotencyKey);
      if (binding !== undefined) {
        const canonical = canonicalJson({
          trajectoryId,
          sequence: input.sequence,
          kind: input.kind,
          payload: input.payload,
          occurredAt: input.occurredAt,
        });
        if (
          binding.trajectoryId === trajectoryId &&
          binding.inputCanonical === canonical
        ) {
          // Idempotent replay: the entry is already in the log. Return the
          // CURRENT record (which contains it) — no duplicate append.
          return {
            trajectoryId: current.header.trajectoryId,
            sequence: binding.sequence,
            stepDigest: binding.stepDigest,
            chainHead: current.chainHead,
            record: current,
          };
        }
        throw new TrajectoryError(TRAJECTORY_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${JSON.stringify(options.idempotencyKey)} is already bound to a different append (lock rule 17: conflicting re-submissions are rejected)`,
          details: {
            idempotencyKey: options.idempotencyKey,
            boundTrajectoryId: binding.trajectoryId,
            boundSequence: binding.sequence,
          },
        });
      }
    }

    const next = await appendTrajectoryEntry(current, input);
    const entry = next.entries[next.entries.length - 1];
    if (entry === undefined) {
      throw new TrajectoryError(TRAJECTORY_ERROR_CODES.UNKNOWN_ERROR, {
        message: 'append produced no entry (protocol invariant broken)',
      });
    }
    this.index(next);
    if (options.idempotencyKey !== undefined) {
      this.appendKeys.set(options.idempotencyKey, {
        trajectoryId,
        sequence: entry.sequence,
        stepDigest: entry.stepDigest,
        inputCanonical: canonicalJson({
          trajectoryId,
          sequence: input.sequence,
          kind: input.kind,
          payload: input.payload,
          occurredAt: input.occurredAt,
        }),
      });
    }
    return {
      trajectoryId: next.header.trajectoryId,
      sequence: entry.sequence,
      stepDigest: entry.stepDigest,
      chainHead: next.chainHead,
      record: next,
    };
  }

  // -------------------------------------------------------------------------
  // Addressing (pure projections)
  // -------------------------------------------------------------------------

  /** The latest version of a trajectory by id (undefined when unknown). */
  async getById(trajectoryId: string): Promise<TrajectoryRecord | undefined> {
    return this.byId.get(trajectoryId);
  }

  /**
   * The EXACT historical record version whose chain head equals the
   * digest — the empty version is addressable by its header digest, and
   * every append version by the chain head it produced. This is the
   * content-addressed read: append-only storage keeps every version.
   */
  async getByDigest(digest: string): Promise<TrajectoryRecord | undefined> {
    return this.versionsByDigest.get(digest);
  }

  /** All trajectories bound to the given run ref (latest versions). */
  async findByRunRef(runRef: TrajectoryRunRefInput): Promise<readonly TrajectoryRecord[]> {
    const key = trajectoryRunRefKey(toTrajectoryRunRef(runRef));
    return this.resolveIndex(this.runRefIndex.get(key));
  }

  /** All trajectories whose acting agent/body has the given digest. */
  async findByBodyRef(agentBodyDigest: string): Promise<readonly TrajectoryRecord[]> {
    return this.resolveIndex(this.bodyIndex.get(agentBodyDigest));
  }

  /** Trajectories started within the inclusive [from, to] window. */
  async findByTimeRange(range: TrajectoryTimeRange): Promise<readonly TrajectoryRecord[]> {
    const from = range.from !== undefined ? toTrajectoryTimestamp(range.from, 'time range from') : null;
    const to = range.to !== undefined ? toTrajectoryTimestamp(range.to, 'time range to') : null;
    if (from !== null && to !== null && from > to) {
      throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_TIMESTAMP, {
        message: `time range is inverted: from ${from} is after to ${to}`,
        details: { from, to },
      });
    }
    const records = [...this.byId.values()].filter((record) => {
      const startedAt = record.header.startedAt;
      if (from !== null && startedAt < from) return false;
      if (to !== null && startedAt > to) return false;
      return true;
    });
    return this.freezeSorted(records);
  }

  /** Every latest version, ordered by (started-at, trajectory id). */
  async list(): Promise<readonly TrajectoryRecord[]> {
    return this.freezeSorted([...this.byId.values()]);
  }

  // -------------------------------------------------------------------------
  // Replay (gate 6 — the ordered entry stream)
  // -------------------------------------------------------------------------

  /** Replay the LATEST version of a trajectory: entries in appended order. */
  async replay(trajectoryId: string): Promise<readonly TrajectoryEntry[]> {
    return replayTrajectory(this.requireLatest(trajectoryId));
  }

  /**
   * Replay the historical version pinned by a chain-head digest —
   * content-addressed replay (the exact entry stream a verifier saw at
   * that point in history).
   */
  async replayAt(digest: string): Promise<readonly TrajectoryEntry[]> {
    const record = this.versionsByDigest.get(digest);
    if (record === undefined) {
      throw new TrajectoryError(TRAJECTORY_ERROR_CODES.NOT_FOUND, {
        message: `no trajectory version with chain head ${JSON.stringify(digest)}`,
        details: { digest },
      });
    }
    return replayTrajectory(record);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireLatest(trajectoryId: string): TrajectoryRecord {
    const record = this.byId.get(trajectoryId);
    if (record === undefined) {
      throw new TrajectoryError(TRAJECTORY_ERROR_CODES.NOT_FOUND, {
        message: `unknown trajectory id ${JSON.stringify(trajectoryId)}`,
        details: { trajectoryId },
      });
    }
    return record;
  }

  private index(record: TrajectoryRecord): void {
    if (!isTrajectoryRecord(record)) {
      throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_RECORD, {
        message: 'store indexing requires a structurally valid trajectory record',
      });
    }
    const trajectoryId = record.header.trajectoryId;
    const previous = this.byId.get(trajectoryId);
    if (previous !== undefined && previous.entries.length > record.entries.length) {
      throw new TrajectoryError(TRAJECTORY_ERROR_CODES.UNKNOWN_ERROR, {
        message: 'store invariant broken: refusing to index a version older than the latest',
      });
    }
    this.byId.set(trajectoryId, record);
    this.versionsByDigest.set(record.chainHead, record);
    if (previous === undefined) {
      const runKey = trajectoryRunRefKey(record.header.run);
      const runSet = this.runRefIndex.get(runKey) ?? new Set<string>();
      runSet.add(trajectoryId);
      this.runRefIndex.set(runKey, runSet);
      const bodySet = this.bodyIndex.get(record.header.agentBodyRef) ?? new Set<string>();
      bodySet.add(trajectoryId);
      this.bodyIndex.set(record.header.agentBodyRef, bodySet);
    }
  }

  private resolveIndex(ids: Set<string> | undefined): readonly TrajectoryRecord[] {
    if (ids === undefined) return Object.freeze([]);
    const records: TrajectoryRecord[] = [];
    for (const id of ids) {
      const record = this.byId.get(id);
      if (record !== undefined) records.push(record);
    }
    return this.freezeSorted(records);
  }

  private freezeSorted(records: readonly TrajectoryRecord[]): readonly TrajectoryRecord[] {
    return Object.freeze([...records].sort((a, b) => latestSortKey(a).localeCompare(latestSortKey(b))));
  }
}
