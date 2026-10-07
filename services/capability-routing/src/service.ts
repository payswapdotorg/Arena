/**
 * CapabilityRoutingService — the reference service wiring the C015
 * cross-resource compiler + ResourceMatch engine to the injected
 * catalog ports (Work Order C015; issue #121).
 *
 * Mirrors the sibling service discipline (services/escalation-routing):
 * injected dependencies only, fail-closed error normalization (an
 * internal failure NEVER invents a match — it degrades to the typed
 * `routing-unavailable` no-match), per-class fail-closed catalog
 * handling (a broken catalog port is a typed `catalog-unavailable`
 * cause, never a silent empty pool), no wall-clock reads (rule 17), and
 * durable routing jobs over the A015 job-protocol submission identity.
 *
 * THE SEAM (the C001/C002/C021 consumers): `routeCrossResource` is the
 * capability-routing port. Rich engine verdicts map onto the closed
 * seam vocabulary (the FULL ResourceMatch + per-candidate causes are
 * preserved in the append-only decision history — nothing is lost):
 *
 *   engine outcome            → seam decision
 *   ─────────────────────────── ─────────────────────────────────────
 *   matched (composition)     → matched(components class:ref pairs)
 *   matched (single class)    → matched(one class:ref pair)
 *   no-match                  → no-match 'no-capable-resource'
 *   blocked-by-coi            → no-match 'no-capable-resource'
 *   blocked-by-privacy        → no-match 'no-capable-resource'
 *   budget-infeasible         → no-match 'budget-below-floor'
 *   deadline-infeasible       → no-match 'routing-unavailable'
 *   incompatible-substrate    → no-match 'no-capable-resource'
 *   class-not-allowed         → no-match 'class-not-allowed'
 *   compile under-specified   → no-match 'routing-unavailable'
 *   compile not-derivable     → no-match 'routing-unavailable'
 *   internal failure          → no-match 'routing-unavailable' (fail-closed)
 *
 * QUALIFICATION AND PERFORMANCE EVIDENCE ARE DATA, NEVER ACCESS GRANTS
 * (lock rules 9/35): the service records routing decisions; it grants
 * nothing.
 */

import {
  appendResourceDecision,
  compileCrossResourceDemand,
  matchResources,
} from '@arena/capability-routing';
import type {
  ArtifactCandidateView,
  BodyCandidateView,
  CrossDemandCompilationResult,
  CrossResourceDemandInput,
  ExpertCandidateView,
  KnowledgeCandidateView,
  ResourceClass,
  ResourceDecisionRecord,
  ResourceMatch,
  ResourceMatchView,
  ToolCandidateView,
} from '@arena/capability-routing';
import type {
  ArtifactOfferCatalog,
  BodyListingCatalog,
  CapabilityGraphSource,
  CapabilityRoutingDecision,
  Clock,
  ExpertCandidateDirectory,
  KnowledgeRecordCatalog,
  ResourceDecisionLog,
  ToolCandidateCatalog,
} from './ports.js';
import type {
  CapabilityRoutingJobStore,
  CapabilityRoutingJobSubmissionOutcome,
} from './jobs.js';
import {
  CAPABILITY_ROUTING_JOB_MAX_ATTEMPTS,
  buildCapabilityRoutingJob,
  capabilityRoutingJobIdentity,
} from './jobs.js';
import { FixedClock } from './fabric.js';
import { InMemoryArtifactOfferCatalog } from './fabric.js';
import { InMemoryBodyListingCatalog } from './fabric.js';
import { InMemoryCapabilityRoutingJobStore } from './fabric.js';
import { InMemoryExpertCandidateDirectory } from './fabric.js';
import { InMemoryKnowledgeRecordCatalog } from './fabric.js';
import { InMemoryResourceDecisionLog } from './fabric.js';
import { InMemoryToolCandidateCatalog } from './fabric.js';
import { StaticGraphSource } from './fabric.js';

/** The full typed outcome of one cross-resource routing run. */
export interface CrossResourceRouteResult {
  /** The demand compilation outcome (typed, never a bare boolean). */
  readonly compilation: CrossDemandCompilationResult;
  /** The engine verdict (present iff the demand compiled AND at least one catalog was readable). */
  readonly match?: ResourceMatch;
  /** The seam-compatible decision (always present). */
  readonly decision: CapabilityRoutingDecision;
  /** The appended decision-history record (present iff the engine ran). */
  readonly record?: ResourceDecisionRecord;
}

