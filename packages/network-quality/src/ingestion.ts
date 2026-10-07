/**
 * The FINDING/EVENT INGESTION MAPPING (Work Order C020): how evidence
 * derived from the merged dep public surfaces (C009 adjudication
 * outcomes, C013 competition outcomes, C010 payment records) becomes
 * dimensional REPUTATION records, and how findings PROPOSE actions into
 * the owning surfaces.
 *
 * Pure, CLOSED mapping tables only — never direct writes into dep state.
 * The source-data shapes are STRUCTURAL MIRRORS of the dep public read
 * surfaces (the house data-in-seam convention): the reference service
 * pulls them from the injected dep ports; the real C009/C013/C010
 * fabrics implement the ports.
 *
 * THE PROPOSAL LAW (C020): findings append evidence into the C005
 * profile through ITS ingestion ports and trigger requalification as
 * PROPOSALS to the owning surfaces. C005's closed evidence-source-family
 * vocabulary does not (yet) contain network-quality families -- so this
 * module produces typed PROFILE-EVIDENCE PROPOSALS carrying the C005
 * ingestion payload shape + the honest provenance surface; the C005
 * surface (or the host mirroring C009/C013 outcomes into the A007
 * match-history seam) accepts them through its own ports. Recorded as
 * architecture question AQ-1 in the PR.
 */

import { NETWORK_QUALITY_ERROR_CODES, NetworkQualityError } from './errors.js';
import {
  toNetworkQualityContentDigest,
  toNetworkQualityRecordId,
  toNetworkQualityTenant,
  toNetworkQualityTimestamp,
} from './shared.js';
import { createReputationRecord } from './reputation.js';
import type { CreateReputationRecordInput } from './reputation.js';
import { toSourceSurfaceFamily } from './vocabulary.js';

/** Wire version of the ingestion mapping shapes. */
export const INGESTION_MAPPING_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Structural mirrors of the dep public read surfaces
// ---------------------------------------------------------------------------

/** C009 AdjudicationOutcome legs (the validation-outcome history source). */
export interface ValidationOutcomeSourceData {
  /** The C009 closed verdict vocabulary. */
  readonly verdict: 'accepted' | 'revision_required' | 'rejected' | 'needs_more_evidence';
  readonly requestId: string;
  readonly tenantId: string;
  /** The expert whose delivered result was adjudicated. */
  readonly expertRef: string;
  readonly taskFamily: string;
  readonly recordDigest: string;
  readonly observedAt: string;
}

/** C013 competition-outcome legs (the agreement/disagreement pattern source). */
export interface CompetitionOutcomeSourceData {
  /**
   * The expert's competition-level agreement outcome: whether their
   * solution survived adjudication against peers (agreed), partially
   * survived (partial), was falsified (disagreed) or the competition was
   * inconclusive.
   */
  readonly agreement: 'agreed' | 'partial' | 'disagreed' | 'inconclusive';
  readonly competitionId: string;
  readonly tenantId: string;
  readonly expertRef: string;
  readonly taskFamily: string;
  readonly recordDigest: string;
  readonly observedAt: string;
}

/** A C020-owned record the reputation log ingests (dispute/COI/finding). */
export interface NetworkQualityRecordSourceData {
  readonly tenant: string;
  readonly expertRef: string;
  readonly recordDigest: string;
  readonly observedAt: string;
}

// ---------------------------------------------------------------------------
// Closed mapping tables
// ---------------------------------------------------------------------------

const VALIDATION_OUTCOME_MAP: Readonly<Record<string, string>> = Object.freeze({
  accepted: 'accepted',
  revision_required: 'accepted-with-revision',
  rejected: 'rejected',
  needs_more_evidence: 'inconclusive',
});

// ---------------------------------------------------------------------------
// Reputation-record mappers (pure, closed)
// ---------------------------------------------------------------------------

export interface MapValidationOutcomeInput {
  readonly recordId: string;
  readonly recordedAt: string;
  readonly source: ValidationOutcomeSourceData;
}

