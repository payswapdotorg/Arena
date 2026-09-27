/**
 * RunAddress — evidence addressability (spec ENV1.0 "Evidence";
 * requirements R9, R22; Work Order A009 gate 5).
 *
 * Every run must be addressable using: task version, environment version,
 * run id, initial snapshot digest, trajectory digest and evidence digests.
 * ALL of them are REQUIRED — construction fails closed when any is missing
 * or malformed. The environment version reference is content-addressed
 * (id + version + digest) so the executable world of the run is pinned,
 * not just named.
 */

import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import type { ContentDigest, NeutralId } from './shared.js';
import {
  deepFreeze,
  expectFields,
  isContentDigest,
  isNeutralId,
  toContentDigest,
  toNeutralId,
} from './shared.js';

/** Minimal versioned reference to a task (task-spec is the owning surface; only id+version are asserted here). */
export interface TaskVersionRef {
  readonly taskId: NeutralId;
  readonly version: string;
}

export function isTaskVersionRef(value: unknown): value is TaskVersionRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['taskId']) &&
    typeof candidate['version'] === 'string' &&
    /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(candidate['version'])
  );
}

/** Validate and freeze a task version reference. */
export function toTaskVersionRef(value: { taskId: string; version: string }): TaskVersionRef {
  const record = expectFields(
    value,
    ['taskId', 'version'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_RUN_ADDRESS,
    'task version ref',
  );
  const taskId = toNeutralId(typeof record['taskId'] === 'string' ? record['taskId'] : '');
  const version = record['version'];
  if (
    typeof version !== 'string' ||
    !/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(version)
  ) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_RUN_ADDRESS, {
      message: `task version ref: invalid task version: ${String(version)}`,
    });
  }
  return Object.freeze({ taskId, version });
}

/**
 * The full evidence address of a run. All parts are REQUIRED (gate 5):
 *   - taskVersion:    the version of the task that drove the run;
 *   - environmentVersion: the content-addressed environment version
 *                     (namespace, name, version, digest);
 *   - runId:          the neutral run identifier;
 *   - initialSnapshotDigest: digest of the initial state snapshot the run
 *                     started from;
 *   - trajectoryDigest: digest of the recorded trajectory;
 *   - evidenceDigests: digests of every produced evidence output (>= 1).
 */
export interface RunAddress {
  readonly taskVersion: TaskVersionRef;
  readonly environmentVersion: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly digest: ContentDigest;
  };
  readonly runId: NeutralId;
  readonly initialSnapshotDigest: ContentDigest;
  readonly trajectoryDigest: ContentDigest;
  readonly evidenceDigests: readonly ContentDigest[];
}

export function isRunAddress(value: unknown): value is RunAddress {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isTaskVersionRef(candidate['taskVersion'])) return false;
  const environmentVersion = candidate['environmentVersion'];
  if (typeof environmentVersion !== 'object' || environmentVersion === null) return false;
  const env = environmentVersion as Record<string, unknown>;
  if (
    typeof env['namespace'] !== 'string' ||
    typeof env['name'] !== 'string' ||
    typeof env['version'] !== 'string' ||
    !isContentDigest(env['digest'])
  ) {
    return false;
  }
  return (
    isNeutralId(candidate['runId']) &&
    isContentDigest(candidate['initialSnapshotDigest']) &&
    isContentDigest(candidate['trajectoryDigest']) &&
    Array.isArray(candidate['evidenceDigests']) &&
    candidate['evidenceDigests'].length > 0 &&
    candidate['evidenceDigests'].every((entry) => isContentDigest(entry))
  );
}

/** Validate and freeze a run address — all six address parts required, or construction fails. */
export function toRunAddress(value: {
  taskVersion: { taskId: string; version: string };
  environmentVersion: {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  };
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
    ENVIRONMENT_ERROR_CODES.INVALID_RUN_ADDRESS,
    'run address',
  );
  const rawTask = record['taskVersion'];
  if (typeof rawTask !== 'object' || rawTask === null) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_RUN_ADDRESS, {
      message: 'run address: taskVersion must be a task version ref',
    });
  }
  const taskVersion = toTaskVersionRef(rawTask as { taskId: string; version: string });

  const rawEnvironment = record['environmentVersion'];
  if (typeof rawEnvironment !== 'object' || rawEnvironment === null) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_RUN_ADDRESS, {
      message: 'run address: environmentVersion must be an environment version ref',
    });
  }
  const envRecord = expectFields(
    rawEnvironment,
    ['namespace', 'name', 'version', 'digest'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_RUN_ADDRESS,
    'run address environmentVersion',
  );
  const environmentVersion = Object.freeze({
    namespace:
      typeof envRecord['namespace'] === 'string' ? envRecord['namespace'] : '',
    name: typeof envRecord['name'] === 'string' ? envRecord['name'] : '',
    version: typeof envRecord['version'] === 'string' ? envRecord['version'] : '',
    digest: toContentDigest(
      typeof envRecord['digest'] === 'string' ? envRecord['digest'] : '',
    ),
  });

  const runId = toNeutralId(typeof record['runId'] === 'string' ? record['runId'] : '');
  const initialSnapshotDigest = toContentDigest(
    typeof record['initialSnapshotDigest'] === 'string' ? record['initialSnapshotDigest'] : '',
  );
  const trajectoryDigest = toContentDigest(
    typeof record['trajectoryDigest'] === 'string' ? record['trajectoryDigest'] : '',
  );
  const rawEvidence = record['evidenceDigests'];
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_RUN_ADDRESS, {
      message:
        'run address: at least one evidence digest is required (evidence outputs are part of the address)',
    });
  }
  const evidenceDigests = Object.freeze(
    rawEvidence.map((entry) =>
      toContentDigest(typeof entry === 'string' ? entry : ''),
    ),
  );

  return deepFreeze({
    taskVersion,
    environmentVersion,
    runId,
    initialSnapshotDigest,
    trajectoryDigest,
    evidenceDigests,
  });
}

/** Stable string key for a run address (map/registry friendly). */
export function runAddressKey(address: RunAddress): string {
  return [
    `task:${address.taskVersion.taskId}@${address.taskVersion.version}`,
    `env:${address.environmentVersion.namespace}/${address.environmentVersion.name}@${address.environmentVersion.version}#${address.environmentVersion.digest}`,
    `run:${address.runId}`,
    `snapshot:${address.initialSnapshotDigest}`,
    `trajectory:${address.trajectoryDigest}`,
  ].join('|');
}
