/**
 * QualificationRecord + the pure qualification engine (Work Order A007;
 * requirement R7 "Qualify experts against evidence-backed competencies";
 * architecture-lock rules 6 and 9; spec/quality-model.md expert quality:
 * evidence per competency, recentness/freshness, conflicts/limitations).
 *
 * THE ENGINE IS PURE: `evaluateCompetencyClaim` derives the qualification
 * state of one claim under one declared policy at one evaluation time from
 * (claim, policy, evidence set, evaluatedAt) — no hidden state, no clock
 * reads, no network. The result is a frozen, content-addressed
 * QualificationRecord carrying the per-requirement sufficiency evidence
 * (counts, freshness, satisfied flags) — evidence DATA for audit, never
 * a compressed quality label and NEVER an authorization grant (lock rule
 * 9: the record is an input to matching and audit, nothing more).
 *
 * Derivation order (deterministic, closed status vocabulary):
 *   1. conflict first — evidence matching a policy conflict rule REVOKES
 *      the qualification regardless of positive evidence (load-bearing
 *      conflicts/limitations, spec/quality-model.md);
 *   2. per-requirement sufficiency — each requirement is satisfied iff
 *      the count of FRESH (within freshnessWindowDays), supersession-
 *      resolved evidence of the required kind >= minimumCount;
 *   3. status — all satisfied ⇒ `qualified` (validFrom/validUntil =
 *      evaluatedAt ± validityWindowDays); every requirement present in
 *      sufficient COUNT but not fresh ⇒ `stale`; otherwise
 *      `unqualified`.
 *
 * Renewal/decay (append-only, lock rule 6): qualification records carry
 * validFrom/validUntil; EXPIRY NEVER REWRITES HISTORY. A decay evaluation
 * after the window elapses APPENDS a new record —
 * `recordQualificationExpiry` builds the `expired` decay record that
 * supersedes the lapsed one; a successful re-qualification appends a new
 * `qualified` record (via `priorRecord`) with a fresh window. `supersedes`
 * chains lineage; records are never edited and stay addressable forever.
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_QUALIFICATION_ERROR_CODES, ExpertQualificationError } from './errors.js';
import { resolveActiveEvidenceDigests, isQualificationEvidence } from './evidence.js';
import type { QualificationEvidence, QualificationEvidenceKind } from './evidence.js';
import type { CompetencyClaim } from './claim.js';
import type { QualificationPolicy } from './policy.js';
import {
  deepFreeze,
  expectEnumMember,
  expectFields,
  isContentDigest,
  isExpertQualificationId,
  isExpertQualificationTimestamp,
  isNeutralText,
  toContentDigest,
  toExpertQualificationId,
  toExpertQualificationTimestamp,
  toNeutralText,
} from './shared.js';
import type {
  ContentDigest,
  ExpertQualificationId,
  NeutralText,
} from './shared.js';

/** Wire version of the qualification-record shape. */
export const QUALIFICATION_RECORD_VERSION = 1 as const;

/**
 * The CLOSED qualification status vocabulary. Statuses are DATA about the
 * evidence lifecycle of a competency claim; they grant NOTHING
 * (architecture-lock rule 9 — qualification is distinct from
 * authorization, and this vocabulary has no member that could be read as
 * permission):
 *   - `qualified` — evidence satisfies the declared policy, fresh, in the
 *     validity window (validFrom/validUntil present);
 *   - `unqualified` — at least one requirement lacks sufficient evidence
 *     even ignoring freshness;
 *   - `stale` — every requirement has sufficient evidence COUNT but at
 *     least one lacks sufficient FRESH evidence (recency decay);
 *   - `expired` — a decay record appended when a prior qualification's
 *     validity window elapsed (append-only; never rewrites the prior
 *     record);
 *   - `revoked` — conflicting evidence (a policy conflict rule matched)
 *     withdraws the qualification regardless of positive evidence.
 */
export const QUALIFICATION_STATUSES = Object.freeze([
  'qualified',
  'unqualified',
  'stale',
  'expired',
  'revoked',
] as const);

export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number];

export function isQualificationStatus(value: unknown): value is QualificationStatus {
  return (
    typeof value === 'string' &&
    (QUALIFICATION_STATUSES as readonly string[]).includes(value)
  );
}

