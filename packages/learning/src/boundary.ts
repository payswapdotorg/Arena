/**
 * LearningBoundary guards (Work Order A020; spec LE1.0 "Learning
 * boundary"; architecture-lock rule 6 - historical evidence is
 * append-only and NEVER rewritten by learning; rule 5 - content
 * addressed immutability).
 *
 * LE1.0: "Learning may produce a new Body Version. Learning may never
 * rewrite historical trajectories, task/environment versions,
 * certification evidence or original customer records."
 *
 * The boundary is enforced in three layers:
 *
 *   1. READ-ONLY inputs - `freezeHistoricalInputs` deep-freezes every
 *      trajectory/evaluation/verification record handed to a learning
 *      computation and returns a frozen view; the hygiene + negative
 *      suites prove the sources stay bit-identical.
 *   2. PROPOSALS ARE NEW CONTENT-ADDRESSED OBJECTS - a
 *      `LearningProposal` references a NEW artifact digest (e.g. an
 *      A019 SkillDraft) with its explicit changed surface and the
 *      experiment run that motivates it. Supersession is APPEND-ONLY
 *      (`supersedes` names the PRIOR artifact; the prior stays
 *      addressable forever).
 *   3. REWRITE DETECTION - `checkLearningBoundary` REJECTS a proposal
 *      whose `proposedArtifactRef` collides with ANY historical digest
 *      the experiment consumed (`LEARNING_REWRITE_ATTEMPT`): proposing
 *      an existing historical artifact as the output of learning is a
 *      rewrite attempt by construction. The same guard rejects
 *      self-supersession.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { TrajectoryRecord } from '@arena/trajectory';
import type { EvaluationRecord } from '@arena/evaluation';
import type { VerificationRecord } from '@arena/verification';
import { LEARNING_ERROR_CODES, LearningError } from './errors.js';
import { INTERVENTION_SURFACES, isInterventionSurface } from './intervention-surface.js';
import type { InterventionSurface } from './intervention-surface.js';
import {
  deepFreeze,
  expectFields,
  isContentDigest,
  isLearningTimestamp,
  isLearningVersion,
  isNeutralId,
  isNeutralText,
  toContentDigest,
  toLearningId,
  toLearningTimestamp,
  toLearningVersion,
  toNeutralId,
  toNeutralText,
} from './shared.js';
import type { ContentDigest, LearningId, LearningTimestamp, LearningVersion, NeutralId, NeutralText } from './shared.js';
import type { ArmEvidence } from './attribution.js';

/** Wire version of the learning-proposal shape. */
export const LEARNING_PROPOSAL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Layer 1: read-only inputs
// ---------------------------------------------------------------------------

/**
 * Deep-freeze the historical records a learning computation reads and
 * return them as a frozen ArmEvidence view (lock rule 6 - learning is
 * read-only over the evidence tier). The inputs are NEVER mutated;
 * callers that later attempt mutation fail silently-or-loudly because
 * every level is frozen.
 */
export function freezeHistoricalInputs(arm: {
  readonly trajectories: readonly TrajectoryRecord[];
  readonly evaluations: readonly EvaluationRecord[];
  readonly verifications: readonly VerificationRecord[];
}): ArmEvidence {
  expectFields(
    arm,
    ['trajectories', 'evaluations', 'verifications'],
    [],
    LEARNING_ERROR_CODES.INVALID_RUN,
    'historical inputs',
  );
  for (const field of ['trajectories', 'evaluations', 'verifications'] as const) {
    const value = (arm as Record<string, unknown>)[field];
    if (!Array.isArray(value)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
        message: `historical inputs: ${field} must be an array of records`,
        details: { field },
      });
    }
  }
  return deepFreeze({
    trajectories: deepFreeze([...arm.trajectories]),
    evaluations: deepFreeze([...arm.evaluations]),
    verifications: deepFreeze([...arm.verifications]),
  });
}

// ---------------------------------------------------------------------------
// Layer 2: LearningProposal - proposals are NEW content-addressed objects
// ---------------------------------------------------------------------------

/** The digest-free view - exactly what the proposal digest commits to. */
export interface LearningProposalView {
  readonly recordVersion: typeof LEARNING_PROPOSAL_VERSION;
  readonly proposalId: LearningId;
  readonly version: LearningVersion;
  /** The digest of the NEW artifact being proposed (e.g. an A019 SkillDraft digest). */
  readonly proposedArtifactRef: ContentDigest;
  /** The EXPLICIT surface of the proposed artifact (LE1.0 nine). */
  readonly changedSurface: InterventionSurface;
  /** The experiment run record digest that motivates this proposal. */
  readonly basisExperimentRef: ContentDigest;
  /** Append-only supersession: the digest of the PRIOR artifact version, or null. */
  readonly supersedes: ContentDigest | null;
  readonly provenance: {
    readonly proposedBy: NeutralId;
    readonly proposedAt: LearningTimestamp;
    readonly notes: NeutralText | null;
  };
}

