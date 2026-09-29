/**
 * CertificationRecord — the APPEND-ONCE record of one certification run
 * (Work Order A023; spec AB1.0 design law — "Arena certifies statements
 * of the form: Agent Body B, version V, possessed by Cognitive Substrate
 * M, under Environment E and Runtime Profile R, satisfied Certification
 * Suite S at revision X."; architecture-lock rules 4, 17, 18).
 *
 * A record binds:
 *   - `suiteRef` — the digest of the CertificationSuiteDescriptor that ran
 *     (which suite, which revision, which declared component refs — all
 *     accountable downstream); the design-law "Suite S at revision X"
 *     field;
 *   - `possessionRef` — the digest of the A003 Possession that binds the
 *     Body+Substrate+RuntimeProfile+Environment together (architecture-lock
 *     rule 3 — a Possession is a versioned binding, not an alias for the
 *     model);
 *   - `bodyVersionRef` / `substrateRef` / `environmentRef` /
 *     `runtimeProfileRef` — the flattened scope refs extracted from the
 *     possession (the design-law "B, V, M, E, R" fields). The engine
 *     receives these as explicit inputs (mirrors A013's strict
 *     evidence-support summary set-equality), and the record view carries
 *     them so consumers can read the scope without dereferencing the
 *     possession;
 *   - `componentVerdicts` — the per-component summary (verdict.ts): one
 *     entry per declared suite ref, set-equal to the descriptor's
 *     declaration;
 *   - `verdict` — pass | conditional-pass | fail | unknown, DERIVED
 *     PURELY from the component summary by deriveCertificationVerdict —
 *     never accepted from the caller, never numerical, never graded
 *     (lock rule 7);
 *   - `unknownCause` — the structured WHY of an unknown verdict
 *     (unverifiable-component | suite-misconfiguration + the driving
 *     component refs); DERIVED, and REQUIRED iff verdict === 'unknown';
 *   - `constraints` — when verdict === 'conditional-pass', the union of
 *     every pass component's declared constraints (the design law's
 *     declared constraints); [] otherwise;
 *   - `statement` — the DERIVED scoped CertificationStatement (the
 *     design-law statement form, rendered from the refs + verdict +
 *     constraints — never caller-supplied, never an unscoped professional
 *     claim);
 *   - `correlationId` + `idempotencyKey` — the protocol-core addressability
 *     pair (lock rule 17);
 *   - `inputDigest` — the sha256 over the canonical run inputs
 *     (suiteRef + possessionRef + component summary), COMPUTED here;
 *   - `startedAt` / `finishedAt` + run provenance.
 *
 * Construction is pure: identical inputs yield the identical record digest;
 * the support summary is canonicalized to the suite's component order for
 * digest stability; finished-at may not precede started-at. Frozen on
 * creation — no mutation API, append-only by content addressing.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { isCorrelationId, isIdempotencyKey } from '@arena/protocol-core';
import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import type { ComponentVerdictSummary } from './verdict.js';
import {
  deriveCertificationVerdict,
  isComponentVerdictSummary,
  isCertificationVerdict,
  isUnknownCause,
  toComponentVerdictSummary,
} from './verdict.js';
import type { CertificationVerdict, UnknownCause } from './verdict.js';
import type { CertificationSuiteDescriptor } from './suite.js';
import { isCertificationSuiteDescriptor, suiteComponentRefs } from './suite.js';
import {
  buildCertificationStatement,
  isCertificationStatement,
} from './statement.js';
import type { CertificationStatement } from './statement.js';
import {
  deepFreeze,
  expectFields,
  isNeutralId,
  isNeutralText,
  isCertificationTimestamp,
  toContentDigest,
  toNeutralId,
  toNeutralText,
  toCertificationTimestamp,
} from './shared.js';
import type {
  ContentDigest,
  NeutralId,
  NeutralText,
  CertificationTimestamp,
} from './shared.js';

/** Wire version of the certification-record shape. */
export const CERTIFICATION_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Run provenance
// ---------------------------------------------------------------------------

/** Provenance of one certification run. */
export interface CertificationProvenance {
  /** Neutral identity of the executing principal (engine, pipeline). */
  readonly executedBy: NeutralId;
  /** When the record was recorded (ms-precision UTC). */
  readonly recordedAt: CertificationTimestamp;
  /** Optional free-form notes. */
  readonly notes: NeutralText | null;
}

/** Stable field list for run provenance (tests + contracts mirror it). */
export const CERTIFICATION_RECORD_PROVENANCE_FIELDS = Object.freeze([
  'executedBy',
  'recordedAt',
  'notes',
] as const) as readonly string[];

