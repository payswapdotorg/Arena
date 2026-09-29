/**
 * Typed workbench view-models + pure projection functions (Work Order
 * A017; requirements R7/R8 qualification + matching UX, R10 trajectory
 * visibility, R26 async-jobs visibility, R41 graceful degradation).
 *
 * Every view-model is DERIVED from the domain packages' public types via
 * digest refs — domain types are REFERENCED (type-only imports), never
 * redefined — and every projection is a pure function over its input
 * that returns a DEEP-FROZEN view. Projections never mutate their
 * inputs: they only read.
 *
 * Malformed domain objects fail CLOSED with a typed WorkbenchError
 * naming the surface and index — never a crash, never a silently empty
 * page. Structural validation uses the DOMAIN PACKAGES' exported guard
 * predicates (isExpertProfile, isCompetencyClaim, …): the ONLY runtime
 * (value) imports from the domain packages in this package (disclosed in
 * the README; everything else is type-only — the A018 discipline). The
 * repo convention is to reuse protocol-level validation rather than
 * reimplement it.
 *
 * View-model families (one per workbench section):
 *   - ExpertDirectoryView  ← A006 ExpertProfile + A007 claims/records
 *   - TaskQueueView        ← A008 TaskSpec + CompilationRecord
 *                             + A007 MatchResult (matching UX, R8)
 *   - TrajectoryFeedView   ← A011 TrajectoryRecord (read-only, R10)
 *   - JobStatusView        ← A015 JobRecord + events (R26)
 *   - WorkbenchOverviewView← aggregate counts + degradation rollup
 *
 * EVERY view carries an explicit `degradation: DegradationState`
 * (R41): derived from the corpus's per-section supply state, so the
 * degraded mode can never drift from the data it annotates.
 */

import {
  isCompetencyClaim,
  isMatchResult,
  isQualificationRecord,
} from '@arena/expert-qualification';
import type {
  CompetencyClaim,
  MatchResult,
  QualificationRecord,
} from '@arena/expert-qualification';
import { isExpertProfile } from '@arena/expert-registry';
import type { ExpertProfile } from '@arena/expert-registry';
import { isJobRecord } from '@arena/job-protocol';
import type { JobRecord } from '@arena/job-protocol';
import { isCompilationRecord, isTaskSpec } from '@arena/task-spec';
import type { TaskSpec } from '@arena/task-spec';
import { isTrajectoryRecord } from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';

import type { WorkbenchCorpus } from './corpus.js';
import { WORKBENCH_ERROR_CODES, WorkbenchError } from './errors.js';
import { deepFreeze } from './freeze.js';
import {
  degradationMode,
  type DegradationState,
  mergeDegradation,
  noDegradation,
} from './degradation.js';

// ---------------------------------------------------------------------------
// View-model primitives
// ---------------------------------------------------------------------------

/** A digest ref as shown in the workbench: full sha256 hex. */
export type ViewDigest = string;

/** One entry of a status breakdown (aggregates). */
export interface StatusCount {
  readonly status: string;
  readonly count: number;
}

/** Deterministic JSON (sorted keys at every depth) for payload summaries. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const body = keys
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Deterministically count statuses (sorted by status). */
function countStatuses(statuses: readonly string[]): readonly StatusCount[] {
  const counts = new Map<string, number>();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  return deepFreeze(
    [...counts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => a.status.localeCompare(b.status)),
  );
}

// ---------------------------------------------------------------------------
// ExpertDirectoryView (R7: qualification states; R41: degradation)
// ---------------------------------------------------------------------------

/** One qualification line: a claim's LATEST evaluated state (A007). */
export interface ExpertQualificationLineView {
  /** The claimed capability/skill node, `kind/id@version`. */
  readonly capability: string;
  readonly proficiency: string;
  /** The qualification record's status (qualified/stale/expired/…). */
  readonly status: string;
  readonly evaluatedAt: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly claimDigest: ViewDigest;
  readonly recordDigest: ViewDigest;
}

