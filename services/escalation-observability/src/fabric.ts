/**
 * EscalationObservabilityService — the C021 reference read/projection
 * service (Work Order C021; issue #127). In-process fabric pattern
 * (mirrors services/expert-performance structurally): in-memory
 * append-only reference store, injected PUBLIC dep source ports
 * (C001 events + request subjects, C011 engagement SLA clocks, C010
 * payment-state refs, C015 routing decisions), fail-closed errors,
 * REQUIRED idempotency keys on commands (lock rule 17 — the A015
 * durable-job discipline: correlation-addressable, replay-safe).
 *
 *   - materializeTenantProjections (COMMAND, idempotency key REQUIRED):
 *     ingests the tenant's escalation event stream through the C001
 *     port, projects the per-escalation timelines, measures the SLA
 *     clocks through the C011 engagement port (the domain package's
 *     measurement — evidence law enforced) and appends the measured
 *     records. APPEND-ONLY: re-materializing at a later projection time
 *     appends NEW measured records (supersessions of earlier ones per
 *     clock), never edits prior records in place.
 *   - correctMeasuredSlaRecord (COMMAND): the explicit supersession
 *     path — a correction is a NEW record referencing the prior id.
 *   - getEscalationTimeline / listEscalationSummaries / getSlaOverview /
 *     getSloRollups / getNetworkHealth / getAggregateSloView (QUERIES):
 *     the ops query surface. Cross-tenant reads fail closed
 *     (TENANT_MISMATCH); aggregate SLO views suppress small-sample
 *     cells (a tenant's detail can never leak through an aggregate).
 *
 * PROJECTIONS OWN NO DOMAIN TRUTH: there is no code path that mutates
 * an escalation, engagement, payment or routing record. All times are
 * injected — no hidden clocks.
 */

import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';

import {
  ESCALATION_OBSERVABILITY_ERROR_CODES,
  EscalationObservabilityError,
  aggregateSloRollups,
  computeAvailabilityCoverage,
  computeMatchingLatency,
  computeQueueDepth,
  computeReplacementRate,
  computeValidationBacklog,
  createMeasuredSlaRecord,
  effectiveMeasuredSlaRecords,
  foldEscalationSummary,
  measureSlaClocks,
  measuredSlaRecordId,
  projectBacklogAlertRule,
  projectEscalationTimeline,
  projectSlaAlertRules,
  rollupSlo,
  supersedeMeasuredSlaRecord,
} from '@arena/escalation-observability';
import type {
  AggregateSloView,
  AvailabilityCoverageSignal,
  EscalationSummaryView,
  EscalationTimelineProjection,
  MatchingLatencySignal,
  MeasuredSlaRecord,
  ProjectedAlertRule,
  QueueDepthSignal,
  ReplacementRateSignal,
  SloRollupDimension,
  SloRollupView,
  ValidationBacklogSignal,
} from '@arena/escalation-observability';

import type {
  EscalationObservabilitySourcePorts,
  EscalationRequestSubjectData,
} from './ports.js';

export interface CommandOptions {
  readonly correlationId: string;
  readonly idempotencyKey: string;
  /** Caller-injected operation time (no hidden clock). */
  readonly at: string;
}

export interface QueryOptions {
  readonly correlationId: string;
  /** Caller-injected projection time (optional — honest `now` default off the latest observed event). */
  readonly at?: string;
}

export interface MaterializeResult {
  readonly jobId: string;
  readonly tenant: string;
  readonly replayed: boolean;
  readonly projectedTimelineCount: number;
  readonly appendedSlaRecordCount: number;
  readonly projectedAt: string;
}

/** The durable job log entry (the A015 discipline, reference fabric). */
export interface ProjectionJobLogEntry {
  readonly jobId: string;
  readonly correlationId: string;
  readonly tenant: string;
  readonly idempotencyKey: string;
  readonly at: string;
  readonly kind: 'materialize-tenant' | 'correct-sla-record';
  readonly replayed: boolean;
}

interface IdempotencyBinding {
  readonly jobId: string;
  readonly tenant: string;
}

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new EscalationObservabilityError(
      ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_PROJECTION,
      { message: `${field} must be a non-empty string`, details: { field } },
    );
  }
  return value;
}

