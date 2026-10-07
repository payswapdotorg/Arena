/**
 * EscalationValidationService — the reference service wiring the C009
 * adjudication engine to the C001 escalation lifecycle (Work Order
 * C009; issue #116). Mirrors the sibling service discipline
 * (services/intervention, services/escalation-routing): injected
 * dependencies only, fail-closed error normalization, NO network/HTTP
 * layer — adapters own the wire transports.
 *
 * The service implements C007's labelled VALIDATION SEAM for real (the
 * C002 precedent: the engine behind the seam, no C007 code change —
 * hosts inject this service wherever the intervention service accepts
 * a ValidationHandoffPort):
 *
 *   route(command)          — the C007 seam: derives/loads the typed
 *                             validation plan, selects the validator
 *                             (C005-informed, COI-excluded), binds the
 *                             C001 lifecycle SUBMITTED → VALIDATING,
 *                             emits escalation.validation.updated and
 *                             appends the handoff to the append-only
 *                             validation history. Returns the
 *                             deterministic receipt (stub: FALSE).
 *
 *   declareValidationCondition — binds the request's DECLARED
 *                             validation condition and records the
 *                             derived plan (idempotent on the same
 *                             plan; a different plan fails closed).
 *
 *   adjudicate(input)       — runs the two EXPLICITLY DISTINCT stages
 *                             (A012 evaluation: judgment against
 *                             criteria; A013 verification: evidence
 *                             supports claims — lock rule 7, never
 *                             collapsed), combines them into the
 *                             verdict and binds the lifecycle
 *                             VALIDATING → ACCEPTED |
 *                             REVISION_REQUIRED | REJECTED (or stays
 *                             VALIDATING on NEEDS_MORE_EVIDENCE with a
 *                             typed evidence request), driving the
 *                             bounded revision loop.
 *
 *   requestExpertReplacement — the typed replacement triggers: guards
 *                             the trigger against the C001 explicit
 *                             replacement funnel, applies EXPERT_REPLACED
 *                             → MATCHING and routes back through the
 *                             C002 public routing seam (matched →
 *                             OFFERED with the new expert). Replaced-
 *                             expert evidence and history are RETAINED
 *                             (append-only; never a silent mutation).
 *
 * VERDICTS ARE NEVER AUTHORIZATION (lock rules 9/35): the service
 * records adjudication outcomes; it grants nothing.
 */

import {
  applyEscalationTransition,
  createEscalationWebhookEvent,
} from '@arena/escalation';
import type { EscalationRecord, EscalationWebhookEvent } from '@arena/escalation';
import {
  appendValidationEntry,
  bindPlan,
  bindValidator,
  createAdjudicationOutcome,
  createDeclaredValidationCondition,
  createReplacementRequest,
  createRevisionRequest,
  createValidationHistoryEntry,
  createValidationRecord,
  deriveValidationPlan,
  initialRevisionState,
  newAdjudicationVerdictId,
  newRevisionRequestId,
  newValidationEntryId,
  primaryFabricOf,
  recordAdjudicationRound,
  requiredChangesOf,
  revisionResubmissionDeadline,
  revisionStateOf,
  selectValidator,
} from '@arena/escalation-validation';
import type {
  AdjudicationOutcome,
  CreateDeclaredValidationConditionInput,
  DeclaredValidationCondition,
  RevisionRequest,
  ReplacementRequest,
  ReplacementTrigger,
  ValidationPlan,
  ValidationRecord,
  ValidatorCandidate,
  ValidatorSelectionResult,
} from '@arena/escalation-validation';
import { ESCALATION_VALIDATION_ERROR_CODES, EscalationValidationError } from '@arena/escalation-validation';
import {
  FixedClock,
  InMemoryEscalationEventSink,
  InMemoryEscalationPort,
  InMemoryValidationStore,
  ReferenceEvaluationStage,
  ReferenceVerificationStage,
  StaticValidatorDirectory,
} from './fabric.js';
import type {
  AdjudicationStageInput,
  Clock,
  EscalationEventSink,
  EscalationPort,
  EvaluationStagePort,
  RoutingDecision,
  RoutingPortLike,
  ValidationHandoffCommand,
  ValidationHandoffReceipt,
  ValidationStore,
  VerificationStagePort,
} from './ports.js';

