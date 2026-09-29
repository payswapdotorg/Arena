/**
 * ExtractionRunRecord — the APPEND-ONCE, digest-addressed record of one
 * extraction run (Work Order A019; requirement R17; architecture-lock
 * rules 6, 17, 18 — append-only history, idempotent +
 * correlation-addressable runs, provenance-addressed artifacts).
 *
 * A run record binds:
 *   - `runKey` / `correlationId` — the protocol-core addressability
 *     pair (lock rule 17): the idempotency key of the command that
 *     authorized the run and the causal correlation id. Re-running
 *     with the SAME key returns the recorded result, never a
 *     duplicate; the same key with a DIFFERENT command is a conflict;
 *   - `policyRef` — the digest of the ExtractionPolicy that ran;
 *   - `inputs` — the digests of the ValidatedTrajectoryRefs mined, in
 *     input order (the deterministic input address);
 *   - `decisions` — the recorded per-trajectory and per-pattern
 *     accept/reject decisions with their closed-vocabulary reasons
 *     (the mining core's full decision log);
 *   - `candidates` — the digests of the accepted SkillCandidates;
 *   - `drafts` — the digests of the emitted SkillDrafts (paired 1:1
 *     with the accepted candidates);
 *   - `extractorVersion` + run provenance — who ran, when, notes.
 *
 * Construction is pure: identical inputs yield the identical record
 * digest (byte-identical replay). Frozen on creation — no mutation
 * API; the ledger keeps every record addressable by digest forever.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { isCorrelationId, isIdempotencyKey } from '@arena/protocol-core';
import {
  isSkillCandidate,
  isSkillDraft,
  PATTERN_DECISION_REASONS,
  TRAJECTORY_DECISION_REASONS,
  SKILL_EXTRACTION_ERROR_CODES,
  SkillExtractionError,
} from '@arena/skill-extraction';
import type {
  PatternDecision,
  SkillCandidate,
  SkillDraft,
  TrajectoryDecision,
} from '@arena/skill-extraction';

/** Wire version of the extraction-run-record shape. */
export const EXTRACTION_RUN_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Run provenance
// ---------------------------------------------------------------------------

/** Provenance of one extraction run. */
export interface ExtractionRunProvenance {
  /** Neutral identity of the executing extractor instance/principal. */
  readonly executedBy: string;
  /** When the record was recorded (ms-precision UTC). */
  readonly recordedAt: string;
  /** Optional free-form notes. */
  readonly notes: string | null;
}

const NEUTRAL_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const NEUTRAL_TEXT_PATTERN = /^[\x20-\x7E\n\t]{1,4096}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function toRunProvenance(value: ExtractionRunProvenance): ExtractionRunProvenance {
  if (typeof value !== 'object' || value === null) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'extraction run provenance must be a plain object',
    });
  }
  if (
    typeof value.executedBy !== 'string' ||
    !NEUTRAL_ID_PATTERN.test(value.executedBy) ||
    typeof value.recordedAt !== 'string' ||
    !TIMESTAMP_PATTERN.test(value.recordedAt) ||
    Number.isNaN(Date.parse(value.recordedAt)) ||
    (value.notes !== null && (typeof value.notes !== 'string' || !NEUTRAL_TEXT_PATTERN.test(value.notes)))
  ) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'extraction run provenance: invalid executedBy/recordedAt/notes',
    });
  }
  return Object.freeze({ ...value });
}

// ---------------------------------------------------------------------------
// ExtractionRunRecord
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the run-record digest commits to. */
export interface ExtractionRunRecordView {
  readonly recordVersion: typeof EXTRACTION_RUN_RECORD_VERSION;
  readonly runKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
  readonly extractorVersion: string;
  /** Digest of the ExtractionPolicy that ran. */
  readonly policyRef: string;
  /** Digests of the mined ValidatedTrajectoryRefs, in input order. */
  readonly inputs: readonly string[];
  readonly trajectoryDecisions: readonly TrajectoryDecision[];
  readonly patternDecisions: readonly PatternDecision[];
  /** Digests of the accepted SkillCandidates (candidate order). */
  readonly candidates: readonly string[];
  /** Digests of the emitted SkillDrafts (paired with candidates). */
  readonly drafts: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly provenance: ExtractionRunProvenance;
}

