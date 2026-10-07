/**
 * In-memory reference fabric for the escalation-validation service
 * (Work Order C009) — the services-layer house pattern (C001/C002/
 * C006/C007): injected ports with an in-process, zero-external-
 * dependency reference implementation. Hosts swap the fabric for real
 * persistence (adapters/*, never here).
 *
 *   - FixedClock                 — deterministic injected time;
 *   - InMemoryEscalationPort     — the C001 seam over plain records;
 *   - InMemoryValidationStore    — tenant-scoped append-only validation
 *                                  records;
 *   - InMemoryEscalationEventSink— collects the webhook events the
 *                                  service emits (escalation.validation.
 *                                  updated / progressed / matched);
 *   - StaticValidatorDirectory   — the C005 seam over fixed candidates;
 *   - ReferenceEvaluationStage   — THE A012 SEAM reference runner: a
 *                                  deterministic evaluator whose
 *                                  per-criterion scores are scripted by
 *                                  the host (default: every criterion
 *                                  fully met); the outcome is DERIVED
 *                                  from the plan's threshold, never
 *                                  supplied;
 *   - ReferenceVerificationStage — THE A013 SEAM reference runner: a
 *                                  deterministic evidence-provenance
 *                                  verifier whose per-claim support is
 *                                  scripted by the host (default: every
 *                                  required claim present-supported);
 *                                  the outcome is DERIVED from the
 *                                  support summary, never supplied.
 *
 * The stage runners compute their record digests with
 * @arena/protocol-core's digestCanonical over the stage payload — the
 * same content-addressing discipline the A012/A013 fabrics use — so
 * verdict reasons cite reproducible digests.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { EscalationRecord, EscalationWebhookEvent } from '@arena/escalation';
import { evidenceRefsOfContract } from '@arena/intervention';
import type { InterventionResultContract } from '@arena/intervention';
import type {
  EvaluationStageResult,
  EvidenceSupportStatus,
  ValidationPlan,
  VerificationStageResult,
  ValidatorCandidate,
} from '@arena/escalation-validation';
import type {
  AdjudicationStageInput,
  Clock,
  EscalationEventSink,
  EscalationPort,
  EvaluationStagePort,
  RoutingPortLike,
  RoutingDecision,
  ValidationStore,
  VerificationStagePort,
} from './ports.js';
import type { ValidationRecord } from '@arena/escalation-validation';

// ---------------------------------------------------------------------------
// Clock + C001 seam + store + event sink
// ---------------------------------------------------------------------------

/** Deterministic clock returning a fixed instant. */
export class FixedClock implements Clock {
  constructor(private readonly at: number) {}
  now(): number {
    return this.at;
  }
}

/** The C001 escalation seam (in-process reference). */
export class InMemoryEscalationPort implements EscalationPort {
  private readonly byRequestId = new Map<string, EscalationRecord>();

  async seed(record: EscalationRecord): Promise<void> {
    this.byRequestId.set(record.request.requestId, record);
  }

  async get(requestId: string, tenantId: string): Promise<EscalationRecord | undefined> {
    const record = this.byRequestId.get(requestId);
    if (record === undefined || record.request.tenantId !== tenantId) return undefined;
    return record;
  }

  async findById(requestId: string): Promise<EscalationRecord | undefined> {
    return this.byRequestId.get(requestId);
  }

  async update(record: EscalationRecord): Promise<void> {
    if (!this.byRequestId.has(record.request.requestId)) {
      throw new Error(`unknown escalation request id: ${record.request.requestId}`);
    }
    this.byRequestId.set(record.request.requestId, record);
  }
}

/** The append-only validation record store (tenant-scoped reference). */
export class InMemoryValidationStore implements ValidationStore {
  private readonly byRequestId = new Map<string, ValidationRecord>();

  async insert(record: ValidationRecord): Promise<void> {
    if (this.byRequestId.has(record.requestId)) {
      throw new Error(`duplicate validation record: ${record.requestId}`);
    }
    this.byRequestId.set(record.requestId, record);
  }

  async update(record: ValidationRecord): Promise<void> {
    if (!this.byRequestId.has(record.requestId)) {
      throw new Error(`unknown validation record: ${record.requestId}`);
    }
    this.byRequestId.set(record.requestId, record);
  }

  async get(requestId: string, tenantId: string): Promise<ValidationRecord | undefined> {
    const record = this.byRequestId.get(requestId);
    if (record === undefined || record.tenantId !== tenantId) return undefined;
    return record;
  }

  async findById(requestId: string): Promise<ValidationRecord | undefined> {
    return this.byRequestId.get(requestId);
  }
}

/** Webhook event sink (collects events in emission order). */
export class InMemoryEscalationEventSink implements EscalationEventSink {
  readonly events: EscalationWebhookEvent[] = [];

  async emit(event: EscalationWebhookEvent): Promise<void> {
    this.events.push(event);
  }

  /** Events of one type, in emission order (test surface). */
  ofType(eventType: string): readonly EscalationWebhookEvent[] {
    return this.events.filter((event) => event.eventType === eventType);
  }
}

// ---------------------------------------------------------------------------
// The C005 seam (static validator directory)
// ---------------------------------------------------------------------------

/** The C005 seam over a fixed candidate pool. */
export class StaticValidatorDirectory {
  constructor(private readonly candidates: readonly ValidatorCandidate[]) {}

  async listValidatorCandidates(_tenantId: string): Promise<readonly ValidatorCandidate[]> {
    return this.candidates;
  }
}

// ---------------------------------------------------------------------------
// THE A012 SEAM — reference evaluation stage runner
// ---------------------------------------------------------------------------

