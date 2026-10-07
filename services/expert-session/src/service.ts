/**
 * ExpertSessionService — the reference service facade for Arena expert
 * environment sessions (Work Order C006; spec
 * expert-environment-session.md EES1.0; mirrors the C001 ApiService
 * pattern: injected dependencies, fail-closed error normalization, NO
 * network/HTTP layer — adapters own the wire transports).
 *
 * Session lifecycle bound to the C001 escalation states:
 *   openSession   — escalation `accepted` → `session_ready`
 *                   (sessionRef = capsule id; capsule materialized
 *                   through the injected A009/A010 seam);
 *   beginSession  — escalation `session_ready` → `in_progress`;
 *                   session `open` → `active`;
 *   recordSessionEvent — session `active` only; EVERY event is gated by
 *                   the capsule's mode policy + privacy barrier
 *                   (escape attempts fail closed) and screened before
 *                   it enters the append-only observable stream;
 *   submitSession — the EES1.0 completion contract (result + evidence +
 *                   annotations + corrections + optional knowledge
 *                   artifacts + optional tool-gap signals + consent)
 *                   mapped onto a C001 EscalationResult; escalation
 *                   `in_progress` → `submitted` (C001 validation owns
 *                   everything after);
 *   getObservationStream / getSessionReplay — privacy-screened,
 *                   approved-events-only projections.
 *
 * Fail-closed everywhere: wrong state, wrong tenant, expired capsule,
 * unpermitted mode, escape attempt, private-reasoning payload, learning
 * permission violation — all typed ExpertSessionError failures.
 */

import type { EscalationRecord } from '@arena/escalation';
import {
  applyEscalationTransition,
  createEscalationResult,
  submitEscalationResult,
} from '@arena/escalation';
import type { CreateEscalationResultInput, EscalationResult } from '@arena/escalation';
import {
  EXPERT_SESSION_ERROR_CODES,
  ExpertSessionError,
  appendSessionEvent,
  applyExpertSessionTransition,
  buildReplayTrace,
  checkActionAllowlisted,
  checkCredentials,
  checkExportAction,
  checkResourceAccess,
  checkToolUse,
  createExpertSessionRecord,
  createExpertSessionSubmission,
  deriveSessionModes,
  isCapsuleWithinTimeBound,
  isExportChannel,
  projectObservationStream,
  screenObservation,
  assertNoEscape,
  assertSessionActionAllowed,
} from '@arena/expert-session';
import type {
  ExpertSessionEventKind,
  ExpertSessionMode,
  ExpertSessionRecord,
  ExpertSessionSubmission,
  ExecutionCapsuleSource,
  PlainJsonValue,
  SessionAction,
} from '@arena/expert-session';
import type {
  CapsuleMaterializationCommand,
  CapsuleMaterializer,
  Clock,
  EscalationSessionPort,
  SessionStore,
} from './ports.js';
import { DefaultCapsuleMaterializer, InMemoryEscalationSessionPort, InMemorySessionStore } from './fabric.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ExpertSessionServiceConfig {
  readonly clock?: Clock;
  readonly escalationPort?: EscalationSessionPort;
  readonly store?: SessionStore;
  readonly materializer?: CapsuleMaterializer;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface OpenSessionInput {
  readonly requestId: string;
  readonly tenantId: string;
  /** The execution capsule source the adapter materializes against. */
  readonly source: ExecutionCapsuleSource;
  /** Requested session mode (must be within the derived allowance). */
  readonly sessionMode?: string;
  readonly now?: number | string | Date;
  readonly actor?: string;
}

export interface BeginSessionInput {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly expertRef: string;
  readonly now?: number | string | Date;
}

export interface RecordSessionEventInput {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly payload: unknown;
  /** Optional export channel the expert is attempting (checked against restrictions). */
  readonly exportChannel?: string;
  readonly now?: number | string | Date;
  readonly actor?: string;
}