/** One directory entry: an expert's registry profile + qualification states. */
export interface ExpertDirectoryEntryView {
  readonly tenant: string;
  readonly expertId: string;
  readonly version: string;
  /** Registry lifecycle status (draft/published/suspended/retired). */
  readonly status: string;
  readonly competencyCount: number;
  readonly competencyRefs: readonly string[];
  /** Qualification states from A007 records (deterministic join via claims). */
  readonly qualifications: readonly ExpertQualificationLineView[];
  readonly qualificationStatusBreakdown: readonly StatusCount[];
  readonly availabilitySummary: string;
  readonly completedTasks: number;
  readonly failedTasks: number;
  readonly noResponseEvents: number;
  readonly taskHistoryCount: number;
  readonly evidenceCount: number;
  readonly domainScopeSummary: string;
  readonly jurisdictions: readonly string[];
  readonly limitations: readonly string[];
  /** Content digest of the exact profile state this entry was derived from. */
  readonly digest: ViewDigest;
}

/** The expert directory (/experts). */
export interface ExpertDirectoryView {
  readonly kind: 'expert-directory';
  readonly entries: readonly ExpertDirectoryEntryView[];
  readonly expertCount: number;
  /** Claims whose LATEST record is `qualified` (R7 outcome rollup). */
  readonly qualifiedClaimCount: number;
  readonly lifecycleStatusBreakdown: readonly StatusCount[];
  readonly degradation: DegradationState;
}

/** Validate one profile (typed error with index; fail closed). */
function assertProfile(profile: unknown, index: number): ExpertProfile {
  if (!isExpertProfile(profile)) {
    throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_EXPERT_PROFILE, {
      surface: 'expert directory profile',
      index,
      digest: typeof (profile as { digest?: unknown })?.digest === 'string'
        ? (profile as { digest: string }).digest
        : undefined,
    });
  }
  return profile;
}

/** Validate one claim (typed error with index; fail closed). */
function assertClaim(claim: unknown, index: number): CompetencyClaim {
  if (!isCompetencyClaim(claim)) {
    throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_COMPETENCY_CLAIM, {
      surface: 'expert directory competency claim',
      index,
    });
  }
  return claim;
}

/** Validate one qualification record (typed error with index; fail closed). */
function assertQualificationRecord(record: unknown, index: number): QualificationRecord {
  if (!isQualificationRecord(record)) {
    throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_QUALIFICATION_RECORD, {
      surface: 'expert directory qualification record',
      index,
    });
  }
  return record;
}

/** Validate one match result (typed error with index; fail closed). */
function assertMatchResult(result: unknown, index: number): MatchResult {
  if (!isMatchResult(result)) {
    throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_MATCH_RESULT, {
      surface: 'task queue match result',
      index,
    });
  }
  return result;
}

/** Availability summary: `<recurrence> <start>-<end> UTC` per window. */
function availabilitySummaryOf(profile: ExpertProfile): string {
  const windows = profile.availability.windows.map(
    (window) => `${window.recurrence} ${window.startUtc}-${window.endUtc} UTC`,
  );
  const note = profile.availability.note;
  return windows.length === 0
    ? note ?? 'no availability declared'
    : note === undefined
      ? windows.join('; ')
      : `${windows.join('; ')} (${note})`;
}

/** Domain-scope summary: domains + jurisdictions + explicit limitations. */
function domainScopeSummaryOf(profile: ExpertProfile): string {
  const parts: string[] = [];
  const domains = profile.domainScope.domains.map(
    (domain) => `${domain.kind}/${domain.id}@${domain.version}`,
  );
  if (domains.length > 0) parts.push(domains.join(', '));
  const jurisdictions = profile.domainScope.jurisdictions.map(
    (jurisdiction) => jurisdiction.region === undefined
      ? jurisdiction.country
      : `${jurisdiction.country}-${jurisdiction.region}`,
  );
  if (jurisdictions.length > 0) parts.push(`jurisdictions: ${jurisdictions.join(', ')}`);
  const limitations = profile.domainScope.limitations.map(
    (limitation) => `${limitation.class}: ${limitation.statement}`,
  );
  if (limitations.length > 0) parts.push(`limitations: ${limitations.join('; ')}`);
  return parts.length === 0 ? 'no domain scope declared' : parts.join(' · ');
}

/** Reliability counts, recomputed from the append-only ledger (§8). */
function reliabilityCountsOf(profile: ExpertProfile): {
  completed: number;
  failed: number;
  noResponse: number;
} {
  let completed = 0;
  let failed = 0;
  let noResponse = 0;
  for (const entry of profile.reliability) {
    if (entry.kind === 'task-completed') completed += 1;
    else if (entry.kind === 'task-failed') failed += 1;
    else if (entry.kind === 'no-response') noResponse += 1;
  }
  return { completed, failed, noResponse };
}