/**
 * The in-process reference service. Construct with the injected dep
 * source ports; the store is fresh per instance (the reference-fabric
 * pattern). Cross-tenant store reads fail closed.
 */
export class EscalationObservabilityService {
  private readonly ports: EscalationObservabilitySourcePorts;
  private readonly timelines = new Map<string, EscalationTimelineProjection>();
  private readonly slaRecords = new Map<string, MeasuredSlaRecord>();
  private readonly jobs = new Map<string, IdempotencyBinding>();
  private readonly jobLog: ProjectionJobLogEntry[] = [];

  constructor(ports: EscalationObservabilitySourcePorts) {
    this.ports = ports;
  }

  // -------------------------------------------------------------------------
  // materializeTenantProjections (COMMAND — idempotent, append-only)
  // -------------------------------------------------------------------------

  async materializeTenantProjections(
    input: { readonly tenant: string },
    options: CommandOptions,
  ): Promise<MaterializeResult> {
    const correlationId = toCorrelationId(options.correlationId);
    const idempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const tenant = requireNonEmpty(input.tenant, 'tenant');

    const binding = this.jobs.get(idempotencyKey);
    if (binding !== undefined) {
      // Idempotent replay: the job already ran — report it honestly.
      this.jobLog.push({
        jobId: binding.jobId,
        correlationId,
        tenant: binding.tenant,
        idempotencyKey,
        at: options.at,
        kind: 'materialize-tenant',
        replayed: true,
      });
      return {
        jobId: binding.jobId,
        tenant: binding.tenant,
        replayed: true,
        projectedTimelineCount: this.timelinesOf(binding.tenant).length,
        appendedSlaRecordCount: 0,
        projectedAt: options.at,
      };
    }

    const events = await this.ports.events.listEscalationEvents({ tenant });
    for (const event of events) {
      if (event.tenantId !== tenant) {
        throw new EscalationObservabilityError(
          ESCALATION_OBSERVABILITY_ERROR_CODES.PORT_FAILURE,
          {
            message: `the escalation event port returned an event of tenant ${event.tenantId} for the tenant-${tenant} materialization job — a cross-tenant port leak fails closed`,
            details: { eventId: event.eventId, tenant },
          },
        );
      }
    }

    const requestIds = [...new Set(events.map((event) => event.requestId))];
    const subjects = await Promise.all(
      requestIds.map((requestId) =>
        this.ports.requests.resolveRequestSubject({ tenant, requestId }),
      ),
    );
    const subjectByRequest = new Map<string, EscalationRequestSubjectData>();
    for (const subject of subjects) {
      if (subject !== null) subjectByRequest.set(subject.requestId, subject);
    }

    let appendedSlaRecordCount = 0;
    for (const requestId of requestIds) {
      const subject = subjectByRequest.get(requestId) ?? null;
      const timeline = projectEscalationTimeline(
        events.filter((event) => event.requestId === requestId),
        {
          tenant,
          requestId,
          at: options.at,
          clientAppId: subject?.clientAppId ?? null,
          capabilityNeed: subject?.capabilityNeed ?? null,
          urgency: subject?.urgency ?? null,
        },
      );
      this.timelines.set(`${tenant}:${requestId}`, timeline);

      const engagement = await this.ports.engagement.resolveEngagementSla({
        tenant,
        requestId,
      });
      if (engagement === null) {
        // No engagement record yet — the timeline stands alone (honest
        // partial projection, never a fabricated SLA measurement).
        continue;
      }
      if (subject?.urgency !== null && subject?.urgency !== undefined &&
          subject.urgency !== engagement.urgency) {
        throw new EscalationObservabilityError(
          ESCALATION_OBSERVABILITY_ERROR_CODES.PORT_FAILURE,
          {
            message: `the engagement port's urgency (${engagement.urgency}) disagrees with the escalation request subject (${subject.urgency}) — an inconsistent port view fails closed`,
            details: { requestId, tenant },
          },
        );
      }
      const measurement = measureSlaClocks({
        tenant,
        requestId,
        engagementId: engagement.engagementId,
        urgency: engagement.urgency,
        requestDeadline: engagement.requestDeadline,
        offerIssuedAt: engagement.offerIssuedAt,
        milestones: {
          acceptedAt: engagement.acceptedAt,
          activatedAt: engagement.activatedAt,
          submittedAt: engagement.submittedAt,
          validationVerdictAt: engagement.validationVerdictAt,
        },
        at: options.at,
        evidenceEventIds: events
          .filter((event) => event.requestId === requestId)
          .map((event) => event.eventId),
      });
      for (const clock of measurement.clocks) {
        const recordId = await measuredSlaRecordId(requestId, clock.clock, options.at);
        if (this.slaRecords.has(recordId)) continue;
        const record = createMeasuredSlaRecord({
          slaRecordId: recordId,
          tenant,
          requestId,
          engagementId: engagement.engagementId,
          urgency: engagement.urgency,
          clock: clock.clock,
          dueAt: clock.dueAt,
          milestoneAt: clock.milestoneAt,
          state: clock.state,
          reasons: [...clock.reasons],
          observedAt: options.at,
          evidenceEventIds: events
            .filter((event) => event.requestId === requestId)
            .map((event) => event.eventId),
          supersedes: null,
        });
        this.slaRecords.set(recordId, record);
        appendedSlaRecordCount += 1;
      }
    }

    const jobId = `job_${idempotencyKey}`;
    this.jobs.set(idempotencyKey, { jobId, tenant });
    this.jobLog.push({
      jobId,
      correlationId,
      tenant,
      idempotencyKey,
      at: options.at,
      kind: 'materialize-tenant',
      replayed: false,
    });
    return {
      jobId,
      tenant,
      replayed: false,
      projectedTimelineCount: requestIds.length,
      appendedSlaRecordCount,
      projectedAt: options.at,
    };
  }

