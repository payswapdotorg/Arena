/**
 * CertificationRecord — the APPEND-ONCE record of one certification run
 * (or revocation) (Work Order A023; requirements R21, R22, R43;
 * architecture-lock rules 4, 12, 16, 17, 18, 23).
 *
 * KIND 'certification-run' binds:
 *   - `subject` — the composition under test (B/V × M × E × R; the
 *     design-law scope, validated by createCertificationSubject);
 *   - `suiteRef` — the digest of the CertificationSuite that ran (the
 *     suite digest IS the "revision X" of the statement);
 *   - `stages` — one closed-vocabulary StageResult per declared suite
 *     stage (set-equal to the suite's stage ids; strict shape);
 *   - `verdict` — satisfied | not-satisfied | unknown, DERIVED PURELY
 *     from the stage results by deriveCertificationOutcome — never
 *     accepted from the caller, never a score;
 *   - `unknownCause` — the structured WHY of an unknown verdict
 *     (closed reason taxonomy + driving stage detail); DERIVED, and
 *     REQUIRED iff verdict === 'unknown';
 *   - `grantedLevel` — DERIVED (satisfied ⇒ the suite's grant mapping,
 *     CONDITIONAL when the suite declares constraints; otherwise null —
 *     a failed or indeterminate run grants NOTHING);
 *   - `statement` — the DERIVED scoped certification statement (the
 *     design law; never caller-supplied);
 *   - `inputDigest` — the sha256 over the canonical form of
 *     {suiteRef, subject, stages} — COMPUTED here; the reproducibility
 *     anchor (R22): identical inputs commit to the identical digest;
 *   - `supersedes` — the digest of the prior record this record
 *     supersedes (append-only lineage; null when none).
 *
 * KIND 'revocation' binds `revokes` (the digest of the record whose
 * claim is no longer valid) + `grounds` (the recorded why). Revocation
 * is append-only: the revoked record itself is never mutated; the
 * ledger projects its effective status.
 *
 * Both kinds carry the protocol-core addressability pair
 * (correlationId + idempotencyKey, lock rule 17), tenant/workspace
 * scoping, timestamps and run provenance. Construction is pure;
 * identical inputs yield the identical record digest. Frozen on
 * creation — no mutation API, append-only by content addressing.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { isCorrelationId, isIdempotencyKey } from '@arena/protocol-core';
import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import type { CertificationLevel } from './level.js';
import { deriveGrantedLevel } from './level.js';
import type {
  CertificationUnknownCause,
  CertificationVerdict,
  StageResult,
} from './outcome.js';
import {
  deriveCertificationOutcome,
  isStageResult,
  toStageResult,
} from './outcome.js';
import type { CertificationSubject } from './subject.js';
import { isCertificationSubject } from './subject.js';
import type { CertificationSuite } from './suite.js';
import { isCertificationSuite } from './suite.js';
import type { CertificationStatement } from './statement.js';
import { deriveCertificationStatement, isCertificationStatement } from './statement.js';
import {
  deepFreeze,
  expectFields,
  isCertificationTimestamp,
  isNeutralId,
  isNeutralText,
  toCertificationTimestamp,
  toContentDigest,
  toNeutralId,
  toNeutralText,
  toOptionalContentDigest,
} from './shared.js';
import type {
  CertificationTimestamp,
  ContentDigest,
  NeutralId,
  NeutralText,
  TenantId,
  WorkspaceId,
} from './shared.js';

/** Wire version of the certification-record shape. */
export const CERTIFICATION_RECORD_VERSION = 1 as const;

/** The closed record-kind vocabulary. */
export const CERTIFICATION_RECORD_KINDS = Object.freeze([
  'certification-run',
  'revocation',
] as const);

export type CertificationRecordKind = (typeof CERTIFICATION_RECORD_KINDS)[number];