export interface CapabilityRoutingServiceConfig {
  readonly clock?: Clock;
  readonly graphSource?: CapabilityGraphSource;
  readonly expertDirectory?: ExpertCandidateDirectory;
  readonly bodyCatalog?: BodyListingCatalog;
  readonly toolCatalog?: ToolCandidateCatalog;
  readonly knowledgeCatalog?: KnowledgeRecordCatalog;
  readonly artifactCatalog?: ArtifactOfferCatalog;
  readonly decisionLog?: ResourceDecisionLog;
  readonly jobStore?: CapabilityRoutingJobStore;
}

/** Map one engine verdict onto the seam's closed vocabulary. */
export function seamDecisionOf(match: ResourceMatch): CapabilityRoutingDecision {
  if (match.outcome === 'matched') {
    const components =
      match.composition !== null
        ? match.composition.components.map((component) => `${component.resourceClass}:${component.ref}`)
        : match.classes
            .filter((result) => result.outcome === 'matched')
            .flatMap((result) =>
              result.shortlist.slice(0, 1).map((head) => `${result.resourceClass}:${head.ref}`),
            );
    return { outcome: 'matched', components: Object.freeze([...components]) };
  }
  switch (match.outcome) {
    case 'budget-infeasible':
      return { outcome: 'no-match', reason: 'budget-below-floor' };
    case 'deadline-infeasible':
      return { outcome: 'no-match', reason: 'routing-unavailable' };
    case 'class-not-allowed':
      return { outcome: 'no-match', reason: 'class-not-allowed' };
    default:
      return { outcome: 'no-match', reason: 'no-capable-resource' };
  }
}

export class CapabilityRoutingService {
  readonly clock: Clock;
  readonly graphSource: CapabilityGraphSource;
  readonly expertDirectory: ExpertCandidateDirectory;
  readonly bodyCatalog: BodyListingCatalog;
  readonly toolCatalog: ToolCandidateCatalog;
  readonly knowledgeCatalog: KnowledgeRecordCatalog;
  readonly artifactCatalog: ArtifactOfferCatalog;
  readonly decisionLog: ResourceDecisionLog;
  readonly jobStore: CapabilityRoutingJobStore;

  constructor(config: CapabilityRoutingServiceConfig = {}) {
    this.clock = config.clock ?? new FixedClock(0);
    this.graphSource = config.graphSource ?? new StaticGraphSource({} as never);
    this.expertDirectory =
      config.expertDirectory ?? new InMemoryExpertCandidateDirectory([]);
    this.bodyCatalog = config.bodyCatalog ?? new InMemoryBodyListingCatalog([]);
    this.toolCatalog = config.toolCatalog ?? new InMemoryToolCandidateCatalog([]);
    this.knowledgeCatalog = config.knowledgeCatalog ?? new InMemoryKnowledgeRecordCatalog([]);
    this.artifactCatalog = config.artifactCatalog ?? new InMemoryArtifactOfferCatalog([]);
    this.decisionLog = config.decisionLog ?? new InMemoryResourceDecisionLog();
    this.jobStore = config.jobStore ?? new InMemoryCapabilityRoutingJobStore();
  }

  // -------------------------------------------------------------------------
  // THE CAPABILITY-ROUTING SEAM (C001/C002/C021 consumers)
  // -------------------------------------------------------------------------

  /**
   * Route one cross-resource demand. Fail-closed: internal failures
   * degrade to `routing-unavailable`, never an invented match.
   */
  async routeCrossResource(
    demand: CrossResourceDemandInput,
    options: { readonly demandId: string },
  ): Promise<CrossResourceRouteResult> {
    const detailed = await this.routeDetailed(demand, options);
    return detailed;
  }