/** Stable field list for the record (tests + contracts mirror it). */
export const QUALIFICATION_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'claimDigest',
  'policyDigest',
  'status',
  'evaluatedAt',
  'requirementOutcomes',
  'qualifyingEvidence',
  'conflictEvidence',
  'validFrom',
  'validUntil',
  'supersedes',
  'note',
  'digest',
] as const) as readonly string[];

/** Stable field list for one per-requirement outcome. */
export const REQUIREMENT_OUTCOME_FIELDS = Object.freeze([
  'requirementId',
  'evidenceKind',
  'requiredCount',
  'presentCount',
  'freshCount',
  'satisfied',
  'reason',
] as const);

/**
 * The per-requirement sufficiency evidence: the policy's demand, the
 * evidence-set's supply (total and fresh counts, after supersession
 * resolution) and the satisfied flag. No scores, no aggregates — counts
 * and booleans ONLY (spec/quality-model.md: do not collapse expert
 * quality into a single score).
 */
export interface RequirementOutcome {
  readonly requirementId: ExpertQualificationId;
  readonly evidenceKind: QualificationEvidenceKind;
  readonly requiredCount: number;
  /** Evidence of the kind present in the set (supersession-resolved). */
  readonly presentCount: number;
  /** Evidence of the kind within the freshness window (supersession-resolved). */
  readonly freshCount: number;
  readonly satisfied: boolean;
  /** Why the requirement is unsatisfied (null when satisfied). */
  readonly reason: NeutralText | null;
}

/** The digest-free view — exactly what the record digest commits to. */
export interface QualificationRecordView {
  readonly recordVersion: typeof QUALIFICATION_RECORD_VERSION;
  /** The qualified claim (content-addressed). */
  readonly claimDigest: ContentDigest;
  /** The policy under which the claim was evaluated (content-addressed). */
  readonly policyDigest: ContentDigest;
  readonly status: QualificationStatus;
  /** The fixed evaluation time (determinism anchor). */
  readonly evaluatedAt: string;
  readonly requirementOutcomes: readonly RequirementOutcome[];
  /** The fresh evidence digests that satisfied requirements (sorted). */
  readonly qualifyingEvidence: readonly ContentDigest[];
  /** The conflict evidence digests that drove a revocation (sorted). */
  readonly conflictEvidence: readonly ContentDigest[];
  /** Present iff status === 'qualified'. */
  readonly validFrom?: string;
  /** Present iff status === 'qualified'. */
  readonly validUntil?: string;
  /** The prior record this one supersedes (append-only chains). */
  readonly supersedes?: ContentDigest;
  readonly note?: NeutralText;
}

/** A frozen, content-addressed qualification record: view + digest. */
export interface QualificationRecord extends QualificationRecordView {
  readonly digest: ContentDigest;
}

/** Structural (non-throwing) check for one requirement outcome. */
export function isRequirementOutcome(value: unknown): value is RequirementOutcome {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isExpertQualificationId(candidate['requirementId']) &&
    typeof candidate['evidenceKind'] === 'string' &&
    typeof candidate['requiredCount'] === 'number' &&
    Number.isInteger(candidate['requiredCount']) &&
    typeof candidate['presentCount'] === 'number' &&
    Number.isInteger(candidate['presentCount']) &&
    typeof candidate['freshCount'] === 'number' &&
    Number.isInteger(candidate['freshCount']) &&
    typeof candidate['satisfied'] === 'boolean' &&
    (candidate['reason'] === null || isNeutralText(candidate['reason']))
  );
}

/** Structural (non-throwing) check for the digest-free view. */
export function isQualificationRecordView(value: unknown): value is QualificationRecordView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['recordVersion'] !== QUALIFICATION_RECORD_VERSION ||
    !isContentDigest(candidate['claimDigest']) ||
    !isContentDigest(candidate['policyDigest']) ||
    !isQualificationStatus(candidate['status']) ||
    !isExpertQualificationTimestamp(candidate['evaluatedAt'])
  ) {
    return false;
  }
  const outcomes = candidate['requirementOutcomes'];
  if (!Array.isArray(outcomes)) {
    return false;
  }
  // Expiry (decay) records carry NO requirement outcomes — they document
  // the lapse of a prior qualified record, not a fresh evaluation.
  if (candidate['status'] !== 'expired' && outcomes.length === 0) {
    return false;
  }
  if (!outcomes.every((entry) => isRequirementOutcome(entry))) {
    return false;
  }
  for (const field of ['qualifyingEvidence', 'conflictEvidence']) {
    const list = candidate[field];
    if (
      !Array.isArray(list) ||
      !list.every((digest) => isContentDigest(digest))
    ) {
      return false;
    }
  }
  if (candidate['status'] === 'qualified') {
    if (
      !isExpertQualificationTimestamp(candidate['validFrom']) ||
      !isExpertQualificationTimestamp(candidate['validUntil'])
    ) {
      return false;
    }
  }
  if (candidate['supersedes'] !== undefined && !isContentDigest(candidate['supersedes'])) {
    return false;
  }
  if (candidate['note'] !== undefined && !isNeutralText(candidate['note'])) {
    return false;
  }
  return true;
}

