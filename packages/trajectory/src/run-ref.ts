/**
 * TrajectoryRunRef — the run binding of a trajectory (Work Order A011
 * gate 2; spec ENV1.0 "Evidence"; requirements R10, R11).
 *
 * ENV1.0 Evidence: "Every run should be addressable using task version,
 * environment version, run id, initial snapshot digest, trajectory digest
 * and evidence digests." A trajectory is the APPEND-ONLY RECORD of what
 * the agent DID inside a run, so it must bind to the run's INPUT address
 * — the four RunAddress-shaped digest refs that exist BEFORE the run
 * produces anything:
 *
 *   - taskVersion — the version of the task that drove the run
 *     (A009 TaskVersionRef; type-only import, never redefined);
 *   - environmentVersion — the content-addressed environment version
 *     (namespace, name, version, digest — the executable world is pinned
 *     by digest, not by name);
 *   - runId — the neutral run identifier (A010 run ids are tenant-scoped
 *     `<tenant>/<run-key>` strings; the tenant scope is bound by the
 *     A010 RunRecord whose digest may be pinned via the header's run
 *     record digest, so the trajectory accepts the full run-id charset);
 *   - initialSnapshotDigest — the digest of the state snapshot the run
 *     started from.
 *
 * The remaining two RunAddress parts — trajectoryDigest and
 * evidenceDigests — are OUTPUTS of the run and are bound downstream
 * (A010's RunResult carries the full A009 RunAddress); the trajectory's
 * own digest plays the trajectoryDigest role, which is why the run ref
 * here deliberately stops at the four input parts (binding the output
 * parts into the header would be circular).
 *
 * Optionally, the run ref pins the A010 RunRecord BY DIGEST
 * (`runRecordDigest`) — the durable declaration of the run (tenant
 * isolation envelope, job ref, seed, submitted-at) — reusing A010's
 * run/lifecycle types via digest refs without redefining them.
 */

import { TRAJECTORY_ERROR_CODES, TrajectoryError } from './errors.js';
import { deepFreeze, expectFields } from './shared.js';
import {
  isContentDigest,
  isNeutralId,
  toContentDigest,
  toNeutralId,
} from './shared.js';
import type { ContentDigest } from './shared.js';
import type { TaskVersionRef } from '@arena/environment-protocol';

// ---------------------------------------------------------------------------
// TaskVersionRef guard (A009 type, local structural mirror — type-only
// imports cannot carry runtime validators)
// ---------------------------------------------------------------------------

const TASK_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;
const ENVIRONMENT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
const NAME_PATTERN = /^[a-z][a-z0-9-]{1,127}$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export function isTaskVersionRef(value: unknown): value is TaskVersionRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const taskId = candidate['taskId'];
  const version = candidate['version'];
  return (
    typeof taskId === 'string' &&
    ENVIRONMENT_ID_PATTERN.test(taskId) &&
    typeof version === 'string' &&
    TASK_VERSION_PATTERN.test(version)
  );
}

// ---------------------------------------------------------------------------
// TrajectoryRunRef
// ---------------------------------------------------------------------------

/**
 * The run binding of a trajectory: the four input parts of the run's
 * evidence address (task version, environment version, run id, initial
 * snapshot digest), plus the optional A010 RunRecord digest pin.
 */
export interface TrajectoryRunRef {
  readonly taskVersion: TaskVersionRef;
  readonly environmentVersion: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly digest: ContentDigest;
  };
  readonly runId: string;
  readonly initialSnapshotDigest: ContentDigest;
  /** Optional digest pin of the A010 RunRecord declaring this run. */
  readonly runRecordDigest: ContentDigest | null;
}

export interface TrajectoryRunRefInput {
  readonly taskVersion: { taskId: string; version: string };
  readonly environmentVersion: {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  };
  /** A010 run id (`<tenant>/<run-key>`) or A009 neutral run id. */
  readonly runId: string;
  readonly initialSnapshotDigest: string;
  readonly runRecordDigest?: string | null;
}

const RUN_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}\/[a-z][a-z0-9-]{0,63}$/;

export function isTrajectoryRunRef(value: unknown): value is TrajectoryRunRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!isTaskVersionRef(candidate['taskVersion'])) return false;
  const environmentVersion = candidate['environmentVersion'];
  if (typeof environmentVersion !== 'object' || environmentVersion === null) return false;
  const env = environmentVersion as Record<string, unknown>;
  if (
    typeof env['namespace'] !== 'string' ||
    !NAMESPACE_PATTERN.test(env['namespace']) ||
    typeof env['name'] !== 'string' ||
    !NAME_PATTERN.test(env['name']) ||
    typeof env['version'] !== 'string' ||
    !SEMVER_PATTERN.test(env['version']) ||
    !isContentDigest(env['digest'])
  ) {
    return false;
  }
  const runId = candidate['runId'];
  const runIdOk =
    typeof runId === 'string' &&
    (RUN_ID_PATTERN.test(runId) || isNeutralId(runId));
  if (!runIdOk) return false;
  if (!isContentDigest(candidate['initialSnapshotDigest'])) return false;
  const runRecordDigest = candidate['runRecordDigest'];
  return runRecordDigest === null || isContentDigest(runRecordDigest);
}