export interface SubmitSessionInput {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly result: unknown;
  readonly evidence: readonly { kind: string; ref: string }[];
  readonly annotations?: readonly { subjectRef: string; note: string }[];
  readonly corrections?: readonly { correctedRef: string; replacement: unknown }[];
  readonly knowledgeArtifacts?: Parameters<typeof createExpertSessionSubmission>[0]['knowledgeArtifacts'];
  readonly toolGapSignals?: Parameters<typeof createExpertSessionSubmission>[0]['toolGapSignals'];
  readonly consentRightsStatement: { granted: boolean; statement: string };
  /** Optional C001 result-shape overrides (defaults: kind 'answer'). */
  readonly escalationResultKind?: string;
  readonly escalationResultFields?: Record<string, unknown>;
  readonly now?: number | string | Date;
  readonly actor?: string;
}

export interface GetSessionInput {
  readonly sessionId: string;
  readonly tenantId: string;
}

// ---------------------------------------------------------------------------
// Event-kind → session-action policy
// ---------------------------------------------------------------------------

const EVENT_KIND_ACTIONS: Readonly<Record<ExpertSessionEventKind, SessionAction | 'floor'>> = Object.freeze({
  'environment-observation': 'floor',
  checkpoint: 'floor',
  'final-result': 'floor',
  'tool-gap-signal': 'floor',
  'human-action': 'floor',
  annotation: 'annotate',
  'artifact-change': 'edit-artifact',
  'expert-correction': 'edit-artifact',
  'tool-invocation': 'invoke-tool',
  'tool-result': 'invoke-tool',
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ExpertSessionService {
  private readonly clock: Clock;
  private readonly escalationPort: EscalationSessionPort;
  private readonly store: SessionStore;
  private readonly materializer: CapsuleMaterializer;

  constructor(config: ExpertSessionServiceConfig = {}) {
    this.clock = config.clock ?? { now: () => 0 };
    this.escalationPort = config.escalationPort ?? new InMemoryEscalationSessionPort();
    this.store = config.store ?? new InMemorySessionStore();
    this.materializer = config.materializer ?? new DefaultCapsuleMaterializer();
  }

  private now(input: { readonly now?: number | string | Date }): number {
    return input.now !== undefined ? this.coerceMs(input.now) : this.clock.now();
  }

  private coerceMs(value: number | string | Date): number {
    const ms = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value);
    if (!Number.isFinite(ms)) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
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
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `escalation ${requestId} belongs to another tenant`,
        details: { requestId, tenantId },
      });
    }
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown escalation ${requestId} for tenant ${tenantId}`,
      details: { requestId, tenantId },
    });
  }

  private async loadSession(sessionId: string, tenantId: string): Promise<ExpertSessionRecord> {
    const record = await this.store.get(sessionId, tenantId);
    if (record !== undefined) return record;
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown expert session ${sessionId} for tenant ${tenantId}`,
      details: { sessionId, tenantId },
    });
  }

  // -------------------------------------------------------------------------
  // openSession: escalation accepted → session_ready
  // -------------------------------------------------------------------------

  async openSession(input: OpenSessionInput): Promise<ExpertSessionRecord> {
    const now = this.now(input);
    const escalation = await this.loadEscalation(input.requestId, input.tenantId);

    if (escalation.request.environmentSessionPolicy.sessionMode !== 'bounded-replica') {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_STATE, {
        message: `escalation ${input.requestId} does not authorize a bounded-replica session (environmentSessionPolicy.sessionMode: ${escalation.request.environmentSessionPolicy.sessionMode})`,
        details: { requestId: input.requestId, sessionMode: escalation.request.environmentSessionPolicy.sessionMode },
      });
    }
    if (escalation.state !== 'accepted') {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_STATE, {
        message: `session binding requires escalation state 'accepted' (current: ${escalation.state})`,
        details: { requestId: input.requestId, state: escalation.state },
      });
    }

    const allowedModes = deriveSessionModes(escalation.request.escalationModes);
    const sessionMode: ExpertSessionMode =
      input.sessionMode !== undefined
        ? (input.sessionMode as ExpertSessionMode)
        : (allowedModes.find((mode) => mode !== 'observe') ?? 'observe');

    const command: CapsuleMaterializationCommand = {
      escalationRef: { requestId: input.requestId, tenantId: input.tenantId },
      sessionMode,
      allowedModes,
      source: input.source,
      escalationPolicy: {
        permittedActions: escalation.request.permittedActions,
        privacyClassification: escalation.request.privacyPolicy.dataClassification,
        pii: escalation.request.privacyPolicy.pii,
        sanitization: escalation.request.environmentSessionPolicy.sanitization,
        deadline: escalation.request.deadline,
      },
      now,
      // The capsule is bounded by the escalation deadline (time-bounded).
      expiresAt: escalation.request.deadline,
    };
    const capsule = await this.materializer.materialize(command);

    const record = createExpertSessionRecord(capsule, now);
    await this.store.insert(record);

    const bound = applyEscalationTransition(escalation, 'session_ready', {
      now,
      tenantId: input.tenantId,
      sessionRef: capsule.sessionId,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    await this.escalationPort.update(bound);

    return record;
  }

  // -------------------------------------------------------------------------
  // beginSession: escalation session_ready → in_progress; session open → active
  // -------------------------------------------------------------------------

  async beginSession(input: BeginSessionInput): Promise<ExpertSessionRecord> {
    const now = this.now(input);
    const record = await this.loadSession(input.sessionId, input.tenantId);
    if (record.state !== 'open') {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_STATE, {
        message: `session ${input.sessionId} is not open (state: ${record.state})`,
        details: { sessionId: input.sessionId, state: record.state },
      });
    }
    if (!isCapsuleWithinTimeBound(record.capsule, now)) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.DEADLINE_PASSED, {
        message: `session ${input.sessionId} capsule expired at ${record.capsule.expiresAt}`,
        details: { sessionId: input.sessionId, expiresAt: record.capsule.expiresAt },
      });
    }
    const escalation = await this.loadEscalation(
      record.capsule.escalationRef.requestId,
      input.tenantId,
    );
    if (escalation.state !== 'session_ready') {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_STATE, {
        message: `session ${input.sessionId} requires escalation state 'session_ready' (current: ${escalation.state})`,
        details: { sessionId: input.sessionId, escalationState: escalation.state },
      });
    }

    const active = applyExpertSessionTransition(record, 'active', { now, actor: input.expertRef });
    await this.store.update(active);

    const progressed = applyEscalationTransition(escalation, 'in_progress', {
      now,
      tenantId: input.tenantId,
      expertRef: input.expertRef,
      actor: input.expertRef,
    });
    await this.escalationPort.update(progressed);

    return active;
  }

  // -------------------------------------------------------------------------
  // recordSessionEvent: mode + barrier + escape enforcement (fail-closed)
  // -------------------------------------------------------------------------

  async recordSessionEvent(input: RecordSessionEventInput): Promise<ExpertSessionRecord> {
    const now = this.now(input);
    const record = await this.loadSession(input.sessionId, input.tenantId);
    if (record.state !== 'active') {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_STATE, {
        message: `events append only while the session is active (state: ${record.state})`,
        details: { sessionId: input.sessionId, state: record.state },
      });
    }
    const capsule = record.capsule;

    // Time bound + time-limited capsule access material freshness.
    if (!isCapsuleWithinTimeBound(capsule, now)) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.DEADLINE_PASSED, {
        message: `session ${input.sessionId} capsule expired at ${capsule.expiresAt}`,
        details: { sessionId: input.sessionId, expiresAt: capsule.expiresAt },
      });
    }
    assertNoEscape(checkCredentials(capsule.barrier, now));

    // Mode policy over the event kind.
    const mapped = EVENT_KIND_ACTIONS[input.kind as ExpertSessionEventKind];
    if (mapped === undefined) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_EVENT, {
        message: `event kind is not in the approved EES1.0 vocabulary: ${JSON.stringify(input.kind)}`,
      });
    }
    if (mapped !== 'floor') {
      assertSessionActionAllowed(capsule.sessionMode, mapped);
      assertNoEscape(checkActionAllowlisted(capsule.barrier, mapped));
    }

    // THE ESCAPE LAW over the payload: every declared resource/tool
    // reference is checked against the capsule scope + tenant boundary;
    // live-world string values anywhere in the payload are escape
    // attempts. Export channels are checked against the restrictions.
    this.enforceBarrierOnPayload(capsule, input.payload, input.kind, input.exportChannel);

    // Screen the payload BEFORE it enters the append-only stream.
    const screened = screenObservation(capsule.barrier, input.payload as PlainJsonValue);
    const next = appendSessionEvent(record, {
      kind: input.kind,
      payload: screened,
      now,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    await this.store.update(next);
    return next;
  }

  private enforceBarrierOnPayload(
    capsule: ExpertSessionRecord['capsule'],
    payload: unknown,
    kind: string,
    exportChannel: string | undefined,
  ): void {
    if (exportChannel !== undefined) {
      if (!isExportChannel(exportChannel)) {
        throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
          message: `unknown export channel: ${JSON.stringify(exportChannel)}`,
        });
      }
      assertNoEscape(checkExportAction(capsule.barrier, exportChannel));
    }
    if (typeof payload !== 'object' || payload === null) return;
    const scope = {
      tenantId: capsule.escalationRef.tenantId,
      resources: capsule.resources,
    };
    const visit = (value: unknown): void => {
      if (typeof value === 'string') {
        if (value.startsWith('live:') || value.startsWith('prod:') || value.startsWith('ws://live.')) {
          assertNoEscape({ allowed: false, reason: 'resource_outside_capsule' });
        }
        return;
      }
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry);
        return;
      }
      if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>;
        const resourceRef = record['resourceRef'];
        if (typeof resourceRef === 'string') {
          assertNoEscape(
            checkResourceAccess(capsule.barrier, scope, { resourceRef, mode: 'read' }),
          );
        }
        const toolName = record['toolName'];
        if (typeof toolName === 'string') {
          assertNoEscape(checkToolUse(capsule.barrier, capsule.tools, toolName));
        }
        for (const key of Object.keys(record)) visit(record[key]);
      }
    };
    if (kind === 'tool-invocation' || kind === 'tool-result') {
      const toolName = (payload as Record<string, unknown>)['toolName'];
      if (typeof toolName === 'string') {
        assertNoEscape(checkToolUse(capsule.barrier, capsule.tools, toolName));
      }
    }
    visit(payload);
  }

  // -------------------------------------------------------------------------
  // submitSession: the EES1.0 completion contract → C001 validation
  // -------------------------------------------------------------------------

  async submitSession(input: SubmitSessionInput): Promise<ExpertSessionRecord> {
    const now = this.now(input);
    const record = await this.loadSession(input.sessionId, input.tenantId);
    if (record.state !== 'active') {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_STATE, {
        message: `submission requires an active session (state: ${record.state})`,
        details: { sessionId: input.sessionId, state: record.state },
      });
    }
    const escalation = await this.loadEscalation(
      record.capsule.escalationRef.requestId,
      input.tenantId,
    );
    if (escalation.state !== 'in_progress') {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_STATE, {
        message: `submission requires escalation state 'in_progress' (current: ${escalation.state})`,
        details: { sessionId: input.sessionId, escalationState: escalation.state },
      });
    }
    // Mode policy: only modes with result capability may submit.
    assertSessionActionAllowed(record.capsule.sessionMode, 'submit-result');

    // Learning permissions (C001 EscalationRequest policy fields).
    const learning = escalation.request.learningPermissions;
    if (input.toolGapSignals !== undefined && input.toolGapSignals.length > 0 && !learning.allowToolGapSignals) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
        message: 'the escalation request does not allow tool-gap signals (learningPermissions.allowToolGapSignals: false)',
      });
    }
    if (
      input.knowledgeArtifacts !== undefined &&
      input.knowledgeArtifacts.length > 0 &&
      !learning.allowKnowledgeCapture
    ) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
        message: 'the escalation request does not allow knowledge capture (learningPermissions.allowKnowledgeCapture: false)',
      });
    }

    const submission: ExpertSessionSubmission = createExpertSessionSubmission({
      sessionId: input.sessionId,
      result: input.result,
      evidence: input.evidence,
      ...(input.annotations !== undefined ? { annotations: input.annotations } : {}),
      ...(input.corrections !== undefined ? { corrections: input.corrections } : {}),
      ...(input.knowledgeArtifacts !== undefined ? { knowledgeArtifacts: input.knowledgeArtifacts } : {}),
      ...(input.toolGapSignals !== undefined ? { toolGapSignals: input.toolGapSignals } : {}),
      consentRightsStatement: input.consentRightsStatement,
      now,
    });

    // Append the final-result event, then complete the session.
    const withFinal = appendSessionEvent(record, {
      kind: 'final-result',
      payload: submission.result,
      now,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    const completed = applyExpertSessionTransition(withFinal, 'completed', {
      now,
      submission,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    await this.store.update(completed);

    // Map the session submission onto a C001 EscalationResult and hand
    // the escalation to C001 validation (in_progress → submitted).
    const escalationResult = this.toEscalationResult(input, submission, now);
    const submitted = submitEscalationResult(escalation, escalationResult, {
      now,
      tenantId: input.tenantId,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    await this.escalationPort.update(submitted);

    return completed;
  }

  private toEscalationResult(
    input: SubmitSessionInput,
    submission: ExpertSessionSubmission,
    now: number,
  ): EscalationResult {
    const kind = input.escalationResultKind ?? 'answer';
    const resultInput: CreateEscalationResultInput = {
      kind,
      producedAt: now,
      summary: `expert session ${input.sessionId} submission (consent: ${submission.consentRightsStatement.granted ? 'granted' : 'not granted'})`,
      payload: submission.result,
      evidenceRefs: submission.evidence.map((entry) => entry.ref),
      ...(input.escalationResultFields as Record<string, unknown> | undefined),
    };
    return createEscalationResult(resultInput);
  }

  // -------------------------------------------------------------------------
  // Read surfaces (privacy-screened, approved events only)
  // -------------------------------------------------------------------------

  async getSession(input: GetSessionInput): Promise<ExpertSessionRecord | undefined> {
    return this.store.get(input.sessionId, input.tenantId);
  }

  /** The observation stream for the originating agent (re-screened). */
  async getObservationStream(input: GetSessionInput): Promise<readonly unknown[]> {
    const record = await this.loadSession(input.sessionId, input.tenantId);
    return projectObservationStream(record.capsule.barrier, record.events);
  }

  /** The replay trace (observational; never a live mutation). */
  async getSessionReplay(input: GetSessionInput & { readonly now?: number | string | Date }) {
    const record = await this.loadSession(input.sessionId, input.tenantId);
    const now = input.now !== undefined ? input.now : this.clock.now();
    return buildReplayTrace(record.capsule.sessionId, record.capsule.digest, record.events, now);
  }

  /** Deterministic expiry sweep: capsules past their time bound expire. */
  async sweepExpiredSessions(now?: number | string | Date): Promise<readonly ExpertSessionRecord[]> {
    const at = now !== undefined ? this.coerceMs(now) : this.clock.now();
    const expired: ExpertSessionRecord[] = [];
    for (const record of await this.store.list()) {
      if (record.state !== 'open' && record.state !== 'active') continue;
      if (!isCapsuleWithinTimeBound(record.capsule, at)) {
        const next = applyExpertSessionTransition(record, 'expired', { now: at, actor: 'expert-session-service' });
        await this.store.update(next);
        expired.push(next);
      }
    }
    return expired;
  }
}