/** Structural (non-throwing) check for the full record (view + digest). */
export function isQualificationRecord(value: unknown): value is QualificationRecord {
  if (!isQualificationRecordView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

// ---------------------------------------------------------------------------
// Freshness math (pure, ms-precision UTC)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** True iff `observedAt` is within `freshnessWindowDays` of `evaluatedAt`. */
export function isEvidenceFresh(
  observedAt: string,
  evaluatedAt: string,
  freshnessWindowDays: number,
): boolean {
  const observed = Date.parse(observedAt);
  const evaluated = Date.parse(evaluatedAt);
  if (Number.isNaN(observed) || Number.isNaN(evaluated)) return false;
  const ageMs = evaluated - observed;
  return ageMs >= 0 && ageMs <= freshnessWindowDays * DAY_MS;
}

/** validUntil = evaluatedAt + validityWindowDays (ms-precision UTC). */
export function computeValidUntil(
  evaluatedAt: string,
  validityWindowDays: number,
): string {
  return new Date(Date.parse(evaluatedAt) + validityWindowDays * DAY_MS).toISOString();
}

/**
 * True iff the record is a `qualified` record whose validity window covers
 * `at` (renewal/decay semantics: a qualified record stops being in force
 * the instant its validUntil elapses; the record itself is never edited).
 */
export function isQualificationInForce(record: QualificationRecord, at: string): boolean {
  if (record.status !== 'qualified') return false;
  const from = record.validFrom;
  const until = record.validUntil;
  if (from === undefined || until === undefined) return false;
  const atMs = Date.parse(at);
  const fromMs = Date.parse(from);
  const untilMs = Date.parse(until);
  if (Number.isNaN(atMs) || Number.isNaN(fromMs) || Number.isNaN(untilMs)) return false;
  return atMs >= fromMs && atMs < untilMs;
}

// ---------------------------------------------------------------------------
// The pure qualification engine
// ---------------------------------------------------------------------------

export interface EvaluateCompetencyClaimInput {
  readonly claim: CompetencyClaim;
  readonly policy: QualificationPolicy;
  /** The evidence records referenced by the claim (superset-safe: all claim digests MUST be present). */
  readonly evidence: readonly QualificationEvidence[];
  /** The fixed evaluation time (determinism anchor; no clock reads). */
  readonly evaluatedAt: string;
  /** The prior record being renewed (optional; sets the supersedes chain). */
  readonly priorRecord?: QualificationRecord;
  /** Optional free-form note recorded onto the record. */
  readonly note?: string;
}

/** Build the per-requirement outcomes for a supersession-resolved evidence set. */
function buildRequirementOutcomes(
  policy: QualificationPolicy,
  activeEvidence: readonly QualificationEvidence[],
  evaluatedAt: string,
): readonly RequirementOutcome[] {
  return Object.freeze(
    policy.requirements.map((requirement) => {
      const ofKind = activeEvidence.filter((record) => record.kind === requirement.evidenceKind);
      const fresh = ofKind.filter((record) =>
        isEvidenceFresh(record.observedAt, evaluatedAt, policy.freshnessWindowDays),
      );
      const satisfied = fresh.length >= requirement.minimumCount;
      let reason: NeutralText | null = null;
      if (!satisfied) {
        const text =
          ofKind.length >= requirement.minimumCount
            ? `requirement ${requirement.requirementId} has ${ofKind.length} ${requirement.evidenceKind} evidence item(s) but only ${fresh.length} within the ${policy.freshnessWindowDays}-day freshness window (needs ${requirement.minimumCount} fresh)`
            : `requirement ${requirement.requirementId} has ${ofKind.length} ${requirement.evidenceKind} evidence item(s) (needs ${requirement.minimumCount})`;
        reason = toNeutralText(text, 'requirement outcome reason');
      }
      return Object.freeze({
        requirementId: requirement.requirementId,
        evidenceKind: requirement.evidenceKind,
        requiredCount: requirement.minimumCount,
        presentCount: ofKind.length,
        freshCount: fresh.length,
        satisfied,
        reason,
      }) satisfies RequirementOutcome;
    }),
  );
}

function conflictMatches(
  evidence: QualificationEvidence,
  rule: { evidenceKind: QualificationEvidenceKind; outcome: string | null },
): boolean {
  if (evidence.kind !== rule.evidenceKind) return false;
  if (rule.outcome === null) return true;
  // Outcome constraints apply to verification refs (the only kind with an outcome).
  return evidence.verification?.outcome === rule.outcome;
}

/**
 * Evaluate one competency claim under one declared policy at one fixed
 * time. PURE AND DETERMINISTIC: identical inputs ⇒ identical record
 * digest. Throws typed errors for structurally inconsistent inputs
 * (missing evidence for the claim, mismatched prior record) — failing
 * loudly instead of silently best-effort.
 */
export async function evaluateCompetencyClaim(
  input: EvaluateCompetencyClaimInput,
): Promise<QualificationRecord> {
  const record = expectFields(
    input,
    ['claim', 'policy', 'evidence', 'evaluatedAt'],
    ['priorRecord', 'note'],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD,
    'qualification evaluation',
  );

  const { claim, policy } = record as { claim: CompetencyClaim; policy: QualificationPolicy };
  const evaluatedAt = toExpertQualificationTimestamp(
    typeof record['evaluatedAt'] === 'string' ? record['evaluatedAt'] : '',
    'qualification evaluation evaluatedAt',
  );

  if (!Array.isArray(record['evidence'])) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
      message: 'qualification evaluation requires an evidence record array',
      details: { field: 'evidence' },
    });
  }
  const evidence = record['evidence'] as readonly QualificationEvidence[];
  for (const item of evidence) {
    if (!isQualificationEvidence(item)) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
        message: 'qualification evaluation requires structurally valid evidence records',
      });
    }
  }

  // Every evidence digest the claim references MUST be present — fail
  // loudly, never evaluate a claim against partial evidence.
  const available = new Set(evidence.map((item) => item.digest));
  const missing = claim.evidence.filter((digest) => !available.has(digest));
  if (missing.length > 0) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.MISSING_EVIDENCE, {
      message: `qualification evaluation is missing ${missing.length} evidence record(s) referenced by the claim (fail loudly — never evaluate against partial evidence)`,
      details: { claimDigest: claim.digest, missing: [...missing] },
    });
  }

  const priorRecord = record['priorRecord'] as QualificationRecord | undefined;
  if (priorRecord !== undefined) {
    if (!isQualificationRecord(priorRecord)) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD, {
        message: 'priorRecord, when present, must be a structurally valid qualification record',
      });
    }
    if (priorRecord.claimDigest !== claim.digest) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.SUPERSESSION_CONFLICT, {
        message: `a renewal record must supersede a record of the SAME claim (prior claim ${priorRecord.claimDigest}, renewed claim ${claim.digest} — a re-claim starts a fresh chain)`,
        details: { priorClaimDigest: priorRecord.claimDigest, claimDigest: claim.digest },
      });
    }
  }

  // Supersession resolution: superseded evidence stays for audit but does
  // not count (lock rule 6 — append-only discipline).
  const activeDigests = new Set(resolveActiveEvidenceDigests(evidence));
  const activeEvidence = evidence.filter((item) => activeDigests.has(item.digest));

  // 1. Conflict first — revocation regardless of positive evidence.
  const conflictEvidence = Object.freeze(
    activeEvidence
      .filter((item) =>
        policy.conflictEvidence.some((rule) => conflictMatches(item, rule)),
      )
      .map((item) => item.digest)
      .sort(),
  );

  const requirementOutcomes =
    conflictEvidence.length > 0
      ? Object.freeze(
          policy.requirements.map((requirement) => {
            const ofKind = activeEvidence.filter(
              (record) => record.kind === requirement.evidenceKind,
            );
            const fresh = ofKind.filter((record) =>
              isEvidenceFresh(record.observedAt, evaluatedAt, policy.freshnessWindowDays),
            );
            return Object.freeze({
              requirementId: requirement.requirementId,
              evidenceKind: requirement.evidenceKind,
              requiredCount: requirement.minimumCount,
              presentCount: ofKind.length,
              freshCount: fresh.length,
              satisfied: false,
              reason: toNeutralText(
                'conflict evidence revoked the qualification before sufficiency was assessed',
                'requirement outcome reason',
              ),
            }) satisfies RequirementOutcome;
          }),
        )
      : buildRequirementOutcomes(policy, activeEvidence, evaluatedAt);

  const status: QualificationStatus =
    conflictEvidence.length > 0
      ? 'revoked'
      : requirementOutcomes.every((outcome) => outcome.satisfied)
        ? 'qualified'
        : requirementOutcomes.every(
              (outcome) => outcome.presentCount >= outcome.requiredCount,
            )
            ? 'stale'
            : 'unqualified';

  const qualifyingEvidence = Object.freeze(
    conflictEvidence.length > 0
      ? []
      : requirementOutcomes
          .filter((outcome) => outcome.satisfied)
          .flatMap((outcome) =>
            activeEvidence
              .filter(
                (item) =>
                  item.kind === outcome.evidenceKind &&
                  isEvidenceFresh(item.observedAt, evaluatedAt, policy.freshnessWindowDays),
              )
              .map((item) => item.digest),
          )
          .sort()
          .filter((digest, index, list) => list.indexOf(digest) === index),
  );

  const note: NeutralText | undefined =
    record['note'] === undefined
      ? undefined
      : toNeutralText(
          typeof record['note'] === 'string' ? record['note'] : '',
          'qualification record note',
        );

  const validFrom = status === 'qualified' ? evaluatedAt : undefined;
  const validUntil =
    status === 'qualified' ? computeValidUntil(evaluatedAt, policy.validityWindowDays) : undefined;

  const view: QualificationRecordView = {
    recordVersion: QUALIFICATION_RECORD_VERSION,
    claimDigest: claim.digest,
    policyDigest: policy.digest,
    status,
    evaluatedAt,
    requirementOutcomes,
    qualifyingEvidence,
    conflictEvidence,
    ...(validFrom !== undefined ? { validFrom } : {}),
    ...(validUntil !== undefined ? { validUntil } : {}),
    ...(priorRecord !== undefined ? { supersedes: priorRecord.digest } : {}),
    ...(note !== undefined ? { note } : {}),
  };

  const digest = toContentDigest(
    await digestCanonical(view),
    'qualification record digest',
  );
  return deepFreeze({ ...view, digest }) as QualificationRecord;
}

