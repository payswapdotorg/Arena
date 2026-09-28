/**
 * Checkpoint/restore semantics (Work Order A010 gate 8; spec ENV1.0
 * reset/checkpoint semantics; requirement R9 — snapshot/restore).
 *
 * A `RunCheckpoint` is the content-addressed record of one checkpoint
 * taken while a run is executing:
 *   - `sequence`    — 1-based, contiguous per run;
 *   - `snapshotDigest` — sha256 over the canonical simulated world state
 *                     at the checkpoint (the snapshot content address);
 *   - `stepIndex`   — the world position (workload step) the snapshot
 *                     captures, so a restore is semantically a rewind;
 *   - `recordedAt`  — canonical ms-UTC timestamp;
 *   - `digest`      — sha256 over the digest-free view (tamper evidence).
 *
 * `restoreToCheckpoint` validates the ref chain BEFORE any reset:
 *   - the ref must be structurally valid;
 *   - it must belong to THIS run (a foreign run's checkpoint is
 *     rejected — gate 8 negative test);
 *   - its sequence must be a checkpoint actually recorded by this run;
 *   - its snapshot digest must match the recorded checkpoint (mismatch
 *     is tampering);
 *   - the run must be in a state that may reset (`running`).
 * Only then does the pure fold rewind the world position.
 */

import { digestCanonical } from '@arena/protocol-core';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import type { RunStateSnapshot } from './run-state.js';
import {
  isContentDigest,
  isRunId,
  isRunTimestamp,
  toContentDigest,
  toRunId,
  toRunTimestamp,
  toTenantId,
} from './shared.js';
import type { ContentDigest, RunId, RunTimestamp, TenantId } from './shared.js';

/** Wire version of the checkpoint record shape. */
export const RUN_CHECKPOINT_VERSION = 1 as const;

/**
 * The per-run record of one checkpoint as carried in run state and the
 * restore validation chain (the content-addressed form adds the digest;
 * see RunCheckpoint).
 */
export interface RecordedCheckpoint {
  readonly sequence: number;
  readonly snapshotDigest: ContentDigest;
  readonly stepIndex: number;
  readonly recordedAt: RunTimestamp;
}

export function isRecordedCheckpoint(value: unknown): value is RecordedCheckpoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['sequence'] === 'number' &&
    Number.isInteger(candidate['sequence']) &&
    candidate['sequence'] >= 1 &&
    isContentDigest(candidate['snapshotDigest']) &&
    typeof candidate['stepIndex'] === 'number' &&
    Number.isInteger(candidate['stepIndex']) &&
    candidate['stepIndex'] >= 0 &&
    isRunTimestamp(candidate['recordedAt'])
  );
}

/** The digest-free view — exactly what the checkpoint digest commits to. */
export interface RunCheckpointView {
  readonly checkpointVersion: typeof RUN_CHECKPOINT_VERSION;
  readonly runId: RunId;
  readonly tenantId: TenantId;
  readonly sequence: number;
  readonly snapshotDigest: ContentDigest;
  readonly stepIndex: number;
  readonly recordedAt: RunTimestamp;
}

/** A frozen run checkpoint: the view plus its sha256 content digest. */
export interface RunCheckpoint extends RunCheckpointView {
  readonly digest: ContentDigest;
}

/** A reference to a checkpoint of a specific run (the restore address). */
export interface RunCheckpointRef {
  readonly runId: RunId;
  readonly sequence: number;
  readonly snapshotDigest: ContentDigest;
}

export function isRunCheckpointRef(value: unknown): value is RunCheckpointRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isRunId(candidate['runId']) &&
    typeof candidate['sequence'] === 'number' &&
    Number.isInteger(candidate['sequence']) &&
    candidate['sequence'] >= 1 &&
    isContentDigest(candidate['snapshotDigest'])
  );
}

/** Validate and freeze a checkpoint reference. */
export function toRunCheckpointRef(value: {
  runId: string;
  sequence: number;
  snapshotDigest: string;
}): RunCheckpointRef {
  if (!isRunCheckpointRef(value)) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_CHECKPOINT,
      {
        message: `invalid run checkpoint ref: ${JSON.stringify(value)} (tenant-scoped runId, sequence >= 1, lowercase sha256 snapshotDigest)`,
      },
    );
  }
  const runId = value.runId;
  const sequence = value.sequence;
  const snapshotDigest = toContentDigest(value.snapshotDigest);
  return Object.freeze({ runId, sequence, snapshotDigest });
}

export function isRunCheckpoint(value: unknown): value is RunCheckpoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['checkpointVersion'] === RUN_CHECKPOINT_VERSION &&
    isRunId(candidate['runId']) &&
    typeof candidate['sequence'] === 'number' &&
    Number.isInteger(candidate['sequence']) &&
    candidate['sequence'] >= 1 &&
    isContentDigest(candidate['snapshotDigest']) &&
    typeof candidate['stepIndex'] === 'number' &&
    Number.isInteger(candidate['stepIndex']) &&
    candidate['stepIndex'] >= 0 &&
    isRunTimestamp(candidate['recordedAt']) &&
    isContentDigest(candidate['digest'])
  );
}

/**
 * Create a validated, deep-frozen, content-addressed run checkpoint.
 * The sequence must be exactly the run's next checkpoint sequence
 * (contiguous, append-only); the step index is the world position being
 * snapshotted.
 */
