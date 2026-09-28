/**
 * RunRecord — the content-addressed, deep-frozen declaration of an
 * environment run (Work Order A010 gate 2; spec ENV1.0; requirements
 * R9, R29, R30).
 *
 * A RunRecord binds:
 *   - a tenant-scoped run id (`<tenant>/<run-key>`, run-id.ts — the
 *     tenant is part of the ADDRESS and therefore of the digest);
 *   - the owning tenant id (must equal the run id's tenant half —
 *     constructing a record whose tenant field contradicts its run id
 *     is rejected as a tenant-isolation violation);
 *   - the target environment as A009's content-addressed
 *     EnvironmentVersionRef (the run pins the executable world by
 *     digest, never by name only);
 *   - the workload/job reference as an A015 job id (type-only import);
 *   - the initial state snapshot digest the run starts from;
 *   - the deterministic seed (or null when the environment's seed
 *     policy admits none);
 *   - the submitted-at timestamp;
 *   - the run's isolation envelope (A009 ResourceLimits / NetworkPolicy
 *     / FilesystemPolicy / SecretPolicy — gate 5).
 *
 * Content addressing: the sha256 digest is computed over the canonical
 * JSON serialization of the digest-free view with @arena/protocol-core's
 * digestCanonical — NEVER reimplemented here. Same inputs ⇒ same
 * digest; ANY field change ⇒ a different digest (gate 2 tests). The
 * record is deep-frozen at creation — there is no mutation API.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { JobId } from '@arena/job-protocol';
import type { EnvironmentVersionRef } from '@arena/environment-protocol';
import type {
  FilesystemPolicy,
  NetworkPolicy,
  ResourceLimits,
  SecretPolicy,
} from '@arena/environment-protocol';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import { runIdTenant } from './run-id.js';
import {
  isEnvironmentVersionRef,
  isFilesystemPolicy,
  isNetworkPolicy,
  isResourceLimits,
  isSecretPolicy,
  toEnvironmentRef,
  toFilesystemEnvelope,
  toNetworkEnvelope,
  toResourceEnvelope,
  toSecretEnvelope,
} from './isolation-envelope.js';
import type { RunIsolationEnvelope } from './isolation-envelope.js';
import {
  assertNoSecretMaterialFields,
  assertRuntimeNeutralTree,
  deepFreeze,
  expectFields,
  isContentDigest,
  isRunId,
  isRunTimestamp,
  isRunSeed,
  isTenantId,
  toContentDigest,
  toRunId,
  toRunTimestamp,
  toRunSeed,
  toTenantId,
} from './shared.js';
import type { ContentDigest, RunId, RunSeed, RunTimestamp, TenantId } from './shared.js';

/** Wire version of the run record shape. */
export const RUN_RECORD_VERSION = 1 as const;

/** Job references use the A015 job-id charset (type-only import; local guard). */
export const JOB_REF_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const JOB_REF_PATTERN = new RegExp(JOB_REF_PATTERN_SOURCE);

export function isJobRef(value: unknown): value is JobId {
  return typeof value === 'string' && JOB_REF_PATTERN.test(value);
}

