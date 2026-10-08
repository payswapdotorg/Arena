/**
 * The improvement CANDIDATE — the compiler input (Work Order C022).
 *
 * A candidate is a typed, tenant-scoped VIEW projected by the host (or
 * the reference service's injected ports) from the validated
 * intervention-derived outputs of the dependency surfaces:
 *
 *   - C008 tool-gap body-improvement / benchmark candidates and
 *     knowledge-patch learning candidates;
 *   - C009 escalation-validation adjudication evidence;
 *   - C013 adversarial-evaluation research candidates / disagreement
 *     material;
 *   - C014 body-marketplace pretraining candidates.
 *
 * The candidate does NOT import those surfaces' record types — it binds
 * them BY DIGEST (`sourceRecordRef`, `evidenceRefs`) and carries the
 * closed source-kind vocabulary. Everything protocol-visible is
 * versioned, tenant-scoped and machine-readable; the changed surface is
 * EXPLICIT and MUST be one of the LE1.0 nine (@arena/learning's REAL
 * closed vocabulary — consumed, never redefined).
 *
 * Rights/scope discipline (lock rules 31/32): a candidate carries an
 * explicit rights statement from a closed vocabulary. A candidate whose
 * rights are 'insufficient' can still be INGESTED (observation is
 * allowed) but can never compile into a GLOBALLY REUSABLE program — the
 * compiler blocks it (see program.ts).
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  INTERVENTION_SURFACES,
  deepFreeze,
  isContentDigest,
  isInterventionSurface,
  isLearningTimestamp,
  isNeutralId,
  isNeutralText,
  toContentDigest,
  toLearningTimestamp,
  toNeutralId,
  toNeutralText,
} from '@arena/learning';
import type { ContentDigest, LearningTimestamp, NeutralId, NeutralText } from '@arena/learning';
import type { InterventionSurface } from '@arena/learning';
import { CAPABILITY_LEARNING_ERROR_CODES, CapabilityLearningError } from './errors.js';
import { expectFields } from './shared.js';

/** Wire version of the improvement-candidate shape. */
export const IMPROVEMENT_CANDIDATE_VERSION = 1 as const;

/**
 * The CLOSED candidate-source vocabulary — one member per dependency
 * surface's public candidate/evidence output.
 */
export const CANDIDATE_SOURCE_KINDS = Object.freeze([
  'tool-gap-body-improvement-candidate',
  'tool-gap-benchmark-candidate',
  'knowledge-patch-candidate',
  'escalation-validated-evidence',
  'adversarial-research-candidate',
  'marketplace-pretraining-candidate',
] as const);
export type CandidateSourceKind = (typeof CANDIDATE_SOURCE_KINDS)[number];