export async function createRunCheckpoint(input: {
  runId: string;
  tenantId: string;
  sequence: number;
  snapshotDigest: string;
  stepIndex: number;
  recordedAt: string;
}): Promise<RunCheckpoint> {
  const runId = toRunId(input.runId);
  const tenantId = toTenantId(input.tenantId);
  if (
    typeof input.sequence !== 'number' ||
    !Number.isInteger(input.sequence) ||
    input.sequence < 1
  ) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_CHECKPOINT,
      {
        message: `run checkpoint: sequence must be a positive integer (contiguous per run), got: ${String(input.sequence)}`,
      },
    );
  }
  const snapshotDigest = toContentDigest(input.snapshotDigest);
  if (
    typeof input.stepIndex !== 'number' ||
    !Number.isInteger(input.stepIndex) ||
    input.stepIndex < 0
  ) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_CHECKPOINT,
      {
        message: `run checkpoint: stepIndex must be a non-negative integer, got: ${String(input.stepIndex)}`,
      },
    );
  }
  const recordedAt = toRunTimestamp(input.recordedAt);
  const view: RunCheckpointView = {
    checkpointVersion: RUN_CHECKPOINT_VERSION,
    runId,
    tenantId,
    sequence: input.sequence,
    snapshotDigest,
    stepIndex: input.stepIndex,
    recordedAt,
  };
  const digest = toContentDigest(await digestCanonical(view));
  return Object.freeze({ ...view, digest }) as RunCheckpoint;
}

/** The digest-free view of a checkpoint. */
export function runCheckpointView(checkpoint: RunCheckpoint): RunCheckpointView {
  const { digest: _digest, ...view } = checkpoint;
  return Object.freeze({ ...view }) as RunCheckpointView;
}

/** The checkpoint ref of a recorded checkpoint (the restore address). */
export function runCheckpointRef(checkpoint: RunCheckpoint): RunCheckpointRef {
  return Object.freeze({
    runId: checkpoint.runId,
    sequence: checkpoint.sequence,
    snapshotDigest: checkpoint.snapshotDigest,
  });
}

/** Verify a checkpoint's content digest (tamper tripwire). */
export async function verifyRunCheckpoint(checkpoint: RunCheckpoint): Promise<ContentDigest> {
  if (!isRunCheckpoint(checkpoint)) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_CHECKPOINT,
      { message: 'checkpoint verification requires a structurally valid run checkpoint' },
    );
  }
  const actual = await digestCanonical(runCheckpointView(checkpoint));
  if (actual !== checkpoint.digest) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.TAMPERED, {
      message: `run checkpoint digest mismatch for ${checkpoint.runId}#${String(checkpoint.sequence)}: expected ${checkpoint.digest}, got ${actual}`,
      details: { runId: checkpoint.runId, sequence: checkpoint.sequence, actual },
    });
  }
  return toContentDigest(actual);
}

/**
 * Validate a restore against the run's recorded checkpoint chain and
 * return the world position to rewind to (gate 8).
 *
 * Rejections (typed CHECKPOINT_REJECTED, each covered by a negative
 * test):
 *   - a ref that is not structurally valid (INVALID_CHECKPOINT);
 *   - a ref belonging to a FOREIGN run (tenant/id mismatch);
 *   - a ref whose sequence was never recorded by this run;
 *   - a ref whose snapshot digest does not match the recorded
 *     checkpoint (tampering);
 *   - a run not in a resettable state (`running`).
 */
/** The input shape of a restore ref (validated strictly inside). */
export type RunCheckpointRefInput = RunCheckpointRef | {
  readonly runId: string;
  readonly sequence: number;
  readonly snapshotDigest: string;
};

export function restoreToCheckpoint(
  state: RunStateSnapshot,
  ref: RunCheckpointRefInput,
): number {
  if (!isRunCheckpointRef(ref)) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_CHECKPOINT,
      {
        message: `restore rejected: not a structurally valid checkpoint ref: ${JSON.stringify(ref)}`,
      },
    );
  }
  if (ref.runId !== state.runId) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.CHECKPOINT_REJECTED,
      {
        message: `restore rejected: checkpoint belongs to run ${JSON.stringify(ref.runId)}, not ${JSON.stringify(state.runId)} (checkpoint chains are per-run — a foreign run's checkpoint can never restore this run's world)`,
        details: { refRunId: ref.runId, runId: state.runId },
      },
    );
  }
  const recorded = state.checkpoints.find(
    (checkpoint) => checkpoint.sequence === ref.sequence,
  );
  if (recorded === undefined) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.CHECKPOINT_REJECTED,
      {
        message: `restore rejected: this run never recorded a checkpoint #${String(ref.sequence)} (recorded: ${state.checkpoints.map((checkpoint) => String(checkpoint.sequence)).join(', ') || 'none'})`,
        details: { sequence: ref.sequence, recorded: state.checkpoints.length },
      },
    );
  }
  if (recorded.snapshotDigest !== ref.snapshotDigest) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.CHECKPOINT_REJECTED,
      {
        message: `restore rejected: checkpoint #${String(ref.sequence)} snapshot digest mismatch (recorded ${recorded.snapshotDigest}, ref ${ref.snapshotDigest}) — the ref chain must match the recorded chain exactly`,
        details: { sequence: ref.sequence, recorded: recorded.snapshotDigest, ref: ref.snapshotDigest },
      },
    );
  }
  if (state.status !== 'running') {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.CHECKPOINT_REJECTED,
      {
        message: `restore rejected: run is in state '${state.status}' — only a running run may reset its world to a checkpoint`,
        details: { status: state.status },
      },
    );
  }
  return recorded.stepIndex;
}
