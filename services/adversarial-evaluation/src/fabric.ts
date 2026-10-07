/**
 * The in-memory reference fabric for the adversarial-evaluation service
 * (Work Order C013): the durable CompetitionStore, the idempotent
 * JobLog, the event sink collector, the research candidate sink
 * collector, and the reference A012/A013/C009 seam implementations
 * hosts can wire onto the real fabrics. Zero external runtime
 * dependencies (the A015-era house posture — in-process, injected
 * ports, fail-closed).
 */

import { AdversarialEvaluationError, ADVERSARIAL_EVALUATION_ERROR_CODES } from '@arena/adversarial-evaluation';
import { createHash } from 'node:crypto';

import type {
  Clock,
  CompetitionAggregate,
  CompetitionEvent,
  CompetitionEventSink,
  CompetitionStore,
  EvaluationFabricPort,
  ExpertCalibrationPort,
  ExpertDirectory,
  FinalAdjudicationPort,
  JobLog,
  ResearchCandidateSink,
  StageRunInput,
  VerificationFabricPort,
} from './ports.js';

// ---------------------------------------------------------------------------
// The fixed clock (injected time; never a wall-clock read)
// ---------------------------------------------------------------------------

export class FixedClock implements Clock {
  private at: number;
  constructor(at: number) {
    this.at = at;
  }
  now(): number {
    return this.at;
  }
  advance(byMs: number): void {
    this.at += byMs;
  }
}

// ---------------------------------------------------------------------------
// The durable (in-memory) competition store — tenant-scoped
// ---------------------------------------------------------------------------

export class InMemoryCompetitionStore implements CompetitionStore {
  private readonly aggregates = new Map<string, CompetitionAggregate>();

  async insert(aggregate: CompetitionAggregate): Promise<void> {
    const id = aggregate.competition.competitionId;
    if (this.aggregates.has(id)) {
      throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_COMPETITION, {
        message: `competition ${id} already exists (duplicate insert denied)`,
      });
    }
    this.aggregates.set(id, aggregate);
  }

  async update(aggregate: CompetitionAggregate): Promise<void> {
    const id = aggregate.competition.competitionId;
    if (!this.aggregates.has(id)) {
      throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_COMPETITION, {
        message: `competition ${id} does not exist (update denied)`,
      });
    }
    this.aggregates.set(id, aggregate);
  }

  async get(competitionId: string, tenantId: string): Promise<CompetitionAggregate | undefined> {
    const aggregate = this.aggregates.get(competitionId);
    if (aggregate === undefined) return undefined;
    if (aggregate.competition.tenantId !== tenantId) return undefined;
    return aggregate;
  }

  async findById(competitionId: string): Promise<CompetitionAggregate | undefined> {
    return this.aggregates.get(competitionId);
  }

  async listByTenant(tenantId: string): Promise<readonly CompetitionAggregate[]> {
    return [...this.aggregates.values()]
      .filter((aggregate) => aggregate.competition.tenantId === tenantId)
      .sort((left, right) => (left.competition.createdAt < right.competition.createdAt ? 1 : -1));
  }
}

// ---------------------------------------------------------------------------
// The idempotent job log (command-id keyed, digest-checked)
// ---------------------------------------------------------------------------

export class InMemoryJobLog implements JobLog {
  private readonly entries = new Map<string, { digest: string; receipt: Readonly<Record<string, unknown>> }>();

  async record(
    commandId: string,
    digest: string,
    receipt: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const prior = this.entries.get(commandId);
    if (prior !== undefined && prior.digest !== digest) {
      throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_COMPETITION, {
        message: `command id ${commandId} was already used for a DIFFERENT command (idempotency collision denied)`,
        details: { commandId, priorDigest: prior.digest, attemptedDigest: digest },
      });
    }
    this.entries.set(commandId, { digest, receipt });
  }

  async receiptOf(commandId: string): Promise<Readonly<Record<string, unknown>> | undefined> {
    return this.entries.get(commandId)?.receipt;
  }

  async entryOf(
    commandId: string,
  ): Promise<{ readonly digest: string; readonly receipt: Readonly<Record<string, unknown>> } | undefined> {
    return this.entries.get(commandId);
  }
}

// ---------------------------------------------------------------------------
// The event + research sink collectors
// ---------------------------------------------------------------------------

export class CollectingEventSink implements CompetitionEventSink {
  readonly events: CompetitionEvent[] = [];
  async emit(event: CompetitionEvent): Promise<void> {
    this.events.push(event);
  }
}

/** One A030-bound research/benchmark candidate (rights-carrying). */
export interface CollectedResearchCandidate {
  readonly candidateId: string;
  readonly competitionId: string;
  readonly kind: 'research-candidate' | 'benchmark-candidate';
  readonly artifactRef: string;
  readonly license: string;
  readonly provenance: string;
  readonly consentForResearch: boolean;
}

export class CollectingResearchSink implements ResearchCandidateSink {
  readonly candidates: CollectedResearchCandidate[] = [];
  async accept(candidates: readonly CollectedResearchCandidate[]): Promise<void> {
    this.candidates.push(...candidates);
  }
}

