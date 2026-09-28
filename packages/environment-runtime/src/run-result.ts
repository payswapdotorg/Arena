/**
 * RunResult — the evidence-addressable outcome of a COMPLETED run
 * (Work Order A010 gate 9; spec ENV1.0 "Evidence"; requirement R9).
 *
 * A RunResult binds A009's RunAddress — the full evidence address of a
 * run: task version, environment version, run id, initial snapshot
 * digest, trajectory digest, evidence digests. The RunAddress TYPE is
 * imported type-only from @arena/environment-protocol (never
 * redefined); its structural guard + strict constructor are local
 * mirrors of A009's own validation (closed shapes; ALL six address
 * parts REQUIRED — any missing digest fails construction with a typed
 * error, gate 9 test).
 *
 * The result itself is content-addressed: sha256 over the canonical
 * digest-free view via @arena/protocol-core's digestCanonical. Only
 * completed runs may produce a RunResult (failed and timed-out runs
 * are evidenced by their event streams).
 */

import { digestCanonical } from '@arena/protocol-core';
import type { RunAddress, TaskVersionRef } from '@arena/environment-protocol';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import { isEnvironmentVersionRef } from './isolation-envelope.js';
import { deepFreeze, expectFields, isContentDigest } from './shared.js';
import type { ContentDigest, RunId, RunTimestamp, TenantId } from './shared.js';
import { isRunId, isTenantId, toContentDigest, toRunTimestamp } from './shared.js';

/** Wire version of the run result shape. */
export const RUN_RESULT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// RunAddress guard (A009 type, local structural mirror — type-only
// imports cannot carry runtime validators)
// ---------------------------------------------------------------------------

const TASK_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;
const NEUTRAL_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export function isTaskVersionRef(value: unknown): value is TaskVersionRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['taskId'] === 'string' &&
    NEUTRAL_ID_PATTERN.test(candidate['taskId']) &&
    typeof candidate['version'] === 'string' &&
    TASK_VERSION_PATTERN.test(candidate['version'])
  );
}

export function isRunAddress(value: unknown): value is RunAddress {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!isTaskVersionRef(candidate['taskVersion'])) return false;
  if (!isEnvironmentVersionRef(candidate['environmentVersion'])) return false;
  return (
    typeof candidate['runId'] === 'string' &&
    NEUTRAL_ID_PATTERN.test(candidate['runId']) &&
    isContentDigest(candidate['initialSnapshotDigest']) &&
    isContentDigest(candidate['trajectoryDigest']) &&
    Array.isArray(candidate['evidenceDigests']) &&
    (candidate['evidenceDigests'] as unknown[]).length > 0 &&
    (candidate['evidenceDigests'] as unknown[]).every((entry) => isContentDigest(entry))
  );
}

/**
 * Validate and freeze a run address — ALL six parts required or
 * construction fails (gate 9: missing digest ⇒ construction fails).
 */
