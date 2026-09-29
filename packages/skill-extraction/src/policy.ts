/**
 * ExtractionPolicy — the versioned, content-addressed rules that govern
 * one extraction (Work Order A019; requirement R17; architecture-lock
 * rules 5, 12, 18 — versioned, explicitly published, provenance-bearing
 * artifacts; docs/architecture.md §11 — learning never rewrites
 * historical facts or evidence).
 *
 * A policy binds:
 *   - `policyId` + `version` — the stable identity of the rule set
 *     (same identity, different content is a different digest — the
 *     caller's registries enforce the identity conflict);
 *   - `validation` — the MINIMUM VALIDATION EVIDENCE a trajectory must
 *     carry to be mined: the verification outcome that must be met
 *     (default `pass`), how many distinct verification records at that
 *     outcome are required (≥ 1 — the R17 gate is non-negotiable, the
 *     policy only tightens it), whether evaluation records must exist,
 *     and the evaluation aggregate outcome that must be met (null — no
 *     judgment gate);
 *   - `eligibility` — which trajectory entry kinds are eligible for
 *     mining. A closed subset of A011's five entry kinds; the house
 *     default is actions + completions (Arena does NOT require hidden
 *     chain-of-thought — there is none by design — and observations are
 *     environment outputs, not agent skill). `requireCompletedOutcome`
 *     demands the completion entry's outcome be `completed` (default) —
 *     failed/timed-out runs are not skill sources under the default
 *     policy;
 *   - `thresholds` — dedup/threshold rules: how many DISTINCT
 *     trajectories a pattern must span (minTrajectories) and how many
 *     total occurrences it must have (minOccurrences) before it may
 *     become a candidate;
 *   - `taxonomy` — the A004 target node the mined skills are proposed
 *     under (a REAL CapabilityNodeRef — validated by
 *     @arena/capability-graph's own guard): the skill drafts will carry
 *     a provenance-bearing `decomposes-into` edge from this node.
 *
 * Determinism (the A019 contract): the same inputs + the same policy ⇒
 * the same candidates — the policy enters every candidate digest via
 * its content digest, and the mining core is a pure function.
 */

import type { CapabilityNodeRef } from '@arena/capability-graph';
import { isCapabilityNodeRef } from '@arena/capability-graph';
import type { TrajectoryEntryKind } from '@arena/trajectory';
import { isTrajectoryEntryKind, TRAJECTORY_ENTRY_KINDS } from '@arena/trajectory';
import { digestCanonical } from '@arena/protocol-core';
import { SKILL_EXTRACTION_ERROR_CODES, SkillExtractionError } from './errors.js';
import {
  deepFreeze,
  expectEnumMember,
  expectFields,
  expectNonNegativeInteger,
  toNeutralId,
  toSkillExtractionVersion,
} from './shared.js';
import type { NeutralId, SkillExtractionVersion } from './shared.js';

/** Wire version of the extraction-policy shape. */
export const EXTRACTION_POLICY_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Closed vocabularies (A012/A013 outcome vocabularies, reused by value)
// ---------------------------------------------------------------------------

/**
 * The verification outcomes a policy may require. A013's closed
 * vocabulary is pass | fail | unknown; the house default (and the only
 * outcome that means 'validated') is `pass`.
 */
export const POLICY_VERIFICATION_OUTCOMES = Object.freeze(['pass', 'fail', 'unknown'] as const);
export type PolicyVerificationOutcome = (typeof POLICY_VERIFICATION_OUTCOMES)[number];

/**
 * The evaluation aggregate outcomes a policy may require. A012's closed
 * judgment vocabulary is meets-criteria | below-criteria; null means no
 * judgment gate.
 */
export const POLICY_EVALUATION_OUTCOMES = Object.freeze([
  'meets-criteria',
  'below-criteria',
] as const);
export type PolicyEvaluationOutcome = (typeof POLICY_EVALUATION_OUTCOMES)[number];