/** Structural (non-throwing) check for the record-kind vocabulary. */
export function isCertificationRecordKind(value: unknown): value is CertificationRecordKind {
  return (
    typeof value === 'string' &&
    (CERTIFICATION_RECORD_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Run provenance
// ---------------------------------------------------------------------------

/** Provenance of one certification run. */
export interface CertificationProvenance {
  readonly executedBy: NeutralId;
  readonly recordedAt: CertificationTimestamp;
  readonly notes: NeutralText | null;
}

/** Stable field list for run provenance (tests + contracts mirror it). */
export const CERTIFICATION_RECORD_PROVENANCE_FIELDS = Object.freeze([
  'executedBy',
  'recordedAt',
  'notes',
] as const) as readonly string[];

/** Structural (non-throwing) check for run provenance. */
export function isCertificationProvenance(value: unknown): value is CertificationProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['executedBy']) &&
    isCertificationTimestamp(candidate['recordedAt']) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

function toCertificationProvenance(value: unknown): CertificationProvenance {
  const record = expectFields(
    value,
    ['executedBy', 'recordedAt', 'notes'],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_PROVENANCE,
    'certification record provenance',
  );
  const notes = record['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'certification record provenance: notes must be neutral text or null',
    });
  }
  return deepFreeze({
    executedBy: toNeutralId(
      typeof record['executedBy'] === 'string' ? record['executedBy'] : '',
      'certification record provenance executedBy',
    ),
    recordedAt: toCertificationTimestamp(
      typeof record['recordedAt'] === 'string' ? record['recordedAt'] : '',
      'certification record provenance recordedAt',
    ),
    notes: notes === null ? null : toNeutralText(notes, 'certification record provenance notes'),
  });
}

// ---------------------------------------------------------------------------
// The input digest (reproducibility anchor, R22)
// ---------------------------------------------------------------------------

/**
 * Compute the run-input digest: sha256 over the canonical JSON of
 * { suiteRef, subject, stages } — the full input material of the run.
 * The record constructor computes this itself, so a record can always
 * prove what inputs produced it.
 */
export async function computeCertificationInputDigest(
  suiteRef: string,
  subject: CertificationSubject,
  stages: readonly StageResult[],
): Promise<ContentDigest> {
  return toContentDigest(
    await digestCanonical({
      suiteRef,
      subject,
      stages: [...stages],
    }),
    'certification input digest',
  );
}

// ---------------------------------------------------------------------------
// CertificationRecord
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the record digest commits to. */
export interface CertificationRecordView {
  readonly recordVersion: typeof CERTIFICATION_RECORD_VERSION;
  readonly kind: CertificationRecordKind;
  // --- certification-run fields (null on revocation records) ---
  readonly subject: CertificationSubject | null;
  readonly suiteRef: ContentDigest | null;
  readonly stages: readonly StageResult[];
  readonly verdict: CertificationVerdict | null;
  readonly unknownCause: CertificationUnknownCause | null;
  readonly grantedLevel: CertificationLevel | null;
  readonly statement: CertificationStatement | null;
  readonly inputDigest: ContentDigest | null;
  readonly supersedes: ContentDigest | null;
  // --- revocation fields (null on run records) ---
  readonly revokes: ContentDigest | null;
  readonly grounds: NeutralText | null;
  // --- common fields ---
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: IdempotencyKey;
  readonly tenantId: TenantId | null;
  readonly workspaceId: WorkspaceId | null;
  readonly startedAt: CertificationTimestamp;
  readonly finishedAt: CertificationTimestamp;
  readonly provenance: CertificationProvenance;
}

/** A frozen, content-addressed certification record: the view plus its sha256 digest. */
export interface CertificationRecord extends CertificationRecordView {
  readonly digest: ContentDigest;
}

/** Stable field list for the record view (tests + contracts mirror it). */
export const CERTIFICATION_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'kind',
  'subject',
  'suiteRef',
  'stages',
  'verdict',
  'unknownCause',
  'grantedLevel',
  'statement',
  'inputDigest',
  'supersedes',
  'revokes',
  'grounds',
  'correlationId',
  'idempotencyKey',
  'tenantId',
  'workspaceId',
  'startedAt',
  'finishedAt',
  'provenance',
] as const) as readonly string[];

const RUN_FIELDS = Object.freeze([
  'subject',
  'suiteRef',
  'stages',
  'verdict',
  'unknownCause',
  'grantedLevel',
  'statement',
  'inputDigest',
  'supersedes',
] as const);

const REVOCATION_FIELDS = Object.freeze(['revokes', 'grounds'] as const);

