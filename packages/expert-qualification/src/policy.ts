/**
 * QualificationPolicy — the versioned, content-addressed rules stating
 * WHAT EVIDENCE QUALIFIES a competency claim (Work Order A007; requirement
 * R7; spec/quality-model.md expert quality: evidence per competency,
 * recentness/freshness, conflicts/limitations).
 *
 * A policy declares:
 *   - `requirements` — per-evidence-kind minimum counts (requirement ids
 *     unique, counts positive). Only evidence of the declared kind that is
 *     FRESH counts toward a requirement;
 *   - `freshnessWindowDays` — the recency bound: evidence observed more
 *     than this many days before the evaluation time is STALE (counts for
 *     presence, not for sufficiency);
 *   - `validityWindowDays` — how long a freshly computed `qualified`
 *     record stays in force (renewal/decay modeling);
 *   - `conflictEvidence` — the CLOSED conflict rules: evidence of a
 *     declared kind (optionally with a declared outcome, for
 *     verification refs) REVOKES the qualification regardless of positive
 *     evidence (spec/quality-model.md "conflicts/limitations" — conflict
 *     evidence is maintained and load-bearing).
 *
 * The policy is DATA about evidence adjudication. It grants NOTHING
 * (architecture-lock rule 9): it is an input to qualification computation
 * and audit, never an authorization. Same policy ⇒ same digest; changing
 * a policy requires a new version (identity conflicts are detected at
 * registration in the reference fabric).
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_QUALIFICATION_ERROR_CODES, ExpertQualificationError } from './errors.js';
import {
  deepFreeze,
  expectEnumMember,
  expectFields,
  expectPositiveInteger,
  isContentDigest,
  isExpertQualificationId,
  isExpertQualificationVersion,
  isNeutralText,
  toContentDigest,
  toExpertQualificationId,
  toExpertQualificationVersion,
  toNeutralText,
} from './shared.js';
import type {
  ContentDigest,
  ExpertQualificationId,
  ExpertQualificationVersion,
  NeutralText,
} from './shared.js';
import {
  QUALIFICATION_EVIDENCE_KINDS,
  VERIFICATION_REF_OUTCOMES,
  isVerificationRefOutcome,
} from './evidence.js';
import type {
  QualificationEvidenceKind,
  VerificationRefOutcome,
} from './evidence.js';

/** Wire version of the qualification-policy record shape. */
export const QUALIFICATION_POLICY_VERSION = 1 as const;

/** Stable field list for the policy (tests + contracts mirror it). */
export const QUALIFICATION_POLICY_FIELDS = Object.freeze([
  'policyVersion',
  'policyId',
  'version',
  'description',
  'requirements',
  'freshnessWindowDays',
  'validityWindowDays',
  'conflictEvidence',
  'digest',
] as const) as readonly string[];

/** Stable field list for one policy evidence requirement. */
export const POLICY_EVIDENCE_REQUIREMENT_FIELDS = Object.freeze([
  'requirementId',
  'evidenceKind',
  'minimumCount',
] as const);

/** Stable field list for one conflict rule. */
export const POLICY_CONFLICT_RULE_FIELDS = Object.freeze([
  'evidenceKind',
  'outcome',
] as const);

/** One evidence requirement: the evidence kind and the minimum FRESH count. */
export interface PolicyEvidenceRequirement {
  readonly requirementId: ExpertQualificationId;
  readonly evidenceKind: QualificationEvidenceKind;
  readonly minimumCount: number;
}

/**
 * One conflict rule: evidence of `evidenceKind` (for verification refs,
 * optionally restricted to a declared derived outcome) revokes the
 * qualification.
 */
export interface PolicyConflictRule {
  readonly evidenceKind: QualificationEvidenceKind;
  /** Restricts the rule to verification refs with this derived outcome. */
  readonly outcome: VerificationRefOutcome | null;
}

/** The digest-free view — exactly what the policy digest commits to. */
export interface QualificationPolicyView {
  readonly policyVersion: typeof QUALIFICATION_POLICY_VERSION;
  readonly policyId: ExpertQualificationId;
  readonly version: ExpertQualificationVersion;
  readonly description: NeutralText;
  readonly requirements: readonly PolicyEvidenceRequirement[];
  readonly freshnessWindowDays: number;
  readonly validityWindowDays: number;
  readonly conflictEvidence: readonly PolicyConflictRule[];
}

/** A frozen, content-addressed qualification policy: view + digest. */
export interface QualificationPolicy extends QualificationPolicyView {
  readonly digest: ContentDigest;
}