/** The completion outcomes a policy may require of the source trajectory. */
export const POLICY_COMPLETION_OUTCOMES = Object.freeze(['completed', 'failed', 'timed-out'] as const);
export type PolicyCompletionOutcome = (typeof POLICY_COMPLETION_OUTCOMES)[number];

// ---------------------------------------------------------------------------
// ExtractionPolicy
// ---------------------------------------------------------------------------

/** The minimum-validation-evidence rules (all counts are minimums). */
export interface PolicyValidationRules {
  /** The verification outcome that must be met (house default: 'pass'). */
  readonly requiredVerificationOutcome: PolicyVerificationOutcome;
  /** Distinct verification records at the required outcome (≥ 1). */
  readonly minVerificationRecords: number;
  /** Whether at least one evaluation record must exist. */
  readonly requireEvaluations: boolean;
  /** The aggregate outcome at least one evaluation must meet (null: none). */
  readonly requiredEvaluationOutcome: PolicyEvaluationOutcome | null;
}

/** Which trajectory content is eligible for mining. */
export interface PolicyEligibilityRules {
  /** Eligible entry kinds — a non-empty subset of A011's five kinds. */
  readonly entryKinds: readonly TrajectoryEntryKind[];
  /** Required completion outcome (null: any outcome accepted). */
  readonly requireCompletedOutcome: PolicyCompletionOutcome | null;
}

/** The dedup/threshold rules a mined pattern must satisfy. */
export interface PolicyThresholdRules {
  /** Distinct trajectories the pattern must span (≥ 1). */
  readonly minTrajectories: number;
  /** Total occurrences the pattern must have (≥ 1). */
  readonly minOccurrences: number;
}

/** The A004 taxonomy placement of mined skills. */
export interface PolicyTaxonomyRules {
  /** The capability/sub-capability/domain node the skills decompose under. */
  readonly targetNode: CapabilityNodeRef;
}

/** The digest-free view — exactly what the policy digest commits to. */
export interface ExtractionPolicyView {
  readonly recordVersion: typeof EXTRACTION_POLICY_VERSION;
  readonly policyId: NeutralId;
  readonly version: SkillExtractionVersion;
  readonly validation: PolicyValidationRules;
  readonly eligibility: PolicyEligibilityRules;
  readonly thresholds: PolicyThresholdRules;
  readonly taxonomy: PolicyTaxonomyRules;
}

/** A frozen, content-addressed extraction policy: the view plus its sha256 digest. */
export interface ExtractionPolicy extends ExtractionPolicyView {
  readonly digest: string;
}

/** Stable field list for the policy view (tests mirror it). */
export const EXTRACTION_POLICY_FIELDS = Object.freeze([
  'recordVersion',
  'policyId',
  'version',
  'validation',
  'eligibility',
  'thresholds',
  'taxonomy',
] as const) as readonly string[];

export interface CreateExtractionPolicyInput {
  readonly policyId: string;
  readonly version: string;
  readonly validation: {
    readonly requiredVerificationOutcome: string;
    readonly minVerificationRecords: number;
    readonly requireEvaluations: boolean;
    readonly requiredEvaluationOutcome: string | null;
  };
  readonly eligibility: {
    readonly entryKinds: readonly string[];
    readonly requireCompletedOutcome: string | null;
  };
  readonly thresholds: {
    readonly minTrajectories: number;
    readonly minOccurrences: number;
  };
  readonly taxonomy: {
    readonly targetNode: {
      readonly kind: string;
      readonly id: string;
      readonly version: string;
      readonly digest: string;
    };
  };
}

