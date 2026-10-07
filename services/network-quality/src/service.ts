/**
 * The network-quality REFERENCE SERVICE (Work Order C020; issue #126):
 * dispute intake/resolution, COI registration/checks, anti-gaming and
 * fraud detection jobs over the injected dep ports — durable,
 * idempotent on the A015 fabric conventions, fail-closed errors,
 * envelope events per the sibling services.
 *
 * COMMANDS carry REQUIRED idempotency keys (lock rule 17): a replay of
 * the same key returns the recorded outcome verbatim; a key bound to a
 * DIFFERENT command fails closed (IDEMPOTENCY_CONFLICT). QUERIES are
 * pure reads. Cross-tenant reads fail closed (NOT_FOUND). Tampered
 * store entries fail closed on digest re-verification.
 *
 * FINDINGS PROPOSE, NEVER SILENTLY ADJUST: the detection jobs store
 * typed findings, emit finding-recorded events, book conduct-flag
 * reputation evidence (append-only) and forward the findings' typed
 * proposals to the injected proposal sinks. Nothing writes into
 * C005/C009/C010/C013 state.
 */

import {
  NetworkQualityError,
  NETWORK_QUALITY_ERROR_CODES,
  aggregateFamilyOutcomes,
  createReputationRecord,
  verifyReputationRecordDigest,
  openDispute,
  transitionDispute,
  verifyDisputeDigest,
  createCoiRecord,
  retractCoiRecord,
  verifyCoiRecordDigest,
  checkConflictOfInterest,
  detectSelfVotingAttempts,
  detectDuplicateAccountSignals,
  detectCoordinatedBrigading,
  detectRateLimitBreaches,
  detectCapacityGaming,
  detectDuplicatePayoutAttempts,
  detectPayoutVelocityAnomalies,
  detectExpertImpersonation,
  openEnforcementCase,
  transitionEnforcementCase,
  verifyEnforcementCaseDigest,
  mapValidationOutcomeToReputation,
  mapCompetitionOutcomeToReputation,
  mapFindingToConductFlag,
  proposeProfileEvidence,
  proposeRequalificationTrigger,
  DEFAULT_ANTI_GAMING_POLICY,
  DEFAULT_FRAUD_CONTROL_POLICY,
  makeOpenDisputeCommand,
  makeTransitionDisputeCommand,
  makeRegisterCoiCommand,
  makeRetractCoiCommand,
  makeDisputeTransitionedEvent,
  makeFindingRecordedEvent,
  makeEnforcementUpdatedEvent,
  makeProfileEvidenceProposalEvent,
  makeRequalificationProposalEvent,
  makeCoiCheckVerdictEvent,
} from '@arena/network-quality';
import type {
  AntiGamingPolicy,
  CoiCheckResult,
  CoiRecord,
  DisputeRecord,
  DisputeState,
  DisputeTransitionReason,
  DisputeResolutionOutcome,
  EnforcementAction,
  EnforcementCase,
  EnforcementCaseState,
  FindingRecord,
  FraudControlPolicy,
  ReputationRecord,
} from '@arena/network-quality';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import type {
  Clock,
  NetworkQualitySinks,
  NetworkQualitySourcePorts,
  NetworkQualityStores,
} from './ports.js';