/** Structural (non-throwing) check for the digest-free view. */
export function isCertificationRecordView(value: unknown): value is CertificationRecordView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== CERTIFICATION_RECORD_VERSION) return false;
  if (!isCertificationRecordKind(candidate['kind'])) return false;
  const kind = candidate['kind'];
  if (kind === 'certification-run') {
    if (forbiddenPresent(candidate, REVOCATION_FIELDS)) return false;
    return (
      isCertificationSubject(candidate['subject']) &&
      digestLike(candidate['suiteRef']) &&
      Array.isArray(candidate['stages']) &&
      (candidate['stages'] as unknown[]).length > 0 &&
      (candidate['stages'] as unknown[]).every((entry) => isStageResult(entry)) &&
      (candidate['verdict'] === 'satisfied' ||
        candidate['verdict'] === 'not-satisfied' ||
        candidate['verdict'] === 'unknown') &&
      ((candidate['verdict'] === 'unknown') === (candidate['unknownCause'] !== null)) &&
      (candidate['unknownCause'] === null ||
        (typeof candidate['unknownCause'] === 'object' && candidate['unknownCause'] !== null)) &&
      isCertificationStatement(candidate['statement']) &&
      digestLike(candidate['inputDigest']) &&
      (candidate['supersedes'] === null || digestLike(candidate['supersedes']))
    );
  }
  // revocation
  if (forbiddenPresent(candidate, RUN_FIELDS)) return false;
  return digestLike(candidate['revokes']) && typeof candidate['grounds'] === 'string';
}

function forbiddenPresent(
  candidate: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.some((field) => {
    const value = candidate[field];
    if (value === null || value === undefined) return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });
}

function digestLike(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Structural (non-throwing) check for the full record (view + digest). */
export function isCertificationRecord(value: unknown): value is CertificationRecord {
  if (!isCertificationRecordView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return digestLike(candidate['digest']);
}

function validateCommonRunFields(
  record: Record<string, unknown>,
): {
  correlationId: CorrelationId;
  idempotencyKey: IdempotencyKey;
  tenantId: TenantId | null;
  workspaceId: WorkspaceId | null;
  startedAt: CertificationTimestamp;
  finishedAt: CertificationTimestamp;
  provenance: CertificationProvenance;
} {
  const startedAt = toCertificationTimestamp(
    typeof record['startedAt'] === 'string' ? record['startedAt'] : '',
    'certification record startedAt',
  );
  const finishedAt = toCertificationTimestamp(
    typeof record['finishedAt'] === 'string' ? record['finishedAt'] : '',
    'certification record finishedAt',
  );
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.TIMESTAMP_REGRESSION, {
      message: `certification record: finishedAt ${finishedAt} precedes startedAt ${startedAt}`,
      details: { startedAt, finishedAt },
    });
  }
  const correlationId = record['correlationId'];
  if (!isCorrelationId(correlationId)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `certification record: invalid correlation id: ${JSON.stringify(correlationId)}`,
    });
  }
  const idempotencyKey = record['idempotencyKey'];
  if (!isIdempotencyKey(idempotencyKey)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `certification record: invalid idempotency key: ${JSON.stringify(idempotencyKey)}`,
    });
  }
  const tenantId =
    record['tenantId'] === null || record['tenantId'] === undefined
      ? null
      : (record['tenantId'] as TenantId);
  const workspaceId =
    record['workspaceId'] === null || record['workspaceId'] === undefined
      ? null
      : (record['workspaceId'] as WorkspaceId);
  return {
    correlationId,
    idempotencyKey,
    tenantId,
    workspaceId,
    startedAt,
    finishedAt,
    provenance: toCertificationProvenance(record['provenance']),
  };
}

export interface CreateCertificationRecordInput {
  readonly subject: {
    readonly bodyVersionRef: unknown;
    readonly substrateRef: unknown;
    readonly environmentRef: unknown;
    readonly runtimeProfile: unknown;
    readonly possessionRef?: unknown;
    readonly tenantId?: unknown;
    readonly workspaceId?: unknown;
  };
  readonly suiteRef: string;
  readonly stages: readonly {
    readonly stageId: string;
    readonly outcome: string;
    readonly reason: string;
    readonly evidenceDigest: string | null;
    readonly unknownCause: { readonly reason: string; readonly detail: string } | null;
  }[];
  readonly supersedes: string | null;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly tenantId?: string | null;
  readonly workspaceId?: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly provenance: {
    readonly executedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

/**
 * Create a validated, deep-frozen, content-addressed CERTIFICATION-RUN
 * record. The verdict, unknown cause, granted level, statement and
 * input digest are COMPUTED (never caller-supplied); the stage results
 * must be set-equal to the suite's declared stages (order canonicalized
 * to suite order); the suiteRef must bind the exact suite supplied.
 */
export async function createCertificationRecord(
  input: CreateCertificationRecordInput,
  suite: CertificationSuite,
): Promise<CertificationRecord> {
  const record = expectFields(
    input,
    [
      'subject',
      'suiteRef',
      'stages',
      'supersedes',
      'correlationId',
      'idempotencyKey',
      'tenantId',
      'workspaceId',
      'startedAt',
      'finishedAt',
      'provenance',
    ],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_RECORD,
    'certification record',
  );

  if (!isCertificationSuite(suite)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
      message: 'certification record creation requires a structurally valid certification suite',
    });
  }