/**
 * The LATEST qualification record for one claim: the LAST occurrence in
 * the corpus's append-ordered record list (append-only ⇒ later is newer;
 * duplicate digests collapse to the last occurrence).
 */
function latestRecordForClaim(
  claimDigest: string,
  records: readonly QualificationRecord[],
): QualificationRecord | undefined {
  let latest: QualificationRecord | undefined;
  for (const record of records) {
    if (record.claimDigest === claimDigest) latest = record;
  }
  return latest;
}

/** Derive the degradation state for the expert directory (R41). */
export function expertDirectoryDegradation(corpus: WorkbenchCorpus): DegradationState {
  const supply = corpus.expertSupply;
  if (supply.available) return noDegradation();
  const reasons: { code: string; detail: string }[] = [
    {
      code: 'expert-supply-unavailable',
      detail: supply.detail,
    },
  ];
  if (corpus.profiles.length > 0) {
    reasons.push({
      code: 'last-known-state',
      detail: `directory shows the last-known state captured at ${supply.lastKnownAt} (no invented data)`,
    });
  } else {
    reasons.push({
      code: 'last-known-state',
      detail: `no last-known directory state was captured before ${supply.lastKnownAt} (the listing below is honestly empty)`,
    });
  }
  return degradationMode(reasons);
}

/** Project one directory entry (profile + its qualification lines). */
function toExpertDirectoryEntry(
  profile: ExpertProfile,
  claims: readonly CompetencyClaim[],
  records: readonly QualificationRecord[],
): ExpertDirectoryEntryView {
  // NOTE: the claim's tenant/expertId are expert-qualification brands and
  // the profile's are expert-registry brands — distinct types over the
  // SAME neutral string wire format; compare through their string
  // values (a brand is a string at runtime; this is a read, not a cast
  // of domain state).
  const profileTenant = profile.identity.tenant as string;
  const profileExpertId = profile.identity.expertId as string;
  const qualifications: ExpertQualificationLineView[] = claims
    .filter(
      (claim) =>
        (claim.tenant as string) === profileTenant &&
        (claim.expertId as string) === profileExpertId,
    )
    .map((claim) => ({ claim, record: latestRecordForClaim(claim.digest, records) }))
    .filter((line): line is { claim: CompetencyClaim; record: QualificationRecord } => line.record !== undefined)
    .map(({ claim, record }) => ({
      capability: `${claim.capability.kind}/${claim.capability.id}@${claim.capability.version}`,
      proficiency: claim.proficiency,
      status: record.status,
      evaluatedAt: record.evaluatedAt,
      ...(record.validFrom !== undefined ? { validFrom: record.validFrom } : {}),
      ...(record.validUntil !== undefined ? { validUntil: record.validUntil } : {}),
      claimDigest: claim.digest,
      recordDigest: record.digest,
    }));
  const reliability = reliabilityCountsOf(profile);
  const view: ExpertDirectoryEntryView = {
    tenant: profile.identity.tenant,
    expertId: profile.identity.expertId,
    version: profile.version,
    status: profile.status,
    competencyCount: profile.competencies.length,
    competencyRefs: deepFreeze(
      profile.competencies.map(
        (competency) =>
          `${competency.capability.kind}/${competency.capability.id}@${competency.capability.version}`,
      ),
    ),
    qualifications: deepFreeze(qualifications),
    qualificationStatusBreakdown: countStatuses(qualifications.map((line) => line.status)),
    availabilitySummary: availabilitySummaryOf(profile),
    completedTasks: reliability.completed,
    failedTasks: reliability.failed,
    noResponseEvents: reliability.noResponse,
    taskHistoryCount: profile.taskHistory.length,
    evidenceCount: profile.evidence.length,
    domainScopeSummary: domainScopeSummaryOf(profile),
    jurisdictions: deepFreeze(
      profile.domainScope.jurisdictions.map((jurisdiction) =>
        jurisdiction.region === undefined
          ? jurisdiction.country
          : `${jurisdiction.country}-${jurisdiction.region}`,
      ),
    ),
    limitations: deepFreeze(
      profile.domainScope.limitations.map(
        (limitation) => `${limitation.class}: ${limitation.statement}`,
      ),
    ),
    digest: profile.digest,
  };
  return deepFreeze(view);
}

/**
 * Project the expert directory from the corpus: registry profiles joined
 * with their A007 qualification states, deterministic ordering, deep
 * frozen, with the explicit degradation mode (R41).
 */