/** Command options (idempotency key REQUIRED — lock rule 17). */
export interface CommandOptions {
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface ServiceQueryOptions {
  readonly correlationId: string;
}

interface IdempotencyBinding {
  readonly canonical: string;
  readonly kind: 'dispute' | 'coi' | 'finding' | 'enforcement' | 'reputation';
  readonly recordId: string;
}

export interface OpenDisputeInput {
  readonly disputeId: string;
  readonly tenant: string;
  readonly complainantParty: string;
  readonly respondentParty: string;
  readonly subjects: readonly {
    readonly kind: string;
    readonly refId: string;
    readonly refDigest?: string | null;
  }[];
  readonly summary: string;
}

export interface TransitionDisputeServiceInput {
  readonly disputeId: string;
  readonly tenant: string;
  readonly to: DisputeState;
  readonly reasons: readonly DisputeTransitionReason[];
  readonly reviewerParty?: string | null;
  readonly resolutionOutcome?: DisputeResolutionOutcome | null;
  readonly note?: string | null;
}

export interface RegisterCoiInput {
  readonly coiId: string;
  readonly tenant: string;
  readonly party: string;
  readonly counterparty: string;
  readonly kind: string;
  readonly origin: string;
  readonly scope?: string;
  readonly derivedFrom?: { readonly surface: string; readonly refDigest: string } | null;
}

export interface IngestValidationOutcomeInput {
  readonly recordId: string;
  readonly tenant: string;
  readonly requestId: string;
  readonly expertRef: string;
  /** The content digest of the C009 adjudication record (provenance). */
  readonly refDigest: string;
}

export interface IngestCompetitionOutcomeInput {
  readonly recordId: string;
  readonly tenant: string;
  readonly competitionId: string;
}

export interface DetectionJobResult {
  readonly findings: readonly FindingRecord[];
  readonly reputationRecords: readonly ReputationRecord[];
  readonly replayed: boolean;
}

export interface OpenEnforcementInput {
  readonly caseId: string;
  readonly tenant: string;
  readonly subjectParty: string;
  readonly sourceFindingDigests: readonly string[];
  readonly proposedAction: EnforcementAction;
  readonly actorParty: string;
  readonly reason: string;
}

export interface TransitionEnforcementInput {
  readonly caseId: string;
  readonly tenant: string;
  readonly to: EnforcementCaseState;
  readonly actorParty: string;
  readonly reason: string;
  readonly action?: EnforcementAction | null;
}

export interface ReputationFamilyView {
  readonly tenant: string;
  readonly expertId: string;
  readonly family: string;
  readonly records: readonly ReputationRecord[];
  readonly aggregateDigest: string | null;
}

function canonicalOf(parts: readonly unknown[]): string {
  return JSON.stringify(parts);
}

export class NetworkQualityService {
  private readonly ports: NetworkQualitySourcePorts;
  private readonly stores: NetworkQualityStores;
  private readonly sinks: NetworkQualitySinks;
  private readonly clock: Clock;
  private readonly antiGamingPolicy: AntiGamingPolicy;
  private readonly fraudPolicy: FraudControlPolicy;
  private readonly idempotency = new Map<string, IdempotencyBinding>();
  /** Detection-job run index (idempotence per tenant + scope). */
  private readonly detectionRuns = new Map<string, readonly string[]>();

  constructor(
    ports: NetworkQualitySourcePorts,
    stores: NetworkQualityStores,
    sinks: NetworkQualitySinks,
    clock: Clock,
    policies?: {
      readonly antiGaming?: AntiGamingPolicy;
      readonly fraud?: FraudControlPolicy;
    },
  ) {
    this.ports = ports;
    this.stores = stores;
    this.sinks = sinks;
    this.clock = clock;
    this.antiGamingPolicy = policies?.antiGaming ?? DEFAULT_ANTI_GAMING_POLICY;
    this.fraudPolicy = policies?.fraud ?? DEFAULT_FRAUD_CONTROL_POLICY;
  }

  private now(): string {
    return new Date(this.clock.now()).toISOString();
  }