/** Map ONE C009 adjudication outcome into ONE validation-outcome reputation record. */
export function mapValidationOutcomeToReputation(
  input: MapValidationOutcomeInput,
): CreateReputationRecordInput {
  const outcome = VALIDATION_OUTCOME_MAP[input.source.verdict];
  if (outcome === undefined) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE, {
      message: `validation-outcome mapping: unknown C009 verdict: ${JSON.stringify(input.source.verdict)}`,
    });
  }
  toSourceSurfaceFamily('escalation-validation', 'validation-outcome', 'validation-outcome mapping');
  toNetworkQualityContentDigest(input.source.recordDigest, 'validation-outcome recordDigest');
  toNetworkQualityTimestamp(input.source.observedAt, 'validation-outcome observedAt');
  toNetworkQualityTenant(input.source.tenantId, 'validation-outcome tenantId');
  return {
    recordId: toNetworkQualityRecordId(input.recordId, 'validation-outcome recordId'),
    tenant: input.source.tenantId,
    expertId: input.source.expertRef,
    family: 'validation-outcome',
    outcome,
    applicability: { taskFamily: input.source.taskFamily },
    sampleSize: 1,
    observedAt: input.source.observedAt,
    recordedAt: toNetworkQualityTimestamp(input.recordedAt, 'validation-outcome recordedAt'),
    source: {
      surface: 'escalation-validation',
      refDigest: input.source.recordDigest,
      locator: input.source.requestId,
    },
  };
}

export interface MapCompetitionOutcomeInput {
  readonly recordId: string;
  readonly recordedAt: string;
  readonly source: CompetitionOutcomeSourceData;
}

/** Map ONE C013 competition outcome into ONE competition-agreement reputation record. */
export function mapCompetitionOutcomeToReputation(
  input: MapCompetitionOutcomeInput,
): CreateReputationRecordInput {
  toSourceSurfaceFamily(
    'adversarial-evaluation',
    'competition-agreement',
    'competition-agreement mapping',
  );
  toNetworkQualityContentDigest(input.source.recordDigest, 'competition-agreement recordDigest');
  toNetworkQualityTimestamp(input.source.observedAt, 'competition-agreement observedAt');
  toNetworkQualityTenant(input.source.tenantId, 'competition-agreement tenantId');
  return {
    recordId: toNetworkQualityRecordId(input.recordId, 'competition-agreement recordId'),
    tenant: input.source.tenantId,
    expertId: input.source.expertRef,
    family: 'competition-agreement',
    outcome: input.source.agreement,
    applicability: { taskFamily: input.source.taskFamily },
    sampleSize: 1,
    observedAt: input.source.observedAt,
    recordedAt: toNetworkQualityTimestamp(input.recordedAt, 'competition-agreement recordedAt'),
    source: {
      surface: 'adversarial-evaluation',
      refDigest: input.source.recordDigest,
      locator: input.source.competitionId,
    },
  };
}

export interface MapDisputeOutcomeInput {
  readonly recordId: string;
  readonly recordedAt: string;
  readonly dispute: NetworkQualityRecordSourceData;
  readonly resolutionOutcome: 'upheld' | 'partially-upheld' | 'dismissed' | 'inconclusive';
  readonly domain: string;
}

/** Map ONE resolved dispute into ONE dispute-outcome reputation record. */
export function mapDisputeOutcomeToReputation(
  input: MapDisputeOutcomeInput,
): CreateReputationRecordInput {
  toSourceSurfaceFamily('network-quality', 'dispute-outcome', 'dispute-outcome mapping');
  toNetworkQualityContentDigest(input.dispute.recordDigest, 'dispute-outcome recordDigest');
  toNetworkQualityTimestamp(input.dispute.observedAt, 'dispute-outcome observedAt');
  return {
    recordId: toNetworkQualityRecordId(input.recordId, 'dispute-outcome recordId'),
    tenant: input.dispute.tenant,
    expertId: input.dispute.expertRef,
    family: 'dispute-outcome',
    outcome: input.resolutionOutcome,
    applicability: { domain: input.domain },
    sampleSize: 1,
    observedAt: input.dispute.observedAt,
    recordedAt: toNetworkQualityTimestamp(input.recordedAt, 'dispute-outcome recordedAt'),
    source: {
      surface: 'network-quality',
      refDigest: input.dispute.recordDigest,
      locator: input.recordId,
    },
  };
}

export interface MapCoiRecordInput {
  readonly recordId: string;
  readonly recordedAt: string;
  readonly coi: NetworkQualityRecordSourceData;
  readonly outcome: 'conflict-declared' | 'conflict-derived' | 'none-declared';
  readonly domain: string;
}