  // -------------------------------------------------------------------------
  // correctMeasuredSlaRecord (COMMAND — the supersession path)
  // -------------------------------------------------------------------------

  async correctMeasuredSlaRecord(
    input: {
      readonly tenant: string;
      readonly requestId: string;
      readonly clock: string;
      readonly state: string;
      readonly reasons: readonly string[];
      readonly milestoneAt?: string | null;
      readonly correctionId: string;
      readonly observedAt: string;
    },
    options: CommandOptions,
  ): Promise<{ readonly record: MeasuredSlaRecord }> {
    toCorrelationId(options.correlationId);
    toIdempotencyKey(options.idempotencyKey);
    const prior = this.effectiveRecordsOf(input.tenant).find(
      (record) => record.requestId === input.requestId && record.clock === input.clock,
    );
    if (prior === undefined) {
      throw new EscalationObservabilityError(
        ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLA,
        {
          message: `no measured SLA record to correct for escalation ${input.requestId} clock ${input.clock} — materialize the projections first`,
          details: { requestId: input.requestId, clock: input.clock },
        },
      );
    }
    const correction = supersedeMeasuredSlaRecord(prior, {
      slaRecordId: input.correctionId,
      state: input.state,
      reasons: input.reasons,
      milestoneAt: input.milestoneAt ?? null,
      observedAt: input.observedAt,
    });
    this.slaRecords.set(correction.slaRecordId, correction);
    this.jobLog.push({
      jobId: `job_${options.idempotencyKey}`,
      correlationId: options.correlationId,
      tenant: input.tenant,
      idempotencyKey: options.idempotencyKey,
      at: input.observedAt,
      kind: 'correct-sla-record',
      replayed: false,
    });
    return { record: correction };
  }

  // -------------------------------------------------------------------------
  // Queries (cross-tenant reads fail closed)
  // -------------------------------------------------------------------------

  async getEscalationTimeline(
    query: { readonly tenant: string; readonly requestId: string },
    _options: QueryOptions,
  ): Promise<EscalationTimelineProjection> {
    const timeline = this.timelines.get(`${query.tenant}:${query.requestId}`);
    if (timeline === undefined) {
      throw new EscalationObservabilityError(
        ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_PROJECTION,
        {
          message: `no projected timeline for escalation ${query.requestId} (materialize the tenant projections first)`,
          details: { requestId: query.requestId, tenant: query.tenant },
        },
      );
    }
    return timeline;
  }

  async listEscalationSummaries(
    query: { readonly tenant: string },
    _options: QueryOptions,
  ): Promise<readonly EscalationSummaryView[]> {
    return this.timelinesOf(query.tenant)
      .map((timeline) => foldEscalationSummary(timeline))
      .sort((a, b) => a.requestId.localeCompare(b.requestId));
  }