export function toJobRef(value: string): JobId {
  if (!isJobRef(value)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_JOB_REF, {
      message: `invalid job reference: ${JSON.stringify(value)} (the run must reference the durable job whose workload it executes — A015 job id charset)`,
      details: { pattern: JOB_REF_PATTERN_SOURCE },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// RunRecord
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the digest commits to. */
export interface RunRecordView {
  readonly recordVersion: typeof RUN_RECORD_VERSION;
  readonly runId: RunId;
  readonly tenantId: TenantId;
  readonly environment: EnvironmentVersionRef;
  readonly jobRef: JobId;
  readonly initialSnapshotDigest: ContentDigest;
  readonly seed: RunSeed | null;
  readonly submittedAt: RunTimestamp;
  readonly resourceEnvelope: ResourceLimits;
  readonly networkEnvelope: NetworkPolicy;
  readonly filesystemEnvelope: FilesystemPolicy;
  readonly secretEnvelope: SecretPolicy;
}

/** A frozen run record: the view plus its sha256 content digest. */
export interface RunRecord extends RunRecordView {
  readonly digest: ContentDigest;
}

/** Stable field list for the record view (tests + contracts mirror it). */
export const RUN_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'runId',
  'tenantId',
  'environment',
  'jobRef',
  'initialSnapshotDigest',
  'seed',
  'submittedAt',
  'resourceEnvelope',
  'networkEnvelope',
  'filesystemEnvelope',
  'secretEnvelope',
] as const) as readonly string[];

export interface CreateRunRecordInput {
  readonly runId: string;
  readonly tenantId: string;
  readonly environment: {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  };
  readonly jobRef: string;
  readonly initialSnapshotDigest: string;
  readonly seed: string | null;
  readonly submittedAt: string;
  readonly resourceEnvelope: {
    cpuMillis: number;
    memoryMiB: number;
    wallClockSeconds: number;
  };
  readonly networkEnvelope: {
    egress: string;
    allows?: readonly { host: string; port: number; protocol: string }[];
  };
  readonly filesystemEnvelope: {
    writeMode: string;
    mounts?: readonly { mountPath: string; access: string; source: string }[];
  };
  readonly secretEnvelope: {
    isolation: string;
    injectionPoints?: readonly {
      secretId: string;
      mountPath: string;
      mechanism: string;
    }[];
  };
}

/** Structural (non-throwing) check for the digest-free view. */
export function isRunRecordView(value: unknown): value is RunRecordView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === RUN_RECORD_VERSION &&
    isRunId(candidate['runId']) &&
    isTenantId(candidate['tenantId']) &&
    isEnvironmentVersionRef(candidate['environment']) &&
    isJobRef(candidate['jobRef']) &&
    isContentDigest(candidate['initialSnapshotDigest']) &&
    (candidate['seed'] === null || isRunSeed(candidate['seed'])) &&
    isRunTimestamp(candidate['submittedAt']) &&
    isResourceLimits(candidate['resourceEnvelope']) &&
    isNetworkPolicy(candidate['networkEnvelope']) &&
    isFilesystemPolicy(candidate['filesystemEnvelope']) &&
    isSecretPolicy(candidate['secretEnvelope'])
  );
}