/** A frozen, content-addressed learning proposal: the view plus its sha256 digest. */
export interface LearningProposal extends LearningProposalView {
  readonly digest: ContentDigest;
}

/** Stable field list for the proposal view (tests + contracts mirror it). */
export const LEARNING_PROPOSAL_FIELDS = Object.freeze([
  'recordVersion',
  'proposalId',
  'version',
  'proposedArtifactRef',
  'changedSurface',
  'basisExperimentRef',
  'supersedes',
  'provenance',
] as const);

/** Stable field list for the proposal provenance. */
export const PROPOSAL_PROVENANCE_FIELDS = Object.freeze([
  'proposedBy',
  'proposedAt',
  'notes',
] as const);

export interface CreateLearningProposalInput {
  readonly proposalId: string;
  readonly version: string;
  readonly proposedArtifactRef: string;
  readonly changedSurface: string;
  readonly basisExperimentRef: string;
  readonly supersedes: string | null;
  readonly provenance: {
    readonly proposedBy: string;
    readonly proposedAt: string;
    readonly notes: string | null;
  };
}

/** Structural (non-throwing) check for the digest-free proposal view. */
export function isLearningProposalView(value: unknown): value is LearningProposalView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const provenance = candidate['provenance'];
  return (
    candidate['recordVersion'] === LEARNING_PROPOSAL_VERSION &&
    isNeutralId(candidate['proposalId']) &&
    isLearningVersion(candidate['version']) &&
    isContentDigest(candidate['proposedArtifactRef']) &&
    typeof candidate['changedSurface'] === 'string' &&
    typeof candidate['basisExperimentRef'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['basisExperimentRef']) &&
    (candidate['supersedes'] === null ||
      (typeof candidate['supersedes'] === 'string' && /^[0-9a-f]{64}$/.test(candidate['supersedes']))) &&
    typeof provenance === 'object' &&
    provenance !== null &&
    !Array.isArray(provenance) &&
    isNeutralId((provenance as Record<string, unknown>)['proposedBy']) &&
    isLearningTimestamp((provenance as Record<string, unknown>)['proposedAt']) &&
    ((provenance as Record<string, unknown>)['notes'] === null ||
      isNeutralText((provenance as Record<string, unknown>)['notes']))
  );
}

/** Structural (non-throwing) check for the full proposal (view + digest). */
export function isLearningProposal(value: unknown): value is LearningProposal {
  if (!isLearningProposalView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed learning
 * proposal. Rejects undeclared/ambiguous changed surfaces, malformed
 * digests, self-supersession and malformed provenance with typed
 * LearningErrors.
 */
export async function createLearningProposal(
  input: CreateLearningProposalInput,
): Promise<LearningProposal> {
  const record = expectFields(
    input,
    [
      'proposalId',
      'version',
      'proposedArtifactRef',
      'changedSurface',
      'basisExperimentRef',
      'supersedes',
      'provenance',
    ],
    [],
    LEARNING_ERROR_CODES.INVALID_PROPOSAL,
    'learning proposal',
  );

  const proposedArtifactRef = toContentDigest(
    typeof record['proposedArtifactRef'] === 'string' ? record['proposedArtifactRef'] : '',
    'learning proposal proposedArtifactRef',
  );
  const basisExperimentRef = toContentDigest(
    typeof record['basisExperimentRef'] === 'string' ? record['basisExperimentRef'] : '',
    'learning proposal basisExperimentRef',
  );
  const supersedesRaw = record['supersedes'];
  if (supersedesRaw !== null && typeof supersedesRaw !== 'string') {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_PROPOSAL, {
      message: 'learning proposal: supersedes must be a content digest or null',
    });
  }
  const supersedes =
    supersedesRaw === null
      ? null
      : toContentDigest(supersedesRaw, 'learning proposal supersedes');
  if (supersedes !== null && (supersedes as string) === (proposedArtifactRef as string)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_PROPOSAL, {
      message: 'learning proposal: an artifact cannot supersede itself (append-only supersession names a DIFFERENT prior artifact)',
      details: { proposedArtifactRef: proposedArtifactRef as string, supersedes: supersedes as string },
    });
  }

  const provenance = expectFields(
    record['provenance'],
    ['proposedBy', 'proposedAt', 'notes'],
    [],
    LEARNING_ERROR_CODES.INVALID_PROPOSAL,
    'learning proposal provenance',
  );
  const notes = provenance['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_PROPOSAL, {
      message: 'learning proposal provenance: notes must be neutral text or null',
    });
  }

  const view: LearningProposalView = {
    recordVersion: LEARNING_PROPOSAL_VERSION,
    proposalId: toLearningId(
      typeof record['proposalId'] === 'string' ? record['proposalId'] : '',
      'learning proposal proposalId',
    ),
    version: toLearningVersion(
      typeof record['version'] === 'string' ? record['version'] : '',
      'learning proposal version',
    ),
    proposedArtifactRef,
    changedSurface: (() => {
      const raw =
        typeof record['changedSurface'] === 'string' ? record['changedSurface'] : '';
      if (!isInterventionSurface(raw)) {
        throw new LearningError(LEARNING_ERROR_CODES.INVALID_PROPOSAL, {
          message: `learning proposal: changedSurface must be one of [${INTERVENTION_SURFACES.join(', ')}], got: ${JSON.stringify(raw)}`,
          details: { known: [...INTERVENTION_SURFACES] },
        });
      }
      return raw;
    })(),
    basisExperimentRef,
    supersedes,
    provenance: {
      proposedBy: toNeutralId(
        typeof provenance['proposedBy'] === 'string' ? provenance['proposedBy'] : '',
        'learning proposal provenance proposedBy',
      ),
      proposedAt: toLearningTimestamp(
        typeof provenance['proposedAt'] === 'string' ? provenance['proposedAt'] : '',
        'learning proposal provenance proposedAt',
      ),
      notes: notes === null ? null : toNeutralText(notes, 'proposal notes'),
    },
  };
  const digest = toContentDigest(
    await digestCanonical(view),
    'learning proposal digest',
  );
  return deepFreeze({ ...view, digest }) as LearningProposal;
}

