/**
 * ExpertPerformanceService — the in-process reference read/projection
 * service over the @arena/expert-performance domain (Work Order C005;
 * mirrors the services/expert-calibration fabric pattern structurally:
 * in-memory append-only reference store, injected dep source ports,
 * fail-closed errors, envelope conventions, REQUIRED idempotency keys on
 * commands).
 *
 * Operations:
 *   - appendEvidence (COMMAND, idempotency key REQUIRED — lock rule 17):
 *     resolves the dep source record through the injected PUBLIC port
 *     (provenance verification — a fabricated/tampered source digest
 *     fails closed with PORT_FAILURE), maps it through the pure closed
 *     ingestion mapping (the caller never chooses outcomes), enforces the
 *     EVIDENCE-REPLAY defense (the same source digest can never be
 *     counted twice in one dimension) and APPENDS one content-addressed
 *     evidence record (append-only, lock rule 6);
 *   - getRoutingInput (QUERY — the C002 routing lens): the frozen
 *     demonstrated-performance / historical-task-fit input per dimension,
 *     freshness-aware under the explicit versioned policy;
 *   - getCapabilityHistory (QUERY — the expert-facing lens): the
 *     chronological evidence timeline with attribution over the SAME
 *     canonical profile;
 *   - getDimensionAggregate (QUERY): the typed, versioned,
 *     single-dimension summary (a cross-dimension/global aggregate query
 *     has no code path at all);
 *   - getEvidenceRecord (QUERY): the provenance-addressable read of one
 *     record (cross-tenant reads fail closed with TENANT_MISMATCH).
 *
 * Integrity: every store fetch re-verifies the content digest — a
 * tampered store entry fails closed with EXPERT_PERFORMANCE_TAMPERED.
 * Tenant isolation: cross-tenant access fails closed (lock rule 11).
 * Determinism: all times are injected — no hidden clocks.
 */

import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { Envelope } from '@arena/protocol-core';
import {
  DEFAULT_FRESHNESS_POLICY,
  EXPERT_PERFORMANCE_ERROR_CODES,
  ExpertPerformanceError,
  assemblePerformanceProfile,
  buildDimensionalSummaryAggregate,
  createEvidenceRecord,
  makeAppendEvidenceCommand,
  makeEvidenceAppendedEvent,
  makeGetCapabilityHistoryQuery,
  makeGetCapabilityHistoryResponse,
  makeGetDimensionAggregateQuery,
  makeGetDimensionAggregateResponse,
  makeGetEvidenceRecordQuery,
  makeGetEvidenceRecordResponse,
  makeGetRoutingInputQuery,
  makeGetRoutingInputResponse,
  mapSourceEvidence,
  recomputeEvidenceRecordDigest,
  toRoutingLens,
  toCapabilityHistoryLens,
} from '@arena/expert-performance';
import type {
  CapabilityHistoryView,
  DimensionalSummaryAggregate,
  EvidenceSourceData,
  FreshnessPolicy,
  PerformanceEvidenceRecord,
  PerformanceProfile,
  RoutingPerformanceInputView,
} from '@arena/expert-performance';
import type {
  ExpertPerformanceSourcePorts,
  EvidenceSourceLookup,
} from './ports.js';

export interface CommandOptions {
  readonly correlationId: string;
  readonly idempotencyKey: string;
  /** Caller-injected operation time (ms-precision UTC — no hidden clock). */
  readonly at: string;
}

export interface QueryOptions {
  readonly correlationId: string;
  /** Caller-injected projection time for lens/aggregate reads. */
  readonly at: string;
}

export interface RecordQueryOptions {
  readonly correlationId: string;
}

export interface AppendEvidenceInput {
  readonly recordId: string;
  readonly tenant: string;
  readonly expertId: string;
  /** The dep surface the evidence accumulates from (closed family). */
  readonly family: string;
  /** The dimension this evidence feeds (must be admissible for the family). */
  readonly dimension: string;
  /** The content digest of the dep record the evidence derives from. */
  readonly refDigest: string;
}

export interface AppendEvidenceResult {
  readonly record: PerformanceEvidenceRecord;
  readonly replayed: boolean;
}