export function toExpertDirectoryView(corpus: WorkbenchCorpus): ExpertDirectoryView {
  const profiles = corpus.profiles.map((profile, index) => assertProfile(profile, index));
  const claims = corpus.claims.map((claim, index) => assertClaim(claim, index));
  const records = corpus.qualificationRecords.map((record, index) =>
    assertQualificationRecord(record, index),
  );
  const entries = [...profiles]
    .sort((a, b) =>
      `${a.identity.tenant}/${a.identity.expertId}`.localeCompare(
        `${b.identity.tenant}/${b.identity.expertId}`,
      ),
    )
    .map((profile) => toExpertDirectoryEntry(profile, claims, records));
  const qualifiedClaimCount = entries.reduce(
    (total, entry) =>
      total +
      entry.qualifications.filter((line) => line.status === 'qualified').length,
    0,
  );
  const view: ExpertDirectoryView = {
    kind: 'expert-directory',
    entries: deepFreeze(entries),
    expertCount: entries.length,
    qualifiedClaimCount,
    lifecycleStatusBreakdown: countStatuses(entries.map((entry) => entry.status)),
    degradation: expertDirectoryDegradation(corpus),
  };
  return deepFreeze(view);
}

// ---------------------------------------------------------------------------
// TaskQueueView (A008 specs + compilations; A007 match outcomes — R8)
// ---------------------------------------------------------------------------

/** One match candidate (matching UX, R8). */
export interface MatchCandidateView {
  readonly expertId: string;
  readonly tenant: string;
  readonly satisfiedAll: boolean;
  readonly satisfiedCount: number;
  readonly requirementCount: number;
  readonly evidenceCount: number;
  /** Explicit closed-vocabulary reasons for unsatisfied requirements. */
  readonly unmatchedReasons: readonly string[];
}

/** One match outcome (R8): the evaluated result of one match request. */
export interface MatchOutcomeView {
  readonly requestDigest: ViewDigest;
  readonly matchingPolicyDigest: ViewDigest;
  readonly evaluatedAt: string;
  readonly candidates: readonly MatchCandidateView[];
  readonly candidateCount: number;
  /** Request requirement ids NO returned candidate satisfies. */
  readonly requirementsUnmet: readonly string[];
  readonly digest: ViewDigest;
}

/** One task-queue entry: a compiled TaskSpec (A008). */
export interface TaskQueueEntryView {
  readonly tenant: string;
  readonly taskId: string;
  readonly version: string;
  readonly taskClass: string;
  readonly capabilityLabels: readonly string[];
  readonly difficulty: string;
  readonly domain: string;
  readonly objectivesCount: number;
  readonly constraintsCount: number;
  readonly prohibitedShortcutsCount: number;
  readonly expectedOutputsCount: number;
  readonly completionCriteriaCount: number;
  /** The capability nodes experts must be qualified in (A007-shaped). */
  readonly expertRequirementCapabilities: readonly string[];
  readonly expertExpectations: readonly string[];
  /** Derivation provenance: the exact case state + policy (A008). */
  readonly caseRef: string;
  readonly digest: ViewDigest;
}

/** One compilation record line (A008). */
export interface CompilationLineView {
  readonly compilationKey: string;
  readonly correlationId: string;
  readonly caseRef: string;
  readonly emittedSpecs: readonly string[];
  readonly compiledAt: string;
  readonly digest: ViewDigest;
}

/** The task queue (/tasks). */
export interface TaskQueueView {
  readonly kind: 'task-queue';
  readonly specs: readonly TaskQueueEntryView[];
  readonly compilations: readonly CompilationLineView[];
  readonly matchOutcomes: readonly MatchOutcomeView[];
  readonly specCount: number;
  readonly compilationCount: number;
  readonly matchOutcomeCount: number;
  readonly taskClassBreakdown: readonly StatusCount[];
  readonly degradation: DegradationState;
}

/** Derive the degradation state for the task queue. */
export function taskQueueDegradation(corpus: WorkbenchCorpus): DegradationState {
  const supply = corpus.taskQueue;
  if (supply.available) return noDegradation();
  return degradationMode([
    { code: 'task-queue-unavailable', detail: supply.detail },
    {
      code: 'last-known-state',
      detail: `task queue shows the last-known state captured at ${supply.lastKnownAt} (no invented data)`,
    },
  ]);
}