/** Structural (non-throwing) check for run provenance. */
export function isCertificationProvenance(
  value: unknown,
): value is CertificationProvenance {
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
// The input digest (reproducibility anchor)
// ---------------------------------------------------------------------------

/**
 * Compute the run-input digest: sha256 over the canonical JSON of
 * { suiteRef, possessionRef, componentVerdicts } — the full input
 * material of the run. The record constructor computes this itself from
 * its own view, so a record can always prove what inputs produced it.
 */
export async function computeCertificationInputDigest(
  suiteRef: string,
  possessionRef: string,
  componentVerdicts: ComponentVerdictSummary,
): Promise<ContentDigest> {
  return toContentDigest(
    await digestCanonical({
      suiteRef,
      possessionRef,
      componentVerdicts: [...componentVerdicts],
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
  /** Digest of the CertificationSuiteDescriptor that ran (design-law "S"). */
  readonly suiteRef: ContentDigest;
  /** Digest of the A003 Possession binding the composition together. */
  readonly possessionRef: ContentDigest;
  /** The design-law "Body B, version V" — digest of the A003 BodyVersion. */
  readonly bodyVersionRef: ContentDigest;
  /** The design-law "Cognitive Substrate M" — digest of the A003 substrate. */
  readonly substrateRef: ContentDigest;
  /** The design-law "Environment E" — digest of the A009 environment. */
  readonly environmentRef: ContentDigest;
  /** The design-law "Runtime Profile R" — digest of the A003 runtime profile. */
  readonly runtimeProfileRef: ContentDigest;
  /** The DERIVED per-component summary (one entry per declared suite ref). */
  readonly componentVerdicts: ComponentVerdictSummary;
  /** The DERIVED certification verdict — never caller-supplied. */
  readonly verdict: CertificationVerdict;
  /** The DERIVED structured WHY of an unknown verdict (null iff verdict !== 'unknown'). */
  readonly unknownCause: UnknownCause | null;
  /** Declared constraints when verdict === 'conditional-pass'; [] otherwise. */
  readonly constraints: readonly NeutralText[];
  /** The DERIVED scoped statement (design-law form). */
  readonly statement: CertificationStatement;
  /** The run's correlation id (protocol-core, lock rule 17). */
  readonly correlationId: CorrelationId;
  /** The idempotency key of the command that authorized the run (lock rule 17). */
  readonly idempotencyKey: IdempotencyKey;
  /** Digest over the canonical run inputs — computed here. */
  readonly inputDigest: ContentDigest;
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
  'suiteRef',
  'possessionRef',
  'bodyVersionRef',
  'substrateRef',
  'environmentRef',
  'runtimeProfileRef',
  'componentVerdicts',
  'verdict',
  'unknownCause',
  'constraints',
  'statement',
  'correlationId',
  'idempotencyKey',
  'inputDigest',
  'startedAt',
  'finishedAt',
  'provenance',
] as const) as readonly string[];

export interface CreateCertificationRecordInput {
  readonly suiteRef: string;
  readonly possessionRef: string;
  readonly bodyVersionRef: string;
  readonly substrateRef: string;
  readonly environmentRef: string;
  readonly runtimeProfileRef: string;
  readonly componentVerdicts: readonly {
    readonly refKind: string;
    readonly refDigest: string;
    readonly verdict: string;
    readonly constraints: readonly string[] | null;
    readonly notes: string | null;
  }[];
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly provenance: {
    readonly executedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

function isDigestLike(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Structural (non-throwing) check for the digest-free view. */
export function isCertificationRecordView(
  value: unknown,
): value is CertificationRecordView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['recordVersion'] !== CERTIFICATION_RECORD_VERSION ||
    !isDigestLike(candidate['suiteRef']) ||
    !isDigestLike(candidate['possessionRef']) ||
    !isDigestLike(candidate['bodyVersionRef']) ||
    !isDigestLike(candidate['substrateRef']) ||
    !isDigestLike(candidate['environmentRef']) ||
    !isDigestLike(candidate['runtimeProfileRef']) ||
    !isComponentVerdictSummary(candidate['componentVerdicts']) ||
    !isCertificationVerdict(candidate['verdict'])
  ) {
    return false;
  }
  if (
    candidate['unknownCause'] !== null &&
    !isUnknownCause(candidate['unknownCause'])
  ) {
    return false;
  }
  if (
    (candidate['verdict'] === 'unknown') !== (candidate['unknownCause'] !== null)
  ) {
    return false;
  }
  if (!Array.isArray(candidate['constraints'])) return false;
  for (const c of candidate['constraints'] as unknown[]) {
    if (!isNeutralText(c)) return false;
  }
  if (!isCertificationStatement(candidate['statement'])) return false;
  if (!isCorrelationId(candidate['correlationId'])) return false;
  if (!isIdempotencyKey(candidate['idempotencyKey'])) return false;
  if (!isDigestLike(candidate['inputDigest'])) return false;
  if (!isCertificationTimestamp(candidate['startedAt'])) return false;
  if (!isCertificationTimestamp(candidate['finishedAt'])) return false;
  if (!isCertificationProvenance(candidate['provenance'])) return false;
  return true;
}

/** Structural (non-throwing) check for the full record (view + digest). */
export function isCertificationRecord(
  value: unknown,
): value is CertificationRecord {
  if (!isCertificationRecordView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isDigestLike(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed certification record —
 * the APPEND-ONCE result of one certification run.
 *
 * The verdict and the unknown cause are COMPUTED from the component summary
 * (never caller-supplied); the input digest is COMPUTED from (suiteRef +
 * possessionRef + componentVerdicts); the statement is BUILT from the
 * refs + derived verdict + derived constraints; the component summary
 * must be set-equal to the suite's declared refs (order is canonicalized
 * to suite component-declaration order); finished-at may not precede
 * started-at; the correlation id and idempotency key must be protocol-core
 * valid.
 */
export async function createCertificationRecord(
  input: CreateCertificationRecordInput,
  descriptor: CertificationSuiteDescriptor,
): Promise<CertificationRecord> {
  const record = expectFields(
    input,
    [
      'suiteRef',
      'possessionRef',
      'bodyVersionRef',
      'substrateRef',
      'environmentRef',
      'runtimeProfileRef',
      'componentVerdicts',
      'correlationId',
      'idempotencyKey',
      'startedAt',
      'finishedAt',
      'provenance',
    ],
    [],
    CERTIFICATION_ERROR_CODES.INVALID_RECORD,
    'certification record',
  );

  if (!isCertificationSuiteDescriptor(descriptor)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
      message: 'certification record creation requires a structurally valid suite descriptor',
    });
  }

  // The record's suiteRef must bind the EXACT descriptor supplied.
  const declaredSuiteRef =
    typeof record['suiteRef'] === 'string' ? record['suiteRef'] : '';
  if (declaredSuiteRef !== descriptor.digest) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.SCOPE_VIOLATION, {
      message: `certification record suiteRef ${JSON.stringify(declaredSuiteRef)} does not match the supplied descriptor (digest ${descriptor.digest}) — a record must bind the exact suite that ran`,
      details: { declared: declaredSuiteRef, actual: descriptor.digest },
    });
  }

  // Scope refs: all must be content digests.
  const possessionRef = toContentDigest(
    typeof record['possessionRef'] === 'string' ? record['possessionRef'] : '',
    'record possessionRef',
  );
  const bodyVersionRef = toContentDigest(
    typeof record['bodyVersionRef'] === 'string' ? record['bodyVersionRef'] : '',
    'record bodyVersionRef',
  );
  const substrateRef = toContentDigest(
    typeof record['substrateRef'] === 'string' ? record['substrateRef'] : '',
    'record substrateRef',
  );
  const environmentRef = toContentDigest(
    typeof record['environmentRef'] === 'string' ? record['environmentRef'] : '',
    'record environmentRef',
  );
  const runtimeProfileRef = toContentDigest(
    typeof record['runtimeProfileRef'] === 'string' ? record['runtimeProfileRef'] : '',
    'record runtimeProfileRef',
  );

  // Validate the component summary and enforce set-equality with the suite
  // declaration (every declared ref spoken for, no invented refs).
  const componentVerdicts = toComponentVerdictSummary(record['componentVerdicts']);
  const declared = suiteComponentRefs(descriptor).map(
    (entry) => `${entry.kind}:${entry.ref}`,
  );
  const spoken = componentVerdicts.map(
    (entry) => `${entry.refKind}:${entry.refDigest}`,
  );
  const declaredSet = new Set(declared);
  const spokenSet = new Set(spoken);
  for (const key of declared) {
    if (!spokenSet.has(key)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.COMPONENT_MISMATCH, {
        message: `component-verdict summary is missing an entry for declared suite ref ${JSON.stringify(key)} (every declared ref must be spoken for)`,
        details: { refKey: key, declared: [...declared] },
      });
    }
  }
  for (const key of spoken) {
    if (!declaredSet.has(key)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.COMPONENT_MISMATCH, {
        message: `component-verdict summary speaks for undeclared suite ref ${JSON.stringify(key)} (the suite declares: ${declared.join(', ')})`,
        details: { refKey: key, declared: [...declared] },
      });
    }
  }

  // Canonical order: suite's declaration order (digest stability).
  const order = new Map(declared.map((key, index) => [key, index]));
  const orderedSummary: ComponentVerdictSummary = Object.freeze(
    [...componentVerdicts].sort(
      (a, b) =>
        (order.get(`${a.refKind}:${a.refDigest}`) ?? -1) -
        (order.get(`${b.refKind}:${b.refDigest}`) ?? -1),
    ),
  );

  // DERIVED verdict + structured unknown cause (never caller-supplied).
  const { verdict, unknownCause } = deriveCertificationVerdict(orderedSummary);

  // DERIVED constraints: union of every pass component's declared constraints
  // (only meaningful when verdict === 'conditional-pass'; otherwise must be []).
  const constraintList: NeutralText[] = [];
  for (const entry of orderedSummary) {
    if (entry.verdict === 'pass' && entry.constraints !== null) {
      for (const c of entry.constraints) constraintList.push(c);
    }
  }
  const constraints =
    verdict === 'conditional-pass' ? Object.freeze(constraintList) : Object.freeze([] as NeutralText[]);

  // DERIVED scoped statement (never caller-supplied).
  const suiteRevision = descriptor.digest; // the design-law "revision X"
  const statement = buildCertificationStatement({
    bodyVersionRef,
    substrateRef,
    environmentRef,
    runtimeProfileRef,
    possessionRef,
    suiteRef: declaredSuiteRef,
    suiteRevision,
    verdict,
    constraints,
  });

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

  const inputDigest = await computeCertificationInputDigest(
    declaredSuiteRef,
    possessionRef,
    orderedSummary,
  );

  const view: CertificationRecordView = {
    recordVersion: CERTIFICATION_RECORD_VERSION,
    suiteRef: toContentDigest(declaredSuiteRef, 'certification record suiteRef'),
    possessionRef,
    bodyVersionRef,
    substrateRef,
    environmentRef,
    runtimeProfileRef,
    componentVerdicts: orderedSummary,
    verdict,
    unknownCause,
    constraints,
    statement,
    correlationId,
    idempotencyKey,
    inputDigest,
    startedAt,
    finishedAt,
    provenance: toCertificationProvenance(record['provenance']),
  };
  const digest = toContentDigest(
    await digestCanonical(view),
    'certification record digest',
  );
  return deepFreeze({ ...view, digest }) as CertificationRecord;
}

