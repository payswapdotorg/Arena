/**
 * EscalationRoutingService — the reference service wiring the C002
 * capability-demand compiler + routing engine to the C001 routing seam
 * (Work Order C002; spec/expert-escalation-api.md ES1.0 "Routing").
 *
 * Mirrors the sibling service discipline (services/escalation-api):
 * injected dependencies only, fail-closed error normalization (an
 * internal failure NEVER invents a match — it degrades to the typed
 * `routing-unavailable` no-match), no wall-clock reads (rule 17), and
 * durable routing jobs over the A015 job-protocol submission identity.
 *
 * The service implements C001's RoutingPort STRUCTURALLY:
 *
 *   route(request: EscalationRecord): Promise<RoutingDecision>
 *
 * Rich engine verdicts map onto the port's closed vocabulary (the FULL
 * verdict + per-candidate causes are preserved in the append-only
 * decision history — nothing is lost at the seam):
 *
 *   engine verdict          → port decision
 *   ────────────────────────── ──────────────────────────────
 *   matched                 → matched(expertRef)
 *   blocked-by-coi          → no-match 'no-qualified-expert'
 *   blocked-by-privacy      → no-match 'no-qualified-expert'
 *   no-match                → no-match 'no-qualified-expert'
 *   budget-infeasible       → no-match 'budget-below-floor'
 *   locale-uncovered        → no-match 'locale-uncovered'
 *   deadline-infeasible     → no-match 'routing-unavailable'
 *   compile under-specified → no-match 'routing-unavailable'
 *   compile not-derivable   → no-match 'routing-unavailable'
 *   internal failure        → no-match 'routing-unavailable' (fail-closed)
 *
 * (COI/privacy compress to 'no-qualified-expert' because the port
 * vocabulary has no dedicated reason — recorded as an architecture
 * question in the PR.)
 *
 * QUALIFICATION IS DATA, NEVER AN ACCESS GRANT (lock rule 9): the
 * service records routing decisions; it grants nothing.
 */

import type { EscalationRecord } from '@arena/escalation';
import { appendRoutingDecision, compileDemandProfile, routeEscalation } from '@arena/escalation-routing';
import type {
  DemandCompilationResult,
  RoutingCandidate,
  RoutingDecisionRecord,
  RoutingVerdict,
} from '@arena/escalation-routing';
import type {
  CapabilityGraphSource,
  Clock,
  RoutingCandidateDirectory,
  RoutingDecision,
  RoutingDecisionLog,
} from './ports.js';
import type { RoutingJobStore, RoutingJobSubmissionOutcome } from './jobs.js';
import { ROUTING_JOB_MAX_ATTEMPTS, buildRoutingJob, routingJobIdentity } from './jobs.js';
import { FixedClock } from './fabric.js';
import { InMemoryRoutingDecisionLog } from './fabric.js';
import { InMemoryRoutingJobStore } from './fabric.js';
import { StaticGraphSource } from './fabric.js';
import { StaticRoutingCandidateDirectory } from './fabric.js';

/** The full typed outcome of one routing run (richer than the port). */
export interface RouteDetailedResult {
  /** The demand compilation outcome (typed, never a bare boolean). */
  readonly compilation: DemandCompilationResult;
  /** The engine verdict (present iff the demand compiled AND the pool was readable). */
  readonly verdict?: RoutingVerdict;
  /** The C001-port-compatible decision (always present). */
  readonly decision: RoutingDecision;
  /** The appended decision-history record (present iff the engine ran). */
  readonly record?: RoutingDecisionRecord;
}

export interface EscalationRoutingServiceConfig {
  readonly clock?: Clock;
  readonly graphSource?: CapabilityGraphSource;
  readonly directory?: RoutingCandidateDirectory;
  readonly decisionLog?: RoutingDecisionLog;
  readonly jobStore?: RoutingJobStore;
}

/** Map one engine verdict onto the C001 port's closed vocabulary. */
export function portDecisionOf(verdict: RoutingVerdict): RoutingDecision {
  if (verdict.outcome === 'matched' && verdict.expertRef !== undefined) {
    return { outcome: 'matched', expertRef: verdict.expertRef };
  }
  switch (verdict.outcome) {
    case 'budget-infeasible':
      return { outcome: 'no-match', reason: 'budget-below-floor' };
    case 'locale-uncovered':
      return { outcome: 'no-match', reason: 'locale-uncovered' };
    case 'deadline-infeasible':
      return { outcome: 'no-match', reason: 'routing-unavailable' };
    default:
      return { outcome: 'no-match', reason: 'no-qualified-expert' };
  }
}

export class EscalationRoutingService {
  readonly clock: Clock;
  readonly graphSource: CapabilityGraphSource;
  readonly directory: RoutingCandidateDirectory;
  readonly decisionLog: RoutingDecisionLog;
  readonly jobStore: RoutingJobStore;

  constructor(config: EscalationRoutingServiceConfig = {}) {
    this.clock = config.clock ?? new FixedClock(0);
    this.graphSource = config.graphSource ?? new StaticGraphSource({} as never);
    this.directory = config.directory ?? new StaticRoutingCandidateDirectory([]);
    this.decisionLog = config.decisionLog ?? new InMemoryRoutingDecisionLog();
    this.jobStore = config.jobStore ?? new InMemoryRoutingJobStore();
  }