/** Project one task-queue entry from a TaskSpec. */
function toTaskQueueEntry(spec: TaskSpec): TaskQueueEntryView {
  const view: TaskQueueEntryView = {
    tenant: spec.identity.tenant,
    taskId: spec.identity.taskId,
    version: spec.version,
    taskClass: spec.taskClass,
    capabilityLabels: deepFreeze([...spec.capabilityLabels]),
    difficulty: `${spec.difficulty.scale} · ${spec.difficulty.class}`,
    domain: `${spec.domain.kind}/${spec.domain.id}@${spec.domain.version}`,
    objectivesCount: spec.objectives.length,
    constraintsCount: spec.constraints.length,
    prohibitedShortcutsCount: spec.prohibitedShortcuts.length,
    expectedOutputsCount: spec.expectedOutputs.length,
    completionCriteriaCount: spec.completionCriteria.length,
    expertRequirementCapabilities: deepFreeze(
      spec.expertQualificationRequirements.competencies.map(
        (competency) => `${competency.kind}/${competency.id}@${competency.version}`,
      ),
    ),
    expertExpectations: deepFreeze([...spec.expertQualificationRequirements.expectations]),
    caseRef: `${spec.derivedFrom.caseRef.tenant}/${spec.derivedFrom.caseRef.caseId}@${spec.derivedFrom.caseRef.version}`,
    digest: spec.digest,
  };
  return deepFreeze(view);
}

/** Project one match outcome from a MatchResult. */
function toMatchOutcome(result: MatchResult): MatchOutcomeView {
  const view: MatchOutcomeView = {
    requestDigest: result.requestDigest,
    matchingPolicyDigest: result.matchingPolicyDigest,
    evaluatedAt: result.evaluatedAt,
    candidates: deepFreeze(
      result.candidates.map((candidate) => ({
        expertId: candidate.expertId,
        tenant: candidate.tenant,
        satisfiedAll: candidate.satisfiedAll,
        satisfiedCount: candidate.satisfiedCount,
        requirementCount: candidate.perRequirement.length,
        evidenceCount: candidate.evidenceCount,
        unmatchedReasons: deepFreeze(
          candidate.perRequirement
            .filter((entry) => !entry.satisfied)
            .map((entry) => entry.unmatchedReason ?? 'unknown'),
        ),
      })),
    ),
    candidateCount: result.candidates.length,
    requirementsUnmet: deepFreeze([...result.requirementsUnmet]),
    digest: result.digest,
  };
  return deepFreeze(view);
}

/**
 * Project the task queue from the corpus: A008 TaskSpecs + compilation
 * records + A007 match outcomes (the matching UX), deterministic
 * ordering, deep frozen, with the explicit degradation mode.
 */
export function toTaskQueueView(corpus: WorkbenchCorpus): TaskQueueView {
  const specs = corpus.specs.map((spec, index) => {
    if (!isTaskSpec(spec)) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_TASK_SPEC, {
        surface: 'task queue task spec',
        index,
      });
    }
    return spec;
  });
  const compilations = corpus.compilations.map((record, index) => {
    if (!isCompilationRecord(record)) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_COMPILATION_RECORD, {
        surface: 'task queue compilation record',
        index,
      });
    }
    return record;
  });
  const matchResults = corpus.matchResults.map((result, index) =>
    assertMatchResult(result, index),
  );
  const specEntries = [...specs]
    .sort((a, b) =>
      `${a.identity.tenant}/${a.identity.taskId}@${a.version}`.localeCompare(
        `${b.identity.tenant}/${b.identity.taskId}@${b.version}`,
      ),
    )
    .map((spec) => toTaskQueueEntry(spec));
  const compilationEntries = [...compilations]
    .sort((a, b) => a.compilationKey.localeCompare(b.compilationKey))
    .map((record) => ({
      compilationKey: record.compilationKey,
      correlationId: record.correlationId,
      caseRef: `${record.caseRef.tenant}/${record.caseRef.caseId}@${record.caseRef.version}`,
      emittedSpecs: deepFreeze(
        record.emittedSpecs.map((ref) => `${ref.tenant}/${ref.taskId}@${ref.version}`),
      ),
      compiledAt: record.compiledAt,
      digest: record.digest,
    }));
  const outcomes = [...matchResults]
    .sort((a, b) =>
      `${a.evaluatedAt}/${a.requestDigest}`.localeCompare(`${b.evaluatedAt}/${b.requestDigest}`),
    )
    .map((result) => toMatchOutcome(result));
  const view: TaskQueueView = {
    kind: 'task-queue',
    specs: deepFreeze(specEntries),
    compilations: deepFreeze(compilationEntries),
    matchOutcomes: deepFreeze(outcomes),
    specCount: specEntries.length,
    compilationCount: compilationEntries.length,
    matchOutcomeCount: outcomes.length,
    taskClassBreakdown: countStatuses(specEntries.map((entry) => entry.taskClass)),
    degradation: taskQueueDegradation(corpus),
  };
  return deepFreeze(view);
}