export function isCandidateSourceKind(value: unknown): value is CandidateSourceKind {
  return (
    typeof value === 'string' &&
    (CANDIDATE_SOURCE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * The CLOSED rights vocabulary (lock rules 31/32): globally reusable
 * outputs require EXPLICIT rights; a tenant-scoped grant never promotes
 * to global reuse; 'insufficient' blocks reusable compilation.
 */
export const CANDIDATE_RIGHTS_STATUSES = Object.freeze([
  'granted-for-global-reuse',
  'granted-tenant-scoped',
  'insufficient',
] as const);
export type CandidateRightsStatus = (typeof CANDIDATE_RIGHTS_STATUSES)[number];

export function isCandidateRightsStatus(value: unknown): value is CandidateRightsStatus {
  return (
    typeof value === 'string' &&
    (CANDIDATE_RIGHTS_STATUSES as readonly string[]).includes(value)
  );
}

/** An A002-shaped artifact reference (namespace/name/version/digest). */
export interface CandidateArtifactRef {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

/** The experiment plan a candidate contributes (merged per class at compile time). */
export interface CandidateExperimentPlan {
  readonly taskPopulation: readonly { readonly taskId: string; readonly version: string }[];
  readonly evaluationSuiteRefs: readonly string[];
  readonly verificationSuiteRefs: readonly string[];
  readonly environmentVersions: readonly {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  }[];
  readonly outcomeMetrics: readonly {
    readonly metricId: string;
    readonly description: string;
    readonly direction: string;
  }[];
  readonly uncertainty: {
    readonly method: string;
    readonly notes: string | null;
  };
  readonly protectedCapabilities: readonly {
    readonly ref: {
      readonly kind: string;
      readonly id: string;
      readonly version: string;
      readonly digest: string;
    };
    readonly metricId: string;
    readonly direction: string;
  }[];
}

/** The digest-free view — exactly what the candidate digest commits to. */
export interface ImprovementCandidateView {
  readonly recordVersion: typeof IMPROVEMENT_CANDIDATE_VERSION;
  readonly candidateId: NeutralId;
  readonly tenantId: NeutralId;
  readonly sourceKind: CandidateSourceKind;
  /** The digest of the source-surface record this candidate was projected from. */
  readonly sourceRecordRef: ContentDigest;
  /** The EXPLICIT changed surface (LE1.0 nine). */
  readonly changedSurface: InterventionSurface;
  /** The intervention artifact the source surface produced. */
  readonly artifact: CandidateArtifactRef;
  /** The digest of the PRIOR artifact version this improvement would supersede (append-only lineage), or null. */
  readonly supersedes: ContentDigest | null;
  readonly targetCapability: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly baseline: {
    readonly bodyRef: string | null;
    readonly substrateRef: string | null;
    readonly runtimeRef: string | null;
  };
  readonly experimentPlan: CandidateExperimentPlan;
  /** ≥1 validated evidence digest is REQUIRED (C009/C013/A012/A013 records). */
  readonly evidenceRefs: readonly ContentDigest[];
  readonly rights: {
    readonly status: CandidateRightsStatus;
    readonly statement: NeutralText;
  };
  /** Explicit request for global reusability (requires granted-for-global-reuse rights). */
  readonly globalReuseRequested: boolean;
  readonly provenance: {
    readonly capturedFrom: NeutralId;
    readonly capturedAt: LearningTimestamp;
    readonly notes: NeutralText | null;
  };
}

/** A frozen, content-addressed improvement candidate: the view plus its sha256 digest. */
export interface ImprovementCandidate extends ImprovementCandidateView {
  readonly digest: ContentDigest;
}

/** Stable field list for the candidate view (tests + parity mirror it). */
export const IMPROVEMENT_CANDIDATE_FIELDS = Object.freeze([
  'recordVersion',
  'candidateId',
  'tenantId',
  'sourceKind',
  'sourceRecordRef',
  'changedSurface',
  'artifact',
  'supersedes',
  'targetCapability',
  'baseline',
  'experimentPlan',
  'evidenceRefs',
  'rights',
  'globalReuseRequested',
  'provenance',
] as const);

export interface CreateImprovementCandidateInput {
  readonly candidateId: string;
  readonly tenantId: string;
  readonly sourceKind: string;
  readonly sourceRecordRef: string;
  readonly changedSurface: string;
  readonly artifact: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly supersedes: string | null;
  readonly targetCapability: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly baseline: {
    readonly bodyRef: string | null;
    readonly substrateRef: string | null;
    readonly runtimeRef: string | null;
  };
  readonly experimentPlan: CandidateExperimentPlan;
  readonly evidenceRefs: readonly string[];
  readonly rights: {
    readonly status: string;
    readonly statement: string;
  };
  readonly globalReuseRequested: boolean;
  readonly provenance: {
    readonly capturedFrom: string;
    readonly capturedAt: string;
    readonly notes: string | null;
  };
}

function isCandidateArtifactRef(value: unknown): value is CandidateArtifactRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['namespace'] === 'string' &&
    candidate['namespace'].length > 0 &&
    typeof candidate['name'] === 'string' &&
    candidate['name'].length > 0 &&
    typeof candidate['version'] === 'string' &&
    candidate['version'].length > 0 &&
    isContentDigest(candidate['digest'])
  );
}

/** Structural (non-throwing) check for the digest-free candidate view. */
export function isImprovementCandidateView(value: unknown): value is ImprovementCandidateView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const rights = candidate['rights'];
  const provenance = candidate['provenance'];
  return (
    candidate['recordVersion'] === IMPROVEMENT_CANDIDATE_VERSION &&
    isNeutralId(candidate['candidateId']) &&
    isNeutralId(candidate['tenantId']) &&
    isCandidateSourceKind(candidate['sourceKind']) &&
    isContentDigest(candidate['sourceRecordRef']) &&
    isInterventionSurface(candidate['changedSurface']) &&
    isCandidateArtifactRef(candidate['artifact']) &&
    (candidate['supersedes'] === null || isContentDigest(candidate['supersedes'])) &&
    typeof candidate['targetCapability'] === 'object' &&
    candidate['targetCapability'] !== null &&
    typeof (candidate['targetCapability'] as Record<string, unknown>)['digest'] === 'string' &&
    isContentDigest((candidate['targetCapability'] as Record<string, unknown>)['digest']) &&
    typeof candidate['baseline'] === 'object' &&
    candidate['baseline'] !== null &&
    typeof candidate['experimentPlan'] === 'object' &&
    candidate['experimentPlan'] !== null &&
    Array.isArray(candidate['evidenceRefs']) &&
    (candidate['evidenceRefs'] as unknown[]).every((entry) => isContentDigest(entry)) &&
    typeof rights === 'object' &&
    rights !== null &&
    isCandidateRightsStatus((rights as Record<string, unknown>)['status']) &&
    isNeutralText((rights as Record<string, unknown>)['statement']) &&
    typeof candidate['globalReuseRequested'] === 'boolean' &&
    typeof provenance === 'object' &&
    provenance !== null &&
    isNeutralId((provenance as Record<string, unknown>)['capturedFrom']) &&
    isLearningTimestamp((provenance as Record<string, unknown>)['capturedAt'])
  );
}

/** Structural (non-throwing) check for the full candidate (view + digest). */
export function isImprovementCandidate(value: unknown): value is ImprovementCandidate {
  if (!isImprovementCandidateView(value)) return false;
  return isContentDigest((value as unknown as Record<string, unknown>)['digest']);
}

function requireArtifact(
  value: unknown,
  context: string,
): CandidateArtifactRef {
  if (!isCandidateArtifactRef(value)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `${context}: artifact must be an A002-shaped {namespace, name, version, digest} reference with a 64-hex digest`,
    });
  }
  return deepFreeze({ ...value }) as CandidateArtifactRef;
}

