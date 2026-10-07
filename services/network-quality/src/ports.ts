/**
 * Network-quality service ports (Work Order C020) — the ONLY things
 * services/network-quality depends on besides the domain package
 * (@arena/network-quality) and @arena/protocol-core.
 *
 * Mirroring the sibling services' ports.ts discipline
 * (services/expert-performance, services/escalation-validation):
 *   - Clock        — time is INJECTED (the service never reads a wall
 *                    clock; architecture-lock rule 17);
 *   - ValidationOutcomeSourcePort — THE C009 SEAM: adjudication outcomes
 *                    are read-consumed through this injected port (never
 *                    a C009 edit);
 *   - VotingSourcePort           — THE C013 SEAM: competition voting data
 *                    (participants, submissions, judgments, denied
 *                    attempts) for the anti-gaming detection jobs;
 *   - PayoutAuditSourcePort      — THE C010 SEAM: payment audit events
 *                    for the fraud detection jobs;
 *   - IdentitySignalSourcePort / EngagementSignalSourcePort — the
 *                    registry/engagement identity-capacity seams;
 *   - DisputeStore / CoiStore / FindingStore / ReputationStore /
 *     EnforcementStore — persistence for the append-only C020 records
 *                    (durable + tenant-scoped; the reference fabric is
 *                    in-process — hosts wire the A015-era fabric);
 *   - NetworkQualityEventSink — event delivery
 *                    (network-quality.* envelope events);
 *   - ProfileEvidenceProposalSink / RequalificationProposalSink — the
 *     PROPOSAL surfaces: findings propose evidence into the C005 profile
 *     ingestion ports and requalification triggers into the C004 owning
 *     surface. Data-only; the owning surfaces accept through their own
 *     ports (AQ-1).
 *
 * Authority boundary (lock rule 16): the service OWNS dispute/COI/
 * finding/enforcement orchestration only. It NEVER writes into C005/
 * C009/C010/C013 state and NEVER grants authorization.
 */

import type {
  CompetitionOutcomeSourceData,
  CoiRecord,
  DisputeRecord,
  EngagementSignal,
  EnforcementCase,
  FindingRecord,
  IdentitySignal,
  PayoutAuditSignal,
  ProfileEvidenceProposal,
  RequalificationTriggerProposal,
  ReputationRecord,
  ValidationOutcomeSourceData,
  VotingJudgment,
  VotingParticipant,
  VotingSubmission,
  DeniedJudgmentAttempt,
} from '@arena/network-quality';
import type { Envelope } from '@arena/protocol-core';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

// ---------------------------------------------------------------------------
// The dep seams (C009 / C013 / C010 / registry / engagement)
// ---------------------------------------------------------------------------

/** The provenance-addressed lookup the C009 source port resolves by. */
export interface ValidationOutcomeLookup {
  readonly tenant: string;
  readonly requestId: string;
  /** The content digest of the C009 adjudication record (fail-closed match). */
  readonly refDigest: string;
}

/** THE C009 SEAM — adjudication outcomes read through the public port. */
export interface ValidationOutcomeSourcePort {
  resolveValidationOutcome(
    lookup: ValidationOutcomeLookup,
  ): Promise<ValidationOutcomeSourceData | null>;
}

/** The C013 voting data bundle one competition's controls run over. */
export interface CompetitionVotingData {
  readonly participants: readonly VotingParticipant[];
  readonly submissions: readonly VotingSubmission[];
  readonly judgments: readonly VotingJudgment[];
  readonly deniedAttempts: readonly DeniedJudgmentAttempt[];
  /** The C013 competition-level agreement outcomes (reputation source). */
  readonly competitionOutcomes: readonly CompetitionOutcomeSourceData[];
}

/** THE C013 SEAM — competition voting data read through the public port. */
export interface VotingSourcePort {
  listCompetitionVoting(tenant: string, competitionId: string): Promise<CompetitionVotingData | null>;
}

