/**
 * TrajectoryRecord — header + entries, the frozen aggregate of a
 * trajectory (Work Order A011 gate 4; requirements R10, R11, R24;
 * architecture-lock rule 6 — trajectories are append-only and
 * content-addressed).
 *
 * A record is:
 *   - `header`  — the content-addressed declaration (who acted, in which
 *                 run, on which substrate, from which seed);
 *   - `entries` — the append-only, chain-linked entry stream (sequence
 *                 1..n, contiguous; every entry digest-addressed);
 *   - `chainHead` — the FINAL DIGEST OVER THE FULL CHAIN: the last
 *                 entry's stepDigest, or the header digest when the
 *                 trajectory is still empty. The chain head is the
 *                 trajectory digest referenced by ENV1.0's RunAddress.
 *
 * Appends return a NEW frozen record (the input record is never
 * modified); a trajectory that has appended a `completion` entry is
 * FROZEN — append-after-complete is rejected (gate 4 negative test).
 *
 * `replayTrajectory` is the pure replay view: the ordered entry stream
 * exactly as it was appended. `verifyTrajectoryRecord` recomputes the
 * whole chain (header digest + every stepDigest + ordering invariants)
 * and throws TRAJECTORY_TAMPERED on any mismatch — the record-level
 * tamper tripwire behind lock rule 6.
 */

import { TRAJECTORY_ERROR_CODES, TrajectoryError } from './errors.js';
import {
  createTrajectoryEntry,
  isTrajectoryEntry,
  verifyTrajectoryEntry,
} from './entry.js';
import type {
  CreateTrajectoryEntryInput,
  TrajectoryChainTail,
  TrajectoryEntry,
} from './entry.js';
import type { TrajectoryHeader } from './header.js';
import { createTrajectoryHeader, isTrajectoryHeader, verifyTrajectoryHeader } from './header.js';
import type { CreateTrajectoryHeaderInput } from './header.js';
import { deepFreeze, isContentDigest } from './shared.js';
import type { ContentDigest } from './shared.js';

// ---------------------------------------------------------------------------
// TrajectoryRecord
// ---------------------------------------------------------------------------

/** The frozen, append-only trajectory aggregate. */
export interface TrajectoryRecord {
  readonly header: TrajectoryHeader;
  readonly entries: readonly TrajectoryEntry[];
  /** Final digest over the full chain (header digest when empty). */
  readonly chainHead: ContentDigest;
}

/** The tail state an append validates against (pure projection). */
function chainTailOf(record: TrajectoryRecord): TrajectoryChainTail {
  const entries = record.entries;
  const last = entries.length > 0 ? entries[entries.length - 1] : undefined;
  return Object.freeze({
    anchorDigest: last !== undefined ? last.stepDigest : record.header.digest,
    lastSequence: last?.sequence ?? 0,
    lastOccurredAt: last?.occurredAt ?? null,
    completed: last !== undefined && last.kind === 'completion',
  });
}

/** True iff the trajectory has appended its terminal completion entry. */
export function isTrajectoryCompleted(record: TrajectoryRecord): boolean {
  return chainTailOf(record).completed;
}

/** Number of appended entries (pure projection). */
export function trajectoryEntryCount(record: TrajectoryRecord): number {
  return record.entries.length;
}

/** Structural (non-throwing) shape check WITHOUT chain-head consistency —
 * the input surface of verification, which exists precisely to catch
 * records whose DECLARED chain head (or any history) does not survive
 * recomputation. */
function isTrajectoryRecordShape(value: unknown): value is TrajectoryRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isTrajectoryHeader(candidate['header']) &&
    Array.isArray(candidate['entries']) &&
    candidate['entries'].every((entry) => isTrajectoryEntry(entry)) &&
    isContentDigest(candidate['chainHead'])
  );
}

/** Structural (non-throwing) check for a whole record (shape + chain-head
 * consistency with the appended history). */
export function isTrajectoryRecord(value: unknown): value is TrajectoryRecord {
  if (!isTrajectoryRecordShape(value)) return false;
  const record = value as TrajectoryRecord;
  const last = record.entries.length > 0 ? record.entries[record.entries.length - 1] : undefined;
  const expectedHead = last !== undefined ? last.stepDigest : record.header.digest;
  return expectedHead === record.chainHead;
}

/**
 * Create a trajectory record from a validated header — the EMPTY
 * trajectory, chain head anchored at the header digest.
 */
export function createTrajectoryRecord(header: TrajectoryHeader): TrajectoryRecord {
  return deepFreeze({
    header,
    entries: Object.freeze([]),
    chainHead: header.digest,
  });
}

/**
 * Open a trajectory in one step: validate the header input, then create
 * the empty record (convenience over createTrajectoryHeader +
 * createTrajectoryRecord for store boundaries).
 */
export async function openTrajectory(
  input: CreateTrajectoryHeaderInput,
): Promise<TrajectoryRecord> {
  const header = await createTrajectoryHeader(input);
  return createTrajectoryRecord(header);
}