/**
 * Build the DECAY record for a qualification whose validity window has
 * elapsed (renewal/decay modeling — expiry NEVER rewrites history: this
 * APPENDS a new record that supersedes the lapsed one; the lapsed record
 * keeps its `qualified` status and its own window forever).
 *
 * Fails loudly (typed errors) when the prior record is not a qualified
 * record, or when `evaluatedAt` is still inside the prior validity
 * window (nothing has decayed yet).
 */
export async function recordQualificationExpiry(
  priorRecord: QualificationRecord,
  evaluatedAt: string,
  note?: string,
): Promise<QualificationRecord> {
  if (!isQualificationRecord(priorRecord)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'qualification expiry requires a structurally valid qualification record',
    });
  }
  if (priorRecord.status !== 'qualified') {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: `only a qualified record can decay (prior status: ${priorRecord.status})`,
      details: { priorStatus: priorRecord.status },
    });
  }
  const at = toExpertQualificationTimestamp(evaluatedAt, 'qualification expiry evaluatedAt');
  if (isQualificationInForce(priorRecord, at)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: `the qualification is still in force at ${JSON.stringify(at)} (valid until ${priorRecord.validUntil}) — nothing has decayed`,
      details: { evaluatedAt: at, validUntil: priorRecord.validUntil },
    });
  }

  const safeNote = note === undefined ? undefined : toNeutralText(note, 'qualification expiry note');

  const view: QualificationRecordView = {
    recordVersion: QUALIFICATION_RECORD_VERSION,
    claimDigest: priorRecord.claimDigest,
    policyDigest: priorRecord.policyDigest,
    status: 'expired',
    evaluatedAt: at,
    requirementOutcomes: [],
    qualifyingEvidence: [],
    conflictEvidence: [],
    supersedes: priorRecord.digest,
    ...(safeNote !== undefined ? { note: safeNote } : {}),
  };

  const digest = toContentDigest(
    await digestCanonical(view),
    'qualification expiry record digest',
  );
  return deepFreeze({ ...view, digest }) as QualificationRecord;
}