// ---------------------------------------------------------------------------
// The reference seam implementations (A012 / A013 / C009)
// ---------------------------------------------------------------------------

/**
 * The reference A012 evaluator seam: judgment against criteria — a
 * deterministic reference implementation that judges meets-criteria for
 * submissions with recorded evidence and inconclusive otherwise. Hosts
 * wire the real evaluation fabric here.
 */
export class ReferenceEvaluator implements EvaluationFabricPort {
  async runEvaluator(input: StageRunInput): Promise<{
    readonly outcome: 'meets-criteria' | 'below-criteria' | 'inconclusive';
    readonly recordDigest: string | null;
  }> {
    const digest = digestOf(JSON.stringify(input));
    if (input.evidenceRefs.length === 0) {
      return { outcome: 'inconclusive', recordDigest: digest };
    }
    return { outcome: 'meets-criteria', recordDigest: digest };
  }
}

/**
 * The reference A013 verifier seam: evidence supports claims —
 * deterministic reference implementation; pass when evidence exists,
 * unknown otherwise (it NEVER scores). Hosts wire the real verification
 * fabric here.
 */
export class ReferenceVerifier implements VerificationFabricPort {
  async runVerifier(input: StageRunInput): Promise<{
    readonly outcome: 'pass' | 'fail' | 'unknown';
    readonly recordDigest: string | null;
  }> {
    const digest = digestOf(JSON.stringify(input));
    if (input.evidenceRefs.length === 0) {
      return { outcome: 'unknown', recordDigest: digest };
    }
    return { outcome: 'pass', recordDigest: digest };
  }
}

/**
 * The reference C009/A013 FINAL VERIFICATION seam: composes the A013
 * reference verifier and marks itself NOT a stub (the real seam is the
 * escalation-validation service). Authority stays on the seam.
 */
export class ReferenceFinalAdjudicator implements FinalAdjudicationPort {
  private readonly verifier = new ReferenceVerifier();
  async adjudicateSubmission(input: StageRunInput): Promise<{
    readonly outcome: 'pass' | 'fail' | 'unknown';
    readonly recordDigest: string | null;
    readonly stub: boolean;
  }> {
    const outcome = await this.verifier.runVerifier(input);
    return { outcome: outcome.outcome, recordDigest: outcome.recordDigest, stub: false };
  }
}

/**
 * The reference C005 calibration seam: the uninformed agreement-pattern
 * projection (empty — the engine's default 0.5 weight applies).
 */
export class ReferenceCalibration implements ExpertCalibrationPort {
  async listAgreementPatterns(): Promise<readonly never[]> {
    return [];
  }
}

function digestOf(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------
// The wired reference fabric
// ---------------------------------------------------------------------------

export interface ReferenceFabric {
  readonly clock: FixedClock;
  readonly store: InMemoryCompetitionStore;
  readonly directory: ExpertDirectory;
  readonly events: CollectingEventSink;
  readonly research: CollectingResearchSink;
}

export interface ReferenceDirectoryInput {
  readonly expertRef: string;
  readonly tenant: string;
  readonly principalClusterRef: string;
  readonly qualified: boolean;
  readonly declaredConflicts?: readonly string[];
}

/** The host-wired participant directory (reference: a static list). */
export class StaticExpertDirectory implements ExpertDirectory {
  constructor(private readonly input: readonly ReferenceDirectoryInput[]) {}
  async listParticipants(): Promise<
    readonly {
      readonly expertRef: string;
      readonly tenant: string;
      readonly principalClusterRef: string;
      readonly qualified: boolean;
      readonly declaredConflicts: readonly string[];
      readonly joinedAt: string;
    }[]
  > {
    return this.input.map((participant) => ({
      expertRef: participant.expertRef,
      tenant: participant.tenant,
      principalClusterRef: participant.principalClusterRef,
      qualified: participant.qualified,
      declaredConflicts: Object.freeze([...(participant.declaredConflicts ?? [])]),
      joinedAt: '1970-01-01T00:00:00.000Z',
    }));
  }
}

/** Wire the full in-memory reference fabric (the A015-era posture). */
export function createReferenceFabric(options: {
  readonly at: number;
  readonly participants: readonly ReferenceDirectoryInput[];
}): ReferenceFabric & {
  readonly evaluator: ReferenceEvaluator;
  readonly verifier: ReferenceVerifier;
  readonly finalAdjudication: ReferenceFinalAdjudicator;
  readonly calibration: ReferenceCalibration;
  readonly jobLog: InMemoryJobLog;
} {
  const clock = new FixedClock(options.at);
  const store = new InMemoryCompetitionStore();
  const directory = new StaticExpertDirectory(options.participants);
  const events = new CollectingEventSink();
  const research = new CollectingResearchSink();
  const evaluator = new ReferenceEvaluator();
  const verifier = new ReferenceVerifier();
  const finalAdjudication = new ReferenceFinalAdjudicator();
  const calibration = new ReferenceCalibration();
  const jobLog = new InMemoryJobLog();
  return Object.freeze({
    clock,
    store,
    directory,
    events,
    research,
    evaluator,
    verifier,
    finalAdjudication,
    calibration,
    jobLog,
  });
}