/** A frozen, content-addressed extraction run record: the view plus its sha256 digest. */
export interface ExtractionRunRecord extends ExtractionRunRecordView {
  readonly digest: string;
}

/** Stable field list for the run-record view (tests mirror it). */
export const EXTRACTION_RUN_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'runKey',
  'correlationId',
  'extractorVersion',
  'policyRef',
  'inputs',
  'trajectoryDecisions',
  'patternDecisions',
  'candidates',
  'drafts',
  'startedAt',
  'finishedAt',
  'provenance',
] as const) as readonly string[];

/** Structural (non-throwing) check for the digest-free run-record view. */
export function isExtractionRunRecordView(value: unknown): value is ExtractionRunRecordView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const digestList = (v: unknown): boolean =>
    Array.isArray(v) && v.every((entry) => typeof entry === 'string' && DIGEST_PATTERN.test(entry));
  const decisionList = (v: unknown, reasons: readonly string[]): boolean =>
    Array.isArray(v) &&
    v.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record<string, unknown>)['reason'] === 'string' &&
        reasons.includes(String((entry as Record<string, unknown>)['reason'])),
    );
  return (
    candidate['recordVersion'] === EXTRACTION_RUN_RECORD_VERSION &&
    isIdempotencyKey(candidate['runKey']) &&
    isCorrelationId(candidate['correlationId']) &&
    typeof candidate['extractorVersion'] === 'string' &&
    typeof candidate['policyRef'] === 'string' &&
    DIGEST_PATTERN.test(String(candidate['policyRef'])) &&
    digestList(candidate['inputs']) &&
    decisionList(candidate['trajectoryDecisions'], [...TRAJECTORY_DECISION_REASONS]) &&
    decisionList(candidate['patternDecisions'], [...PATTERN_DECISION_REASONS]) &&
    digestList(candidate['candidates']) &&
    digestList(candidate['drafts']) &&
    typeof candidate['startedAt'] === 'string' &&
    TIMESTAMP_PATTERN.test(String(candidate['startedAt'])) &&
    typeof candidate['finishedAt'] === 'string' &&
    TIMESTAMP_PATTERN.test(String(candidate['finishedAt'])) &&
    typeof candidate['provenance'] === 'object' &&
    candidate['provenance'] !== null
  );
}

