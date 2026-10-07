/**
 * Intervention service ports (Work Order C007) — the ONLY things
 * services/intervention depends on besides the domain packages
 * (@arena/intervention, @arena/expert-session, @arena/escalation,
 * @arena/trajectory, @arena/protocol-core).
 *
 * Mirroring services/expert-session's ports.ts discipline:
 *   - Clock               — time is INJECTED (the service never reads a
 *                           wall clock; architecture-lock rule 17);
 *   - EscalationPort      — THE C001 SEAM: the escalation lifecycle is
 *                           read/write consumed through this injected
 *                           port (never another service, never a C001
 *                           edit);
 *   - SessionPort         — THE C006 SEAM: the expert session record
 *                           (capsule + append-only observable stream)
 *                           the intervention runs inside;
 *   - TrajectoryPort      — THE A011 SEAM: persistence for the
 *                           trajectory-backed record of observable work;
 *   - InterventionStore   — persistence for intervention records
 *                           (durable + idempotent; the reference fabric
 *                           is in-process — hosts wire the A015 fabric);
 *   - EscalationEventSink — webhook event delivery (progress events
 *                           feeding escalation.progressed);
 *   - ValidationHandoffPort — THE C009 SEAM: SUBMITTED payloads route
 *                           to the A012/A013 validation surfaces per
 *                           the request's validation condition. The
 *                           full adjudication/revision/replacement
 *                           engine is C009 (not yet dispatched); the
 *                           reference implementation shipped here is a
 *                           DETERMINISTIC STUB, clearly labelled (see
 *                           fabric.ts StubValidationHandoff).
 *
 * Authority boundary (lock rule 16): the service OWNS intervention
 * orchestration only — mode selection/transition authorization, the
 * observable work record, and the submission handoff. It NEVER judges
 * domain outcomes (validation verdicts are C009's) and never grants
 * access beyond the C006 capsule's derived allowance.
 */

import type { EscalationRecord, EscalationWebhookEvent } from '@arena/escalation';
import type { ExpertSessionRecord } from '@arena/expert-session';
import type { InterventionResultContract, InterventionStepKind } from '@arena/intervention';
import type { CreateTrajectoryHeaderInput, TrajectoryRecord } from '@arena/trajectory';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** THE C001 SEAM — the escalation lifecycle consumed through injected ports. */
export interface EscalationPort {
  /** Tenant-scoped lookup by escalation request id (cross-tenant reads return undefined). */
  get(requestId: string, tenantId: string): Promise<EscalationRecord | undefined>;
  /**
   * INTERNAL unscoped lookup — used ONLY to produce the typed
   * cross-tenant failure on intervention paths. Never exposed on read
   * surfaces.
   */
  findById(requestId: string): Promise<EscalationRecord | undefined>;
  /** Persist the latest escalation record snapshot (the C001 store owns durability). */
  update(record: EscalationRecord): Promise<void>;
}

/** THE C006 SEAM — the expert session the intervention runs inside. */
export interface SessionPort {
  /** Tenant-scoped lookup by session id (cross-tenant reads return undefined). */
  get(sessionId: string, tenantId: string): Promise<ExpertSessionRecord | undefined>;
  /**
   * INTERNAL unscoped lookup — used ONLY to produce the typed
   * cross-tenant failure on intervention paths. Never exposed on read
   * surfaces.
   */
  findById(sessionId: string): Promise<ExpertSessionRecord | undefined>;
  /** Persist the latest session record snapshot (C006 owns the record). */
  update(record: ExpertSessionRecord): Promise<void>;
}

/** THE A011 SEAM — persistence for trajectory-backed records of observable work. */
export interface TrajectoryPort {
  /** Persist a trajectory record (idempotent on trajectory id + chain head). */
  save(record: TrajectoryRecord): Promise<void>;
  /** Lookup by trajectory id. */
  get(trajectoryId: string): Promise<TrajectoryRecord | undefined>;
}