export function toRunAddress(value: {
  taskVersion: { taskId: string; version: string };
  environmentVersion: { namespace: string; name: string; version: string; digest: string };
  runId: string;
  initialSnapshotDigest: string;
  trajectoryDigest: string;
  evidenceDigests: readonly string[];
}): RunAddress {
  const record = expectFields(
    value,
    [
      'taskVersion',
      'environmentVersion',
      'runId',
      'initialSnapshotDigest',
      'trajectoryDigest',
      'evidenceDigests',
    ],
    [],
    ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_RESULT,
    'run address',
  );
  if (!isTaskVersionRef(record['taskVersion'])) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.RUN_RESULT_INCOMPLETE,
      {
        message: 'run address: taskVersion (taskId + version) is required — a run is always evidenced against the task version that drove it',
      },
    );
  }
  if (!isEnvironmentVersionRef(record['environmentVersion'])) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.RUN_RESULT_INCOMPLETE,
      {
        message: 'run address: environmentVersion (namespace/name/version + content digest) is required — the executable world must be pinned by digest',
      },
    );
  }
  const runId = record['runId'];
  if (typeof runId !== 'string' || !NEUTRAL_ID_PATTERN.test(runId)) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.RUN_RESULT_INCOMPLETE,
      {
        message: `run address: a neutral run id is required, got: ${JSON.stringify(runId)}`,
      },
    );
  }
  if (typeof record['initialSnapshotDigest'] !== 'string' || !isContentDigest(record['initialSnapshotDigest'])) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.RUN_RESULT_INCOMPLETE,
      {
        message: 'run address: the initial snapshot digest is REQUIRED — a completed run is always evidenced against the world it started from',
      },
    );
  }
  if (typeof record['trajectoryDigest'] !== 'string' || !isContentDigest(record['trajectoryDigest'])) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.RUN_RESULT_INCOMPLETE,
      {
        message: 'run address: the trajectory digest is REQUIRED — a completed run is always evidenced against its recorded trajectory',
      },
    );
  }
  const rawEvidence = record['evidenceDigests'];
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.RUN_RESULT_INCOMPLETE,
      {
        message: 'run address: at least one evidence digest is required (evidence outputs are part of the address)',
      },
    );
  }
  const evidenceDigests = rawEvidence.map((entry) =>
    toContentDigest(typeof entry === 'string' ? entry : ''),
  );
  // Cross-brand note: A009's RunAddress fields carry @arena/environment-
  // protocol's branded views (NeutralId, ContentDigest). The values here
  // have been validated against the SAME charsets (pattern sources are
  // character-for-character copies), so the casts below are exact — the
  // brands differ only by owning package, never by shape.
  return deepFreeze({
    taskVersion: Object.freeze({ ...record['taskVersion'] }),
    environmentVersion: Object.freeze({ ...record['environmentVersion'] }),
    runId: runId as RunAddress['runId'],
    initialSnapshotDigest:
      record['initialSnapshotDigest'] as unknown as RunAddress['initialSnapshotDigest'],
    trajectoryDigest:
      record['trajectoryDigest'] as unknown as RunAddress['trajectoryDigest'],
    evidenceDigests: Object.freeze(
      evidenceDigests,
    ) as unknown as RunAddress['evidenceDigests'],
  });
}

/** Stable string key for a run address (registry friendly; mirrors A009). */
export function runAddressKey(address: RunAddress): string {
  return [
    `task:${address.taskVersion.taskId}@${address.taskVersion.version}`,
    `env:${address.environmentVersion.namespace}/${address.environmentVersion.name}@${address.environmentVersion.version}#${address.environmentVersion.digest}`,
    `run:${address.runId}`,
    `snapshot:${address.initialSnapshotDigest}`,
    `trajectory:${address.trajectoryDigest}`,
  ].join('|');
}

// ---------------------------------------------------------------------------
// RunResult
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the result digest commits to. */
export interface RunResultView {
  readonly resultVersion: typeof RUN_RESULT_VERSION;
  readonly runId: RunId;
  readonly tenantId: TenantId;
  /** The digest of the RunRecord this result completes. */
  readonly recordDigest: ContentDigest;
  /** Only completed runs produce results (terminal finality). */
  readonly finalState: 'completed';
  readonly finishedAt: RunTimestamp;
  /** The full evidence address (A009 RunAddress). */
  readonly runAddress: RunAddress;
}

/** A frozen run result: the view plus its sha256 content digest. */
export interface RunResult extends RunResultView {
  readonly digest: ContentDigest;
}

export function isRunResultView(value: unknown): value is RunResultView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['resultVersion'] === RUN_RESULT_VERSION &&
    isRunId(candidate['runId']) &&
    isTenantId(candidate['tenantId']) &&
    isContentDigest(candidate['recordDigest']) &&
    candidate['finalState'] === 'completed' &&
    isRunTimestampValue(candidate['finishedAt']) &&
    isRunAddress(candidate['runAddress'])
  );
}

function isRunTimestampValue(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    new Date(value).toISOString() === value
  );
}

