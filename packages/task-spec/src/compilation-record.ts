/**
 * CompilationRecord — the append-only, idempotency-keyed record of one
 * TaskSpec compilation run (Work Order A008; architecture-lock rule 17:
 * "Long-running jobs are idempotent and correlation-addressable"; rule 6:
 * append-only history).
 *
 * A record binds:
 *   - the idempotency key that authorized the run (the compilationKey —
 *     re-running the same key returns the recorded result; the registry
 *     in services/task-compiler enforces this);
 *   - the correlation id of the causal flow;
 *   - the case digest + the compilation-target digest the run consumed;
 *   - the policy digest the run compiled under;
 *   - the emitted TaskSpec digests (content-addressed refs — exactly
 *     which proposals this run produced);
 *   - the compile timestamp.
 *
 * The record itself is content-addressed (sha256 over the digest-free
 * view) and deep-frozen. It records WHAT a run proposed — it pins
 * nothing: specs are PROPOSALS until a consumer pins them (the record is
 * the audit trail, not a lifecycle mutation of the case; lock rule 6 —
 * the case is never touched).
 */

import { digestCanonical } from '@arena/protocol-core';
import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  isTaskSpecTimestamp,
  toCaseRefView,
  toCompilationPolicyRefView,
  toTaskSpecTimestamp,
} from './shared.js';
import type { CaseRefView, CompilationPolicyRefView } from './shared.js';
import { toTaskVersionRef } from './identity.js';
import type { TaskVersionRef } from './identity.js';

/** Wire version of the compilation-record shape. */
export const COMPILATION_RECORD_VERSION = 1 as const;

/**
 * The idempotency-key pattern (identifier charset, mirroring the core
 * IdempotencyKey constraint this package validates structurally).
 */
export const COMPILATION_KEY_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

const COMPILATION_KEY_PATTERN = new RegExp(COMPILATION_KEY_PATTERN_SOURCE);

export function isCompilationKey(value: unknown): value is string {
  return typeof value === 'string' && COMPILATION_KEY_PATTERN.test(value);
}

/** The digest-free view — exactly what the record digest commits to. */
export interface CompilationRecordView {
  readonly recordVersion: typeof COMPILATION_RECORD_VERSION;
  readonly compilationKey: string;
  readonly correlationId: string;
  readonly caseRef: CaseRefView;
  readonly targetDigest: string;
  readonly policyRef: CompilationPolicyRefView;
  readonly emittedSpecs: readonly TaskVersionRef[];
  readonly compiledAt: string;
}

/** A frozen, content-addressed compilation record: view + digest. */
export interface CompilationRecord extends CompilationRecordView {
  readonly digest: string;
}

/** Stable field list (tests + contracts mirror it). */
export const COMPILATION_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'compilationKey',
  'correlationId',
  'caseRef',
  'targetDigest',
  'policyRef',
  'emittedSpecs',
  'compiledAt',
  'digest',
] as const) as readonly string[];

export interface CreateCompilationRecordInput {
  readonly compilationKey: string;
  readonly correlationId: string;
  readonly caseRef: { tenant: string; caseId: string; version: string; digest: string };
  readonly targetDigest: string;
  readonly policyRef: { policyId: string; version: string; digest: string };
  readonly emittedSpecs: readonly {
    tenant: string;
    taskId: string;
    version: string;
    digest: string;
  }[];
  readonly compiledAt: string;
}

/**
 * Create a validated, deep-frozen, content-addressed CompilationRecord.
 * Every ref is validated (case ref, policy ref, emitted spec refs); the
 * compilation key and correlation id must be identifiers; the timestamp
 * must be ms-precision UTC.
 */
export async function createCompilationRecord(
  input: CreateCompilationRecordInput,
): Promise<CompilationRecord> {
  const record = expectFields(
    input,
    [
      'compilationKey',
      'correlationId',
      'caseRef',
      'targetDigest',
      'policyRef',
      'emittedSpecs',
      'compiledAt',
    ],
    [],
    TASK_SPEC_ERROR_CODES.INVALID_RECORD,
    'compilation record',
  );
  if (record['recordVersion'] !== undefined && record['recordVersion'] !== COMPILATION_RECORD_VERSION) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `unsupported compilation-record version: ${String(record['recordVersion'])}`,
    });
  }
  if (!isCompilationKey(record['compilationKey'])) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_RECORD, {
      message: `invalid compilation key: ${JSON.stringify(record['compilationKey'])} (identifier charset, 1-128 chars)`,
      details: { pattern: COMPILATION_KEY_PATTERN_SOURCE },
    });
  }
  if (typeof record['correlationId'] !== 'string' || record['correlationId'].length === 0) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_RECORD, {
      message: 'compilation record requires a correlation id (lock rule 17)',
    });
  }
  const targetDigest = record['targetDigest'];
  if (typeof targetDigest !== 'string' || !/^[0-9a-f]{64}$/.test(targetDigest)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_RECORD, {
      message: `invalid compilation-target digest: ${JSON.stringify(targetDigest)}`,
    });
  }
  if (!Array.isArray(record['emittedSpecs'])) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_RECORD, {
      message: 'emittedSpecs must be an array of task version refs',
    });
  }
  const view: CompilationRecordView = deepFreeze({
    recordVersion: COMPILATION_RECORD_VERSION,
    compilationKey: record['compilationKey'],
    correlationId: record['correlationId'],
    caseRef: toCaseRefView(record['caseRef'] as CaseRefView),
    targetDigest,
    policyRef: toCompilationPolicyRefView(
      record['policyRef'] as CompilationPolicyRefView,
    ),
    emittedSpecs: Object.freeze(
      (record['emittedSpecs'] as CreateCompilationRecordInput['emittedSpecs']).map(
        (ref) => toTaskVersionRef(ref),
      ),
    ),
    compiledAt: toTaskSpecTimestamp(
      typeof record['compiledAt'] === 'string' ? record['compiledAt'] : '',
    ),
  });
  if (!isTaskSpecTimestamp(view.compiledAt)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `invalid compiledAt timestamp: ${JSON.stringify(view.compiledAt)}`,
    });
  }
  const digest = await digestCanonical(view);
  return deepFreeze({ ...view, digest });
}

/** Structural (non-throwing) check for the full record (view + digest). */
export function isCompilationRecord(value: unknown): value is CompilationRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === COMPILATION_RECORD_VERSION &&
    isCompilationKey(candidate['compilationKey']) &&
    typeof candidate['correlationId'] === 'string' &&
    typeof candidate['targetDigest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['targetDigest']) &&
    Array.isArray(candidate['emittedSpecs']) &&
    typeof candidate['compiledAt'] === 'string' &&
    typeof candidate['digest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}

/** The digest-free view of a record (what the digest commits to). */
export function compilationRecordView(record: CompilationRecord): CompilationRecordView {
  const { digest: _digest, ...view } = record;
  return deepFreeze({ ...view }) as CompilationRecordView;
}

/**
 * Recompute the record digest and compare. Throws TASK_SPEC_TAMPERED on
 * any mismatch.
 */
export async function recomputeCompilationRecordDigest(
  record: CompilationRecord,
  expectedDigest?: string,
): Promise<string> {
  const actual = await digestCanonical(compilationRecordView(record));
  const claimed = expectedDigest ?? record.digest;
  if (actual !== claimed) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.TAMPERED, {
      message: `compilation record digest mismatch: expected ${claimed}, recomputed ${actual}`,
      details: { expected: claimed, actual },
    });
  }
  return actual;
}