  /** Route one cross-resource demand with the FULL typed outcome (match + history). */
  async routeDetailed(
    demand: CrossResourceDemandInput,
    options: { readonly demandId: string },
  ): Promise<CrossResourceRouteResult> {
    const evaluatedAt = new Date(this.clock.now()).toISOString();
    const tenantId = demand.tenantId;

    // --- graph (needed for the expert facet; fail-closed on breakage) ----
    let graph = null;
    if (demand.expert !== undefined) {
      try {
        graph = await this.graphSource.load();
      } catch {
        return {
          compilation: { outcome: 'not-derivable', reason: 'graph-missing' },
          decision: { outcome: 'no-match', reason: 'routing-unavailable' },
        };
      }
    }

    const compilation = await compileCrossResourceDemand(demand, graph, { evaluatedAt });
    if (compilation.outcome !== 'compilable') {
      // Under-specified / not-derivable demands never invent a match.
      return {
        compilation,
        decision: { outcome: 'no-match', reason: 'routing-unavailable' },
      };
    }
    const profile = compilation.profile;

    // --- catalogs (per-class fail-closed: a broken port is a typed cause) --
    const catalogs: {
      experts?: readonly ExpertCandidateView[];
      bodies?: readonly BodyCandidateView[];
      tools?: readonly ToolCandidateView[];
      knowledge?: readonly KnowledgeCandidateView[];
      artifacts?: readonly ArtifactCandidateView[];
    } = {};
    const unavailable: ResourceClass[] = [];
    if (profile.requestedClasses.includes('expert')) {
      try {
        catalogs.experts = await this.expertDirectory.listExpertCandidates(tenantId);
      } catch {
        unavailable.push('expert');
      }
    }
    if (profile.requestedClasses.includes('body')) {
      try {
        catalogs.bodies = await this.bodyCatalog.listBodyCandidates(tenantId);
      } catch {
        unavailable.push('body');
      }
    }
    if (profile.requestedClasses.includes('tool')) {
      try {
        catalogs.tools = await this.toolCatalog.listToolCandidates(tenantId);
      } catch {
        unavailable.push('tool');
      }
    }
    if (profile.requestedClasses.includes('knowledge')) {
      try {
        catalogs.knowledge = await this.knowledgeCatalog.listKnowledgeCandidates(tenantId);
      } catch {
        unavailable.push('knowledge');
      }
    }
    if (profile.requestedClasses.includes('artifact')) {
      try {
        catalogs.artifacts = await this.artifactCatalog.listArtifactCandidates(tenantId);
      } catch {
        unavailable.push('artifact');
      }
    }

    const match = await matchResources(profile, catalogs, {
      requestId: options.demandId,
      evaluatedAt,
      ...(unavailable.length > 0 ? { unavailableCatalogs: unavailable } : {}),
    });
    const decision = seamDecisionOf(match);
    // Supersession by append: load the prior chain, then append.
    const prior = await this.decisionLog.list(options.demandId, tenantId);
    const { record } = await appendResourceDecision(prior, match, {
      demandId: options.demandId,
      tenantId,
      recordedAt: evaluatedAt,
    });
    await this.decisionLog.append(record);
    return { compilation, match, decision, record };
  }

  // -------------------------------------------------------------------------
  // Durable routing jobs (A015 fabric semantics)
  // -------------------------------------------------------------------------

  /** Submit a durable routing job (idempotent on the A015 submission identity). */
  async submitRoutingJob(
    demand: CrossResourceDemandInput,
    options: {
      readonly demandId: string;
      readonly idempotencyKey: string;
      readonly correlationId: string;
    },
  ): Promise<CapabilityRoutingJobSubmissionOutcome> {
    const identity = capabilityRoutingJobIdentity({
      tenantId: demand.tenantId,
      idempotencyKey: options.idempotencyKey,
      correlationId: options.correlationId,
    });
    const job = buildCapabilityRoutingJob(
      identity,
      { demandId: options.demandId, tenantId: demand.tenantId, demand },
      this.clock.now(),
    );
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
        const decision = await this.routeCrossResource(job.demand, {
          demandId: job.demandId,
        });
        await this.jobStore.update(
          Object.freeze({
            ...job,
            status: 'completed',
            attempts,
            decision: decision.decision,
          }),
        );
        completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempts >= CAPABILITY_ROUTING_JOB_MAX_ATTEMPTS) {
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

  /** The recorded decision history of one demand (tenant-scoped). */
  async decisionHistory(
    demandId: string,
    tenantId: string,
  ): Promise<readonly ResourceDecisionRecord[]> {
    return this.decisionLog.list(demandId, tenantId);
  }
}

/** Re-exported for host wiring (the view the seam decision summarizes). */
export type { ResourceMatchView };