/** Structural (non-throwing) check for the full record (view + digest). */
export function isRunRecord(value: unknown): value is RunRecord {
  if (!isRunRecordView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed run record.
 * Throws a typed EnvironmentRuntimeError on any malformed input, any
 * tenant contradiction between runId and tenantId, any runner/provider
 * leakage or secret-material field (shared tripwires).
 */
export async function createRunRecord(input: CreateRunRecordInput): Promise<RunRecord> {
  assertNoSecretMaterialFields(input, 'runRecord');
  const record = expectFields(
    input,
    [
      'runId',
      'tenantId',
      'environment',
      'jobRef',
      'initialSnapshotDigest',
      'seed',
      'submittedAt',
      'resourceEnvelope',
      'networkEnvelope',
      'filesystemEnvelope',
      'secretEnvelope',
    ],
    [],
    ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RECORD,
    'run record',
  );

  const runId = toRunId(record['runId'] as string);
  const tenantId = toTenantId(record['tenantId'] as string);
  // Tenant isolation (gate 6): the tenant field must match the run id's
  // namespacing tenant — a contradiction is rejected at construction.
  if (runIdTenant(runId) !== tenantId) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.TENANT_ISOLATION_VIOLATION,
      {
        message: `run record tenant contradiction: run id ${JSON.stringify(runId)} is scoped to tenant ${JSON.stringify(runIdTenant(runId))}, but the record declares tenant ${JSON.stringify(tenantId)}`,
        details: { runId, owningTenant: runIdTenant(runId), declaredTenant: tenantId },
      },
    );
  }
  const rawEnvironment = record['environment'];
  if (typeof rawEnvironment !== 'object' || rawEnvironment === null) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_ENVIRONMENT_REF,
      { message: 'run record: environment must be an environment version ref' },
    );
  }
  const environment = toEnvironmentRef(
    rawEnvironment as {
      namespace: string;
      name: string;
      version: string;
      digest: string;
    },
  );
  const jobRef = toJobRef(record['jobRef'] as string);
  const initialSnapshotDigest = toContentDigest(
    record['initialSnapshotDigest'] as string,
  );
  const rawSeed = record['seed'];
  if (rawSeed !== null && typeof rawSeed !== 'string') {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_SEED, {
      message: 'run record: seed must be a neutral seed string or null',
    });
  }
  const seed = rawSeed === null ? null : toRunSeed(rawSeed);
  const submittedAt = toRunTimestamp(record['submittedAt'] as string);

  const rawResource = record['resourceEnvelope'];
  if (typeof rawResource !== 'object' || rawResource === null) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RESOURCE_ENVELOPE,
      { message: 'run record: resourceEnvelope must be a resource limits object' },
    );
  }
  const resourceEnvelope = toResourceEnvelope(
    rawResource as { cpuMillis: number; memoryMiB: number; wallClockSeconds: number },
  );
  const rawNetwork = record['networkEnvelope'];
  if (typeof rawNetwork !== 'object' || rawNetwork === null) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_NETWORK_ENVELOPE,
      { message: 'run record: networkEnvelope must be a network policy object' },
    );
  }
  const networkEnvelope = toNetworkEnvelope(
    rawNetwork as {
      egress: string;
      allows?: readonly { host: string; port: number; protocol: string }[];
    },
  );
  const rawFilesystem = record['filesystemEnvelope'];
  if (typeof rawFilesystem !== 'object' || rawFilesystem === null) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_FILESYSTEM_ENVELOPE,
      { message: 'run record: filesystemEnvelope must be a filesystem policy object' },
    );
  }
  const filesystemEnvelope = toFilesystemEnvelope(
    rawFilesystem as {
      writeMode: string;
      mounts?: readonly { mountPath: string; access: string; source: string }[];
    },
  );
  const rawSecret = record['secretEnvelope'];
  if (typeof rawSecret !== 'object' || rawSecret === null) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_SECRET_ENVELOPE,
      { message: 'run record: secretEnvelope must be a secret policy object' },
    );
  }
  const secretEnvelope = toSecretEnvelope(
    rawSecret as {
      isolation: string;
      injectionPoints?: readonly {
        secretId: string;
        mountPath: string;
        mechanism: string;
      }[];
    },
  );

  const view: RunRecordView = {
    recordVersion: RUN_RECORD_VERSION,
    runId,
    tenantId,
    environment,
    jobRef,
    initialSnapshotDigest,
    seed,
    submittedAt,
    resourceEnvelope,
    networkEnvelope,
    filesystemEnvelope,
    secretEnvelope,
  };
  assertRuntimeNeutralTree(view, 'runRecord');
  const digest = toContentDigest(await digestCanonical(view));
  return deepFreeze({ ...view, digest }) as RunRecord;
}

/** The digest-free view of a record (what the digest commits to). */
export function runRecordView(record: RunRecord): RunRecordView {
  const { digest: _digest, ...view } = record;
  return deepFreeze({ ...view }) as RunRecordView;
}

/**
 * Verify a run record: recompute the digest over the digest-free view
 * and compare (optionally against an expected digest). Throws
 * ENVIRONMENT_RUNTIME_TAMPERED on any mismatch.
 */
export async function verifyRunRecord(
  record: RunRecord,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isRunRecord(record)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RECORD, {
      message: 'run record verification requires a structurally valid run record',
    });
  }
  const actual = await digestCanonical(runRecordView(record));
  if (actual !== record.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.TAMPERED, {
      message: `run record digest mismatch: expected ${expectedDigest ?? record.digest}, got ${actual}`,
      details: { runId: record.runId, expected: expectedDigest ?? record.digest, actual },
    });
  }
  return toContentDigest(actual);
}

/** The isolation envelope slice of a record (admission input). */
export function runIsolationEnvelope(record: RunRecord): RunIsolationEnvelope {
  return Object.freeze({
    resource: record.resourceEnvelope,
    network: record.networkEnvelope,
    filesystem: record.filesystemEnvelope,
    secret: record.secretEnvelope,
  });
}