export function isRunResult(value: unknown): value is RunResult {
  if (!isRunResultView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed run result for a
 * COMPLETED run. Throws typed errors when:
 *   - any part of the run address is missing or malformed (missing
 *     digest ⇒ construction fails — gate 9);
 *   - the tenant contradicts the run id (tenant isolation);
 *   - the environment ref inside the address is malformed.
 */
export async function createRunResult(input: {
  runId: string;
  tenantId: string;
  recordDigest: string;
  finalState: 'completed';
  finishedAt: string;
  runAddress: {
    taskVersion: { taskId: string; version: string };
    environmentVersion: { namespace: string; name: string; version: string; digest: string };
    runId: string;
    initialSnapshotDigest: string;
    trajectoryDigest: string;
    evidenceDigests: readonly string[];
  };
}): Promise<RunResult> {
  const record = expectFields(
    input,
    ['runId', 'tenantId', 'recordDigest', 'finalState', 'finishedAt', 'runAddress'],
    [],
    ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_RESULT,
    'run result',
  );
  if (record['finalState'] !== 'completed') {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_RESULT,
      {
        message: `run results exist only for completed runs, got finalState ${JSON.stringify(record['finalState'])} (failed and timed-out runs are evidenced by their event streams)`,
      },
    );
  }
  const runId = record['runId'];
  if (typeof runId !== 'string' || !isRunId(runId)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_ID, {
      message: `run result: invalid tenant-scoped run id: ${JSON.stringify(runId)}`,
    });
  }
  const tenantId = record['tenantId'];
  if (typeof tenantId !== 'string' || !isTenantId(tenantId)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_TENANT, {
      message: `run result: invalid tenant id: ${JSON.stringify(tenantId)}`,
    });
  }
  const recordDigest = toContentDigest(
    typeof record['recordDigest'] === 'string' ? record['recordDigest'] : '',
  );
  const finishedAt = toRunTimestamp(
    typeof record['finishedAt'] === 'string' ? record['finishedAt'] : '',
  );
  const rawAddress = record['runAddress'];
  if (typeof rawAddress !== 'object' || rawAddress === null) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.RUN_RESULT_INCOMPLETE,
      { message: 'run result: the run address is REQUIRED (evidence addressability — gate 9)' },
    );
  }
  const runAddress = toRunAddress(
    rawAddress as {
      taskVersion: { taskId: string; version: string };
      environmentVersion: { namespace: string; name: string; version: string; digest: string };
      runId: string;
      initialSnapshotDigest: string;
      trajectoryDigest: string;
      evidenceDigests: readonly string[];
    },
  );
  // Address↔record consistency: the evidence address must address THIS
  // run — A009's RunAddress.runId is the tenant-LOCAL run key, which
  // must equal the tenant-scoped run id's key half.
  const scopedKey = runId.slice(runId.indexOf('/') + 1);
  if (runAddress.runId !== scopedKey) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_RESULT,
      {
        message: `run result: the run address names run key ${JSON.stringify(runAddress.runId)}, but the result completes run ${JSON.stringify(runId)} (key ${JSON.stringify(scopedKey)})`,
        details: { addressRunKey: runAddress.runId, runId, expectedKey: scopedKey },
      },
    );
  }
  const view: RunResultView = {
    resultVersion: RUN_RESULT_VERSION,
    runId,
    tenantId,
    recordDigest,
    finalState: 'completed',
    finishedAt,
    runAddress,
  };
  const digest = toContentDigest(await digestCanonical(view));
  return deepFreeze({ ...view, digest }) as RunResult;
}

/** The digest-free view of a result. */
export function runResultView(result: RunResult): RunResultView {
  const { digest: _digest, ...view } = result;
  return deepFreeze({ ...view }) as RunResultView;
}

/** Verify a run result's content digest (tamper tripwire). */
export async function verifyRunResult(result: RunResult): Promise<ContentDigest> {
  if (!isRunResult(result)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_RESULT, {
      message: 'run result verification requires a structurally valid run result',
    });
  }
  const actual = await digestCanonical(runResultView(result));
  if (actual !== result.digest) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.TAMPERED, {
      message: `run result digest mismatch for ${result.runId}: expected ${result.digest}, got ${actual}`,
      details: { runId: result.runId, expected: result.digest, actual },
    });
  }
  return toContentDigest(actual);
}
