/**
 * Adversarial-evaluation service ports (Work Order C013) — the ONLY
 * things services/adversarial-evaluation depends on besides the domain
 * package (@arena/adversarial-evaluation, @arena/escalation-validation
 * for the C009 seam vocabulary, @arena/protocol-core).
 *
 * Mirroring the sibling services' ports.ts discipline
 * (services/escalation-validation, services/escalation-routing):
 *   - Clock                  — time is INJECTED (never a wall-clock
 *                              read; architecture-lock rule 17);
 *   - CompetitionStore       — durable, tenant-scoped persistence for
 *                              the append-only competition aggregate;
 *   - ExpertDirectory        — THE C004/C005 SEAM: participants with
 *                              qualification, principal-cluster identity
 *                              and declared conflicts;
 *   - EvaluationFabricPort   — THE A012 SEAM: the task-specific
 *                              evaluator (judgment against criteria;
 *                              never establishes evidence);
 *   - VerificationFabricPort — THE A013 SEAM: the verifier (evidence
 *                              supports claims; never scores);
 *   - FinalAdjudicationPort  — THE C009/A013 SEAM: final verification
 *                              AUTHORITY stays in escalation-validation
 *                              / Verification — this service composes
 *                              with it, never claims it;
 *   - CompetitionEventSink   — competition.*.updated event delivery;
 *   - ResearchCandidateSink — THE A030 SEAM: byproduct candidates
 *                              (rights/provenance-carrying).
 *
 * Boundary rule B2: a service may not import another service's
 * internals — the seams above are structural mirrors hosts wire to the
 * real fabrics (the escalation-validation precedent).
 */

import type {
  AgreementPatternInput,
  CompetitionResult,
  CommunitySignal,
} from '@arena/adversarial-evaluation';
import type { CompetitionParticipant } from '@arena/adversarial-evaluation';
import type {
  CompetitionRecord,
  CompetitionSubmission,
  JudgmentRecord,
} from '@arena/adversarial-evaluation';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** The append-only competition aggregate (lifecycle + submissions + judgments). */
export interface CompetitionAggregate {
  readonly competition: CompetitionRecord;
  readonly submissions: readonly CompetitionSubmission[];
  readonly judgments: readonly JudgmentRecord[];
  /** The derived result (present once adjudication has run). */
  readonly result: CompetitionResult | null;
  /** The per-submission community discovery signals (labelled, verdict-free). */
  readonly signals: readonly CommunitySignal[];
}

/** Persistence port for the competition aggregate (tenant-scoped). */
export interface CompetitionStore {
  /** Persist a NEW competition aggregate; throws on duplicate competition id. */
  insert(aggregate: CompetitionAggregate): Promise<void>;
  /** Replace the latest snapshot of an existing aggregate (append-only history inside). */
  update(aggregate: CompetitionAggregate): Promise<void>;
  /** Tenant-scoped lookup (cross-tenant reads return undefined). */
  get(competitionId: string, tenantId: string): Promise<CompetitionAggregate | undefined>;
  /** INTERNAL unscoped lookup — used ONLY to produce the typed cross-tenant failure. */
  findById(competitionId: string): Promise<CompetitionAggregate | undefined>;
  /** Tenant-scoped listing (newest first). */
  listByTenant(tenantId: string): Promise<readonly CompetitionAggregate[]>;
}

/**
 * THE C004/C005 SEAM — host-wired participants carrying qualification,
 * principal-cluster identity (duplicate-account guardrail) and declared
 * conflicts. HOST CONTRACT: the directory returns experts of the tenant
 * or the reserved global `public` scope; the service double-guards this
 * and eliminates cross-tenant participants.
 */
export interface ExpertDirectory {
  listParticipants(tenantId: string): Promise<readonly CompetitionParticipant[]>;
}

/** The shared input of one A012/A013 stage run over a submission. */
export interface StageRunInput {
  readonly competitionId: string;
  readonly tenantId: string;
  readonly submissionId: string;
  readonly authorExpertRef: string;
  readonly task: CompetitionRecord['task'];
  readonly evidenceRefs: readonly string[];
  readonly now: number;
}