/** The handoff essentials persisted on the validation record (adjudication input). */
interface StoredHandoff {
  readonly receiptId: string;
  readonly mode: string;
  readonly resultKind: string;
  readonly correlationId: string;
  readonly contract: import('@arena/intervention').InterventionResultContract;
  readonly trajectoryRef?: { readonly trajectoryId: string; readonly chainHead: string };
  readonly submittedAt: string;
}

/** The full typed result of one adjudication run (richer than the lifecycle binding). */
export interface AdjudicationRunResult {
  readonly outcome: AdjudicationOutcome;
  /** The escalation record AFTER the lifecycle binding (undefined when the verdict keeps VALIDATING). */
  readonly escalation: EscalationRecord | undefined;
  /** Present iff the verdict is REVISION_REQUIRED (the typed revision request). */
  readonly revisionRequest?: RevisionRequest;
  /** Present iff the verdict is NEEDS_MORE_EVIDENCE (the typed evidence request). */
  readonly evidenceRequest?: { readonly requestedAt: string; readonly reasons: readonly string[] };
  /** The validation record AFTER the append-only round. */
  readonly validation: ValidationRecord;
}

/** The full typed result of one expert-replacement run. */
export interface ReplacementRunResult {
  readonly replacement: ReplacementRequest;
  /** The escalation record AFTER the funnel (expert_replaced → matching [→ offered]). */
  readonly escalation: EscalationRecord;
  /** The C002-seam routing decision (present iff a routing port is wired). */
  readonly routingDecision?: RoutingDecision;
  readonly validation: ValidationRecord;
}

/** The full typed result of one condition declaration / plan derivation. */
export interface DeclarationResult {
  readonly plan: ValidationPlan;
  readonly validation: ValidationRecord;
}

export interface EscalationValidationServiceConfig {
  readonly clock?: Clock;
  readonly escalationPort?: EscalationPort;
  readonly evaluationStage?: EvaluationStagePort;
  readonly verificationStage?: VerificationStagePort;
  readonly validatorDirectory?: { listValidatorCandidates(tenantId: string): Promise<readonly ValidatorCandidate[]> };
  readonly routing?: RoutingPortLike;
  readonly store?: ValidationStore;
  readonly eventSink?: EscalationEventSink;
}

export class EscalationValidationService {
  readonly clock: Clock;
  readonly escalationPort: EscalationPort;
  readonly evaluationStage: EvaluationStagePort;
  readonly verificationStage: VerificationStagePort;
  readonly validatorDirectory: { listValidatorCandidates(tenantId: string): Promise<readonly ValidatorCandidate[]> };
  readonly routing: RoutingPortLike | null;
  readonly store: ValidationStore;
  readonly eventSink: EscalationEventSink;
  private readonly eventSequences = new Map<string, number>();

  constructor(config: EscalationValidationServiceConfig = {}) {
    this.clock = config.clock ?? new FixedClock(0);
    this.escalationPort = config.escalationPort ?? new InMemoryEscalationPort();
    this.evaluationStage = config.evaluationStage ?? new ReferenceEvaluationStage();
    this.verificationStage = config.verificationStage ?? new ReferenceVerificationStage();
    this.validatorDirectory = config.validatorDirectory ?? new StaticValidatorDirectory([]);
    this.routing = config.routing ?? null;
    this.store = config.store ?? new InMemoryValidationStore();
    this.eventSink = config.eventSink ?? new InMemoryEscalationEventSink();
  }

  // -------------------------------------------------------------------------
  // Condition declaration (plan derivation — deterministic, typed)
  // -------------------------------------------------------------------------