export interface CreateQualificationPolicyInput {
  readonly policyId: string;
  readonly version: string;
  readonly description: string;
  readonly requirements: readonly {
    readonly requirementId: string;
    readonly evidenceKind: string;
    readonly minimumCount: number;
  }[];
  readonly freshnessWindowDays: number;
  readonly validityWindowDays: number;
  readonly conflictEvidence: readonly {
    readonly evidenceKind: string;
    readonly outcome: string | null;
  }[];
}

function toPolicyEvidenceRequirement(
  value: unknown,
): PolicyEvidenceRequirement {
  const record = expectFields(
    value,
    ['requirementId', 'evidenceKind', 'minimumCount'],
    [],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_POLICY,
    'qualification policy requirement',
  );
  return Object.freeze({
    requirementId: toExpertQualificationId(
      typeof record['requirementId'] === 'string' ? record['requirementId'] : '',
      'qualification policy requirementId',
    ),
    evidenceKind: expectEnumMember(
      record['evidenceKind'],
      QUALIFICATION_EVIDENCE_KINDS,
      'evidenceKind',
      EXPERT_QUALIFICATION_ERROR_CODES.INVALID_POLICY,
      'qualification policy requirement',
    ),
    minimumCount: expectPositiveInteger(
      record['minimumCount'],
      'minimumCount',
      EXPERT_QUALIFICATION_ERROR_CODES.INVALID_POLICY,
      'qualification policy requirement',
    ),
  });
}

function toPolicyConflictRule(value: unknown): PolicyConflictRule {
  const record = expectFields(
    value,
    ['evidenceKind', 'outcome'],
    [],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_POLICY,
    'qualification policy conflict rule',
  );
  const evidenceKind = expectEnumMember(
    record['evidenceKind'],
    QUALIFICATION_EVIDENCE_KINDS,
    'evidenceKind',
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_POLICY,
    'qualification policy conflict rule',
  );
  const outcomeRaw = record['outcome'];
  let outcome: VerificationRefOutcome | null;
  if (outcomeRaw === null) {
    outcome = null;
  } else {
    if (!isVerificationRefOutcome(outcomeRaw)) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_POLICY, {
        message: `qualification policy conflict rule: outcome must be null or one of [${VERIFICATION_REF_OUTCOMES.join(', ')}], got: ${String(outcomeRaw)}`,
        details: { known: [...VERIFICATION_REF_OUTCOMES] },
      });
    }
    outcome = outcomeRaw;
  }
  return Object.freeze({ evidenceKind, outcome });
}

/** Structural (non-throwing) check for the digest-free view. */
export function isQualificationPolicyView(value: unknown): value is QualificationPolicyView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['policyVersion'] !== QUALIFICATION_POLICY_VERSION ||
    !isExpertQualificationId(candidate['policyId']) ||
    !isExpertQualificationVersion(candidate['version']) ||
    !isNeutralText(candidate['description'])
  ) {
    return false;
  }
  const requirements = candidate['requirements'];
  if (
    !Array.isArray(requirements) ||
    requirements.length === 0 ||
    !requirements.every((entry) => {
      if (typeof entry !== 'object' || entry === null) return false;
      const req = entry as Record<string, unknown>;
      return (
        isExpertQualificationId(req['requirementId']) &&
        QUALIFICATION_EVIDENCE_KINDS.includes(req['evidenceKind'] as QualificationEvidenceKind) &&
        typeof req['minimumCount'] === 'number' &&
        Number.isInteger(req['minimumCount']) &&
        req['minimumCount'] > 0
      );
    })
  ) {
    return false;
  }
  for (const field of ['freshnessWindowDays', 'validityWindowDays']) {
    const value = candidate[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return false;
    }
  }
  const conflictEvidence = candidate['conflictEvidence'];
  if (
    !Array.isArray(conflictEvidence) ||
    !conflictEvidence.every((entry) => {
      if (typeof entry !== 'object' || entry === null) return false;
      const rule = entry as Record<string, unknown>;
      return (
        QUALIFICATION_EVIDENCE_KINDS.includes(rule['evidenceKind'] as QualificationEvidenceKind) &&
        (rule['outcome'] === null || isVerificationRefOutcome(rule['outcome']))
      );
    })
  ) {
    return false;
  }
  return true;
}