/** The digest-free view of a record (what the digest commits to). */
export function qualificationRecordView(
  record: QualificationRecord,
): QualificationRecordView {
  const { digest: _digest, ...view } = record;
  return deepFreeze({ ...view }) as QualificationRecordView;
}

/**
 * Recompute the record digest over the digest-free view and compare.
 * Throws EXPERT_QUALIFICATION_TAMPERED on any mismatch.
 */
export async function recomputeQualificationRecordDigest(
  record: QualificationRecord,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isQualificationRecord(record)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'record digest recomputation requires a structurally valid qualification record',
    });
  }
  const actual = await digestCanonical(qualificationRecordView(record));
  if (actual !== record.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.TAMPERED, {
      message: `qualification record digest mismatch: expected ${expectedDigest ?? record.digest}, got ${actual}`,
      details: {
        claimDigest: record.claimDigest,
        status: record.status,
        expected: expectedDigest ?? record.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed record digest');
}

/**
 * Parse and validate an unknown value as a QualificationRecord (strict
 * shape, closed vocabulary, digest recomputation). The replay path for
 * wire records — fails loudly on any drift.
 */
export async function replayQualificationRecord(value: unknown): Promise<QualificationRecord> {
  const record = expectFields(
    value,
    [
      'recordVersion',
      'claimDigest',
      'policyDigest',
      'status',
      'evaluatedAt',
      'requirementOutcomes',
      'qualifyingEvidence',
      'conflictEvidence',
      'digest',
    ],
    ['validFrom', 'validUntil', 'supersedes', 'note'],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD,
    'qualification record replay',
  );

  if (record['recordVersion'] !== QUALIFICATION_RECORD_VERSION) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `unsupported qualification record wire version: ${String(record['recordVersion'])} (expected ${QUALIFICATION_RECORD_VERSION})`,
      details: { field: 'recordVersion' },
    });
  }
  const status = expectEnumMember(
    record['status'],
    QUALIFICATION_STATUSES,
    'status',
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD,
    'qualification record replay',
  );
  if (status === 'qualified' && (record['validFrom'] === undefined || record['validUntil'] === undefined)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'a qualified record must carry validFrom and validUntil',
    });
  }
  if (status !== 'qualified' && (record['validFrom'] !== undefined || record['validUntil'] !== undefined)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: `only qualified records carry validFrom/validUntil (status: ${status})`,
    });
  }

  const outcomes = Array.isArray(record['requirementOutcomes'])
    ? record['requirementOutcomes']
    : [];
  if (status === 'expired' ? outcomes.length !== 0 : outcomes.length === 0) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'the requirement-outcome list is required except on expiry (decay) records, which carry none',
      details: { status, outcomeCount: outcomes.length },
    });
  }
  for (const outcome of outcomes) {
    const parsed = expectFields(
      outcome,
      REQUIREMENT_OUTCOME_FIELDS as unknown as readonly string[],
      [],
      EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD,
      'qualification record requirement outcome',
    );
    toExpertQualificationId(
      typeof parsed['requirementId'] === 'string' ? parsed['requirementId'] : '',
      'requirement outcome requirementId',
    );
    expectEnumMember(
      parsed['evidenceKind'],
      ['credential-ref', 'work-product-ref', 'verification-ref', 'evaluation-ref'],
      'evidenceKind',
      EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD,
      'requirement outcome',
    );
  }

  toContentDigest(
    typeof record['claimDigest'] === 'string' ? record['claimDigest'] : '',
    'record replay claimDigest',
  );
  toContentDigest(
    typeof record['policyDigest'] === 'string' ? record['policyDigest'] : '',
    'record replay policyDigest',
  );
  toExpertQualificationTimestamp(
    typeof record['evaluatedAt'] === 'string' ? record['evaluatedAt'] : '',
    'record replay evaluatedAt',
  );
  const digest = toContentDigest(
    typeof record['digest'] === 'string' ? record['digest'] : '',
    'record replay digest',
  );

  // The strict-shape, vocabulary and digest validations above have all
  // passed; the record's own object (already frozen by the constructor,
  // or structurally validated here for wire inputs) is the replay result.
  const candidate = deepFreeze({
    ...record,
    digest,
  }) as unknown as QualificationRecord;
  if (!isQualificationRecord(candidate)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'the replayed record is not structurally valid',
    });
  }
  await recomputeQualificationRecordDigest(candidate);
  if (isQualificationRecord(value)) {
    // The input was already a validated record object — replay is the
    // identity on it (reference-stable for callers holding the original).
    return value;
  }
  return candidate;
}