  const declaredSuiteRef =
    typeof record['suiteRef'] === 'string' ? record['suiteRef'] : '';
  if (declaredSuiteRef !== suite.digest) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.EVIDENCE_MISMATCH, {
      message: `certification record suiteRef ${JSON.stringify(declaredSuiteRef)} does not match the supplied suite (digest ${suite.digest}) — a record must bind the exact suite that ran`,
      details: { declared: declaredSuiteRef, actual: suite.digest },
    });
  }

  const subject = isCertificationSubject(record['subject'])
    ? (record['subject'] as CertificationSubject)
    : null;
  if (subject === null) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUBJECT, {
      message: 'certification record: a structurally valid subject (the full B×M×E×R composition) is required',
    });
  }
  // Tenant scoping consistency: the record's scope may not contradict
  // the subject's (lock rule 11).
  if (subject.tenantId !== null && record['tenantId'] !== null && record['tenantId'] !== undefined) {
    if (subject.tenantId !== record['tenantId']) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SCOPE, {
        message: `certification record: tenant ${JSON.stringify(record['tenantId'])} contradicts the subject's tenant ${JSON.stringify(subject.tenantId)}`,
        details: { recordTenant: record['tenantId'], subjectTenant: subject.tenantId },
      });
    }
  }

  const stagesInput = record['stages'];
  if (!Array.isArray(stagesInput) || stagesInput.length === 0) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'certification record: at least one stage result is required',
    });
  }
  const stages = stagesInput.map((entry) => toStageResult(entry));

  // Set-equality between the stage results and the suite's stages.
  const declared = suite.stages.map((stage) => stage.stageId);
  const spoken = stages.map((stage) => stage.stageId);
  const declaredSet = new Set<string>(declared);
  const spokenSet = new Set<string>(spoken);
  for (const id of declared) {
    if (!spokenSet.has(id)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.STAGE_MISMATCH, {
        message: `stage results are missing an entry for declared stage ${JSON.stringify(id)} (every declared stage must be spoken for)`,
        details: { stageId: id, declared: [...declared] },
      });
    }
  }
  for (const id of spoken) {
    if (!declaredSet.has(id)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.STAGE_MISMATCH, {
        message: `stage results speak for undeclared stage ${JSON.stringify(id)} (the suite declares: ${declared.join(', ')})`,
        details: { stageId: id, declared: [...declared] },
      });
    }
  }

  // Canonical order: the suite's stage order (digest stability).
  const order = new Map(declared.map((id, index) => [id, index]));
  const orderedStages = Object.freeze(
    [...stages].sort(
      (a, b) => (order.get(a.stageId) ?? -1) - (order.get(b.stageId) ?? -1),
    ),
  );

  // The DERIVED outcome + structured unknown cause (never caller-supplied).
  const { verdict, unknownCause } = deriveCertificationOutcome(orderedStages);

  // The DERIVED granted level (a failed or indeterminate run grants NOTHING).
  const grantedLevel: CertificationLevel | null =
    verdict === 'satisfied' ? deriveGrantedLevel(suite.levelGrant, suite.constraints) : null;

  // The DERIVED scoped statement (the design law).
  const statement = deriveCertificationStatement(subject, suite, verdict, grantedLevel);

  const common = validateCommonRunFields(record);
  const inputDigest = await computeCertificationInputDigest(
    declaredSuiteRef,
    subject,
    orderedStages,
  );

  const view: CertificationRecordView = {
    recordVersion: CERTIFICATION_RECORD_VERSION,
    kind: 'certification-run',
    subject,
    suiteRef: toContentDigest(declaredSuiteRef, 'certification record suiteRef'),
    stages: orderedStages,
    verdict,
    unknownCause,
    grantedLevel,
    statement,
    inputDigest,
    supersedes: toOptionalContentDigest(
      record['supersedes'],
      'certification record supersedes',
    ),
    revokes: null,
    grounds: null,
    correlationId: common.correlationId,
    idempotencyKey: common.idempotencyKey,
    tenantId: common.tenantId,
    workspaceId: common.workspaceId,
    startedAt: common.startedAt,
    finishedAt: common.finishedAt,
    provenance: common.provenance,
  };
  const digest = toContentDigest(await digestCanonical(view), 'certification record digest');
  return deepFreeze({ ...view, digest }) as CertificationRecord;
}