/** THE A012 SEAM — the task-specific evaluator (judgment against criteria; NEVER establishes evidence). */
export interface EvaluationFabricPort {
  runEvaluator(input: StageRunInput): Promise<{
    readonly outcome: 'meets-criteria' | 'below-criteria' | 'inconclusive';
    readonly recordDigest: string | null;
  }>;
}

/** THE A013 SEAM — the verifier (evidence supports claims; NEVER scores). */
export interface VerificationFabricPort {
  runVerifier(input: StageRunInput): Promise<{
    readonly outcome: 'pass' | 'fail' | 'unknown';
    readonly recordDigest: string | null;
  }>;
}

/**
 * THE C009/A013 SEAM — final verification authority. An object with
 * `adjudicateSubmission(input)` satisfies it; hosts wire the C009
 * escalation-validation service / the A013 verification fabric. The
 * competition service COMPOSES with this seam; it never overrides it
 * and never claims its authority (lock rule 34).
 */
export interface FinalAdjudicationPort {
  adjudicateSubmission(input: StageRunInput): Promise<{
    readonly outcome: 'pass' | 'fail' | 'unknown';
    readonly recordDigest: string | null;
    /** FALSE on real fabrics; TRUE only while a host runs a stub. */
    readonly stub: boolean;
  }>;
}

/**
 * THE C005 SEAM (historical calibration + agreement patterns) — the
 * read-surface projections the adjudication engine weights votes by.
 */
export interface ExpertCalibrationPort {
  listAgreementPatterns(tenantId: string): Promise<readonly AgreementPatternInput[]>;
}

// ---------------------------------------------------------------------------
// Events + research candidates
// ---------------------------------------------------------------------------

export const COMPETITION_EVENT_TYPES = Object.freeze([
  'competition.opened',
  'competition.state_changed',
  'competition.submission.recorded',
  'competition.judgment.recorded',
  'competition.judgment.denied',
  'competition.result.derived',
] as const);
export type CompetitionEventType = (typeof COMPETITION_EVENT_TYPES)[number];

export interface CompetitionEvent {
  readonly eventId: string;
  readonly competitionId: string;
  readonly tenantId: string;
  readonly type: CompetitionEventType;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Competition webhook event delivery (competition.*.updated et al.). */
export interface CompetitionEventSink {
  emit(event: CompetitionEvent): Promise<void>;
}

/**
 * THE A030 SEAM — byproduct candidates (adversarial trajectories,
 * disagreement data, benchmark material) with rights/provenance. The
 * research surfaces own admission; this sink delivers candidates only.
 */
export interface ResearchCandidateSink {
  accept(candidates: readonly {
    readonly candidateId: string;
    readonly competitionId: string;
    readonly kind: 'research-candidate' | 'benchmark-candidate';
    readonly artifactRef: string;
    readonly license: string;
    readonly provenance: string;
    readonly consentForResearch: boolean;
  }[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Durable idempotent jobs (the A015 fabric conventions)
// ---------------------------------------------------------------------------

/**
 * The job log every command runs through: a command id is durably
 * recorded with its receipt; replaying the SAME command id returns the
 * SAME receipt (idempotency; architecture-lock rule 17), and a
 * DIFFERENT command with the same id fails closed.
 */
export interface JobLog {
  /** Record a completed job; throws on duplicate command id with a different digest. */
  record(commandId: string, digest: string, receipt: Readonly<Record<string, unknown>>): Promise<void>;
  /** The receipt of a previously completed command (undefined when unseen). */
  receiptOf(commandId: string): Promise<Readonly<Record<string, unknown>> | undefined>;
  /** The full entry (digest + receipt) of a previously completed command. */
  entryOf(commandId: string): Promise<
    | { readonly digest: string; readonly receipt: Readonly<Record<string, unknown>> }
    | undefined
  >;
}
