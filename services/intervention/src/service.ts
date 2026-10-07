/**
 * InterventionService — the reference service facade for Arena live
 * human interventions (Work Order C007; issue #114; mirrors the C006
 * ExpertSessionService pattern: injected ports, fail-closed error
 * normalization, NO network/HTTP layer — adapters own the wire
 * transports).
 *
 * Intervention lifecycle bound to the C001 escalation states:
 *   beginIntervention — escalation `session_ready` → `in_progress`
 *                   (session `open` → `active`); the mode is
 *                   AUTHORIZED against the EscalationRequest's
 *                   escalationModes and the C006 capsule's derived
 *                   allowance; durable + idempotent on the injected
 *                   store (duplicate begins return the same record);
 *   recordInterventionStep — one observable step of expert work: mode
 *                   + barrier + private-reasoning + live-world guards
 *                   fail closed, the step enters the C006 session
 *                   stream AND the intervention record, and a
 *                   progress event feeds `escalation.progressed`;
 *   switchInterventionMode — the escalation-modes law: transitions
 *                   only through explicit lifecycle state
 *                   (in_progress | revision_required) + authorization;
 *   submitIntervention — the per-mode typed result contract is built
 *                   (mode-authorization guarded), the A011
 *                   trajectory-backed record of observable work is
 *                   emitted and verified, the C006 session completes
 *                   (EES1.0 completion contract), the C001 escalation
 *                   moves in_progress → submitted, and the SUBMITTED
 *                   payload routes onto the validation seam (the
 *                   clearly-labelled C009 stub until C009 ships).
 *
 * Fail-closed everywhere: wrong state, wrong tenant, expired capsule,
 * unpermitted mode, unauthorized transition, live-world mutation
 * attempt, private-reasoning payload — all typed InterventionError
 * failures.
 */

import type { EscalationRecord, EscalationResult, EscalationWebhookEvent } from '@arena/escalation';
import {
  applyEscalationTransition,
  createEscalationResult,
  createEscalationWebhookEvent,
  submitEscalationResult,
} from '@arena/escalation';
import type { CreateInterventionResultInput, InterventionStep } from '@arena/intervention';
import type { CreateTrajectoryHeaderInput } from '@arena/trajectory';
import { isInterventionStepKind } from '@arena/intervention';
import {
  INTERVENTION_ERROR_CODES,
  InterventionError,
  assertModeAuthorized,
  assertModeSessionPolicy,
  assertModeTransition,
  assertNoLiveWorldMutation,
  assertNoPrivateReasoning,
  buildInterventionTrajectory,
  createInterventionResult,
  interventionTrajectoryRef,
  isLiveInterventionMode,
  toEscalationResultInput,
  evidenceRefsOfContract,
} from '@arena/intervention';
import type { InterventionResultContract } from '@arena/intervention';
import type { ExpertSessionRecord, SessionAction } from '@arena/expert-session';
import {
  appendSessionEvent,
  applyExpertSessionTransition,
  assertNoEscape,
  assertSessionActionAllowed,
  checkActionAllowlisted,
  checkCredentials,
  createExpertSessionSubmission,
  isCapsuleWithinTimeBound,
  screenObservation,
} from '@arena/expert-session';
import { verifyTrajectoryRecord } from '@arena/trajectory';
import { StubValidationHandoff, InMemoryEscalationEventSink, InMemoryEscalationPort, InMemoryInterventionStore, InMemorySessionPort, InMemoryTrajectoryPort } from './fabric.js';
import type {
  Clock,
  EscalationPort,
  EscalationEventSink,
  InterventionRecord,
  InterventionStore,
  SessionPort,
  TrajectoryPort,
  ValidationHandoffPort,
} from './ports.js';

// ---------------------------------------------------------------------------
// Configuration + inputs
// ---------------------------------------------------------------------------

export interface InterventionServiceConfig {
  readonly clock?: Clock;
  readonly escalationPort?: EscalationPort;
  readonly sessionPort?: SessionPort;
  readonly trajectoryPort?: TrajectoryPort;
  readonly store?: InterventionStore;
  readonly eventSink?: EscalationEventSink;
  readonly validationHandoff?: ValidationHandoffPort;
}