/** The digest-free view of a record (what the digest commits to). */
export function certificationRecordView(
  record: CertificationRecord,
): CertificationRecordView {
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
  if (
    actual !== record.digest ||
    (expectedDigest !== undefined && actual !== expectedDigest)
  ) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.TAMPERED, {
      message: `certification record digest mismatch: expected ${expectedDigest ?? record.digest}, got ${actual}`,
      details: {
        suiteRef: record.suiteRef,
        expected: expectedDigest ?? record.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed record digest');
}

/**
 * Replay a certification record's construction PURELY from its own inputs:
 * re-derives the verdict, unknown cause, constraints and statement from
 * the component summary and rebuilds the record, asserting the
 * byte-identical digest. Throws CERTIFICATION_TAMPERED when the recomputed
 * digest differs — the record is append-once, so a replay divergence
 * means tampering.
 */
export async function replayCertificationRecord(
  record: CertificationRecord,
  descriptor: CertificationSuiteDescriptor,
): Promise<CertificationRecord> {
  if (!isCertificationRecord(record)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'certification replay requires a structurally valid certification record',
    });
  }
  const rebuilt = await createCertificationRecord(
    {
      suiteRef: record.suiteRef,
      possessionRef: record.possessionRef,
      bodyVersionRef: record.bodyVersionRef,
      substrateRef: record.substrateRef,
      environmentRef: record.environmentRef,
      runtimeProfileRef: record.runtimeProfileRef,
      componentVerdicts: record.componentVerdicts.map((entry) => ({
        refKind: entry.refKind,
        refDigest: entry.refDigest,
        verdict: entry.verdict,
        constraints: entry.constraints === null ? null : [...entry.constraints],
        notes: entry.notes,
      })),
      correlationId: record.correlationId,
      idempotencyKey: record.idempotencyKey,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      provenance: {
        executedBy: record.provenance.executedBy,
        recordedAt: record.provenance.recordedAt,
        notes: record.provenance.notes,
      },
    },
    descriptor,
  );
  if (rebuilt.digest !== record.digest) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.TAMPERED, {
      message: `certification record replay diverged: record declares ${record.digest}, pure reconstruction yields ${rebuilt.digest}`,
      details: { declared: record.digest, reconstructed: rebuilt.digest },
    });
  }
  return rebuilt;
}