  private requireIdempotency(
    options: CommandOptions,
    command: { readonly kind: string; readonly schema: string; readonly payload: unknown },
  ): { correlationId: CorrelationId; idempotencyKey: IdempotencyKey; canonical: string } {
    const correlationId = toCorrelationId(options.correlationId);
    const idempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const canonical = canonicalOf([command.kind, command.schema, command.payload]);
    const binding = this.idempotency.get(options.idempotencyKey);
    if (binding !== undefined && binding.canonical !== canonical) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `network-quality command: idempotency key ${JSON.stringify(options.idempotencyKey)} is already bound to a different command`,
        details: { idempotencyKey: options.idempotencyKey },
      });
    }
    return { correlationId, idempotencyKey, canonical };
  }

  // -------------------------------------------------------------------------
  // Disputes
  // -------------------------------------------------------------------------

  async openDispute(input: OpenDisputeInput, options: CommandOptions): Promise<DisputeRecord> {
    const at = this.now();
    const command = makeOpenDisputeCommand(
      {
        disputeId: input.disputeId,
        tenant: input.tenant,
        complainantParty: input.complainantParty,
        respondentParty: input.respondentParty,
        summary: input.summary,
        at,
      },
      { correlationId: toCorrelationId(options.correlationId), idempotencyKey: toIdempotencyKey(options.idempotencyKey) },
    );
    const { idempotencyKey, canonical } = this.requireIdempotency(options, command);
    const existing = await this.stores.disputes.get(input.disputeId, input.tenant);
    const binding = this.idempotency.get(options.idempotencyKey);
    if (binding !== undefined) {
      if (binding.kind !== 'dispute' || binding.recordId !== input.disputeId) {
        throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: 'open-dispute: idempotency key bound to a different record',
        });
      }
      if (existing !== undefined) return existing;
    }
    if (existing !== undefined) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
        message: `open-dispute: disputeId ${JSON.stringify(input.disputeId)} already exists — dispute ids are unique per tenant`,
      });
    }
    const record = await openDispute({ ...input, at });
    await this.stores.disputes.insert(record);
    this.idempotency.set(options.idempotencyKey, {
      canonical,
      kind: 'dispute',
      recordId: record.disputeId,
    });
    return record;
  }

  async transitionDispute(
    input: TransitionDisputeServiceInput,
    options: CommandOptions,
  ): Promise<DisputeRecord> {
    const at = this.now();
    const command = makeTransitionDisputeCommand(
      {
        disputeId: input.disputeId,
        to: input.to,
        reasons: input.reasons,
        reviewerParty: input.reviewerParty ?? null,
        resolutionOutcome: input.resolutionOutcome ?? null,
        note: input.note ?? null,
        at,
      },
      { correlationId: toCorrelationId(options.correlationId), idempotencyKey: toIdempotencyKey(options.idempotencyKey) },
    );
    this.requireIdempotency(options, command);
    if (this.idempotency.has(options.idempotencyKey)) {
      const current = await this.stores.disputes.get(input.disputeId, input.tenant);
      if (current !== undefined && current.state === input.to) return current;
    }
    const stored = await this.stores.disputes.get(input.disputeId, input.tenant);
    if (stored === undefined) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.NOT_FOUND, {
        message: `transition-dispute: unknown dispute ${JSON.stringify(input.disputeId)} for tenant ${JSON.stringify(input.tenant)} — cross-tenant reads fail closed`,
      });
    }
    if (!(await verifyDisputeDigest(stored))) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.TAMPERED, {
        message: 'transition-dispute: stored dispute failed digest verification — tampered entries fail closed',
      });
    }
    const transitioned = await transitionDispute(stored, {
      to: input.to,
      reasons: input.reasons,
      reviewerParty: input.reviewerParty ?? null,
      ...(input.resolutionOutcome === undefined || input.resolutionOutcome === null
        ? {}
        : { resolutionOutcome: input.resolutionOutcome }),
      ...(input.note === undefined || input.note === null ? {} : { note: input.note }),
      at,
    });
    await this.stores.disputes.update(transitioned);
    this.idempotency.set(options.idempotencyKey, {
      canonical: canonicalOf([command.kind, command.schema, command.payload]),
      kind: 'dispute',
      recordId: transitioned.disputeId,
    });
    await this.sinks.events.emit(
      makeDisputeTransitionedEvent(
        {
          disputeId: transitioned.disputeId,
          tenant: transitioned.tenant,
          from: stored.state,
          to: transitioned.state,
          resolutionOutcome: transitioned.resolutionOutcome,
          disputeDigest: transitioned.digest,
          at,
        },
        { correlationId: toCorrelationId(options.correlationId), idempotencyKey: toIdempotencyKey(options.idempotencyKey) },
      ),
    );
    return transitioned;
  }

  async getDispute(
    disputeId: string,
    tenant: string,
    _options: ServiceQueryOptions,
  ): Promise<DisputeRecord> {
    const stored = await this.stores.disputes.get(disputeId, tenant);
    if (stored === undefined) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.NOT_FOUND, {
        message: `get-dispute: unknown dispute ${JSON.stringify(disputeId)} for tenant ${JSON.stringify(tenant)} — cross-tenant reads fail closed`,
      });
    }
    if (!(await verifyDisputeDigest(stored))) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.TAMPERED, {
        message: 'get-dispute: stored dispute failed digest verification',
      });
    }
    return stored;
  }

  // -------------------------------------------------------------------------
  // COI registry + the typed check read port
  // -------------------------------------------------------------------------

  async registerCoi(input: RegisterCoiInput, options: CommandOptions): Promise<CoiRecord> {
    const at = this.now();
    const command = makeRegisterCoiCommand(
      {
        coiId: input.coiId,
        tenant: input.tenant,
        party: input.party,
        counterparty: input.counterparty,
        kind: input.kind,
        origin: input.origin,
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        observedAt: at,
        recordedAt: at,
      },
      { correlationId: toCorrelationId(options.correlationId), idempotencyKey: toIdempotencyKey(options.idempotencyKey) },
    );
    const { canonical } = this.requireIdempotency(options, command);
    const registry = await this.stores.coi.list(input.tenant);
    if (registry.some((record) => record.coiId === input.coiId)) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
        message: `register-coi: coiId ${JSON.stringify(input.coiId)} already exists`,
      });
    }
    const record = await createCoiRecord({
      coiId: input.coiId,
      tenant: input.tenant,
      party: input.party,
      counterparty: input.counterparty,
      kind: input.kind,
      origin: input.origin,
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      ...(input.derivedFrom === undefined || input.derivedFrom === null
        ? {}
        : { derivedFrom: input.derivedFrom }),
      observedAt: at,
      recordedAt: at,
    });
    await this.stores.coi.insert(record);
    this.idempotency.set(options.idempotencyKey, {
      canonical,
      kind: 'coi',
      recordId: record.coiId,
    });
    return record;
  }

  async retractCoi(
    input: { readonly coiId: string; readonly tenant: string; readonly reason: string },
    options: CommandOptions,
  ): Promise<CoiRecord> {
    const at = this.now();
    const command = makeRetractCoiCommand(
      { coiId: input.coiId, at, reason: input.reason },
      { correlationId: toCorrelationId(options.correlationId), idempotencyKey: toIdempotencyKey(options.idempotencyKey) },
    );
    const { canonical } = this.requireIdempotency(options, command);
    const registry = await this.stores.coi.list(input.tenant);
    const stored = registry.find((record) => record.coiId === input.coiId);
    if (stored === undefined) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.NOT_FOUND, {
        message: `retract-coi: unknown record ${JSON.stringify(input.coiId)} for tenant ${JSON.stringify(input.tenant)}`,
      });
    }
    if (!(await verifyCoiRecordDigest(stored))) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.TAMPERED, {
        message: 'retract-coi: stored record failed digest verification',
      });
    }
    const retracted = await retractCoiRecord(stored, at, input.reason);
    await this.stores.coi.update(retracted);
    this.idempotency.set(options.idempotencyKey, {
      canonical,
      kind: 'coi',
      recordId: retracted.coiId,
    });
    return retracted;
  }

  async checkCoi(
    query: { readonly tenant: string; readonly party: string; readonly counterparty: string },
    options: ServiceQueryOptions,
  ): Promise<CoiCheckResult> {
    const at = this.now();
    const registry = await this.stores.coi.list(query.tenant);
    const result = checkConflictOfInterest(registry, { ...query, at });
    await this.sinks.events.emit(
      makeCoiCheckVerdictEvent(
        {
          tenant: query.tenant,
          party: query.party,
          counterparty: query.counterparty,
          verdict: result.verdict,
          reasonCount: result.reasons.length,
          examined: result.examined,
          at,
        },
        { correlationId: toCorrelationId(options.correlationId) },
      ),
    );
    return result;
  }

  // -------------------------------------------------------------------------
  // Finding ingestion: C009 validation outcomes -> reputation records
  // -------------------------------------------------------------------------

  async ingestValidationOutcome(
    input: IngestValidationOutcomeInput,
    options: CommandOptions,
  ): Promise<ReputationRecord> {
    const at = this.now();
    // PROVENANCE FAIL-CLOSED: the C009 port must resolve the record for
    // THIS tenant + request + digest, else the ingestion fails closed.
    const source = await this.ports.validationOutcomes.resolveValidationOutcome({
      tenant: input.tenant,
      requestId: input.requestId,
      refDigest: input.refDigest,
    });
    if (source === null) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE, {
        message: `ingest-validation-outcome: the C009 seam did not resolve request ${JSON.stringify(input.requestId)} with digest ${JSON.stringify(input.refDigest.slice(0, 12))}... for tenant ${JSON.stringify(input.tenant)} — fabricated or cross-tenant provenance fails closed`,
      });
    }
    if (source.tenantId !== input.tenant || source.expertRef !== input.expertRef) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.TENANT_MISMATCH, {
        message: 'ingest-validation-outcome: the resolved C009 record does not match the requested tenant/expert',
      });
    }
    const mapped = mapValidationOutcomeToReputation({
      recordId: input.recordId,
      recordedAt: at,
      source,
    });
    const record = await createReputationRecord(mapped);
    // duplicate-source defense: the same C009 digest cannot book twice
    const existing = await this.stores.reputation.list(
      input.tenant,
      input.expertRef,
      'validation-outcome',
    );
    if (existing.some((prior) => prior.source.refDigest === input.refDigest)) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.DUPLICATE_EVIDENCE, {
        message: 'ingest-validation-outcome: the same C009 record digest is already folded into the validation-outcome family (evidence-replay defense)',
      });
    }
    await this.stores.reputation.insert(record);
    // THE PROPOSAL: the C005 profile receives this outcome through its own
    // ingestion ports (AQ-1) — target family expert-match-history,
    // dimension review-outcome.
    await this.sinks.profileEvidenceProposals.proposeProfileEvidence(
      proposeProfileEvidence({
        tenant: input.tenant,
        expertId: input.expertRef,
        targetFamily: 'expert-match-history',
        targetDimension: 'review-outcome',
        targetOutcome: record.outcome,
        sampleSize: 1,
        refDigest: input.refDigest,
        provenanceSurface: 'escalation-validation',
        reason: `C009 adjudication outcome for request ${input.requestId}`,
      }),
    );
    await this.sinks.events.emit(
      makeProfileEvidenceProposalEvent(
        {
          tenant: input.tenant,
          expertId: input.expertRef,
          targetFamily: 'expert-match-history',
          targetDimension: 'review-outcome',
          refDigest: input.refDigest,
          at,
        },
        { correlationId: toCorrelationId(options.correlationId) },
      ),
    );
    return record;
  }

  async ingestCompetitionOutcomes(
    input: IngestCompetitionOutcomeInput,
    options: CommandOptions,
  ): Promise<readonly ReputationRecord[]> {
    const at = this.now();
    const voting = await this.ports.voting.listCompetitionVoting(
      input.tenant,
      input.competitionId,
    );
    if (voting === null) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE, {
        message: `ingest-competition-outcomes: the C013 seam did not resolve competition ${JSON.stringify(input.competitionId)} for tenant ${JSON.stringify(input.tenant)}`,
      });
    }
    const records: ReputationRecord[] = [];
    for (const outcome of voting.competitionOutcomes) {
      if (outcome.tenantId !== input.tenant) continue;
      const recordId = `${input.recordId}-${outcome.expertRef}`;
      const mapped = mapCompetitionOutcomeToReputation({
        recordId,
        recordedAt: at,
        source: outcome,
      });
      const record = await createReputationRecord(mapped);
      const existing = await this.stores.reputation.list(
        input.tenant,
        outcome.expertRef,
        'competition-agreement',
      );
      if (existing.some((prior) => prior.source.refDigest === outcome.recordDigest)) continue;
      await this.stores.reputation.insert(record);
      records.push(record);
      await this.sinks.profileEvidenceProposals.proposeProfileEvidence(
        proposeProfileEvidence({
          tenant: input.tenant,
          expertId: outcome.expertRef,
          targetFamily: 'expert-match-history',
          targetDimension: 'agreement',
          targetOutcome: record.outcome,
          sampleSize: 1,
          refDigest: outcome.recordDigest,
          provenanceSurface: 'adversarial-evaluation',
          reason: `C013 competition agreement outcome for competition ${input.competitionId}`,
        }),
      );
    }
    await this.sinks.events.emit(
      makeProfileEvidenceProposalEvent(
        {
          tenant: input.tenant,
          expertId: 'competition-outcomes',
          targetFamily: 'expert-match-history',
          targetDimension: 'agreement',
          refDigest: '0'.repeat(64),
          at,
        },
        { correlationId: toCorrelationId(options.correlationId) },
      ),
    );
    return Object.freeze(records);
  }

  // -------------------------------------------------------------------------
  // The anti-gaming detection job (idempotent per tenant+competition)
  // -------------------------------------------------------------------------

  async runAntiGamingDetection(
    input: { readonly tenant: string; readonly competitionId: string },
    options: CommandOptions,
  ): Promise<DetectionJobResult> {
    const at = this.now();
    const voting = await this.ports.voting.listCompetitionVoting(
      input.tenant,
      input.competitionId,
    );
    if (voting === null) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE, {
        message: `run-anti-gaming-detection: the C013 seam did not resolve competition ${JSON.stringify(input.competitionId)} for tenant ${JSON.stringify(input.tenant)}`,
      });
    }
    // idempotence: re-running the job for the same (tenant, competition)
    // replays the stored findings verbatim (never double-counts)
    const runKey = `anti-gaming:${input.tenant}:${input.competitionId}`;
    const priorFindingIds = this.detectionRuns.get(runKey);
    if (priorFindingIds !== undefined) {
      const priorRun: FindingRecord[] = [];
      for (const findingId of priorFindingIds) {
        const stored = await this.stores.findings.get(findingId, input.tenant);
        if (stored !== undefined) priorRun.push(stored);
      }
      return { findings: Object.freeze(priorRun), reputationRecords: [], replayed: true };
    }

    const findings: FindingRecord[] = [
      ...(await detectSelfVotingAttempts({
        tenant: input.tenant,
        participants: voting.participants,
        submissions: voting.submissions,
        judgments: voting.judgments,
        deniedAttempts: voting.deniedAttempts,
        detectedAt: at,
      })),
      ...(await detectDuplicateAccountSignals({
        tenant: input.tenant,
        participants: voting.participants,
        judgments: voting.judgments,
        detectedAt: at,
      })),
      ...(await detectCoordinatedBrigading({
        tenant: input.tenant,
        participants: voting.participants,
        submissions: voting.submissions,
        judgments: voting.judgments,
        policy: this.antiGamingPolicy,
        detectedAt: at,
      })),
      ...(await detectRateLimitBreaches({
        tenant: input.tenant,
        participants: voting.participants,
        judgments: voting.judgments,
        policy: this.antiGamingPolicy,
        detectedAt: at,
      })),
    ];

    const reputationRecords: ReputationRecord[] = [];
    const findingIds: string[] = [];
    for (const finding of findings) {
      await this.stores.findings.insert(finding);
      findingIds.push(finding.findingId);
      await this.sinks.events.emit(
        makeFindingRecordedEvent(
          {
            findingId: finding.findingId,
            tenant: finding.tenant,
            subjectParty: finding.subjectParty,
            kind: finding.kind,
            severity: finding.severity,
            proposalCount: finding.proposals.length,
            findingDigest: finding.digest,
            at,
          },
          { correlationId: toCorrelationId(options.correlationId) },
        ),
      );
      // conduct-flag reputation evidence (append-only dimensional record)
      const conductInput = mapFindingToConductFlag({
        recordId: `nq-conduct-${finding.findingId}`,
        recordedAt: at,
        finding: {
          tenant: finding.tenant,
          subjectParty: finding.subjectParty,
          digest: finding.digest,
          observedAt: finding.observedAt,
          evidenceSurface: finding.evidence[0]?.surface ?? 'adversarial-evaluation',
          kind: finding.kind,
          severity: finding.severity,
          domain: 'network',
        },
      });
      const record = await createReputationRecord(conductInput);
      await this.stores.reputation.insert(record);
      reputationRecords.push(record);
      // requalification proposals for finding kinds that warrant them
      if (finding.severity === 'critical' || finding.severity === 'high') {
        const trigger =
          finding.category === 'fraud' ? 'fraud-finding' : 'anti-gaming-finding';
        await this.sinks.requalificationProposals.proposeRequalificationTrigger(
          proposeRequalificationTrigger({
            tenant: finding.tenant,
            expertRef: finding.subjectParty,
            trigger,
            evidenceDigests: [finding.digest],
            reason: `${finding.kind} (${finding.severity}) detected over the C013/C010 seams`,
          }),
        );
        await this.sinks.events.emit(
          makeRequalificationProposalEvent(
            {
              tenant: finding.tenant,
              expertRef: finding.subjectParty,
              trigger,
              evidenceCount: 1,
              at,
            },
            { correlationId: toCorrelationId(options.correlationId) },
          ),
        );
      }
    }
    this.detectionRuns.set(runKey, Object.freeze(findingIds));
    return { findings: Object.freeze(findings), reputationRecords: Object.freeze(reputationRecords), replayed: false };
  }

  // -------------------------------------------------------------------------
  // The fraud detection job (idempotent per tenant run window)
  // -------------------------------------------------------------------------

  async runFraudDetection(
    input: { readonly tenant: string; readonly sinceMs: number },
    options: CommandOptions,
  ): Promise<DetectionJobResult> {
    const at = this.now();
    const payoutEvents = await this.ports.payoutAudit.listPayoutAuditEvents(
      input.tenant,
      input.sinceMs,
    );
    const identitySignals = await this.ports.identitySignals.listIdentitySignals(input.tenant);
    const storedFindings = await this.stores.findings.list(input.tenant);
    const fingerprint = (event: { readonly eventId: string }) => event.eventId;
    const knownEventIds = new Set(
      storedFindings.flatMap((finding) => finding.evidence.map((entry) => entry.refId)),
    );
    const freshEvents = payoutEvents.filter((event) => !knownEventIds.has(fingerprint(event)));
    const findings: FindingRecord[] = [
      ...(await detectDuplicatePayoutAttempts({ events: freshEvents, detectedAt: at })),
      ...(await detectPayoutVelocityAnomalies({
        events: freshEvents,
        policy: this.fraudPolicy,
        detectedAt: at,
      })),
      ...(await detectExpertImpersonation({ signals: identitySignals, detectedAt: at })),
    ];
    const reputationRecords: ReputationRecord[] = [];
    for (const finding of findings) {
      await this.stores.findings.insert(finding);
      await this.sinks.events.emit(
        makeFindingRecordedEvent(
          {
            findingId: finding.findingId,
            tenant: finding.tenant,
            subjectParty: finding.subjectParty,
            kind: finding.kind,
            severity: finding.severity,
            proposalCount: finding.proposals.length,
            findingDigest: finding.digest,
            at,
          },
          { correlationId: toCorrelationId(options.correlationId) },
        ),
      );
      if (finding.severity === 'critical' || finding.severity === 'high') {
        await this.sinks.requalificationProposals.proposeRequalificationTrigger(
          proposeRequalificationTrigger({
            tenant: finding.tenant,
            expertRef: finding.subjectParty,
            trigger: 'fraud-finding',
            evidenceDigests: [finding.digest],
            reason: `${finding.kind} (${finding.severity}) detected over the C010/registry seams`,
          }),
        );
      }
    }
    return { findings: Object.freeze(findings), reputationRecords: Object.freeze(reputationRecords), replayed: false };
  }

  // -------------------------------------------------------------------------
  // Enforcement cases (explicit transitions, append-only audit)
  // -------------------------------------------------------------------------

  async openEnforcement(
    input: OpenEnforcementInput,
    options: CommandOptions,
  ): Promise<EnforcementCase> {
    const at = this.now();
    const existing = await this.stores.enforcement.get(input.caseId, input.tenant);
    if (existing !== undefined) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
        message: `open-enforcement: caseId ${JSON.stringify(input.caseId)} already exists`,
      });
    }
    const record = await openEnforcementCase({ ...input, at });
    await this.stores.enforcement.insert(record);
    await this.sinks.events.emit(
      makeEnforcementUpdatedEvent(
        {
          caseId: record.caseId,
          tenant: record.tenant,
          subjectParty: record.subjectParty,
          state: record.state,
          action: record.action,
          caseDigest: record.digest,
          at,
        },
        { correlationId: toCorrelationId(options.correlationId) },
      ),
    );
    return record;
  }

  async transitionEnforcement(
    input: TransitionEnforcementInput,
    options: CommandOptions,
  ): Promise<EnforcementCase> {
    const at = this.now();
    const stored = await this.stores.enforcement.get(input.caseId, input.tenant);
    if (stored === undefined) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.NOT_FOUND, {
        message: `transition-enforcement: unknown case ${JSON.stringify(input.caseId)} for tenant ${JSON.stringify(input.tenant)} — cross-tenant reads fail closed`,
      });
    }
    if (!(await verifyEnforcementCaseDigest(stored))) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.TAMPERED, {
        message: 'transition-enforcement: stored case failed digest verification',
      });
    }
    const transitioned = await transitionEnforcementCase({
      case: stored,
      to: input.to,
      actorParty: input.actorParty,
      at,
      reason: input.reason,
      action: input.action ?? null,
    });
    await this.stores.enforcement.update(transitioned);
    await this.sinks.events.emit(
      makeEnforcementUpdatedEvent(
        {
          caseId: transitioned.caseId,
          tenant: transitioned.tenant,
          subjectParty: transitioned.subjectParty,
          state: transitioned.state,
          action: transitioned.action,
          caseDigest: transitioned.digest,
          at,
        },
        { correlationId: toCorrelationId(options.correlationId) },
      ),
    );
    return transitioned;
  }

  // -------------------------------------------------------------------------
  // Reads (tenant-scoped, fail-closed)
  // -------------------------------------------------------------------------

  async getReputationFamily(
    query: { readonly tenant: string; readonly expertId: string; readonly family: string },
    _options: ServiceQueryOptions,
  ): Promise<ReputationFamilyView> {
    const records = await this.stores.reputation.list(query.tenant, query.expertId, query.family);
    for (const record of records) {
      if (!(await verifyReputationRecordDigest(record))) {
        throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.TAMPERED, {
          message: `get-reputation-family: stored record ${JSON.stringify(record.recordId)} failed digest verification`,
        });
      }
    }
    let aggregateDigest: string | null = null;
    if (records.length > 0) {
      aggregateDigest = (await aggregateFamilyOutcomes(records)).aggregateDigest;
    }
    return {
      tenant: query.tenant,
      expertId: query.expertId,
      family: query.family,
      records,
      aggregateDigest,
    };
  }

  async listFindings(
    tenant: string,
    _options: ServiceQueryOptions,
  ): Promise<readonly FindingRecord[]> {
    return this.stores.findings.list(tenant);
  }
}