/** Map ONE COI registry record into ONE coi-record reputation record. */
export function mapCoiRecordToReputation(input: MapCoiRecordInput): CreateReputationRecordInput {
  toSourceSurfaceFamily('network-quality', 'coi-record', 'coi-record mapping');
  toNetworkQualityContentDigest(input.coi.recordDigest, 'coi-record recordDigest');
  toNetworkQualityTimestamp(input.coi.observedAt, 'coi-record observedAt');
  return {
    recordId: toNetworkQualityRecordId(input.recordId, 'coi-record recordId'),
    tenant: input.coi.tenant,
    expertId: input.coi.expertRef,
    family: 'coi-record',
    outcome: input.outcome,
    applicability: { domain: input.domain },
    sampleSize: 1,
    observedAt: input.coi.observedAt,
    recordedAt: toNetworkQualityTimestamp(input.recordedAt, 'coi-record recordedAt'),
    source: {
      surface: 'network-quality',
      refDigest: input.coi.recordDigest,
      locator: input.recordId,
    },
  };
}

/** Map a resolved dispute into a reputation record (async convenience). */
export async function recordDisputeOutcomeEvidence(
  input: MapDisputeOutcomeInput,
): Promise<ReturnType<typeof createReputationRecord>> {
  return createReputationRecord(mapDisputeOutcomeToReputation(input));
}

// ---------------------------------------------------------------------------
// Conduct-flag mapping from findings
// ---------------------------------------------------------------------------

/** Which finding surfaces may book conduct-flag reputation evidence (closed). */
const FINDING_CONDUCT_SURFACE_MAP: Readonly<Record<string, string>> = Object.freeze({
  'adversarial-evaluation': 'adversarial-evaluation',
  payments: 'payments',
  'expert-engagement': 'expert-engagement',
  'expert-registry': 'expert-registry',
});

export interface MapFindingToConductFlagInput {
  readonly recordId: string;
  readonly recordedAt: string;
  readonly finding: {
    readonly tenant: string;
    readonly subjectParty: string;
    readonly digest: string;
    readonly observedAt: string;
    /** The surface the finding's FIRST evidence ref points at (closed). */
    readonly evidenceSurface: string;
    readonly kind: string;
    readonly severity: string;
    readonly domain: string;
  };
}

/**
 * Map ONE finding into ONE conduct-flag reputation record (the
 * dimensional record of gaming/fraud conduct). The flag outcome is
 * 'flag-raised' at detection; substantiation/dismissal is a LATER record
 * (append-only) -- never an in-place change.
 */
export function mapFindingToConductFlag(
  input: MapFindingToConductFlagInput,
): CreateReputationRecordInput {
  const surface = FINDING_CONDUCT_SURFACE_MAP[input.finding.evidenceSurface];
  if (surface === undefined) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE, {
      message: `conduct-flag mapping: finding evidence surface '${input.finding.evidenceSurface}' cannot book conduct-flag evidence (closed mapping)`,
      details: { known: Object.keys(FINDING_CONDUCT_SURFACE_MAP) },
    });
  }
  toSourceSurfaceFamily(surface, 'conduct-flag', 'conduct-flag mapping');
  toNetworkQualityContentDigest(input.finding.digest, 'conduct-flag finding digest');
  toNetworkQualityTimestamp(input.finding.observedAt, 'conduct-flag observedAt');
  toNetworkQualityTenant(input.finding.tenant, 'conduct-flag tenant');
  return {
    recordId: toNetworkQualityRecordId(input.recordId, 'conduct-flag recordId'),
    tenant: input.finding.tenant,
    expertId: input.finding.subjectParty,
    family: 'conduct-flag',
    outcome: 'flag-raised',
    applicability: { domain: input.finding.domain },
    sampleSize: 1,
    observedAt: input.finding.observedAt,
    recordedAt: toNetworkQualityTimestamp(input.recordedAt, 'conduct-flag recordedAt'),
    source: {
      surface: surface as CreateReputationRecordInput['source']['surface'],
      refDigest: input.finding.digest,
      locator: input.recordId,
    },
    notes: `finding ${input.finding.kind} (${input.finding.severity})`,
  };
}

// ---------------------------------------------------------------------------
// PROPOSALS into the owning surfaces (data, never writes)
// ---------------------------------------------------------------------------

/**
 * A requalification-trigger PROPOSAL (C004 is the owning surface): the
 * typed trigger + the evidence digests + the machine-readable reason.
 */
export interface RequalificationTriggerProposal {
  readonly proposalVersion: 1;
  readonly proposalKind: 'requalification-trigger-proposal';
  readonly tenant: string;
  readonly expertRef: string;
  /** The closed C020 trigger vocabulary. */
  readonly trigger: 'anti-gaming-finding' | 'fraud-finding' | 'dispute-outcome' | 'validation-outcome-trend';
  readonly evidenceDigests: readonly string[];
  readonly reason: string;
}