  async getSlaOverview(
    query: { readonly tenant: string },
    options: QueryOptions,
  ): Promise<{
    readonly records: readonly MeasuredSlaRecord[];
    readonly alertRules: readonly ProjectedAlertRule[];
  }> {
    const records = this.effectiveRecordsOf(query.tenant);
    const alertRules = projectSlaAlertRules({
      tenant: query.tenant,
      measuredStates: records.map((record) => ({
        requestId: record.requestId,
        clock: record.clock,
        urgency: record.urgency,
        state: record.state,
      })),
      at: options.at ?? records[0]?.observedAt ?? new Date(0).toISOString(),
    });
    return { records, alertRules };
  }

  async getSloRollups(
    query: {
      readonly tenant: string;
      readonly dimension: SloRollupDimension;
      readonly window: { readonly windowStart: number; readonly windowEnd: number };
      readonly targetRatio?: number;
    },
    _options: QueryOptions,
  ): Promise<readonly SloRollupView[]> {
    const timelines = this.timelinesOf(query.tenant);
    const routingByKey = new Map<string, { resourceClass: string; capability: string }>();
    for (const timeline of timelines) {
      const decision = await this.ports.routing.resolveRoutingDecision({
        tenant: query.tenant,
        requestId: timeline.requestId,
      });
      if (decision !== null) routingByKey.set(timeline.requestId, decision);
    }
    const groups = new Map<string, { good: number; bad: number }>();
    for (const timeline of timelines) {
      if (!timeline.terminal) continue;
      const decision = routingByKey.get(timeline.requestId);
      const key =
        query.dimension === 'capability'
          ? timeline.capabilityNeed ?? decision?.capability ?? null
          : query.dimension === 'resource-class'
            ? decision?.resourceClass ?? null
            : query.dimension === 'client-app'
              ? timeline.clientAppId
              : timeline.tenant;
      if (key === null || key === undefined) continue;
      const bucket = groups.get(key) ?? { good: 0, bad: 0 };
      const lastEvent = timeline.steps[timeline.steps.length - 1];
      const good = lastEvent?.eventType === 'escalation.completed';
      if (good) bucket.good += 1;
      else bucket.bad += 1;
      groups.set(key, bucket);
    }
    const windowStart = query.window.windowStart;
    const cells: SloRollupView[] = [];
    for (const key of [...groups.keys()].sort()) {
      const bucket = groups.get(key) as { good: number; bad: number };
      const samples = [
        ...Array.from({ length: bucket.good }, (_, index) => ({
          occurredAt: windowStart + index,
          good: true,
        })),
        ...Array.from({ length: bucket.bad }, (_, index) => ({
          occurredAt: windowStart + bucket.good + index,
          good: false,
        })),
      ];
      cells.push(
        rollupSlo({
          dimension: query.dimension,
          key,
          samples,
          window: query.window,
          targetRatio: query.targetRatio ?? 0.9,
        }),
      );
    }
    return Object.freeze(cells);
  }

  async getNetworkHealth(
    query: {
      readonly tenant: string;
      readonly availabilityWindows?: readonly {
        readonly declaredCapacity: number;
        readonly remainingCapacity: number;
      }[];
      readonly backlogThreshold?: number;
    },
    options: QueryOptions,
  ): Promise<{
    readonly matchingLatency: MatchingLatencySignal;
    readonly queueDepth: QueueDepthSignal;
    readonly validationBacklog: ValidationBacklogSignal;
    readonly replacementRate: ReplacementRateSignal;
    readonly availabilityCoverage: AvailabilityCoverageSignal | null;
    readonly alertRules: readonly ProjectedAlertRule[];
  }> {
    const events = await this.ports.events.listEscalationEvents({
      tenant: query.tenant,
    });
    const at =
      options.at ??
      events[events.length - 1]?.occurredAt ??
      new Date(0).toISOString();
    const matchingLatency = computeMatchingLatency(events, {
      tenant: query.tenant,
      at,
    });
    const queueDepth = computeQueueDepth(events, { tenant: query.tenant, at });
    const validationBacklog = computeValidationBacklog(events, {
      tenant: query.tenant,
      at,
    });
    const replacementRate = computeReplacementRate(events, {
      tenant: query.tenant,
      at,
    });
    const availabilityCoverage =
      query.availabilityWindows === undefined
        ? null
        : computeAvailabilityCoverage(query.availabilityWindows, {
            tenant: query.tenant,
            at,
          });
    const backlogRule = projectBacklogAlertRule({
      tenant: query.tenant,
      backlogCount: validationBacklog.backlogCount,
      threshold: query.backlogThreshold ?? 10,
      at,
    });
    const alertRules = backlogRule === null ? [] : [backlogRule];
    return {
      matchingLatency,
      queueDepth,
      validationBacklog,
      replacementRate,
      availabilityCoverage,
      alertRules,
    };
  }