/** Validate and freeze a trajectory run ref — all four address parts required. */
export function toTrajectoryRunRef(value: TrajectoryRunRefInput): TrajectoryRunRef {
  const record = expectFields(
    value,
    ['taskVersion', 'environmentVersion', 'runId', 'initialSnapshotDigest'],
    ['runRecordDigest'],
    TRAJECTORY_ERROR_CODES.INVALID_RUN_REF,
    'trajectory run ref',
  );

  const rawTask = record['taskVersion'];
  if (typeof rawTask !== 'object' || rawTask === null) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_RUN_REF, {
      message: 'trajectory run ref: taskVersion must be a task version ref',
    });
  }
  const taskRecord = expectFields(
    rawTask,
    ['taskId', 'version'],
    [],
    TRAJECTORY_ERROR_CODES.INVALID_RUN_REF,
    'trajectory run ref taskVersion',
  );
  const taskId = toNeutralId(
    typeof taskRecord['taskId'] === 'string' ? taskRecord['taskId'] : '',
    'taskVersion.taskId',
  );
  const taskVersionString = taskRecord['version'];
  if (
    typeof taskVersionString !== 'string' ||
    !TASK_VERSION_PATTERN.test(taskVersionString)
  ) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_RUN_REF, {
      message: `task version ref: invalid task version: ${String(taskVersionString)}`,
    });
  }
  // Cross-brand note: A009's TaskVersionRef.taskId carries
  // @arena/environment-protocol's branded NeutralId. The value here has
  // been validated against the SAME charset (the pattern sources are
  // character-for-character copies), so the cast below is exact — the
  // brands differ only by owning package, never by shape (mirrors
  // @arena/environment-runtime's run-result.ts).
  const taskVersion = Object.freeze({
    taskId,
    version: taskVersionString,
  }) as unknown as TaskVersionRef;

  const rawEnvironment = record['environmentVersion'];
  if (typeof rawEnvironment !== 'object' || rawEnvironment === null) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_RUN_REF, {
      message: 'trajectory run ref: environmentVersion must be an environment version ref',
    });
  }
  const envRecord = expectFields(
    rawEnvironment,
    ['namespace', 'name', 'version', 'digest'],
    [],
    TRAJECTORY_ERROR_CODES.INVALID_RUN_REF,
    'trajectory run ref environmentVersion',
  );
  const namespace = envRecord['namespace'];
  const name = envRecord['name'];
  const version = envRecord['version'];
  if (
    typeof namespace !== 'string' ||
    !NAMESPACE_PATTERN.test(namespace) ||
    typeof name !== 'string' ||
    !NAME_PATTERN.test(name)
  ) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_RUN_REF, {
      message:
        'trajectory run ref: environmentVersion namespace/name must be neutral lowercase identifiers',
      details: { namespace: String(namespace), name: String(name) },
    });
  }
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_RUN_REF, {
      message: `trajectory run ref: invalid environment semver: ${String(version)} (build metadata is not allowed)`,
    });
  }
  const environmentVersion = Object.freeze({
    namespace,
    name,
    version,
    digest: toContentDigest(
      typeof envRecord['digest'] === 'string' ? envRecord['digest'] : '',
      'environmentVersion.digest',
    ),
  });

  const runId = record['runId'];
  if (
    typeof runId !== 'string' ||
    (!RUN_ID_PATTERN.test(runId) && !isNeutralId(runId))
  ) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_RUN_REF, {
      message: `trajectory run ref: invalid run id: ${JSON.stringify(runId)} (A010 tenant-scoped '<tenant>/<run-key>' or A009 neutral id required)`,
    });
  }

  const initialSnapshotDigest = toContentDigest(
    typeof record['initialSnapshotDigest'] === 'string'
      ? record['initialSnapshotDigest']
      : '',
    'run ref initialSnapshotDigest',
  );

  const rawRunRecordDigest = record['runRecordDigest'];
  let runRecordDigest: ContentDigest | null = null;
  if (rawRunRecordDigest !== undefined && rawRunRecordDigest !== null) {
    if (typeof rawRunRecordDigest !== 'string') {
      throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_RUN_REF, {
        message: 'trajectory run ref: runRecordDigest must be a sha256 digest or null',
      });
    }
    runRecordDigest = toContentDigest(rawRunRecordDigest, 'run ref runRecordDigest');
  }

  return deepFreeze({
    taskVersion,
    environmentVersion,
    runId,
    initialSnapshotDigest,
    runRecordDigest,
  });
}

/** Stable string key for a trajectory run ref (map/registry friendly). */
export function trajectoryRunRefKey(ref: TrajectoryRunRef): string {
  return [
    `task:${ref.taskVersion.taskId}@${ref.taskVersion.version}`,
    `env:${ref.environmentVersion.namespace}/${ref.environmentVersion.name}@${ref.environmentVersion.version}#${ref.environmentVersion.digest}`,
    `run:${ref.runId}`,
    `snapshot:${ref.initialSnapshotDigest}`,
    `record:${ref.runRecordDigest ?? '-'}`,
  ].join('|');
}