  // -------------------------------------------------------------------------
  // THE C001 ROUTING SEAM (RoutingPort — structural implementation)
  // -------------------------------------------------------------------------

  /** Route one escalation record. Fail-closed: internal failures degrade to `routing-unavailable`. */
  async route(request: EscalationRecord): Promise<RoutingDecision> {
    const detailed = await this.routeDetailed(request);
    return detailed.decision;
  }

  /** Route one escalation record with the FULL typed outcome (verdict + history). */
  async routeDetailed(request: EscalationRecord): Promise<RouteDetailedResult> {
    const evaluatedAt = new Date(this.clock.now()).toISOString();
    const requestId = request.request.requestId;
    const tenantId = request.request.tenantId;
    const demand = {
      tenantId,
      clientAppId: request.request.clientAppId,
      capabilityNeed: request.request.capabilityNeed,
      requiredCapabilities: request.request.expertRequirements.requiredCapabilities,
      ...(request.request.expertRequirements.preferredLocales !== undefined
        ? { preferredLocales: request.request.expertRequirements.preferredLocales }
        : {}),
      ...(request.request.expertRequirements.jurisdictions !== undefined
        ? { jurisdictions: request.request.expertRequirements.jurisdictions }
        : {}),
      locale: request.request.locale,
      budget: request.request.budget,
      deadline: request.request.deadline,
      createdAt: request.request.createdAt,
      urgency: request.request.urgency,
      privacyPolicy: request.request.privacyPolicy,
      escalationModes: request.request.escalationModes,
    };

    let graph;
    try {
      graph = await this.graphSource.load();
    } catch {
      // Fail-closed: a broken graph source is never a silent empty route.
      return {
        compilation: { outcome: 'not-derivable', reason: 'graph-missing' },
        decision: { outcome: 'no-match', reason: 'routing-unavailable' },
      };
    }

    const compilation = await compileDemandProfile(demand, graph, { evaluatedAt });
    if (compilation.outcome !== 'compilable') {
      // Under-specified / not-derivable demands never invent a match.
      return {
        compilation,
        decision: { outcome: 'no-match', reason: 'routing-unavailable' },
      };
    }

    let candidates: readonly RoutingCandidate[];
    try {
      candidates = await this.directory.listRoutingCandidates(tenantId);
    } catch {
      // Fail-closed: a broken directory is never a silent empty pool.
      return {
        compilation,
        decision: { outcome: 'no-match', reason: 'routing-unavailable' },
      };
    }

    const verdict = await routeEscalation(compilation.profile, candidates, {
      requestId,
      evaluatedAt,
    });
    const decision = portDecisionOf(verdict);
    // Supersession by append: load the prior chain, then append.
    const prior = await this.decisionLog.list(requestId, tenantId);
    const { record } = await appendRoutingDecision(prior, verdict, {
      requestId,
      tenantId,
      recordedAt: evaluatedAt,
    });
    await this.decisionLog.append(record);
    return { compilation, verdict, decision, record };
  }

  // -------------------------------------------------------------------------
  // Durable routing jobs (A015 fabric semantics)
  // -------------------------------------------------------------------------

  /** Submit a durable routing job (idempotent on the A015 submission identity). */
  async submitRoutingJob(request: EscalationRecord): Promise<RoutingJobSubmissionOutcome> {
    const identity = routingJobIdentity({
      tenantId: request.request.tenantId,
      idempotencyKey: request.request.idempotencyKey,
      correlationId: request.request.correlationId,
    });
    const job = buildRoutingJob(identity, request, this.clock.now());
    const existing = await this.jobStore.findBySubmissionKey(job.submissionKey);
    if (existing !== undefined) {
      return { outcome: 'replay', job: existing };
    }
    await this.jobStore.insert(job);
    return { outcome: 'queued', job };
  }

  /** Drain queued routing jobs (deterministic; safe to re-run). */
  async drainRoutingJobs(): Promise<{ completed: number; failed: number }> {
    let completed = 0;
    let failed = 0;
    for (const job of await this.jobStore.list()) {
      if (job.status !== 'queued') continue;
      const attempts = job.attempts + 1;
      try {
        const decision = await this.route(job.request);
        await this.jobStore.update(
          Object.freeze({
            ...job,
            status: 'completed',
            attempts,
            decision,
            ...(decision.outcome === 'no-match' ? { lastError: decision.reason } : {}),
          }),
        );
        completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempts >= ROUTING_JOB_MAX_ATTEMPTS) {
          await this.jobStore.update(
            Object.freeze({ ...job, status: 'failed', attempts, lastError: message }),
          );
          failed += 1;
        } else {
          await this.jobStore.update(Object.freeze({ ...job, attempts, lastError: message }));
        }
      }
    }
    return { completed, failed };
  }

  /** The recorded decision history of one escalation (tenant-scoped, chain-verified). */
  async decisionHistory(
    requestId: string,
    tenantId: string,
  ): Promise<readonly RoutingDecisionRecord[]> {
    return this.decisionLog.list(requestId, tenantId);
  }
}