/** The durable intervention record the service owns. */
export interface InterventionRecord {
  readonly recordVersion: 1;
  readonly interventionId: string;
  /** Idempotency key of the begin command (duplicate begins return the same record). */
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  /** The escalation mode the intervention CURRENTLY runs in. */
  readonly mode: string;
  /** The modes the EscalationRequest authorizes. */
  readonly allowedModes: readonly string[];
  /** Append-only mode history (1..n; the escalation-modes law's audit trail). */
  readonly modeHistory: readonly {
    readonly from: string | null;
    readonly to: string;
    readonly occurredAt: string;
    readonly reason: 'begin' | 'mode_transition_ok';
  }[];
  readonly state: 'active' | 'completed';
  /** The observable work log (also mirrored into the C006 session stream + A011 trajectory). */
  readonly steps: readonly {
    readonly kind: InterventionStepKind;
    readonly stepId: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly occurredAt: string;
  }[];
  /** The A011 header binding inputs (present when a trajectory binding was declared). */
  readonly trajectoryBinding?: {
    readonly trajectoryId: string;
    readonly run: CreateTrajectoryHeaderInput['run'];
    readonly agentBodyRef: string;
    readonly substrateRef: string;
    readonly seed: string | null;
    readonly startedAt: string;
  };
  readonly trajectoryRef?: { readonly trajectoryId: string; readonly chainHead: string };
  /** The per-mode result contract (present once completed). */
  readonly contract?: InterventionResultContract;
  /** The C009-seam validation handoff receipt (present once completed). */
  readonly validationHandoff?: ValidationHandoffReceipt;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Persistence port for intervention records (durable + idempotent). */
export interface InterventionStore {
  /** Persist a NEW intervention record; throws on duplicate intervention id. */
  insert(record: InterventionRecord): Promise<void>;
  /** Replace the latest snapshot of an existing intervention record. */
  update(record: InterventionRecord): Promise<void>;
  /** Tenant-scoped lookup by intervention id (cross-tenant reads return undefined). */
  get(interventionId: string, tenantId: string): Promise<InterventionRecord | undefined>;
  /** Tenant-scoped idempotent lookup by begin idempotency key. */
  findByIdempotencyKey(idempotencyKey: string, tenantId: string): Promise<InterventionRecord | undefined>;
  /** All intervention records (scans). */
  list(): Promise<readonly InterventionRecord[]>;
}

/** Webhook event delivery (progress events feeding escalation.progressed). */
export interface EscalationEventSink {
  emit(event: EscalationWebhookEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// THE C009 SEAM — validation handoff (deterministic stub until C009 ships)
// ---------------------------------------------------------------------------

/** The command routed onto the validation seam when an escalation is SUBMITTED. */
export interface ValidationHandoffCommand {
  readonly requestId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  /** The escalation mode the intervention ran in. */
  readonly mode: string;
  /** The C001 escalation result kind the per-mode contract mapped onto. */
  readonly resultKind: string;
  /** The per-mode intervention result contract (the machine-readable payload to validate). */
  readonly contract: InterventionResultContract;
  /** The trajectory backing the observable work (when bound). */
  readonly trajectoryRef?: { readonly trajectoryId: string; readonly chainHead: string };
  readonly submittedAt: string;
}

/** The validation surfaces a SUBMITTED payload routes onto. */
export const VALIDATION_FABRICS = Object.freeze([
  'evaluation-fabric',
  'verification-fabric',
] as const);
export type ValidationFabric = (typeof VALIDATION_FABRICS)[number];

/** The deterministic receipt the seam returns. */
export interface ValidationHandoffReceipt {
  readonly handoffVersion: 1;
  /** Deterministic receipt id (idempotent per request + mode). */
  readonly receiptId: string;
  readonly status: 'routed';
  readonly routedTo: ValidationFabric;
  /** The validation condition the routing decided on. */
  readonly validationCondition: {
    readonly source: string;
    readonly policy: string;
  };
  /** TRUE while the C009 adjudication engine is not yet dispatched. */
  readonly stub: boolean;
}

/**
 * THE C009 SEAM — SUBMITTED payloads route to the A012/A013 surfaces
 * per the request's validation condition. The full adjudication /
 * revision / expert-replacement engine is Work Order C009; until it
 * ships, the reference implementation is the clearly-labelled
 * deterministic StubValidationHandoff in fabric.ts.
 */
export interface ValidationHandoffPort {
  route(command: ValidationHandoffCommand): Promise<ValidationHandoffReceipt>;
}