/** Structural (non-throwing) check for the digest-free policy view. */
export function isExtractionPolicyView(value: unknown): value is ExtractionPolicyView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== EXTRACTION_POLICY_VERSION) return false;
  if (typeof candidate['policyId'] !== 'string') return false;
  if (typeof candidate['version'] !== 'string') return false;
  const validation = candidate['validation'];
  if (typeof validation !== 'object' || validation === null) return false;
  const v = validation as Record<string, unknown>;
  if (
    typeof v['requiredVerificationOutcome'] !== 'string' ||
    !(POLICY_VERIFICATION_OUTCOMES as readonly string[]).includes(v['requiredVerificationOutcome'])
  ) {
    return false;
  }
  if (typeof v['minVerificationRecords'] !== 'number' || !Number.isInteger(v['minVerificationRecords']) || v['minVerificationRecords'] < 1) {
    return false;
  }
  if (typeof v['requireEvaluations'] !== 'boolean') return false;
  if (
    v['requiredEvaluationOutcome'] !== null &&
    (typeof v['requiredEvaluationOutcome'] !== 'string' ||
      !(POLICY_EVALUATION_OUTCOMES as readonly string[]).includes(v['requiredEvaluationOutcome']))
  ) {
    return false;
  }
  const eligibility = candidate['eligibility'];
  if (typeof eligibility !== 'object' || eligibility === null) return false;
  const e = eligibility as Record<string, unknown>;
  if (
    !Array.isArray(e['entryKinds']) ||
    e['entryKinds'].length === 0 ||
    !e['entryKinds'].every((kind) => isTrajectoryEntryKind(kind)) ||
    new Set(e['entryKinds']).size !== e['entryKinds'].length
  ) {
    return false;
  }
  if (
    e['requireCompletedOutcome'] !== null &&
    (typeof e['requireCompletedOutcome'] !== 'string' ||
      !(POLICY_COMPLETION_OUTCOMES as readonly string[]).includes(e['requireCompletedOutcome']))
  ) {
    return false;
  }
  const thresholds = candidate['thresholds'];
  if (typeof thresholds !== 'object' || thresholds === null) return false;
  const t = thresholds as Record<string, unknown>;
  if (
    typeof t['minTrajectories'] !== 'number' ||
    !Number.isInteger(t['minTrajectories']) ||
    t['minTrajectories'] < 1
  ) {
    return false;
  }
  if (
    typeof t['minOccurrences'] !== 'number' ||
    !Number.isInteger(t['minOccurrences']) ||
    t['minOccurrences'] < 1
  ) {
    return false;
  }
  const taxonomy = candidate['taxonomy'];
  if (typeof taxonomy !== 'object' || taxonomy === null) return false;
  return isCapabilityNodeRef((taxonomy as Record<string, unknown>)['targetNode']);
}

/** Structural (non-throwing) check for the full policy (view + digest). */
export function isExtractionPolicy(value: unknown): value is ExtractionPolicy {
  if (!isExtractionPolicyView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate['digest'] === 'string' && /^[0-9a-f]{64}$/.test(candidate['digest']);
}

/** Validate eligibility entry kinds (closed A011 subset, non-empty, no dupes). */
function toEligibilityKinds(value: unknown): readonly TrajectoryEntryKind[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: `extraction policy eligibility: entryKinds must be a non-empty array of A011 trajectory entry kinds (known: ${TRAJECTORY_ENTRY_KINDS.join(', ')})`,
      details: { known: [...TRAJECTORY_ENTRY_KINDS] },
    });
  }
  const kinds: TrajectoryEntryKind[] = [];
  for (const kind of value) {
    if (!isTrajectoryEntryKind(kind)) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
        message: `extraction policy eligibility: unknown entry kind ${JSON.stringify(kind)} (A011 kinds: ${TRAJECTORY_ENTRY_KINDS.join(', ')})`,
        details: { known: [...TRAJECTORY_ENTRY_KINDS] },
      });
    }
    if (kinds.includes(kind)) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
        message: `extraction policy eligibility: duplicate entry kind ${JSON.stringify(kind)}`,
      });
    }
    kinds.push(kind);
  }
  return Object.freeze(kinds);
}