/**
 * Scriptable per-criterion scores (criteriaRef -> score in [0, 1]).
 * Unlisted criteria default to a fully-met score of 1. Setting a score
 * below the plan's threshold derives a not-met judgment.
 */
export interface ReferenceEvaluationScript {
  readonly scores?: Readonly<Record<string, number>>;
  /** Force the inconclusive judgment (e.g. evaluator could not run). */
  readonly inconclusive?: boolean;
}

export class ReferenceEvaluationStage implements EvaluationStagePort {
  constructor(private readonly script: ReferenceEvaluationScript = {}) {}

  async run(input: AdjudicationStageInput): Promise<EvaluationStageResult> {
    const plan: ValidationPlan = input.plan;
    const executedAt = new Date(input.now).toISOString();
    const judgments = plan.evaluationStage.criteriaRefs.map((criteriaRef) => {
      const score = this.script.scores?.[criteriaRef] ?? 1;
      const verdict: 'met' | 'not-met' | 'inconclusive' =
        this.script.inconclusive === true
          ? 'inconclusive'
          : score >= (plan.evaluationStage.criteriaThreshold ?? 0)
            ? 'met'
            : 'not-met';
      return {
        criteriaRef,
        verdict,
        score: this.script.inconclusive === true ? null : score,
        note: null,
      };
    });
    const anyNotMet = judgments.some((judgment) => judgment.verdict === 'not-met');
    const anyInconclusive = judgments.some((judgment) => judgment.verdict === 'inconclusive');
    const outcome: EvaluationStageResult['outcome'] =
      this.script.inconclusive === true || anyInconclusive
        ? 'inconclusive'
        : anyNotMet
          ? 'below-criteria'
          : 'meets-criteria';

    const evaluatorDescriptor = {
      evaluatorKind: plan.evaluationStage.evaluatorKind,
      criteriaRefs: [...plan.evaluationStage.criteriaRefs],
      outputSchemaRef: plan.evaluationStage.outputSchemaRef,
    };
    const evaluatorRef = await digestCanonical(evaluatorDescriptor);
    const recordPayload = {
      stage: 'evaluation',
      evaluatorRef,
      requestId: input.requestId,
      tenantId: input.tenantId,
      mode: input.mode,
      resultKind: input.resultKind,
      judgments,
      outcome,
      executedAt,
    };
    const recordDigest = await digestCanonical(recordPayload);

    return Object.freeze({
      stage: 'evaluation',
      outcome,
      recordDigest,
      evaluatorRef,
      validatorExpertRef: input.validator === null ? null : input.validator.expertRef,
      criteriaJudgments: Object.freeze(judgments),
      executedAt,
      provenance: 'reference-evaluation-fabric',
    });
  }
}

// ---------------------------------------------------------------------------
// THE A013 SEAM — reference verification stage runner
// ---------------------------------------------------------------------------

/**
 * Scriptable per-claim evidence support (claim -> A013 support
 * status). Unlisted claims default to present-supported. The outcome
 * is DERIVED: any present-unsupported -> fail; any missing or
 * present-indeterminate/unverified -> unknown; otherwise pass.
 */
export interface ReferenceVerificationScript {
  readonly support?: Readonly<Record<string, EvidenceSupportStatus>>;
}

export class ReferenceVerificationStage implements VerificationStagePort {
  constructor(private readonly script: ReferenceVerificationScript = {}) {}

  async run(input: AdjudicationStageInput): Promise<VerificationStageResult> {
    const plan: ValidationPlan = input.plan;
    const executedAt = new Date(input.now).toISOString();
    const evidenceSupport = plan.verificationStage.requiredEvidence.map((requirement) => ({
      claim: requirement.claim,
      status: this.script.support?.[requirement.claim] ?? 'present-supported',
    }));
    let outcome: VerificationStageResult['outcome'] = 'pass';
    for (const entry of evidenceSupport) {
      if (entry.status === 'present-unsupported') {
        outcome = 'fail';
        break;
      }
      if (
        entry.status === 'missing' ||
        entry.status === 'present-indeterminate' ||
        entry.status === 'present-unverified'
      ) {
        outcome = 'unknown';
      }
    }

    const verifierDescriptor = {
      verifierMethod: plan.verificationStage.verifierMethod,
      requiredEvidence: [...plan.verificationStage.requiredEvidence],
    };
    const verifierRef = await digestCanonical(verifierDescriptor);
    const evidenceRefs = evidenceRefsOfContract(input.contract as InterventionResultContract);
    const recordPayload = {
      stage: 'verification',
      verifierRef,
      requestId: input.requestId,
      tenantId: input.tenantId,
      mode: input.mode,
      resultKind: input.resultKind,
      evidenceSupport,
      evidenceRefs,
      outcome,
      executedAt,
    };
    const recordDigest = await digestCanonical(recordPayload);

    return Object.freeze({
      stage: 'verification',
      outcome,
      recordDigest,
      verifierRef,
      evidenceSupport: Object.freeze(evidenceSupport),
      evidenceRefs: Object.freeze([...evidenceRefs]),
      executedAt,
      provenance: 'reference-verification-fabric',
    });
  }
}

// ---------------------------------------------------------------------------
// THE C002 SEAM — scripted routing reference (test surface)
// ---------------------------------------------------------------------------

/** A routing port returning scripted decisions in order (reference). */
export class ScriptedRoutingPort implements RoutingPortLike {
  private index = 0;

  constructor(private readonly decisions: readonly RoutingDecision[]) {}

  async route(_request: EscalationRecord): Promise<RoutingDecision> {
    const decision = this.decisions[this.index] ?? {
      outcome: 'no-match',
      reason: 'routing-unavailable',
    } as RoutingDecision;
    this.index += 1;
    return decision;
  }
}