/** The closed C005 ingestion-target families (mirror of C005's vocabulary). */
export const PROFILE_EVIDENCE_TARGET_FAMILIES = Object.freeze([
  'expert-calibration-verdict',
  'expert-qualification-record',
  'expert-match-history',
  'skill-extraction-outcome',
  'learning-experiment-attribution',
] as const);

export type ProfileEvidenceTargetFamily =
  (typeof PROFILE_EVIDENCE_TARGET_FAMILIES)[number];

/**
 * A profile-evidence PROPOSAL into the C005 ingestion port: carries the
 * C005 append-Evidence payload shape + the HONEST provenance surface the
 * evidence derives from. The C005 surface accepts it through its own
 * ports (see AQ-1: C005's closed family vocabulary needs a
 * network-quality family or a host-wired mirror before these land).
 */
export interface ProfileEvidenceProposal {
  readonly proposalVersion: 1;
  readonly proposalKind: 'profile-evidence-proposal';
  readonly tenant: string;
  readonly expertId: string;
  /** The C005 closed source family the payload targets. */
  readonly targetFamily: ProfileEvidenceTargetFamily;
  /** The C005 closed dimension the payload targets. */
  readonly targetDimension: string;
  /** The C005 closed outcome for the dimension. */
  readonly targetOutcome: string;
  /** The sample size the evidence rests on. */
  readonly sampleSize: number;
  /** The content digest of the SOURCE record (provenance address). */
  readonly refDigest: string;
  /** The honest C020 provenance surface the evidence derives from. */
  readonly provenanceSurface: string;
  readonly reason: string;
}

export interface ProposeProfileEvidenceInput {
  readonly tenant: string;
  readonly expertId: string;
  readonly targetFamily: string;
  readonly targetDimension: string;
  readonly targetOutcome: string;
  readonly sampleSize: number;
  readonly refDigest: string;
  readonly provenanceSurface: string;
  readonly reason: string;
}

/**
 * Build ONE profile-evidence proposal. Fails closed on unknown C005
 * target families -- a proposal outside the C005 closed ingestion
 * vocabulary has no shape to travel in.
 */
export function proposeProfileEvidence(
  input: ProposeProfileEvidenceInput,
): ProfileEvidenceProposal {
  if (
    typeof input.targetFamily !== 'string' ||
    !(PROFILE_EVIDENCE_TARGET_FAMILIES as readonly string[]).includes(input.targetFamily)
  ) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE, {
      message: `profile-evidence proposal: unknown C005 target family: ${JSON.stringify(String(input.targetFamily))} -- the C005 ingestion vocabulary is closed (AQ-1)`,
      details: { known: PROFILE_EVIDENCE_TARGET_FAMILIES },
    });
  }
  if (typeof input.sampleSize !== 'number' || !Number.isInteger(input.sampleSize) || input.sampleSize < 1) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: 'profile-evidence proposal: sampleSize must be a positive integer',
    });
  }
  toNetworkQualityContentDigest(input.refDigest, 'profile-evidence refDigest');
  return {
    proposalVersion: 1 as const,
    proposalKind: 'profile-evidence-proposal' as const,
    tenant: toNetworkQualityTenant(input.tenant, 'profile-evidence tenant'),
    expertId: input.expertId,
    targetFamily: input.targetFamily as ProfileEvidenceTargetFamily,
    targetDimension: input.targetDimension,
    targetOutcome: input.targetOutcome,
    sampleSize: input.sampleSize,
    refDigest: input.refDigest,
    provenanceSurface: input.provenanceSurface,
    reason: input.reason,
  };
}

export interface ProposeRequalificationTriggerInput {
  readonly tenant: string;
  readonly expertRef: string;
  readonly trigger: RequalificationTriggerProposal['trigger'];
  readonly evidenceDigests: readonly string[];
  readonly reason: string;
}

/** Build ONE requalification-trigger proposal (C004 is the owning surface). */
export function proposeRequalificationTrigger(
  input: ProposeRequalificationTriggerInput,
): RequalificationTriggerProposal {
  if (!Array.isArray(input.evidenceDigests) || input.evidenceDigests.length === 0) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: 'requalification-trigger proposal: at least one evidence digest is required',
    });
  }
  for (const digest of input.evidenceDigests) {
    toNetworkQualityContentDigest(digest, 'requalification evidenceDigest');
  }
  return {
    proposalVersion: 1 as const,
    proposalKind: 'requalification-trigger-proposal' as const,
    tenant: toNetworkQualityTenant(input.tenant, 'requalification tenant'),
    expertRef: input.expertRef,
    trigger: input.trigger,
    evidenceDigests: Object.freeze([...input.evidenceDigests]),
    reason: input.reason,
  };
}