/**
 * Create a validated, deep-frozen, content-addressed improvement
 * candidate. Rejects unknown source kinds, undeclared/ambiguous changed
 * surfaces (the LE1.0 nine), malformed digests, empty evidence sets and
 * malformed rights/provenance with typed CapabilityLearningErrors.
 */
export async function createImprovementCandidate(
  input: CreateImprovementCandidateInput,
): Promise<ImprovementCandidate> {
  const record = expectFields(
    input,
    [
      'candidateId',
      'tenantId',
      'sourceKind',
      'sourceRecordRef',
      'changedSurface',
      'artifact',
      'supersedes',
      'targetCapability',
      'baseline',
      'experimentPlan',
      'evidenceRefs',
      'rights',
      'globalReuseRequested',
      'provenance',
    ],
    [],
    CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE,
    'improvement candidate',
  );

  const sourceKind = record['sourceKind'];
  if (!isCandidateSourceKind(sourceKind)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `improvement candidate: sourceKind must be one of [${CANDIDATE_SOURCE_KINDS.join(', ')}], got: ${JSON.stringify(sourceKind)}`,
      details: { known: [...CANDIDATE_SOURCE_KINDS] },
    });
  }

  const changedSurface = record['changedSurface'];
  if (!isInterventionSurface(changedSurface)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `improvement candidate: changedSurface must be one of the LE1.0 nine [${INTERVENTION_SURFACES.join(', ')}], got: ${JSON.stringify(changedSurface)} (the changed surface must be explicit)`,
      details: { known: [...INTERVENTION_SURFACES] },
    });
  }

  const evidenceRefsRaw = record['evidenceRefs'];
  if (!Array.isArray(evidenceRefsRaw) || evidenceRefsRaw.length === 0) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'improvement candidate: at least one validated evidence digest is required (C009 adjudication / C013 research / A012 evaluation / A013 verification records)',
    });
  }
  const evidenceRefs = Object.freeze(
    evidenceRefsRaw.map((entry, index) =>
      toContentDigest(
        typeof entry === 'string' ? entry : '',
        `improvement candidate evidenceRefs[${String(index)}]`,
      ),
    ),
  );

  const rights = expectFields(
    record['rights'],
    ['status', 'statement'],
    [],
    CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE,
    'improvement candidate rights',
  );
  if (!isCandidateRightsStatus(rights['status'])) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `improvement candidate rights: status must be one of [${CANDIDATE_RIGHTS_STATUSES.join(', ')}], got: ${JSON.stringify(rights['status'])}`,
      details: { known: [...CANDIDATE_RIGHTS_STATUSES] },
    });
  }

  const provenance = expectFields(
    record['provenance'],
    ['capturedFrom', 'capturedAt', 'notes'],
    [],
    CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE,
    'improvement candidate provenance',
  );

  const plan = expectFields(
    record['experimentPlan'],
    [
      'taskPopulation',
      'evaluationSuiteRefs',
      'verificationSuiteRefs',
      'environmentVersions',
      'outcomeMetrics',
      'uncertainty',
      'protectedCapabilities',
    ],
    [],
    CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE,
    'improvement candidate experimentPlan',
  );
  if (!Array.isArray(plan['taskPopulation']) || (plan['taskPopulation'] as unknown[]).length === 0) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'improvement candidate experimentPlan: a non-empty pinned task population is required (LE1.0 minimum)',
    });
  }
  if (
    !Array.isArray(plan['evaluationSuiteRefs']) ||
    (plan['evaluationSuiteRefs'] as unknown[]).length === 0 ||
    !Array.isArray(plan['verificationSuiteRefs']) ||
    (plan['verificationSuiteRefs'] as unknown[]).length === 0
  ) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'improvement candidate experimentPlan: non-empty evaluation and verification suite refs are required (LE1.0 minimum)',
    });
  }
  if (!Array.isArray(plan['outcomeMetrics']) || (plan['outcomeMetrics'] as unknown[]).length === 0) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'improvement candidate experimentPlan: at least one declared outcome metric is required (LE1.0 minimum)',
    });
  }
  if (
    !Array.isArray(plan['protectedCapabilities']) ||
    (plan['protectedCapabilities'] as unknown[]).length === 0
  ) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'improvement candidate experimentPlan: at least one protected capability is required (Q1.0 condition 4 — regression must be measurable)',
    });
  }

  const supersedesRaw = record['supersedes'];
  if (supersedesRaw !== null && typeof supersedesRaw !== 'string') {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'improvement candidate: supersedes must be a content digest or null',
    });
  }

  const target = expectFields(
    record['targetCapability'],
    ['kind', 'id', 'version', 'digest'],
    [],
    CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE,
    'improvement candidate targetCapability',
  );
  const baseline = expectFields(
    record['baseline'],
    ['bodyRef', 'substrateRef', 'runtimeRef'],
    [],
    CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE,
    'improvement candidate baseline',
  );

  const view: ImprovementCandidateView = {
    recordVersion: IMPROVEMENT_CANDIDATE_VERSION,
    candidateId: toNeutralId(
      typeof record['candidateId'] === 'string' ? record['candidateId'] : '',
      'improvement candidate candidateId',
    ),
    tenantId: toNeutralId(
      typeof record['tenantId'] === 'string' ? record['tenantId'] : '',
      'improvement candidate tenantId',
    ),
    sourceKind,
    sourceRecordRef: toContentDigest(
      typeof record['sourceRecordRef'] === 'string' ? record['sourceRecordRef'] : '',
      'improvement candidate sourceRecordRef',
    ),
    changedSurface,
    artifact: requireArtifact(record['artifact'], 'improvement candidate'),
    supersedes:
      supersedesRaw === null
        ? null
        : toContentDigest(supersedesRaw, 'improvement candidate supersedes'),
    targetCapability: deepFreeze({
      kind: target['kind'] as string,
      id: target['id'] as string,
      version: target['version'] as string,
      digest: target['digest'] as string,
    }),
    baseline: deepFreeze({
      bodyRef: baseline['bodyRef'] as string | null,
      substrateRef: baseline['substrateRef'] as string | null,
      runtimeRef: baseline['runtimeRef'] as string | null,
    }),
    experimentPlan: deepFreeze({
      taskPopulation: Object.freeze(
        (plan['taskPopulation'] as { taskId: string; version: string }[]).map((entry) =>
          Object.freeze({ ...entry }),
        ),
      ),
      evaluationSuiteRefs: Object.freeze([...(plan['evaluationSuiteRefs'] as string[])]),
      verificationSuiteRefs: Object.freeze([...(plan['verificationSuiteRefs'] as string[])]),
      environmentVersions: Object.freeze(
        (plan['environmentVersions'] as CandidateArtifactRef[]).map((entry) =>
          Object.freeze({ ...entry }),
        ),
      ),
      outcomeMetrics: Object.freeze(
        (plan['outcomeMetrics'] as {
          metricId: string;
          description: string;
          direction: string;
        }[]).map((entry) => Object.freeze({ ...entry })),
      ),
      uncertainty: deepFreeze({
        method: (plan['uncertainty'] as { method: string; notes: string | null }).method,
        notes: (plan['uncertainty'] as { method: string; notes: string | null }).notes,
      }),
      protectedCapabilities: Object.freeze(
        (plan['protectedCapabilities'] as {
          ref: { kind: string; id: string; version: string; digest: string };
          metricId: string;
          direction: string;
        }[]).map((entry) => Object.freeze({ ...entry })),
      ),
    }),
    evidenceRefs,
    rights: deepFreeze({
      status: rights['status'] as CandidateRightsStatus,
      statement: toNeutralText(
        typeof rights['statement'] === 'string' ? rights['statement'] : '',
        'improvement candidate rights statement',
      ),
    }),
    globalReuseRequested: record['globalReuseRequested'] === true,
    provenance: deepFreeze({
      capturedFrom: toNeutralId(
        typeof provenance['capturedFrom'] === 'string' ? provenance['capturedFrom'] : '',
        'improvement candidate provenance capturedFrom',
      ),
      capturedAt: toLearningTimestamp(
        typeof provenance['capturedAt'] === 'string' ? provenance['capturedAt'] : '',
        'improvement candidate provenance capturedAt',
      ),
      notes:
        provenance['notes'] === null
          ? null
          : toNeutralText(
              typeof provenance['notes'] === 'string' ? provenance['notes'] : '',
              'improvement candidate provenance notes',
            ),
    }),
  };
  const digest = toContentDigest(
    await digestCanonical(view),
    'improvement candidate digest',
  );
  return deepFreeze({ ...view, digest }) as ImprovementCandidate;
}

/**
 * The historical digests a candidate consumed — every digest the
 * compiler must NEVER propose as its own output (the LE1.0 learning
 * boundary): the source record, the evidence refs and the superseded
 * prior artifact.
 */
export function historicalDigestsOfCandidate(candidate: ImprovementCandidate): readonly string[] {
  return Object.freeze([
    candidate.sourceRecordRef as string,
    ...(candidate.evidenceRefs as readonly string[]),
    ...(candidate.supersedes === null ? [] : [candidate.supersedes as string]),
  ]);
}