export interface CreateRevocationRecordInput {
  readonly revokes: string;
  readonly grounds: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly tenantId?: string | null;
  readonly workspaceId?: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly provenance: {
    readonly executedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

/**
 * Create a validated, deep-frozen, content-addressed REVOCATION record:
 * the append-only governance fact that a prior certification record's
 * claim is no longer valid (quality-model level REVOKED). The revoked
 * record is never mutated — the ledger projects effective status.
 */
export async function createRevocationRecord(
  input: CreateRevocationRecordInput,
): Promise<CertificationRecord> {
  const record = expectFields(
    input,
    [
      'revokes',
      'grounds',
      'correlationId',
      'idempotencyKey',
      'tenantId',
      'workspaceId',
      'startedAt',
      'finishedAt',
      'provenance',
    ],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_RECORD,
    'revocation record',
  );
  const common = validateCommonRunFields(record);
  const view: CertificationRecordView = {
    recordVersion: CERTIFICATION_RECORD_VERSION,
    kind: 'revocation',
    subject: null,
    suiteRef: null,
    stages: [],
    verdict: null,
    unknownCause: null,
    grantedLevel: null,
    statement: null,
    inputDigest: null,
    supersedes: null,
    revokes: toContentDigest(
      typeof record['revokes'] === 'string' ? record['revokes'] : '',
      'revocation record revokes',
    ),
    grounds: toNeutralText(
      typeof record['grounds'] === 'string' ? record['grounds'] : '',
      'revocation record grounds',
    ),
    correlationId: common.correlationId,
    idempotencyKey: common.idempotencyKey,
    tenantId: common.tenantId,
    workspaceId: common.workspaceId,
    startedAt: common.startedAt,
    finishedAt: common.finishedAt,
    provenance: common.provenance,
  };
  const digest = toContentDigest(await digestCanonical(view), 'revocation record digest');
  return deepFreeze({ ...view, digest }) as CertificationRecord;
}

/** The digest-free view of a record (what the digest commits to). */
export function certificationRecordView(record: CertificationRecord): CertificationRecordView {
  const { digest: _digest, ...view } = record;
  return deepFreeze({ ...view }) as CertificationRecordView;
}

/**
 * Recompute the record digest over the digest-free view and compare
 * (optionally against an expected digest). Throws CERTIFICATION_TAMPERED
 * on any mismatch — the append-once content-addressing tripwire.
 */
export async function recomputeCertificationRecordDigest(
  record: CertificationRecord,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isCertificationRecord(record)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'record digest recomputation requires a structurally valid certification record',
    });
  }
  const actual = await digestCanonical(certificationRecordView(record));
  if (actual !== record.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.TAMPERED, {
      message: `certification record digest mismatch: expected ${expectedDigest ?? record.digest}, got ${actual}`,
      details: {
        kind: record.kind,
        expected: expectedDigest ?? record.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed record digest');
}

/**
 * Replay a certification record's construction PURELY from its own
 * inputs: re-derives the verdict / unknown cause / granted level /
 * statement and rebuilds the record, asserting the byte-identical
 * digest. Throws CERTIFICATION_TAMPERED when the recomputed digest
 * differs — the record is append-once, so a replay divergence means
 * tampering.
 */
export async function replayCertificationRecord(
  record: CertificationRecord,
  suite: CertificationSuite,
): Promise<CertificationRecord> {
  if (!isCertificationRecord(record) || record.kind !== 'certification-run') {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'certification replay requires a structurally valid certification-run record',
    });
  }
  const rebuilt = await createCertificationRecord(
    {
      subject: record.subject!,
      suiteRef: record.suiteRef!,
      stages: record.stages.map((stage) => ({
        stageId: stage.stageId,
        outcome: stage.outcome,
        reason: stage.reason,
        evidenceDigest: stage.evidenceDigest,
        unknownCause: stage.unknownCause === null ? null : { ...stage.unknownCause },
      })),
      supersedes: record.supersedes,
      correlationId: record.correlationId,
      idempotencyKey: record.idempotencyKey,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      provenance: {
        executedBy: record.provenance.executedBy,
        recordedAt: record.provenance.recordedAt,
        notes: record.provenance.notes,
      },
    },
    suite,
  );
  if (rebuilt.digest !== record.digest) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.TAMPERED, {
      message: `certification record replay diverged: record declares ${record.digest}, pure reconstruction yields ${rebuilt.digest}`,
      details: { declared: record.digest, reconstructed: rebuilt.digest },
    });
  }
  return rebuilt;
}