  async getAggregateSloView(
    query: {
      readonly dimension: SloRollupDimension;
      readonly window: { readonly windowStart: number; readonly windowEnd: number };
      readonly targetRatio?: number;
      readonly minSampleCount?: number;
    },
    _options: QueryOptions,
  ): Promise<AggregateSloView> {
    const tenants = [...new Set([...this.timelines.keys()].map((key) => key.split(':')[0]!))];
    const cells: SloRollupView[] = [];
    for (const tenant of tenants) {
      const rollups = await this.getSloRollups(
        {
          tenant,
          dimension: query.dimension,
          window: query.window,
          ...(query.targetRatio !== undefined ? { targetRatio: query.targetRatio } : {}),
        },
        { correlationId: 'aggregate-view' },
      );
      for (const rollup of rollups) {
        // Re-key the cell to the tenant scope for the aggregate lens.
        cells.push(
          rollupSlo({
            dimension: 'tenant',
            key: tenant,
            samples: samplesOfRollup(rollup, query.window.windowStart),
            window: query.window,
            targetRatio: query.targetRatio ?? 0.9,
            ...(query.minSampleCount !== undefined
              ? { minSampleCount: query.minSampleCount }
              : {}),
          }),
        );
      }
    }
    return aggregateSloRollups({
      dimension: query.dimension,
      cells,
      window: query.window,
      targetRatio: query.targetRatio ?? 0.9,
      ...(query.minSampleCount !== undefined
        ? { minSampleCount: query.minSampleCount }
        : {}),
    });
  }

  /** The durable job log (append-only evidence of the A015 jobs). */
  getJobLog(): readonly ProjectionJobLogEntry[] {
    return Object.freeze([...this.jobLog]);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private timelinesOf(tenant: string): readonly EscalationTimelineProjection[] {
    const owned: EscalationTimelineProjection[] = [];
    for (const [key, timeline] of this.timelines) {
      if (key.split(':')[0] !== tenant) {
        // A cross-tenant read attempt NEVER surfaces another tenant's
        // projections — the entry is skipped, never returned.
        continue;
      }
      if (timeline.tenant !== tenant) {
        throw new EscalationObservabilityError(
          ESCALATION_OBSERVABILITY_ERROR_CODES.TENANT_MISMATCH,
          {
            message: `store integrity: timeline of escalation ${timeline.requestId} is indexed under tenant ${tenant} but carries tenant ${timeline.tenant}`,
            details: { requestId: timeline.requestId },
          },
        );
      }
      owned.push(timeline);
    }
    return owned;
  }

  private effectiveRecordsOf(tenant: string): readonly MeasuredSlaRecord[] {
    const owned: MeasuredSlaRecord[] = [];
    for (const record of this.slaRecords.values()) {
      if (record.tenant !== tenant) continue;
      owned.push(record);
    }
    return effectiveMeasuredSlaRecords(owned);
  }
}

function samplesOfRollup(
  rollup: SloRollupView,
  windowStart: number,
): { occurredAt: number; good: boolean }[] {
  const samples: { occurredAt: number; good: boolean }[] = [];
  for (let good = 0; good < rollup.evaluation.goodCount; good += 1) {
    samples.push({ occurredAt: windowStart + good, good: true });
  }
  for (let bad = 0; bad < rollup.evaluation.badCount; bad += 1) {
    samples.push({ occurredAt: windowStart + rollup.evaluation.goodCount + bad, good: false });
  }
  return samples;
}