// ---------------------------------------------------------------------------
// TrajectoryFeedView (A011, read-only — R10)
// ---------------------------------------------------------------------------

/** One trajectory entry summary (deterministic payload projection). */
export interface TrajectoryEntrySummaryView {
  readonly sequence: number;
  readonly kind: string;
  readonly occurredAt: string;
  /** One-line deterministic summary of the typed payload. */
  readonly summary: string;
  /** Digest refs the payload pins (checkpoint snapshot / completion evidence). */
  readonly digests: readonly string[];
}

/** One trajectory in the feed: header + append-only entry chain. */
export interface TrajectoryFeedEntryView {
  readonly trajectoryId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly taskVersion: string;
  readonly environment: string;
  readonly agentBodyRef: ViewDigest;
  readonly substrateRef: ViewDigest;
  readonly startedAt: string;
  readonly seed: string | null;
  readonly entryCount: number;
  /** True iff the terminal completion entry has been appended. */
  readonly completed: boolean;
  /** The chained head over the full entry history. */
  readonly chainHead: ViewDigest;
  readonly entries: readonly TrajectoryEntrySummaryView[];
  /** The trajectory header's content digest. */
  readonly digest: ViewDigest;
}

/** The trajectory feed (/trajectories) — READ-ONLY (R10). */
export interface TrajectoryFeedView {
  readonly kind: 'trajectory-feed';
  readonly entries: readonly TrajectoryFeedEntryView[];
  readonly trajectoryCount: number;
  readonly totalEntryCount: number;
  readonly completedCount: number;
  readonly degradation: DegradationState;
}

/** One trajectory, drilled down (/trajectories/:trajectoryId). */
export interface TrajectoryDetailView {
  readonly kind: 'trajectory-detail';
  readonly entry: TrajectoryFeedEntryView;
  /** The section-level degradation state (R41 — every view carries it). */
  readonly degradation: DegradationState;
}

/** Derive the degradation state for the trajectory feed. */
export function trajectoryFeedDegradation(corpus: WorkbenchCorpus): DegradationState {
  const supply = corpus.trajectoryStore;
  if (supply.available) return noDegradation();
  return degradationMode([
    { code: 'trajectory-store-unavailable', detail: supply.detail },
    {
      code: 'last-known-state',
      detail: `trajectory feed shows the last-known state captured at ${supply.lastKnownAt} (no invented data)`,
    },
  ]);
}

/** Deterministic summary of one typed trajectory entry payload. */
function entrySummaryOf(entry: TrajectoryRecord['entries'][number]): {
  summary: string;
  digests: readonly string[];
} {
  // The payload union members carry distinct field names, so structural
  // `in` checks narrow them exactly (kind and payload are separate view
  // fields; narrowing on the payload itself is the type-safe route).
  const payload = entry.payload;
  if ('actionId' in payload) {
    return {
      summary:
        payload.input === null || payload.input === undefined
          ? `action ${payload.actionId} (no input recorded)`
          : `action ${payload.actionId} — input ${stableJson(payload.input)}`,
      digests: [],
    };
  }
  if ('observationId' in payload) {
    return {
      summary: `observation ${payload.observationId} [${payload.channel}]: ${payload.content}`,
      digests: [],
    };
  }
  if ('checkpointId' in payload) {
    return {
      summary: `checkpoint ${payload.checkpointId} reached`,
      digests: [payload.snapshotDigest],
    };
  }
  if ('code' in payload) {
    return {
      summary: `error ${payload.code}: ${payload.message}`,
      digests: [],
    };
  }
  return {
    summary: `completion — outcome ${payload.outcome} (${payload.evidenceDigests.length} evidence digest(s))`,
    digests: [...payload.evidenceDigests],
  };
}