/** Structural (non-throwing) check for the full policy (view + digest). */
export function isQualificationPolicy(value: unknown): value is QualificationPolicy {
  if (!isQualificationPolicyView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed qualification
 * policy. Rejects empty requirements, duplicate requirement ids, duplicate
 * (kind, outcome) conflict rules, non-positive windows and unknown
 * evidence kinds — all with typed ExpertQualificationErrors.
 */
export async function createQualificationPolicy(
  input: CreateQualificationPolicyInput,
): Promise<QualificationPolicy> {
  const record = expectFields(
    input,
    [
      'policyId',
      'version',
      'description',
      'requirements',
      'freshnessWindowDays',
      'validityWindowDays',
      'conflictEvidence',
    ],
    [],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_POLICY,
    'qualification policy',
  );

  const policyId = toExpertQualificationId(
    typeof record['policyId'] === 'string' ? record['policyId'] : '',
    'qualification policy policyId',
  );
  const version = toExpertQualificationVersion(
    typeof record['version'] === 'string' ? record['version'] : '',
    'qualification policy version',
  );
  const description = toNeutralText(
    typeof record['description'] === 'string' ? record['description'] : '',
    'qualification policy description',
  );

  if (!Array.isArray(record['requirements']) || record['requirements'].length === 0) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_POLICY, {
      message:
        'a qualification policy requires at least one evidence requirement (a policy that demands nothing qualifies nothing — R7)',
      details: { field: 'requirements' },
    });
  }
  const requirements = Object.freeze(
    (record['requirements'] as unknown[]).map((entry) =>
      toPolicyEvidenceRequirement(entry),
    ),
  );
  const seenIds = new Set<string>();
  for (const requirement of requirements) {
    if (seenIds.has(requirement.requirementId)) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.DUPLICATE_REQUIREMENT, {
        message: `duplicate policy requirement id: ${requirement.requirementId}`,
        details: { requirementId: requirement.requirementId },
      });
    }
    seenIds.add(requirement.requirementId);
  }

  const freshnessWindowDays = expectPositiveInteger(
    record['freshnessWindowDays'],
    'freshnessWindowDays',
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_POLICY,
    'qualification policy',
  );
  const validityWindowDays = expectPositiveInteger(
    record['validityWindowDays'],
    'validityWindowDays',
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_POLICY,
    'qualification policy',
  );

  const conflictEvidence = Object.freeze(
    (Array.isArray(record['conflictEvidence'])
      ? (record['conflictEvidence'] as unknown[])
      : []
    ).map((entry) => toPolicyConflictRule(entry)),
  );
  const seenRules = new Set<string>();
  for (const rule of conflictEvidence) {
    const key = `${rule.evidenceKind}#${rule.outcome ?? '*'}`;
    if (seenRules.has(key)) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_POLICY, {
        message: `duplicate conflict rule for evidence kind ${JSON.stringify(rule.evidenceKind)}${rule.outcome === null ? '' : ` with outcome ${JSON.stringify(rule.outcome)}`}`,
        details: { rule },
      });
    }
    seenRules.add(key);
  }

  const view: QualificationPolicyView = {
    policyVersion: QUALIFICATION_POLICY_VERSION,
    policyId,
    version,
    description,
    requirements,
    freshnessWindowDays,
    validityWindowDays,
    conflictEvidence,
  };

  const digest = toContentDigest(
    await digestCanonical(view),
    'qualification policy digest',
  );
  return deepFreeze({ ...view, digest }) as QualificationPolicy;
}

/** The digest-free view of a policy (what the digest commits to). */
export function qualificationPolicyView(
  policy: QualificationPolicy,
): QualificationPolicyView {
  const { digest: _digest, ...view } = policy;
  return deepFreeze({ ...view }) as QualificationPolicyView;
}

/**
 * Recompute the policy digest over the digest-free view and compare.
 * Throws EXPERT_QUALIFICATION_TAMPERED on any mismatch.
 */
export async function recomputeQualificationPolicyDigest(
  policy: QualificationPolicy,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isQualificationPolicy(policy)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_POLICY, {
      message: 'policy digest recomputation requires a structurally valid qualification policy',
    });
  }
  const actual = await digestCanonical(qualificationPolicyView(policy));
  if (actual !== policy.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.TAMPERED, {
      message: `qualification policy digest mismatch: expected ${expectedDigest ?? policy.digest}, got ${actual}`,
      details: {
        policyId: policy.policyId,
        version: policy.version,
        expected: expectedDigest ?? policy.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed policy digest');
}

/**
 * The policy identity key — "policyId@version". The reference pool keys
 * duplicate detection on this pair: registering a DIFFERENT policy digest
 * under the same identity is a version conflict (changing a policy
 * requires a new version — spec/quality-model.md assessor versioning).
 */
export function qualificationPolicyIdentityKey(policy: QualificationPolicy): string {
  return `${policy.policyId}@${policy.version}`;
}