/**
 * Create a validated, deep-frozen, content-addressed extraction policy.
 * Same rule content ⇒ same digest; ANY change ⇒ a different digest.
 * Throws typed SkillExtractionError on every malformed input.
 */
export async function createExtractionPolicy(
  input: CreateExtractionPolicyInput,
): Promise<ExtractionPolicy> {
  const record = expectFields(
    input,
    ['policyId', 'version', 'validation', 'eligibility', 'thresholds', 'taxonomy'],
    [],
    SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    'extraction policy',
  );

  const policyId = toNeutralId(
    typeof record['policyId'] === 'string' ? record['policyId'] : '',
    'extraction policy policyId',
  );
  const version = toSkillExtractionVersion(
    typeof record['version'] === 'string' ? record['version'] : '',
    'extraction policy version',
  );

  const rawValidation = record['validation'];
  if (typeof rawValidation !== 'object' || rawValidation === null) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: 'extraction policy: validation must be a policy validation rules object',
    });
  }
  const validationRecord = expectFields(
    rawValidation,
    [
      'requiredVerificationOutcome',
      'minVerificationRecords',
      'requireEvaluations',
      'requiredEvaluationOutcome',
    ],
    [],
    SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    'extraction policy validation',
  );
  const requiredVerificationOutcome = expectEnumMember(
    validationRecord['requiredVerificationOutcome'],
    POLICY_VERIFICATION_OUTCOMES,
    'requiredVerificationOutcome',
    SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    'extraction policy validation',
  );
  const minVerificationRecords = expectNonNegativeInteger(
    validationRecord['minVerificationRecords'],
    'minVerificationRecords',
    SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    'extraction policy validation',
  );
  if (minVerificationRecords < 1) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: `extraction policy validation: minVerificationRecords must be ≥ 1 (requirement R17 'validated' gate is non-negotiable; a policy may only tighten it)`,
      details: { minVerificationRecords },
    });
  }
  if (typeof validationRecord['requireEvaluations'] !== 'boolean') {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: 'extraction policy validation: requireEvaluations must be a boolean',
    });
  }
  const requireEvaluations = validationRecord['requireEvaluations'];
  const rawRequiredEvaluationOutcome = validationRecord['requiredEvaluationOutcome'];
  let requiredEvaluationOutcome: PolicyEvaluationOutcome | null = null;
  if (rawRequiredEvaluationOutcome !== null) {
    requiredEvaluationOutcome = expectEnumMember(
      rawRequiredEvaluationOutcome,
      POLICY_EVALUATION_OUTCOMES,
      'requiredEvaluationOutcome',
      SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
      'extraction policy validation',
    );
  }

  const rawEligibility = record['eligibility'];
  if (typeof rawEligibility !== 'object' || rawEligibility === null) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: 'extraction policy: eligibility must be a policy eligibility rules object',
    });
  }
  const eligibilityRecord = expectFields(
    rawEligibility,
    ['entryKinds', 'requireCompletedOutcome'],
    [],
    SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    'extraction policy eligibility',
  );
  const entryKinds = toEligibilityKinds(eligibilityRecord['entryKinds']);
  const rawRequireCompletedOutcome = eligibilityRecord['requireCompletedOutcome'];
  let requireCompletedOutcome: PolicyCompletionOutcome | null = null;
  if (rawRequireCompletedOutcome !== null) {
    requireCompletedOutcome = expectEnumMember(
      rawRequireCompletedOutcome,
      POLICY_COMPLETION_OUTCOMES,
      'requireCompletedOutcome',
      SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
      'extraction policy eligibility',
    );
  }

  const rawThresholds = record['thresholds'];
  if (typeof rawThresholds !== 'object' || rawThresholds === null) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: 'extraction policy: thresholds must be a policy threshold rules object',
    });
  }
  const thresholdsRecord = expectFields(
    rawThresholds,
    ['minTrajectories', 'minOccurrences'],
    [],
    SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    'extraction policy thresholds',
  );
  const minTrajectories = expectNonNegativeInteger(
    thresholdsRecord['minTrajectories'],
    'minTrajectories',
    SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    'extraction policy thresholds',
  );
  if (minTrajectories < 1) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: 'extraction policy thresholds: minTrajectories must be ≥ 1',
      details: { minTrajectories },
    });
  }
  const minOccurrences = expectNonNegativeInteger(
    thresholdsRecord['minOccurrences'],
    'minOccurrences',
    SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    'extraction policy thresholds',
  );
  if (minOccurrences < 1) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: 'extraction policy thresholds: minOccurrences must be ≥ 1',
      details: { minOccurrences },
    });
  }

  const rawTaxonomy = record['taxonomy'];
  if (typeof rawTaxonomy !== 'object' || rawTaxonomy === null) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: 'extraction policy: taxonomy must be a policy taxonomy rules object',
    });
  }
  const taxonomyRecord = expectFields(
    rawTaxonomy,
    ['targetNode'],
    [],
    SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY,
    'extraction policy taxonomy',
  );
  const rawTargetNode = taxonomyRecord['targetNode'];
  if (typeof rawTargetNode !== 'object' || rawTargetNode === null) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: 'extraction policy taxonomy: targetNode must be an A004 CapabilityNodeRef',
    });
  }
  if (!isCapabilityNodeRef(rawTargetNode)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: `extraction policy taxonomy: targetNode must be a structurally valid A004 CapabilityNodeRef (REAL @arena/capability-graph guard): ${JSON.stringify(rawTargetNode)}`,
    });
  }
  const targetNode = Object.freeze({ ...rawTargetNode });
  if (
    targetNode.kind !== 'capability' &&
    targetNode.kind !== 'sub-capability' &&
    targetNode.kind !== 'domain'
  ) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: `extraction policy taxonomy: targetNode kind must be domain | capability | sub-capability (a skill decomposes under the taxonomy, not under a tool or evaluator): got ${JSON.stringify(targetNode.kind)}`,
      details: { kind: targetNode.kind },
    });
  }

  const view: ExtractionPolicyView = {
    recordVersion: EXTRACTION_POLICY_VERSION,
    policyId,
    version,
    validation: deepFreeze({
      requiredVerificationOutcome,
      minVerificationRecords,
      requireEvaluations,
      requiredEvaluationOutcome,
    }),
    eligibility: deepFreeze({ entryKinds, requireCompletedOutcome }),
    thresholds: deepFreeze({ minTrajectories, minOccurrences }),
    taxonomy: deepFreeze({ targetNode }),
  };
  const digest = await digestCanonical(view);
  return deepFreeze({ ...view, digest }) as ExtractionPolicy;
}

/** The digest-free view of a policy (what the digest commits to). */
export function extractionPolicyView(policy: ExtractionPolicy): ExtractionPolicyView {
  const { digest: _digest, ...view } = policy;
  return deepFreeze({ ...view }) as ExtractionPolicyView;
}

/**
 * Verify a policy: recompute the digest over the digest-free view and
 * compare (optionally against an expected digest). Throws
 * SKILL_EXTRACTION_TAMPERED on any mismatch — the content-addressing
 * tripwire for the rule set that governs an extraction.
 */
export async function verifyExtractionPolicy(
  policy: ExtractionPolicy,
  expectedDigest?: string,
): Promise<string> {
  if (!isExtractionPolicy(policy)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: 'policy verification requires a structurally valid extraction policy',
    });
  }
  const actual = await digestCanonical(extractionPolicyView(policy));
  const claimed = expectedDigest ?? policy.digest;
  if (actual !== claimed) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.TAMPERED, {
      message: `extraction policy digest mismatch: expected ${claimed}, recomputed ${actual}`,
      details: { policyId: policy.policyId, expected: claimed, actual },
    });
  }
  return actual;
}