/** Project one trajectory record into a feed entry view. */
export function toTrajectoryFeedEntry(record: TrajectoryRecord): TrajectoryFeedEntryView {
  const view: TrajectoryFeedEntryView = {
    trajectoryId: record.header.trajectoryId,
    runId: record.header.run.runId,
    taskId: record.header.run.taskVersion.taskId,
    taskVersion: record.header.run.taskVersion.version,
    environment: `${record.header.run.environmentVersion.namespace}/${record.header.run.environmentVersion.name}@${record.header.run.environmentVersion.version}`,
    agentBodyRef: record.header.agentBodyRef,
    substrateRef: record.header.substrateRef,
    startedAt: record.header.startedAt,
    seed: record.header.seed,
    entryCount: record.entries.length,
    completed:
      record.entries.length > 0 &&
      record.entries[record.entries.length - 1]?.kind === 'completion',
    chainHead: record.chainHead,
    entries: deepFreeze(
      record.entries.map((entry) => {
        const { summary, digests } = entrySummaryOf(entry);
        return {
          sequence: entry.sequence,
          kind: entry.kind,
          occurredAt: entry.occurredAt,
          summary,
          digests: deepFreeze([...digests]),
        };
      }),
    ),
    digest: record.header.digest,
  };
  return deepFreeze(view);
}

/**
 * Project the trajectory feed from the corpus (read-only, R10):
 * deterministic ordering by (startedAt, trajectoryId), deep frozen, with
 * the explicit degradation mode.
 */
export function toTrajectoryFeedView(corpus: WorkbenchCorpus): TrajectoryFeedView {
  const records = corpus.trajectories.map((record, index) => {
    if (!isTrajectoryRecord(record)) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_TRAJECTORY_RECORD, {
        surface: 'trajectory feed record',
        index,
      });
    }
    return record;
  });
  const entries = [...records]
    .sort((a, b) =>
      `${a.header.startedAt}/${a.header.trajectoryId}`.localeCompare(
        `${b.header.startedAt}/${b.header.trajectoryId}`,
      ),
    )
    .map((record) => toTrajectoryFeedEntry(record));
  const view: TrajectoryFeedView = {
    kind: 'trajectory-feed',
    entries: deepFreeze(entries),
    trajectoryCount: entries.length,
    totalEntryCount: entries.reduce((total, entry) => total + entry.entryCount, 0),
    completedCount: entries.filter((entry) => entry.completed).length,
    degradation: trajectoryFeedDegradation(corpus),
  };
  return deepFreeze(view);
}

// ---------------------------------------------------------------------------
// JobStatusView (A015 jobs + events — R26)
// ---------------------------------------------------------------------------

/** One job-status entry: a durable job with its event trail rollup. */
export interface JobStatusEntryView {
  readonly jobId: string;
  readonly jobKind: string;
  readonly status: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly idempotencyScope: string;
  readonly submittedAt: string;
  readonly updatedAt: string;
  readonly eventCount: number;
  /** Every event kind, in append order (the audit rollup). */
  readonly eventKinds: readonly string[];
  readonly lastEventKind: string;
  readonly progressPercent?: number;
  readonly progressNote?: string;
  readonly failureKind?: string;
  readonly failureClass?: string;
  readonly failureMessage?: string;
}

/** The job status surface (/jobs) — R26 async jobs visibility. */
export interface JobStatusView {
  readonly kind: 'job-status';
  readonly jobs: readonly JobStatusEntryView[];
  readonly jobCount: number;
  readonly statusBreakdown: readonly StatusCount[];
  readonly degradation: DegradationState;
}

/** Derive the degradation state for the job status surface. */
export function jobStatusDegradation(corpus: WorkbenchCorpus): DegradationState {
  const supply = corpus.jobStore;
  if (supply.available) return noDegradation();
  return degradationMode([
    { code: 'job-store-unavailable', detail: supply.detail },
    {
      code: 'last-known-state',
      detail: `job status shows the last-known state captured at ${supply.lastKnownAt} (no invented data)`,
    },
  ]);
}

/** Project one job-status entry from a JobRecord. */
function toJobStatusEntry(job: JobRecord): JobStatusEntryView {
  const view: JobStatusEntryView = {
    jobId: job.jobId,
    jobKind: `${job.kind.namespace}/${job.kind.name}@${job.kind.version}`,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.policy.retry.maxAttempts,
    correlationId: job.correlationId,
    idempotencyKey: job.idempotencyKey,
    idempotencyScope: job.idempotencyScope,
    submittedAt: job.submittedAt,
    updatedAt: job.updatedAt,
    eventCount: job.events.length,
    eventKinds: deepFreeze(job.events.map((event) => event.kind)),
    lastEventKind: job.events[job.events.length - 1]?.kind ?? 'none',
    ...(job.progress?.percent !== undefined
      ? { progressPercent: job.progress.percent }
      : {}),
    ...(job.progress?.note !== undefined ? { progressNote: job.progress.note } : {}),
    ...(job.failure !== undefined
      ? {
          failureKind: job.failure.kind,
          failureClass: job.failure.errorClass,
          failureMessage: job.failure.message,
        }
      : {}),
  };
  return deepFreeze(view);
}