interface IdempotencyBinding {
  readonly recordId: string;
  readonly canonical: string;
}

interface ServiceEvent {
  readonly kind: string;
  readonly envelope: Envelope<Record<string, unknown>>;
}

function canonicalOf(parts: readonly unknown[]): string {
  return JSON.stringify(parts);
}

/**
 * The in-process reference service. Construct with the injected dep
 * source ports (C004 calibration verdicts, A007 qualification + match
 * history, A019 skill-extraction outcomes, A020 attribution records) and
 * an optional freshness policy (the default policy is in force
 * otherwise); the store is fresh per instance (the reference-fabric
 * pattern).
 */
export class ExpertPerformanceService {
  private readonly ports: ExpertPerformanceSourcePorts;
  private readonly policy: FreshnessPolicy;
  private readonly records = new Map<string, PerformanceEvidenceRecord>();
  private readonly recordOrder: string[] = [];
  private readonly sourceIndex = new Map<string, string>();
  private readonly idempotency = new Map<string, IdempotencyBinding>();
  private readonly events: ServiceEvent[] = [];

  constructor(ports: ExpertPerformanceSourcePorts, policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY) {
    this.ports = ports;
    this.policy = policy;
  }

  // -------------------------------------------------------------------------
  // appendEvidence (COMMAND — the only write; append-only)
  // -------------------------------------------------------------------------