// ---------------------------------------------------------------------------
// Layer 3: rewrite detection
// ---------------------------------------------------------------------------

/**
 * The set of historical digests one experiment run consumed: every
 * trajectory chain head, every evaluation digest and every
 * verification digest of both arms, plus the descriptor digest.
 * Learning may NEVER propose any of these as its own output.
 */
export function historicalDigestsOfRun(args: {
  readonly descriptorRef: string;
  readonly baseline: ArmEvidence;
  readonly intervention: ArmEvidence;
}): readonly string[] {
  const digests = new Set<string>();
  digests.add(args.descriptorRef);
  for (const arm of [args.baseline, args.intervention]) {
    for (const trajectory of arm.trajectories) digests.add(trajectory.chainHead as string);
    for (const evaluation of arm.evaluations) digests.add(evaluation.digest as string);
    for (const verification of arm.verifications) digests.add(verification.digest as string);
  }
  return Object.freeze([...digests]);
}

/**
 * THE learning-boundary guard: reject a proposal whose proposed
 * artifact digest collides with ANY historical digest the experiment
 * consumed (a rewrite attempt by construction) - LEARNING_REWRITE_ATTEMPT.
 * Also rejects a supersession that points at a historical digest the
 * proposal would claim to supersede-in-place rather than append after.
 *
 * Accepts the proposal otherwise: learning proposes NEW
 * content-addressed objects; history stays append-only.
 */
export function checkLearningBoundary(
  historical: readonly string[],
  proposal: LearningProposal,
): void {
  const historicalSet = new Set(historical);
  if (historicalSet.has(proposal.proposedArtifactRef as string)) {
    throw new LearningError(LEARNING_ERROR_CODES.REWRITE_ATTEMPT, {
      message: `learning boundary violation: proposal ${proposal.proposalId} proposes artifact digest ${(proposal.proposedArtifactRef as string).slice(0, 16)}… which IS a historical digest the experiment consumed - learning never rewrites historical trajectories, evaluation/verification records or descriptors (architecture-lock rule 6)`,
      details: {
        proposalId: proposal.proposalId,
        proposedArtifactRef: proposal.proposedArtifactRef,
      },
    });
  }
  if (
    proposal.supersedes !== null &&
    historicalSet.has(proposal.supersedes as string) &&
    (proposal.supersedes as string) === (proposal.basisExperimentRef as string)
  ) {
    throw new LearningError(LEARNING_ERROR_CODES.REWRITE_ATTEMPT, {
      message: 'learning boundary violation: a proposal cannot supersede the experiment record that motivates it (proposals append AFTER the run record; they never replace it)',
      details: {
        proposalId: proposal.proposalId,
        supersedes: proposal.supersedes,
        basisExperimentRef: proposal.basisExperimentRef,
      },
    });
  }
}

/**
 * Create AND boundary-check a learning proposal in one step: the
 * proposal is constructed, then checked against the historical digests
 * - a rewrite attempt never yields a proposal object.
 */
export async function proposeLearningArtifact(
  input: CreateLearningProposalInput,
  historical: readonly string[],
): Promise<LearningProposal> {
  const proposal = await createLearningProposal(input);
  checkLearningBoundary(historical, proposal);
  return proposal;
}