/**
 * Project the job status surface from the corpus: A015 job records with
 * their append-only event trails (R26), deterministic ordering by
 * (submittedAt, jobId), deep frozen, with the explicit degradation mode.
 */
export function toJobStatusView(corpus: WorkbenchCorpus): JobStatusView {
  const jobs = corpus.jobs.map((job, index) => {
    if (!isJobRecord(job)) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.INVALID_JOB_RECORD, {
        surface: 'job status record',
        index,
      });
    }
    return job;
  });
  const entries = [...jobs]
    .sort((a, b) => `${a.submittedAt}/${a.jobId}`.localeCompare(`${b.submittedAt}/${b.jobId}`))
    .map((job) => toJobStatusEntry(job));
  const view: JobStatusView = {
    kind: 'job-status',
    jobs: deepFreeze(entries),
    jobCount: entries.length,
    statusBreakdown: countStatuses(entries.map((entry) => entry.status)),
    degradation: jobStatusDegradation(corpus),
  };
  return deepFreeze(view);
}

// ---------------------------------------------------------------------------
// WorkbenchOverviewView (aggregate)
// ---------------------------------------------------------------------------

/** The workbench index (/): aggregate counts + degradation rollup. */
export interface WorkbenchOverviewView {
  readonly kind: 'workbench-overview';
  readonly expertCount: number;
  readonly qualifiedClaimCount: number;
  readonly matchOutcomeCount: number;
  readonly specCount: number;
  readonly compilationCount: number;
  readonly trajectoryCount: number;
  readonly trajectoryEntryCount: number;
  readonly completedTrajectoryCount: number;
  readonly jobCount: number;
  /** Sections whose supply state is degraded (R41 rollup). */
  readonly degradedSections: readonly string[];
  readonly degradation: DegradationState;
}

/**
 * Project the workbench overview: aggregate counts over the corpus and
 * the merged degradation rollup of all four sections. Pure with respect
 * to the corpus — the counts derive from the SAME projections the
 * section routes serve (defense in depth: the guards run here too).
 */
export function toWorkbenchOverviewView(corpus: WorkbenchCorpus): WorkbenchOverviewView {
  const directory = toExpertDirectoryView(corpus);
  const tasks = toTaskQueueView(corpus);
  const feed = toTrajectoryFeedView(corpus);
  const jobs = toJobStatusView(corpus);
  const degradedSections = deepFreeze(
    (
      [
        ['experts', corpus.expertSupply],
        ['tasks', corpus.taskQueue],
        ['trajectories', corpus.trajectoryStore],
        ['jobs', corpus.jobStore],
      ] as const
    )
      .filter(([, supply]) => !supply.available)
      .map(([section]) => section),
  );
  const view: WorkbenchOverviewView = {
    kind: 'workbench-overview',
    expertCount: directory.expertCount,
    qualifiedClaimCount: directory.qualifiedClaimCount,
    matchOutcomeCount: tasks.matchOutcomeCount,
    specCount: tasks.specCount,
    compilationCount: tasks.compilationCount,
    trajectoryCount: feed.trajectoryCount,
    trajectoryEntryCount: feed.totalEntryCount,
    completedTrajectoryCount: feed.completedCount,
    jobCount: jobs.jobCount,
    degradedSections,
    degradation: mergeDegradation([
      directory.degradation,
      tasks.degradation,
      feed.degradation,
      jobs.degradation,
    ]),
  };
  return deepFreeze(view);
}

// ---------------------------------------------------------------------------
// Negative views (route-level)
// ---------------------------------------------------------------------------

/** Unknown route (negative view — router 404). */
export interface NotFoundView {
  readonly kind: 'not-found';
  readonly path: string;
}

/** Mutation attempt against the read-only workbench (negative view — router 405). */
export interface MethodNotAllowedView {
  readonly kind: 'method-not-allowed';
  readonly method: string;
  readonly path: string;
  readonly allowedMethods: readonly string[];
}