/** Structural (non-throwing) check for the full run record (view + digest). */
export function isExtractionRunRecord(value: unknown): value is ExtractionRunRecord {
  if (!isExtractionRunRecordView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate['digest'] === 'string' && DIGEST_PATTERN.test(candidate['digest']);
}

/** Inputs to the run-record constructor. */
export interface CreateExtractionRunRecordInput {
  readonly runKey: string;
  readonly correlationId: string;
  readonly extractorVersion: string;
  readonly policyRef: string;
  readonly inputs: readonly string[];
  readonly trajectoryDecisions: readonly TrajectoryDecision[];
  readonly patternDecisions: readonly PatternDecision[];
  readonly candidates: readonly SkillCandidate[];
  readonly drafts: readonly SkillDraft[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly provenance: ExtractionRunProvenance;
}

/**
 * Create a validated, deep-frozen, content-addressed extraction run
 * record. Validates the addressability pair (lock rule 17), the
 * digest lists, the decision log (closed reason vocabularies), the
 * candidate/draft pairing (REAL package guards), timestamp ordering
 * and provenance. Pure: identical inputs ⇒ identical digest.
 */
export async function createExtractionRunRecord(
  input: CreateExtractionRunRecordInput,
): Promise<ExtractionRunRecord> {
  if (typeof input !== 'object' || input === null) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, {
      message: 'extraction run record creation requires an input object',
    });
  }
  if (!isIdempotencyKey(input.runKey)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, {
      message: `extraction run record: invalid run key (idempotency key): ${JSON.stringify(input.runKey)}`,
    });
  }
  if (!isCorrelationId(input.correlationId)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, {
      message: `extraction run record: invalid correlation id: ${JSON.stringify(input.correlationId)}`,
    });
  }
  if (typeof input.policyRef !== 'string' || !DIGEST_PATTERN.test(input.policyRef)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, {
      message: 'extraction run record: policyRef must be a sha256 digest',
    });
  }
  if (!Array.isArray(input.inputs) || input.inputs.length === 0) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, {
      message: 'extraction run record: inputs must be a non-empty digest list',
    });
  }
  for (const entry of input.inputs) {
    if (typeof entry !== 'string' || !DIGEST_PATTERN.test(entry)) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, {
        message: 'extraction run record: inputs must be sha256 digests',
      });
    }
  }
  for (const candidate of input.candidates) {
    if (!isSkillCandidate(candidate)) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_CANDIDATE, {
        message: 'extraction run record: candidates must be structurally valid skill candidates',
      });
    }
  }
  if (input.drafts.length !== input.candidates.length) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, {
      message: `extraction run record: drafts must pair 1:1 with candidates (got ${String(input.candidates.length)} candidates and ${String(input.drafts.length)} drafts)`,
    });
  }
  for (const draft of input.drafts) {
    if (!isSkillDraft(draft)) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_DRAFT, {
        message: 'extraction run record: drafts must be structurally valid skill drafts',
      });
    }
  }
  if (
    typeof input.startedAt !== 'string' ||
    !TIMESTAMP_PATTERN.test(input.startedAt) ||
    Number.isNaN(Date.parse(input.startedAt))
  ) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_TIMESTAMP, {
      message: 'extraction run record: startedAt must be an ms-precision UTC timestamp',
    });
  }
  if (
    typeof input.finishedAt !== 'string' ||
    !TIMESTAMP_PATTERN.test(input.finishedAt) ||
    Number.isNaN(Date.parse(input.finishedAt))
  ) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_TIMESTAMP, {
      message: 'extraction run record: finishedAt must be an ms-precision UTC timestamp',
    });
  }
  if (Date.parse(input.finishedAt) < Date.parse(input.startedAt)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.TIMESTAMP_REGRESSION, {
      message: `extraction run record: finishedAt ${input.finishedAt} precedes startedAt ${input.startedAt}`,
    });
  }
  const provenance = toRunProvenance(input.provenance);

  const view: ExtractionRunRecordView = {
    recordVersion: EXTRACTION_RUN_RECORD_VERSION,
    runKey: input.runKey,
    correlationId: input.correlationId,
    extractorVersion: input.extractorVersion,
    policyRef: input.policyRef,
    inputs: Object.freeze([...input.inputs]),
    trajectoryDecisions: Object.freeze([...input.trajectoryDecisions]),
    patternDecisions: Object.freeze([...input.patternDecisions]),
    candidates: Object.freeze(input.candidates.map((candidate) => candidate.digest as string)),
    drafts: Object.freeze(input.drafts.map((draft) => draft.digest as string)),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    provenance,
  };
  const digest = await digestCanonical(view);
  const record = { ...view, digest };
  Object.freeze(record);
  return record;
}

/** The digest-free view of a run record (what the digest commits to). */
export function extractionRunRecordView(record: ExtractionRunRecord): ExtractionRunRecordView {
  const { digest: _digest, ...view } = record;
  return Object.freeze({ ...view }) as ExtractionRunRecordView;
}

/**
 * Verify a run record: recompute the digest over the digest-free view
 * and compare (optionally against an expected digest). Throws
 * SKILL_EXTRACTION_TAMPERED on any mismatch — the append-once
 * content-addressing tripwire.
 */
export async function verifyExtractionRunRecord(
  record: ExtractionRunRecord,
  expectedDigest?: string,
): Promise<string> {
  if (!isExtractionRunRecord(record)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, {
      message: 'run-record verification requires a structurally valid extraction run record',
    });
  }
  const actual = await digestCanonical(extractionRunRecordView(record));
  const claimed = expectedDigest ?? record.digest;
  if (actual !== claimed) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.TAMPERED, {
      message: `extraction run record digest mismatch: expected ${claimed}, recomputed ${actual}`,
      details: { runKey: record.runKey, expected: claimed, actual },
    });
  }
  return actual;
}