export interface BeginInterventionInput {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly expertRef: string;
  /** Idempotency key — duplicate begins return the same record. */
  readonly idempotencyKey: string;
  /** Requested escalation mode (defaults to the request's first live mode). */
  readonly mode?: string;
  /** The A011 trajectory binding to declare for this intervention. */
  readonly trajectoryBinding?: {
    readonly trajectoryId: string;
    readonly run: CreateTrajectoryHeaderInput['run'];
    readonly agentBodyRef: string;
    readonly substrateRef: string;
    readonly seed: string | null;
    readonly startedAt: string;
  };
  readonly now?: number | string | Date;
  readonly actor?: string;
}

export interface RecordStepInput {
  readonly interventionId: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly stepId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly now?: number | string | Date;
  readonly actor?: string;
}

export interface SwitchModeInput {
  readonly interventionId: string;
  readonly tenantId: string;
  readonly toMode: string;
  readonly now?: number | string | Date;
  readonly actor?: string;
}

export interface SubmitInterventionInput {
  readonly interventionId: string;
  readonly tenantId: string;
  /** The per-mode contract fields (mode is taken from the intervention record). */
  readonly result: Omit<CreateInterventionResultInput, 'mode' | 'permittedModes' | 'requestId' | 'sessionId' | 'producedAt'>;
  /** Consent/rights statement for reusable learning (EES1.0 completion contract). */
  readonly consentRightsStatement: { granted: boolean; statement: string };
  readonly now?: number | string | Date;
  readonly actor?: string;
}

export interface GetInterventionInput {
  readonly interventionId: string;
  readonly tenantId: string;
}

// ---------------------------------------------------------------------------
// Step kind → session action + session event kind policy
// ---------------------------------------------------------------------------

const STEP_SESSION_ACTIONS: Readonly<Record<string, SessionAction>> = Object.freeze({
  'human-action': 'observe-state',
  'tool-invocation': 'invoke-tool',
  'tool-result': 'invoke-tool',
  'artifact-change': 'edit-artifact',
  annotation: 'annotate',
  checkpoint: 'capture-checkpoint',
  'tool-gap-signal': 'signal-tool-gap',
});

const STEP_SESSION_EVENT_KINDS: Readonly<Record<string, string>> = Object.freeze({
  'human-action': 'human-action',
  'tool-invocation': 'tool-invocation',
  'tool-result': 'tool-result',
  'artifact-change': 'artifact-change',
  annotation: 'annotation',
  checkpoint: 'checkpoint',
  'tool-gap-signal': 'tool-gap-signal',
});