  async appendEvidence(
    input: AppendEvidenceInput,
    options: CommandOptions,
  ): Promise<AppendEvidenceResult> {
    const correlationId = toCorrelationId(options.correlationId);
    const idempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const command = makeAppendEvidenceCommand(
      {
        recordId: input.recordId,
        tenant: input.tenant,
        expertId: input.expertId,
        family: input.family,
        dimension: input.dimension,
        refDigest: input.refDigest,
        at: options.at,
      },
      { correlationId, idempotencyKey },
    );

    const canonical = canonicalOf([command.kind, command.schema, command.payload]);
    const binding = this.idempotency.get(idempotencyKey);
    if (binding !== undefined) {
      if (binding.canonical !== canonical) {
        throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `append-evidence: idempotency key ${JSON.stringify(options.idempotencyKey)} is already bound to a different command`,
          details: { idempotencyKey: options.idempotencyKey },
        });
      }
      const replayed = await this.fetchRecord(binding.recordId, input.tenant);
      return { record: replayed, replayed: true };
    }
    if (this.records.has(input.recordId)) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD, {
        message: `append-evidence: recordId ${JSON.stringify(input.recordId)} already exists — the store is append-only with unique record ids`,
      });
    }

    const source = await this.resolveSource(input);
    const priorEvaluatorVersion = this.priorEvaluatorVersionOf(
      input.tenant,
      input.expertId,
      input.dimension,
    );
    const mapped = mapSourceEvidence({
      tenant: input.tenant,
      expertId: input.expertId,
      recordId: input.recordId,
      family: input.family,
      dimension: input.dimension,
      source,
      recordedAt: options.at,
      priorEvaluatorVersion,
    });
    const record = await createEvidenceRecord(mapped);

    const sourceKey = canonicalOf([
      input.tenant,
      input.expertId,
      input.family,
      input.refDigest,
      input.dimension,
    ]);
    if (this.sourceIndex.has(sourceKey)) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.DUPLICATE_EVIDENCE, {
        message: `append-evidence: source digest ${JSON.stringify(input.refDigest)} is ALREADY folded into dimension '${input.dimension}' — the same dep record cannot be counted twice in one dimension (evidence-replay inflation defense)`,
        details: { sourceKey, existingRecordId: this.sourceIndex.get(sourceKey) },
      });
    }

    this.records.set(record.recordId, record);
    this.recordOrder.push(record.recordId);
    this.sourceIndex.set(sourceKey, record.recordId);
    this.idempotency.set(idempotencyKey, { recordId: record.recordId, canonical });
    const event = makeEvidenceAppendedEvent(
      {
        recordId: record.recordId,
        tenant: record.tenant,
        expertId: record.expertId,
        dimension: record.dimension,
        outcome: record.outcome,
        attributionKind: record.attribution.kind,
        recordDigest: record.digest,
        at: options.at,
      },
      { correlationId, idempotencyKey },
    );
    this.events.push({
      kind: 'evidence-appended',
      envelope: event as unknown as Envelope<Record<string, unknown>>,
    });
    return { record, replayed: false };
  }

  // -------------------------------------------------------------------------
  // Read lenses (QUERIES — pure reads over the same canonical profile)
  // -------------------------------------------------------------------------

  async getRoutingInput(
    input: { readonly tenant: string; readonly expertId: string },
    options: QueryOptions,
  ): Promise<{ readonly profile: PerformanceProfile; readonly lens: RoutingPerformanceInputView }> {
    const correlationId = toCorrelationId(options.correlationId);
    makeGetRoutingInputQuery(
      { tenant: input.tenant, expertId: input.expertId, at: options.at },
      { correlationId },
    );
    const profile = await this.assemble(input.tenant, input.expertId, options.at);
    const lens = toRoutingLens(profile);
    makeGetRoutingInputResponse(
      {
        tenant: lens.tenant,
        expertId: lens.expertId,
        asOf: lens.asOf,
        profileDigest: lens.profileDigest,
        dimensions: lens.dimensions.map((summary) => ({
          dimension: summary.dimension,
          freshness: summary.freshness.status,
          recordCount: summary.recordCount,
          totalSampleSize: summary.totalSampleSize,
          latestOutcome: summary.latestOutcome,
          evaluatorVersionChanges: summary.evaluatorVersionChanges,
        })),
      },
      { correlationId },
    );
    return { profile, lens };
  }

  async getCapabilityHistory(
    input: { readonly tenant: string; readonly expertId: string },
    options: QueryOptions,
  ): Promise<{ readonly profile: PerformanceProfile; readonly history: CapabilityHistoryView }> {
    const correlationId = toCorrelationId(options.correlationId);
    makeGetCapabilityHistoryQuery(
      { tenant: input.tenant, expertId: input.expertId, at: options.at },
      { correlationId },
    );
    const records = await this.recordsOf(input.tenant, input.expertId);
    const profile = await this.assemble(input.tenant, input.expertId, options.at);
    const history = toCapabilityHistoryLens(profile, records);
    makeGetCapabilityHistoryResponse(
      {
        tenant: history.tenant,
        expertId: history.expertId,
        asOf: history.asOf,
        profileDigest: history.profileDigest,
        totalRecords: history.totalRecords,
      },
      { correlationId },
    );
    return { profile, history };
  }

  async getDimensionAggregate(
    input: { readonly tenant: string; readonly expertId: string; readonly dimension: string },
    options: QueryOptions,
  ): Promise<DimensionalSummaryAggregate> {
    const correlationId = toCorrelationId(options.correlationId);
    makeGetDimensionAggregateQuery(
      { tenant: input.tenant, expertId: input.expertId, dimension: input.dimension, at: options.at },
      { correlationId },
    );
    const records = (await this.recordsOf(input.tenant, input.expertId)).filter(
      (record) => record.dimension === input.dimension,
    );
    const aggregate = await buildDimensionalSummaryAggregate({
      dimension: input.dimension,
      records,
      asOf: options.at,
    });
    makeGetDimensionAggregateResponse(
      {
        tenant: input.tenant,
        expertId: input.expertId,
        dimension: aggregate.dimension,
        formula: aggregate.formula,
        formulaVersion: aggregate.formulaVersion,
        sampleSize: aggregate.sampleSize,
        aggregateDigest: aggregate.digest,
      },
      { correlationId },
    );
    return aggregate;
  }

  async getEvidenceRecord(
    input: { readonly tenant: string; readonly recordId: string },
    options: RecordQueryOptions,
  ): Promise<PerformanceEvidenceRecord> {
    const correlationId = toCorrelationId(options.correlationId);
    makeGetEvidenceRecordQuery(
      { tenant: input.tenant, recordId: input.recordId },
      { correlationId },
    );
    const record = await this.fetchRecord(input.recordId, input.tenant);
    makeGetEvidenceRecordResponse(
      {
        tenant: record.tenant,
        recordId: record.recordId,
        recordDigest: record.digest,
      },
      { correlationId },
    );
    return record;
  }

  /** The events emitted so far (audit trail of the append-only log). */
  emittedEvents(): readonly ServiceEvent[] {
    return Object.freeze([...this.events]);
  }

  /** The number of records in the append-only store. */
  recordCount(): number {
    return this.records.size;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async resolveSource(
    input: AppendEvidenceInput,
  ): Promise<EvidenceSourceData> {
    const lookup: EvidenceSourceLookup = {
      tenant: input.tenant,
      expertId: input.expertId,
      refDigest: input.refDigest,
    };
    const source =
      input.family === 'expert-calibration-verdict'
        ? await this.ports.calibration.resolveCalibrationVerdict(lookup)
        : input.family === 'expert-qualification-record'
          ? await this.ports.qualification.resolveQualificationRecord(lookup)
          : input.family === 'expert-match-history'
            ? await this.ports.qualification.resolveMatchHistoryEntry(lookup)
            : input.family === 'skill-extraction-outcome'
              ? await this.ports.skillExtraction.resolveSkillExtractionOutcome(lookup)
              : await this.ports.learning.resolveAttributionRecord(lookup);
    if (source === null || source === undefined) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.PORT_FAILURE, {
        message: `append-evidence: provenance verification FAILED — the ${JSON.stringify(input.family)} port did not resolve source digest ${JSON.stringify(input.refDigest)} for (${input.tenant}/${input.expertId}); fabricated or tampered provenance fails closed`,
        details: { family: input.family, refDigest: input.refDigest },
      });
    }
    return source;
  }

  private priorEvaluatorVersionOf(
    tenant: string,
    expertId: string,
    dimension: string,
  ): string | null {
    let prior: string | null = null;
    for (const recordId of this.recordOrder) {
      const record = this.records.get(recordId);
      if (
        record !== undefined &&
        record.tenant === tenant &&
        record.expertId === expertId &&
        record.dimension === dimension &&
        record.attribution.evaluatorVersion !== null
      ) {
        prior = record.attribution.evaluatorVersion;
      }
    }
    return prior;
  }

  private async recordsOf(
    tenant: string,
    expertId: string,
  ): Promise<readonly PerformanceEvidenceRecord[]> {
    const collected: PerformanceEvidenceRecord[] = [];
    for (const recordId of this.recordOrder) {
      const record = this.records.get(recordId);
      if (record === undefined) continue;
      if (record.tenant !== tenant || record.expertId !== expertId) continue;
      collected.push(await this.verify(record));
    }
    return collected;
  }

  private async assemble(tenant: string, expertId: string, asOf: string): Promise<PerformanceProfile> {
    return assemblePerformanceProfile({
      tenant,
      expertId,
      records: await this.recordsOf(tenant, expertId),
      policy: this.policy,
      asOf,
    });
  }

  private async fetchRecord(recordId: string, tenant: string): Promise<PerformanceEvidenceRecord> {
    const record = this.records.get(recordId);
    if (record === undefined) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.NOT_FOUND, {
        message: `evidence record ${JSON.stringify(recordId)} not found`,
      });
    }
    if (record.tenant !== tenant) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.TENANT_MISMATCH, {
        message: `evidence record ${JSON.stringify(recordId)} belongs to tenant ${JSON.stringify(record.tenant)} — cross-tenant profile reads fail closed (lock rule 11)`,
        details: { recordTenant: record.tenant, requestedTenant: tenant },
      });
    }
    return this.verify(record);
  }

  private async verify(record: PerformanceEvidenceRecord): Promise<PerformanceEvidenceRecord> {
    const digest = await recomputeEvidenceRecordDigest(record);
    if (digest !== record.digest) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.TAMPERED, {
        message: `evidence record ${JSON.stringify(record.recordId)} failed content-digest re-verification — a tampered store entry fails closed`,
        details: { recordId: record.recordId },
      });
    }
    return record;
  }
}

/** Convenience constructor (mirrors the sibling service factories). */
export function createExpertPerformanceService(
  ports: ExpertPerformanceSourcePorts,
  policy?: FreshnessPolicy,
): ExpertPerformanceService {
  return new ExpertPerformanceService(ports, policy);
}