/** THE C010 SEAM — payment audit events read through the public port. */
export interface PayoutAuditSourcePort {
  listPayoutAuditEvents(tenant: string, sinceMs: number): Promise<readonly PayoutAuditSignal[]>;
}

/** The expert-registry identity-signal seam. */
export interface IdentitySignalSourcePort {
  listIdentitySignals(tenant: string): Promise<readonly IdentitySignal[]>;
}

/** The C011 engagement-signal seam (capacity gaming source). */
export interface EngagementSignalSourcePort {
  listEngagementSignals(tenant: string): Promise<readonly EngagementSignal[]>;
}

/** The full injected dep-port set (one per merged dep surface). */
export interface NetworkQualitySourcePorts {
  readonly validationOutcomes: ValidationOutcomeSourcePort;
  readonly voting: VotingSourcePort;
  readonly payoutAudit: PayoutAuditSourcePort;
  readonly identitySignals: IdentitySignalSourcePort;
  readonly engagementSignals: EngagementSignalSourcePort;
}

// ---------------------------------------------------------------------------
// Persistence (append-only, tenant-scoped)
// ---------------------------------------------------------------------------

/** Persistence port for dispute records (tenant-scoped). */
export interface DisputeStore {
  insert(record: DisputeRecord): Promise<void>;
  /** Replace the latest snapshot (transitions append into the record's own history). */
  update(record: DisputeRecord): Promise<void>;
  get(disputeId: string, tenant: string): Promise<DisputeRecord | undefined>;
}

/** Persistence port for the COI registry (tenant-scoped). */
export interface CoiStore {
  insert(record: CoiRecord): Promise<void>;
  update(record: CoiRecord): Promise<void>;
  list(tenant: string): Promise<readonly CoiRecord[]>;
}

/** Persistence port for findings (tenant-scoped). */
export interface FindingStore {
  insert(record: FindingRecord): Promise<void>;
  get(findingId: string, tenant: string): Promise<FindingRecord | undefined>;
  list(tenant: string): Promise<readonly FindingRecord[]>;
}

/** Persistence port for dimensional reputation records (tenant-scoped). */
export interface ReputationStore {
  insert(record: ReputationRecord): Promise<void>;
  list(tenant: string, expertId: string, family: string): Promise<readonly ReputationRecord[]>;
}

/** Persistence port for enforcement cases (tenant-scoped). */
export interface EnforcementStore {
  insert(record: EnforcementCase): Promise<void>;
  update(record: EnforcementCase): Promise<void>;
  get(caseId: string, tenant: string): Promise<EnforcementCase | undefined>;
}

/** The full injected store set. */
export interface NetworkQualityStores {
  readonly disputes: DisputeStore;
  readonly coi: CoiStore;
  readonly findings: FindingStore;
  readonly reputation: ReputationStore;
  readonly enforcement: EnforcementStore;
}

// ---------------------------------------------------------------------------
// Events + proposals
// ---------------------------------------------------------------------------

/** Event delivery (network-quality.* envelope events). */
export interface NetworkQualityEventSink {
  emit(event: Envelope<unknown>): Promise<void>;
}

/**
 * THE C005 PROPOSAL SEAM: findings propose profile evidence into the
 * C005 ingestion ports. The real C005 service (or the host mirroring
 * C009/C013 outcomes into the A007 match-history seam) implements this;
 * until AQ-1 lands the reference sink records proposals durably.
 */
export interface ProfileEvidenceProposalSink {
  proposeProfileEvidence(proposal: ProfileEvidenceProposal): Promise<void>;
}

/**
 * THE C004 PROPOSAL SEAM: requalification triggers are PROPOSALS to the
 * expert-calibration owning surface.
 */
export interface RequalificationProposalSink {
  proposeRequalificationTrigger(proposal: RequalificationTriggerProposal): Promise<void>;
}

/** The full injected sink set. */
export interface NetworkQualitySinks {
  readonly events: NetworkQualityEventSink;
  readonly profileEvidenceProposals: ProfileEvidenceProposalSink;
  readonly requalificationProposals: RequalificationProposalSink;
}