/**
 * Validate + append: returns a NEW frozen record with the entry linked
 * onto the chain; the input record is never modified. Enforces every
 * ordering invariant of entry.ts (contiguous sequences, monotonic
 * timestamps, completion finality) and computes the chained stepDigest.
 */
export async function appendTrajectoryEntry(
  record: TrajectoryRecord,
  input: CreateTrajectoryEntryInput,
): Promise<TrajectoryRecord> {
  if (!isTrajectoryRecord(record)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_RECORD, {
      message: 'trajectory appends require a structurally valid trajectory record',
    });
  }
  const entry = await createTrajectoryEntry(chainTailOf(record), input);
  const entries = Object.freeze([...record.entries, entry]);
  return deepFreeze({
    header: record.header,
    entries,
    chainHead: entry.stepDigest,
  });
}

/**
 * The pure replay view (gate 4): the ordered entry stream exactly as it
 * was appended — sequence 1..n, nothing filtered, nothing reordered.
 */
export function replayTrajectory(record: TrajectoryRecord): readonly TrajectoryEntry[] {
  if (!isTrajectoryRecord(record)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_RECORD, {
      message: 'trajectory replay requires a structurally valid trajectory record',
    });
  }
  return record.entries;
}

/**
 * Verify a whole trajectory record: recompute the header digest, then
 * walk the chain recomputing every entry's stepDigest against its
 * predecessor, re-checking contiguity, monotonic timestamps and
 * completion finality. Any mismatch throws TRAJECTORY_TAMPERED (or the
 * corresponding invariant error); success returns the verified chain
 * head, optionally pinned against `expectedChainHead`.
 */
export async function verifyTrajectoryRecord(
  record: TrajectoryRecord,
  expectedChainHead?: string,
): Promise<ContentDigest> {
  if (!isTrajectoryRecordShape(record)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_RECORD, {
      message: 'trajectory verification requires a structurally valid trajectory record',
    });
  }
  await verifyTrajectoryHeader(record.header);

  let prevDigest = record.header.digest;
  let lastSequence = 0;
  let lastOccurredAt: string | null = null;
  for (const entry of record.entries) {
    const expected = lastSequence + 1;
    if (entry.sequence !== expected) {
      throw new TrajectoryError(
        entry.sequence < expected
          ? TRAJECTORY_ERROR_CODES.SEQUENCE_REGRESSION
          : TRAJECTORY_ERROR_CODES.SEQUENCE_GAP,
        {
          message: `verification found entry sequence ${String(entry.sequence)} where ${String(expected)} was expected (contiguity broken)`,
          details: { expected, actual: entry.sequence },
        },
      );
    }
    if (
      lastOccurredAt !== null &&
      Date.parse(entry.occurredAt) < Date.parse(lastOccurredAt)
    ) {
      throw new TrajectoryError(TRAJECTORY_ERROR_CODES.TIMESTAMP_REGRESSION, {
        message: `verification found occurred-at ${entry.occurredAt} preceding ${lastOccurredAt} (monotonicity broken)`,
        details: { sequence: entry.sequence, lastOccurredAt, actual: entry.occurredAt },
      });
    }
    await verifyTrajectoryEntry(entry, prevDigest);
    if (lastSequence > 0) {
      const previous = record.entries[lastSequence - 1];
      if (previous !== undefined && previous.kind === 'completion') {
        throw new TrajectoryError(TRAJECTORY_ERROR_CODES.ALREADY_COMPLETED, {
          message: `verification found entry ${String(entry.sequence)} following the completion entry at sequence ${String(lastSequence)} (trajectories freeze at completion)`,
          details: { completionSequence: lastSequence, offendingSequence: entry.sequence },
        });
      }
    }
    prevDigest = entry.stepDigest;
    lastSequence = entry.sequence;
    lastOccurredAt = entry.occurredAt;
  }

  if (prevDigest !== record.chainHead) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.TAMPERED, {
      message: `trajectory chain head mismatch: record declares ${record.chainHead}, full-chain recomputation yields ${prevDigest}`,
      details: {
        trajectoryId: record.header.trajectoryId,
        expected: record.chainHead,
        actual: prevDigest,
      },
    });
  }
  if (expectedChainHead !== undefined && prevDigest !== expectedChainHead) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.TAMPERED, {
      message: `trajectory chain head mismatch: expected ${expectedChainHead}, got ${prevDigest}`,
      details: { trajectoryId: record.header.trajectoryId, expected: expectedChainHead, actual: prevDigest },
    });
  }
  return prevDigest;
}

/**
 * The export view of a trajectory (requirement R24 — export results and
 * evidence): the header plus the ordered entries. The chain head is
 * verifiable from this view alone (verifyTrajectoryRecord over
 * { ...view, chainHead: computed }).
 */
export function trajectoryExportView(
  record: TrajectoryRecord,
): {
  readonly header: TrajectoryHeader;
  readonly entries: readonly TrajectoryEntry[];
} {
  if (!isTrajectoryRecord(record)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_RECORD, {
      message: 'trajectory export requires a structurally valid trajectory record',
    });
  }
  return Object.freeze({ header: record.header, entries: record.entries });
}