  async declareValidationCondition(input: {
    readonly requestId: string;
    readonly tenantId: string;
    readonly condition: CreateDeclaredValidationConditionInput;
    readonly now?: number | string | Date;
    readonly actor?: string;
  }): Promise<DeclarationResult> {
    const now = this.now(input);
    const escalation = await this.loadEscalation(input.requestId, input.tenantId);
    const condition = createDeclaredValidationCondition(input.condition);

    let validation = await this.store.get(input.requestId, input.tenantId);
    if (validation === undefined) {
      validation = createValidationRecord(input.requestId, input.tenantId, now);
    }

    if (validation.plan !== undefined) {
      // Idempotent re-declaration of the SAME plan; anything else fails closed.
      const rederived = await deriveValidationPlan(escalation.request, condition, now);
      if (rederived.outcome !== 'plan-derivable' || rederived.plan.planId !== validation.plan.planId) {
        throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_PLAN, {
          message: `validation plan already bound to escalation ${input.requestId} (plan ${validation.plan.planId}); plans are immutable once bound`,
          details: { requestId: input.requestId, planId: validation.plan.planId },
        });
      }
      return { plan: validation.plan, validation };
    }

    const derivation = await deriveValidationPlan(escalation.request, condition, now);
    if (derivation.outcome !== 'plan-derivable') {
      // The engine NEVER invents a default condition (fail-closed).
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.UNDER_SPECIFIED, {
        message: `the declared validation condition of escalation ${input.requestId} is under-specified (${derivation.reasons.join(', ')})`,
        details: { requestId: input.requestId, reasons: derivation.reasons },
      });
    }

    const occurredAt = new Date(now).toISOString();
    let next = bindPlan(validation, derivation.plan, occurredAt);
    next = appendValidationEntry(
      next,
      createValidationHistoryEntry({
        entryId: newValidationEntryId(),
        requestId: input.requestId,
        tenantId: input.tenantId,
        sequence: next.entries.length + 1,
        kind: 'plan-declared',
        occurredAt,
        ...(input.actor !== undefined ? { actor: input.actor } : {}),
        payload: {
          planId: derivation.plan.planId,
          conditionKind: derivation.plan.conditionKind,
          conditionDigest: derivation.plan.derivation.conditionDigest,
        },
      }),
    );
    await this.persist(validation, next);
    return { plan: derivation.plan, validation: next };
  }

  // -------------------------------------------------------------------------
  // THE C007 VALIDATION SEAM (structural implementation — stub: FALSE)
  // -------------------------------------------------------------------------

  /** Route one SUBMITTED payload onto validation (the C007 seam). Deterministic + idempotent per (request, mode). */
  async route(command: ValidationHandoffCommand): Promise<ValidationHandoffReceipt> {
    const now = this.clock.now();
    const escalation = await this.loadEscalation(command.requestId, command.tenantId);
    const receiptId = `vh-${command.requestId}-${command.mode}`;

    let validation = await this.store.get(command.requestId, command.tenantId);
    if (validation === undefined) {
      validation = createValidationRecord(command.requestId, command.tenantId, now);
    }

    // Idempotent replay: a handoff ALREADY ROUTED (and still active —
    // the escalation is VALIDATING) returns the SAME receipt without a
    // second transition, event or history entry. A resubmitted round
    // (state back to SUBMITTED after a revision) re-routes and APPENDS
    // a new handoff entry (append-only supersession).
    const routed = validation.entries.find(
      (entry) => entry.kind === 'handoff-routed' && entry.payload['receiptId'] === receiptId,
    );
    if (routed !== undefined && escalation.state === 'validating') {
      const planId = routed.payload['planId'];
      const routedTo = routed.payload['routedTo'];
      return this.receipt(receiptId, String(planId), routedTo as 'evaluation-fabric' | 'verification-fabric');
    }

    if (validation.plan === undefined) {
      // Fail-closed: an undeclared condition is UNDER-SPECIFIED — the
      // engine never invents a default (the escalation stays SUBMITTED
      // and the host must declare the condition).
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.UNDER_SPECIFIED, {
        message: `escalation ${command.requestId} has no declared validation condition; declare one before submission routes onto validation`,
        details: { requestId: command.requestId, reasons: ['condition-not-declared'] },
      });
    }
    const plan = validation.plan;

    // Validator selection (C005-informed; COI-excluded; DATA, never authorization).
    const candidates = await this.validatorDirectory.listValidatorCandidates(command.tenantId);
    const selection = selectValidator(candidates, {
      requestId: command.requestId,
      tenantId: command.tenantId,
      submittingExpertRef: escalation.expertRef ?? null,
      coiExpertRefs: [],
      requiredSkills: [...plan.validatorProfile.requiredSkills],
    });
    if (
      selection.outcome === 'no-validator' &&
      plan.evaluationStage.evaluatorKind === 'expert'
    ) {
      // Expert-driven evaluation REQUIRES a non-conflicted validator.
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.NO_VALIDATOR, {
        message: `no conflict-free validator is available to adjudicate escalation ${command.requestId}`,
        details: { requestId: command.requestId, exclusions: selection.exclusions },
      });
    }

    // C001 lifecycle binding: SUBMITTED -> VALIDATING (validation pending).
    if (escalation.state !== 'submitted') {
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_STATE, {
        message: `validation routing requires escalation state 'submitted' (current: ${escalation.state})`,
        details: { requestId: command.requestId, state: escalation.state },
      });
    }
    const validating = applyEscalationTransition(escalation, 'validating', {
      now,
      tenantId: command.tenantId,
      validationStatus: 'pending',
      ...(escalation.expertRef !== undefined ? { expertRef: escalation.expertRef } : {}),
    });
    await this.escalationPort.update(validating);
    await this.emitEvent(validating, 'escalation.validation.updated', {
      planId: plan.planId,
      routedTo: primaryFabricOf(plan),
      validator:
        selection.outcome === 'selected' ? selection.validator.expertRef : null,
    }, now);

    const occurredAt = new Date(now).toISOString();
    let next = bindValidator(validation, selection, occurredAt);
    next = appendValidationEntry(
      next,
      createValidationHistoryEntry({
        entryId: newValidationEntryId(),
        requestId: command.requestId,
        tenantId: command.tenantId,
        sequence: next.entries.length + 1,
        kind: 'handoff-routed',
        occurredAt,
        payload: {
          receiptId,
          planId: plan.planId,
          routedTo: primaryFabricOf(plan),
          mode: command.mode,
          resultKind: command.resultKind,
          correlationId: command.correlationId,
          contract: command.contract,
          ...(command.trajectoryRef !== undefined ? { trajectoryRef: command.trajectoryRef } : {}),
          submittedAt: command.submittedAt,
          escalationStateBefore: escalation.state,
          escalationStateAfter: validating.state,
        },
      }),
    );
    await this.persist(validation, next);
    return this.receipt(receiptId, plan.planId, primaryFabricOf(plan));
  }

  // -------------------------------------------------------------------------
  // Adjudication (the two EXPLICITLY DISTINCT stages + the revision loop)
  // -------------------------------------------------------------------------

  /** Run one adjudication round over the routed SUBMITTED payload. */
  async adjudicate(input: {
    readonly requestId: string;
    readonly tenantId: string;
    readonly now?: number | string | Date;
    readonly actor?: string;
  }): Promise<AdjudicationRunResult> {
    const now = this.now(input);
    const escalation = await this.loadEscalation(input.requestId, input.tenantId);
    if (escalation.state !== 'validating') {
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_STATE, {
        message: `adjudication requires escalation state 'validating' (current: ${escalation.state})`,
        details: { requestId: input.requestId, state: escalation.state },
      });
    }

    let validation = await this.store.get(input.requestId, input.tenantId);
    if (validation === undefined || validation.plan === undefined) {
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_STATE, {
        message: `escalation ${input.requestId} has no routed validation plan to adjudicate`,
        details: { requestId: input.requestId },
      });
    }
    const plan = validation.plan;

    const handoffEntry = [...validation.entries]
      .reverse()
      .find((entry) => entry.kind === 'handoff-routed');
    if (handoffEntry === undefined) {
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_STATE, {
        message: `escalation ${input.requestId} has no SUBMITTED payload routed onto validation`,
        details: { requestId: input.requestId },
      });
    }
    const stored = handoffEntry.payload as unknown as StoredHandoff;

    const validator =
      validation.validator !== undefined && validation.validator.outcome === 'selected'
        ? validation.validator.validator
        : null;
    const stageInput: AdjudicationStageInput = {
      requestId: input.requestId,
      tenantId: input.tenantId,
      correlationId: stored.correlationId,
      mode: stored.mode,
      resultKind: stored.resultKind,
      contract: stored.contract,
      ...(stored.trajectoryRef !== undefined ? { trajectoryRef: stored.trajectoryRef } : {}),
      submittedAt: stored.submittedAt,
      plan,
      validator,
      now,
    };

    // STAGE 1 — evaluation (A012: judgment against criteria; NEVER evidence).
    const evaluation = await this.evaluationStage.run(stageInput);
    // STAGE 2 — verification (A013: evidence supports claims; NEVER scores).
    const verification = await this.verificationStage.run(stageInput);

    const revisionState = revisionStateOf(validation);
    const combined = combine(evaluation, verification, revisionState);
    const occurredAt = new Date(now).toISOString();
    const outcome = createAdjudicationOutcome({
      verdictId: newAdjudicationVerdictId(),
      requestId: input.requestId,
      tenantId: input.tenantId,
      attemptNumber: revisionState.attemptNumber,
      verdict: combined.verdict,
      reasons: combined.reasons,
      evaluationStage: evaluation,
      verificationStage: verification,
      adjudicatedAt: occurredAt,
    });

    let escalationAfter: EscalationRecord | undefined;
    let revisionRequest: RevisionRequest | undefined;
    let evidenceRequest: { readonly requestedAt: string; readonly reasons: readonly string[] } | undefined;

    if (outcome.verdict === 'needs_more_evidence') {
      // The verdict cannot be established: the escalation STAYS
      // VALIDATING and a typed evidence request is recorded.
      evidenceRequest = {
        requestedAt: occurredAt,
        reasons: outcome.reasons.map((reason) => reason.code),
      };
    } else {
      const target =
        outcome.verdict === 'accepted'
          ? 'result_accepted'
          : outcome.verdict === 'revision_required'
            ? 'revision_required'
            : 'result_rejected';
      const transitioned = applyEscalationTransition(escalation, target, {
        now,
        tenantId: input.tenantId,
        validationStatus: outcome.validationStatus,
        ...(escalation.expertRef !== undefined ? { expertRef: escalation.expertRef } : {}),
        ...(escalation.sessionRef !== undefined ? { sessionRef: escalation.sessionRef } : {}),
      });
      await this.escalationPort.update(transitioned);
      escalationAfter = transitioned;
      await this.emitEvent(transitioned, 'escalation.validation.updated', {
        verdict: outcome.verdict,
        attemptNumber: outcome.attemptNumber,
        validationStatus: outcome.validationStatus,
        reasonCodes: outcome.reasons.map((reason) => reason.code),
      }, now);

      if (outcome.verdict === 'revision_required') {
        revisionRequest = createRevisionRequest(
          {
            revisionId: newRevisionRequestId(),
            requestId: input.requestId,
            tenantId: input.tenantId,
            attemptNumber: outcome.attemptNumber,
            requiredChanges: requiredChangesOf(outcome),
            resubmissionDeadline: revisionResubmissionDeadline(
              escalation.request.deadline,
              plan.revisionPolicy,
              now,
            ),
            requestedAt: occurredAt,
          },
          plan.revisionPolicy,
        );
      }
    }

    // Append-only round: adjudication entry (+ revision/evidence request).
    let next = appendValidationEntry(
      validation,
      createValidationHistoryEntry({
        entryId: newValidationEntryId(),
        requestId: input.requestId,
        tenantId: input.tenantId,
        sequence: validation.entries.length + 1,
        kind: 'adjudication-recorded',
        occurredAt,
        ...(input.actor !== undefined ? { actor: input.actor } : {}),
        payload: { adjudication: outcome },
      }),
    );
    if (revisionRequest !== undefined) {
      next = appendValidationEntry(
        next,
        createValidationHistoryEntry({
          entryId: newValidationEntryId(),
          requestId: input.requestId,
          tenantId: input.tenantId,
          sequence: next.entries.length + 1,
          kind: 'revision-requested',
          occurredAt,
          ...(input.actor !== undefined ? { actor: input.actor } : {}),
          payload: { revision: revisionRequest },
        }),
      );
    }
    if (evidenceRequest !== undefined) {
      next = appendValidationEntry(
        next,
        createValidationHistoryEntry({
          entryId: newValidationEntryId(),
          requestId: input.requestId,
          tenantId: input.tenantId,
          sequence: next.entries.length + 1,
          kind: 'evidence-requested',
          occurredAt,
          ...(input.actor !== undefined ? { actor: input.actor } : {}),
          payload: { evidenceRequest },
        }),
      );
    }
    next = recordAdjudicationRound(next, outcome, occurredAt);
    await this.persist(validation, next);

    return {
      outcome,
      escalation: escalationAfter,
      ...(revisionRequest !== undefined ? { revisionRequest } : {}),
      ...(evidenceRequest !== undefined ? { evidenceRequest } : {}),
      validation: next,
    };
  }

  // -------------------------------------------------------------------------
  // Expert replacement (typed triggers -> C001 funnel -> C002 seam)
  // -------------------------------------------------------------------------

  /** Replace the assigned expert through the C001 explicit replacement funnel. */
  async requestExpertReplacement(input: {
    readonly requestId: string;
    readonly tenantId: string;
    readonly trigger: ReplacementTrigger;
    readonly reasonDetail?: string;
    readonly now?: number | string | Date;
    readonly actor?: string;
  }): Promise<ReplacementRunResult> {
    const now = this.now(input);
    const escalation = await this.loadEscalation(input.requestId, input.tenantId);

    const guard = checkReplacementTrigger(escalation.state, input.trigger);
    if (!guard.allowed) {
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_REPLACEMENT, {
        message: `expert replacement denied on escalation ${input.requestId}: ${guard.reason} (state: ${escalation.state}, trigger: ${input.trigger})`,
        details: { requestId: input.requestId, reason: guard.reason, state: escalation.state, trigger: input.trigger },
      });
    }

    const occurredAt = new Date(now).toISOString();
    const replacement = createReplacementRequest({
      requestId: input.requestId,
      tenantId: input.tenantId,
      trigger: input.trigger,
      ...(escalation.expertRef !== undefined ? { replacedExpertRef: escalation.expertRef } : {}),
      reasonDetail:
        input.reasonDetail !== undefined
          ? input.reasonDetail
          : `replacement trigger ${input.trigger} from state ${escalation.state}`,
      occurredAt,
    });

    // C001 funnel: source -> EXPERT_REPLACED -> MATCHING (explicit states).
    const replaced = applyEscalationTransition(escalation, 'expert_replaced', {
      now,
      tenantId: input.tenantId,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    await this.escalationPort.update(replaced);
    await this.emitEvent(replaced, 'escalation.progressed', {
      replacedExpertRef: replacement.replacedExpertRef,
      trigger: input.trigger,
    }, now);

    const matching = applyEscalationTransition(replaced, 'matching', {
      now,
      tenantId: input.tenantId,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    await this.escalationPort.update(matching);
    await this.emitEvent(matching, 'escalation.progressed', {
      routedBackTo: 'matching',
    }, now);

    // THE C002 SEAM: route back through the public routing port.
    let escalationAfter = matching;
    let routingDecision: RoutingDecision | undefined;
    if (this.routing !== null) {
      const decision = await this.routing.route(matching);
      routingDecision = decision;
      if (decision.outcome === 'matched') {
        const offered = applyEscalationTransition(matching, 'offered', {
          now,
          tenantId: input.tenantId,
          expertRef: decision.expertRef,
          ...(input.actor !== undefined ? { actor: input.actor } : {}),
        });
        await this.escalationPort.update(offered);
        await this.emitEvent(offered, 'escalation.matched', {
          expertRef: decision.expertRef,
          replacementOf: replacement.replacedExpertRef,
        }, now);
        escalationAfter = offered;
      }
    }

    // Append-only: the replacement (and the replaced expert) is RETAINED.
    let validation = await this.store.get(input.requestId, input.tenantId);
    if (validation === undefined) {
      validation = createValidationRecord(input.requestId, input.tenantId, now);
    }
    const next = appendValidationEntry(
      validation,
      createValidationHistoryEntry({
        entryId: newValidationEntryId(),
        requestId: input.requestId,
        tenantId: input.tenantId,
        sequence: validation.entries.length + 1,
        kind: 'replacement-requested',
        occurredAt,
        ...(input.actor !== undefined ? { actor: input.actor } : {}),
        payload: {
          replacement,
          ...(routingDecision !== undefined ? { routingDecision } : {}),
        },
      }),
    );
    await this.persist(validation, next);

    return {
      replacement,
      escalation: escalationAfter,
      ...(routingDecision !== undefined ? { routingDecision } : {}),
      validation: next,
    };
  }

  // -------------------------------------------------------------------------
  // Read surfaces
  // -------------------------------------------------------------------------

  /** The append-only validation record of one escalation (tenant-scoped). */
  async getValidationRecord(input: {
    readonly requestId: string;
    readonly tenantId: string;
  }): Promise<ValidationRecord | undefined> {
    const record = await this.store.get(input.requestId, input.tenantId);
    if (record !== undefined) return record;
    const unscoped = await this.store.findById(input.requestId);
    if (unscoped !== undefined) {
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `validation record of escalation ${input.requestId} belongs to another tenant`,
        details: { requestId: input.requestId, tenantId: input.tenantId },
      });
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private receipt(
    receiptId: string,
    planId: string,
    routedTo: 'evaluation-fabric' | 'verification-fabric',
  ): ValidationHandoffReceipt {
    return Object.freeze({
      handoffVersion: 1,
      receiptId,
      status: 'routed',
      routedTo,
      validationCondition: Object.freeze({
        source: 'c009-validation-plan',
        policy: planId,
      }),
      // FALSE on this implementation: the real C009 engine (C007's stub replaced).
      stub: false,
    });
  }

  private now(input: { readonly now?: number | string | Date }): number {
    return input.now !== undefined ? this.coerceMs(input.now) : this.clock.now();
  }

  private coerceMs(value: number | string | Date): number {
    const ms = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value);
    if (!Number.isFinite(ms)) {
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_INPUT, {
        message: `invalid timestamp: ${JSON.stringify(value)}`,
      });
    }
    return ms;
  }

  private async loadEscalation(requestId: string, tenantId: string): Promise<EscalationRecord> {
    const record = await this.escalationPort.get(requestId, tenantId);
    if (record !== undefined) return record;
    const unscoped = await this.escalationPort.findById(requestId);
    if (unscoped !== undefined) {
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `escalation ${requestId} belongs to another tenant`,
        details: { requestId, tenantId },
      });
    }
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_INPUT, {
      message: `unknown escalation ${requestId} for tenant ${tenantId}`,
      details: { requestId, tenantId },
    });
  }

  private async persist(
    before: ValidationRecord,
    after: ValidationRecord,
  ): Promise<void> {
    const known = await this.store.findById(after.requestId);
    if (known === undefined) {
      await this.store.insert(after);
    } else {
      if (known.entries.length > after.entries.length) {
        // Append-only guard: the store's history may never shrink.
        throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.TAMPERED, {
          message: `validation history of escalation ${after.requestId} may never shrink (append-only violated)`,
          details: { requestId: after.requestId },
        });
      }
      await this.store.update(after);
    }
    void before;
  }

  private async emitEvent(
    escalation: EscalationRecord,
    eventType: 'escalation.validation.updated' | 'escalation.progressed' | 'escalation.matched',
    data: Readonly<Record<string, unknown>>,
    now: number,
  ): Promise<void> {
    const key = escalation.request.requestId;
    const last = this.eventSequences.get(key) ?? escalation.history.length;
    const sequence = last + 1;
    this.eventSequences.set(key, sequence);
    const event: EscalationWebhookEvent = createEscalationWebhookEvent({
      eventType,
      request: escalation.request,
      sequence,
      now,
      state: escalation.state,
      data,
    });
    await this.eventSink.emit(event);
  }
}

// ---------------------------------------------------------------------------
// Local composition helpers (imported lazily to keep the module header light)
// ---------------------------------------------------------------------------

import { checkReplacementTrigger } from '@arena/escalation-validation';
import { combineStages } from '@arena/escalation-validation';
import type { EvaluationStageResult, VerificationStageResult } from '@arena/escalation-validation';

function combine(
  evaluation: EvaluationStageResult,
  verification: VerificationStageResult,
  revisionState: ReturnType<typeof initialRevisionState>,
): ReturnType<typeof combineStages> {
  return combineStages(evaluation, verification, revisionState);
}