/** Evidence-ref prefix → the C006 EvidenceRef kind. */
function evidenceKindForRef(ref: string): 'event-ref' | 'artifact-ref' | 'capsule-resource-ref' {
  if (ref.startsWith('event/')) return 'event-ref';
  if (ref.startsWith('capsule/')) return 'capsule-resource-ref';
  return 'artifact-ref';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class InterventionService {
  private readonly clock: Clock;
  private readonly escalationPort: EscalationPort;
  private readonly sessionPort: SessionPort;
  private readonly trajectoryPort: TrajectoryPort;
  private readonly store: InterventionStore;
  private readonly eventSink: EscalationEventSink;
  private readonly validationHandoff: ValidationHandoffPort;
  /** Per-escalation webhook sequence state (monotonic across emissions). */
  private readonly eventSequences = new Map<string, number>();

  constructor(config: InterventionServiceConfig = {}) {
    this.clock = config.clock ?? { now: () => 0 };
    this.escalationPort = config.escalationPort ?? new InMemoryEscalationPort();
    this.sessionPort = config.sessionPort ?? new InMemorySessionPort();
    this.trajectoryPort = config.trajectoryPort ?? new InMemoryTrajectoryPort();
    this.store = config.store ?? new InMemoryInterventionStore();
    this.eventSink = config.eventSink ?? new InMemoryEscalationEventSink();
    this.validationHandoff = config.validationHandoff ?? new StubValidationHandoff();
  }

  private now(input: { readonly now?: number | string | Date }): number {
    return input.now !== undefined ? this.coerceMs(input.now) : this.clock.now();
  }

  private coerceMs(value: number | string | Date): number {
    const ms = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value);
    if (!Number.isFinite(ms)) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_REQUEST, {
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
      throw new InterventionError(INTERVENTION_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `escalation ${requestId} belongs to another tenant`,
        details: { requestId, tenantId },
      });
    }
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown escalation ${requestId} for tenant ${tenantId}`,
      details: { requestId, tenantId },
    });
  }

  private async loadSession(sessionId: string, tenantId: string): Promise<ExpertSessionRecord> {
    const record = await this.sessionPort.get(sessionId, tenantId);
    if (record !== undefined) return record;
    const unscoped = await this.sessionPort.findById(sessionId);
    if (unscoped !== undefined) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `expert session ${sessionId} belongs to another tenant`,
        details: { sessionId, tenantId },
      });
    }
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown expert session ${sessionId} for tenant ${tenantId}`,
      details: { sessionId, tenantId },
    });
  }

  private async loadIntervention(
    interventionId: string,
    tenantId: string,
  ): Promise<InterventionRecord> {
    const record = await this.store.get(interventionId, tenantId);
    if (record !== undefined) return record;
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown intervention ${interventionId} for tenant ${tenantId}`,
      details: { interventionId, tenantId },
    });
  }

  private async emitEvent(
    escalation: EscalationRecord,
    eventType: 'escalation.progressed' | 'escalation.started' | 'escalation.submitted',
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

  // -------------------------------------------------------------------------
  // beginIntervention: escalation session_ready → in_progress
  // -------------------------------------------------------------------------

  async beginIntervention(input: BeginInterventionInput): Promise<InterventionRecord> {
    // IDEMPOTENT begin: the same idempotency key returns the same record.
    const existing = await this.store.findByIdempotencyKey(input.idempotencyKey, input.tenantId);
    if (existing !== undefined) return existing;

    const now = this.now(input);
    const session = await this.loadSession(input.sessionId, input.tenantId);
    const escalation = await this.loadEscalation(
      session.capsule.escalationRef.requestId,
      input.tenantId,
    );
    if (escalation.state !== 'session_ready' && escalation.state !== 'in_progress') {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_STATE, {
        message: `intervention binding requires escalation state 'session_ready' or 'in_progress' (current: ${escalation.state})`,
        details: { requestId: escalation.request.requestId, state: escalation.state },
      });
    }
    if (!isCapsuleWithinTimeBound(session.capsule, now)) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.DEADLINE_PASSED, {
        message: `session ${input.sessionId} capsule expired at ${session.capsule.expiresAt}`,
        details: { sessionId: input.sessionId, expiresAt: session.capsule.expiresAt },
      });
    }

    // Mode selection + AUTHORIZATION (fail-closed; never coerced).
    const permittedModes = escalation.request.escalationModes;
    const mode =
      input.mode !== undefined
        ? input.mode
        : (permittedModes.find((candidate) => isLiveInterventionMode(candidate)) ?? '');
    if (mode === '') {
      throw new InterventionError(INTERVENTION_ERROR_CODES.UNPERMITTED_MODE, {
        message: `the request authorizes no live intervention mode: ${JSON.stringify([...permittedModes])}`,
        details: { permitted: [...permittedModes] },
      });
    }
    assertModeAuthorized(
      {
        escalationModes: [...permittedModes],
        environmentSessionMode: escalation.request.environmentSessionPolicy.sessionMode,
      },
      mode,
    );
    assertModeSessionPolicy(mode, session.capsule.allowedModes);

    // Escalation lifecycle: session_ready → in_progress.
    let escalated = escalation;
    if (escalation.state === 'session_ready') {
      escalated = applyEscalationTransition(escalation, 'in_progress', {
        now,
        tenantId: input.tenantId,
        expertRef: input.expertRef,
        actor: input.actor ?? input.expertRef,
      });
      await this.escalationPort.update(escalated);
    }

    // C006 session lifecycle: open → active.
    let sessionRecord = session;
    if (session.state === 'open') {
      sessionRecord = applyExpertSessionTransition(sessionRecord, 'active', {
        now,
        actor: input.expertRef,
      });
      await this.sessionPort.update(sessionRecord);
    } else if (session.state !== 'active') {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_STATE, {
        message: `session ${input.sessionId} is not open or active (state: ${session.state})`,
        details: { sessionId: input.sessionId, state: session.state },
      });
    }

    const occurredAt = new Date(now).toISOString();
    const record: InterventionRecord = Object.freeze({
      recordVersion: 1,
      interventionId: `ivn_${crypto.randomUUID().replaceAll('-', '')}`,
      idempotencyKey: input.idempotencyKey,
      requestId: escalation.request.requestId,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      mode,
      allowedModes: Object.freeze([...permittedModes]),
      modeHistory: Object.freeze([
        Object.freeze({ from: null, to: mode, occurredAt, reason: 'begin' as const }),
      ]),
      state: 'active',
      steps: Object.freeze([]),
      ...(input.trajectoryBinding !== undefined
        ? { trajectoryBinding: Object.freeze({ ...input.trajectoryBinding }) }
        : {}),
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    await this.store.insert(record);
    if (escalated.state === 'in_progress' && escalation.state === 'session_ready') {
      await this.emitEvent(escalated, 'escalation.started', {
        interventionId: record.interventionId,
        sessionId: input.sessionId,
        mode,
        expertRef: input.expertRef,
      }, now);
    }
    return record;
  }

  // -------------------------------------------------------------------------
  // recordInterventionStep: mode + barrier + screens (fail-closed)
  // -------------------------------------------------------------------------

  async recordInterventionStep(input: RecordStepInput): Promise<InterventionRecord> {
    const now = this.now(input);
    const record = await this.loadIntervention(input.interventionId, input.tenantId);
    if (record.state !== 'active') {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_STATE, {
        message: `intervention ${input.interventionId} is not active (state: ${record.state})`,
        details: { interventionId: input.interventionId, state: record.state },
      });
    }
    const session = await this.loadSession(record.sessionId, input.tenantId);
    const escalation = await this.loadEscalation(record.requestId, input.tenantId);
    if (escalation.state !== 'in_progress') {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_STATE, {
        message: `intervention steps require escalation state 'in_progress' (current: ${escalation.state})`,
        details: { requestId: record.requestId, state: escalation.state },
      });
    }
    if (session.state !== 'active') {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_STATE, {
        message: `session ${record.sessionId} is not active (state: ${session.state})`,
        details: { sessionId: record.sessionId, state: session.state },
      });
    }
    if (!isCapsuleWithinTimeBound(session.capsule, now)) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.DEADLINE_PASSED, {
        message: `session ${record.sessionId} capsule expired at ${session.capsule.expiresAt}`,
        details: { sessionId: record.sessionId, expiresAt: session.capsule.expiresAt },
      });
    }
    assertNoEscape(checkCredentials(session.capsule.barrier, now));

    const action = STEP_SESSION_ACTIONS[input.kind];
    if (action === undefined || !isInterventionStepKind(input.kind)) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_REQUEST, {
        message: `intervention step kind is not in the closed vocabulary: ${JSON.stringify(input.kind)}`,
      });
    }
    const eventKind = STEP_SESSION_EVENT_KINDS[input.kind];
    if (eventKind === undefined) {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_REQUEST, {
        message: `intervention step kind maps to no session event: ${JSON.stringify(input.kind)}`,
      });
    }
    // The C006 capsule is the enforcement authority for what the expert may DO.
    assertSessionActionAllowed(session.capsule.sessionMode, action);
    assertNoEscape(checkActionAllowlisted(session.capsule.barrier, action));

    // THE TWO SCREENS — fail closed before anything is captured.
    assertNoPrivateReasoning(input.payload);
    assertNoLiveWorldMutation(input.payload);

    // Mirror the step into the C006 session's observable stream (screened).
    const occurredAt = new Date(now).toISOString();
    const screened = screenObservation(
      session.capsule.barrier,
      input.payload as Parameters<typeof screenObservation>[1],
    );
    const nextSession = appendSessionEvent(session, {
      kind: eventKind,
      payload: screened,
      now: occurredAt,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    await this.sessionPort.update(nextSession);

    const next: InterventionRecord = Object.freeze({
      ...record,
      steps: Object.freeze([
        ...record.steps,
        Object.freeze({
          kind: input.kind,
          stepId: input.stepId,
          payload: input.payload,
          occurredAt,
        }),
      ]),
      updatedAt: occurredAt,
    });
    await this.store.update(next);

    await this.emitEvent(escalation, 'escalation.progressed', {
      interventionId: record.interventionId,
      mode: record.mode,
      stepKind: input.kind,
      stepId: input.stepId,
    }, now);
    return next;
  }

  // -------------------------------------------------------------------------
  // switchInterventionMode: the escalation-modes law
  // -------------------------------------------------------------------------

  async switchInterventionMode(input: SwitchModeInput): Promise<InterventionRecord> {
    const now = this.now(input);
    const record = await this.loadIntervention(input.interventionId, input.tenantId);
    const escalation = await this.loadEscalation(record.requestId, input.tenantId);
    const session = await this.loadSession(record.sessionId, input.tenantId);

    // THE ESCALATION-MODES LAW FIRST: explicit lifecycle state + authorization.
    assertModeTransition({
      from: record.mode,
      to: input.toMode,
      escalationState: escalation.state,
      request: {
        escalationModes: [...record.allowedModes],
        environmentSessionMode: escalation.request.environmentSessionPolicy.sessionMode,
      },
    });
    assertModeSessionPolicy(input.toMode, session.capsule.allowedModes);
    if (record.state !== 'active') {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_STATE, {
        message: `intervention ${input.interventionId} is not active (state: ${record.state})`,
        details: { interventionId: input.interventionId, state: record.state },
      });
    }

    const occurredAt = new Date(now).toISOString();
    const next: InterventionRecord = Object.freeze({
      ...record,
      mode: input.toMode,
      modeHistory: Object.freeze([
        ...record.modeHistory,
        Object.freeze({
          from: record.mode,
          to: input.toMode,
          occurredAt,
          reason: 'mode_transition_ok' as const,
        }),
      ]),
      updatedAt: occurredAt,
    });
    await this.store.update(next);
    await this.emitEvent(escalation, 'escalation.progressed', {
      interventionId: record.interventionId,
      modeSwitch: { from: record.mode, to: input.toMode },
    }, now);
    return next;
  }

  // -------------------------------------------------------------------------
  // submitIntervention: contract + trajectory + C006 completion + C001 submit
  // -------------------------------------------------------------------------

  async submitIntervention(input: SubmitInterventionInput): Promise<InterventionRecord> {
    const now = this.now(input);
    const record = await this.loadIntervention(input.interventionId, input.tenantId);
    if (record.state !== 'active') {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_STATE, {
        message: `submission requires an active intervention (state: ${record.state})`,
        details: { interventionId: input.interventionId, state: record.state },
      });
    }
    const escalation = await this.loadEscalation(record.requestId, input.tenantId);
    if (escalation.state !== 'in_progress') {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_STATE, {
        message: `submission requires escalation state 'in_progress' (current: ${escalation.state})`,
        details: { requestId: record.requestId, state: escalation.state },
      });
    }
    const session = await this.loadSession(record.sessionId, input.tenantId);
    if (session.state !== 'active') {
      throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_STATE, {
        message: `submission requires an active session (state: ${session.state})`,
        details: { sessionId: record.sessionId, state: session.state },
      });
    }

    const occurredAt = new Date(now).toISOString();

    // The A011 trajectory-backed record of observable work (mandatory for TEACH).
    let trajectoryRef: { trajectoryId: string; chainHead: string } | undefined;
    if (record.trajectoryBinding !== undefined) {
      const steps: readonly InterventionStep[] = record.steps.map((step) => ({
        kind: step.kind,
        stepId: step.stepId,
        payload: step.payload,
        occurredAt: step.occurredAt,
      }));
      const trajectory = await buildInterventionTrajectory({
        binding: {
          trajectoryId: record.trajectoryBinding.trajectoryId,
          run: record.trajectoryBinding.run,
          agentBodyRef: record.trajectoryBinding.agentBodyRef,
          substrateRef: record.trajectoryBinding.substrateRef,
          seed: record.trajectoryBinding.seed,
          startedAt: record.trajectoryBinding.startedAt,
        },
        steps,
        completedAt: occurredAt,
      });
      await verifyTrajectoryRecord(trajectory);
      await this.trajectoryPort.save(trajectory);
      trajectoryRef = interventionTrajectoryRef(trajectory);
    } else if (record.mode === 'teach') {
      throw new InterventionError(INTERVENTION_ERROR_CODES.TRAJECTORY_MISSING, {
        message: 'teach interventions REQUIRE a trajectory binding (capture is mandatory — EES1.0 replay law)',
        details: { interventionId: record.interventionId, mode: record.mode },
      });
    }

    // The per-mode typed result contract (mode-authorization guarded).
    const contract: InterventionResultContract = createInterventionResult({
      ...input.result,
      mode: record.mode,
      permittedModes: [...record.allowedModes],
      requestId: record.requestId,
      sessionId: record.sessionId,
      producedAt: occurredAt,
      ...(trajectoryRef !== undefined ? { trajectoryRef } : {}),
    });

    // C001: the single result taxonomy, in_progress → submitted.
    const escalationResult: EscalationResult = createEscalationResult(
      toEscalationResultInput(contract),
    );
    const submitted = submitEscalationResult(escalation, escalationResult, {
      now,
      tenantId: input.tenantId,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    await this.escalationPort.update(submitted);
    await this.emitEvent(submitted, 'escalation.submitted', {
      interventionId: record.interventionId,
      mode: record.mode,
      resultKind: escalationResult.kind,
    }, now);

    // C006: the EES1.0 completion contract; session active → completed.
    const evidenceRefs = evidenceRefsOfContract(contract);
    const submission = createExpertSessionSubmission({
      sessionId: record.sessionId,
      result: contract,
      evidence: evidenceRefs.map((ref) => ({ kind: evidenceKindForRef(ref), ref })),
      corrections:
        contract.mode === 'correct'
          ? [{ correctedRef: contract.correctedRef, replacement: contract.replacement }]
          : [],
      consentRightsStatement: input.consentRightsStatement,
      now,
    });
    const withFinal = appendSessionEvent(session, {
      kind: 'final-result',
      payload: submission.result,
      now: occurredAt,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    const completed = applyExpertSessionTransition(withFinal, 'completed', {
      now: occurredAt,
      submission,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    await this.sessionPort.update(completed);

    // THE C009 SEAM — route the SUBMITTED payload onto validation.
    const handoff = await this.validationHandoff.route({
      requestId: record.requestId,
      tenantId: input.tenantId,
      correlationId: escalation.request.correlationId,
      mode: record.mode,
      resultKind: escalationResult.kind,
      contract,
      ...(trajectoryRef !== undefined ? { trajectoryRef } : {}),
      submittedAt: occurredAt,
    });

    const next: InterventionRecord = Object.freeze({
      ...record,
      state: 'completed',
      ...(trajectoryRef !== undefined ? { trajectoryRef } : {}),
      contract,
      validationHandoff: handoff,
      updatedAt: occurredAt,
    });
    await this.store.update(next);
    return next;
  }

  // -------------------------------------------------------------------------
  // Read surfaces
  // -------------------------------------------------------------------------

  async getIntervention(input: GetInterventionInput): Promise<InterventionRecord | undefined> {
    return this.store.get(input.interventionId, input.tenantId);
  }
}
