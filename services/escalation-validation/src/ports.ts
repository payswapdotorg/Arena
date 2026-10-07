/**
 * Escalation-validation service ports (Work Order C009) — the ONLY
 * things services/escalation-validation depends on besides the domain
 * packages (@arena/escalation, @arena/escalation-validation,
 * @arena/intervention, @arena/protocol-core).
 *
 * Mirroring the sibling services' ports.ts discipline
 * (services/intervention, services/escalation-routing):
 *   - Clock        — time is INJECTED (the service never reads a wall
 *                    clock; architecture-lock rule 17);
 *   - EscalationPort     — THE C001 SEAM: the escalation lifecycle is
 *                    read/write consumed through this injected port
 *                    (never another service, never a C001 edit);
 *   - EvaluationStagePort / VerificationStagePort — THE A012/A013
 *                    SEAMS: the two EXPLICITLY DISTINCT adjudication
 *                    stages (lock rule 7) run through injected ports
 *                    (hosts wire the evaluation/verification fabrics);
 *   - ValidatorDirectory — THE C005 SEAM: validator candidates carry
 *                    the C005 dimensional evidence projections
 *                    (competency by skill, agreement patterns);
 *   - RoutingPortLike   — THE C002 SEAM: expert-replacement requests
 *                    route back into MATCHING through the public
 *                    routing port (mirrored structurally);
 *   - ValidationStore   — persistence for the append-only validation
 *                    record (durable + tenant-scoped; the reference
 *                    fabric is in-process — hosts wire the A015-era
 *                    fabric);
 *   - EscalationEventSink — webhook event delivery
 *                    (escalation.validation.updated et al.).
 *
 * THE C007 VALIDATION SEAM (services/intervention ValidationHandoffPort):
 * this service implements it STRUCTURALLY. The port types are mirrored
 * here (closed vocabularies byte-equal to C007's) because a service may
 * not import another service (boundary rule B2) — hoisting the port
 * into a domain package is recorded as an architecture question in the
 * PR (the same question services/escalation-routing already records
 * for C001's RoutingPort).
 *
 * Authority boundary (lock rule 16): the service OWNS adjudication
 * orchestration only — plan derivation, the two-stage verdict, the
 * revision loop and replacement triggers. It NEVER judges domain
 * outcomes outside the declared validation condition and NEVER grants
 * authorization (a validation verdict is not an access grant).
 */

import type { EscalationRecord, EscalationWebhookEvent } from '@arena/escalation';
import type { InterventionResultContract } from '@arena/intervention';
import type {
  EvaluationStageResult,
  ValidationPlan,
  VerificationStageResult,
} from '@arena/escalation-validation';
import type { ValidatorCandidate } from '@arena/escalation-validation';

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
   * cross-tenant failure on validation paths. Never exposed on read
   * surfaces.
   */
  findById(requestId: string): Promise<EscalationRecord | undefined>;
  /** Persist the latest escalation record snapshot (the C001 store owns durability). */
  update(record: EscalationRecord): Promise<void>;
}

// ---------------------------------------------------------------------------
// THE C007 VALIDATION SEAM (structural mirror — byte-equal vocabularies)
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

/**
 * The deterministic receipt the seam returns. `stub` is FALSE on this
 * implementation — the real C009 engine (this service) replaces C007's
 * labelled deterministic stub without any C007 code change: hosts
 * inject this service wherever the intervention service accepts a
 * ValidationHandoffPort.
 */
export interface ValidationHandoffReceipt {
  readonly handoffVersion: 1;
  /** Deterministic receipt id (idempotent per request + mode). */
  readonly receiptId: string;
  readonly status: 'routed';
  readonly routedTo: ValidationFabric;
  /** The validation condition the routing decided on (the derived plan). */
  readonly validationCondition: {
    readonly source: string;
    readonly policy: string;
  };
  /** TRUE only while the C009 adjudication engine has not shipped. */
  readonly stub: boolean;
}

/**
 * THE C007 SEAM — SUBMITTED payloads route onto the A012/A013
 * validation surfaces per the request's derived validation plan.
 * EscalationValidationService implements this STRUCTURALLY.
 */
export interface ValidationHandoffPort {
  route(command: ValidationHandoffCommand): Promise<ValidationHandoffReceipt>;
}

// ---------------------------------------------------------------------------
// THE A012 / A013 STAGE SEAMS
// ---------------------------------------------------------------------------

/** The shared input of one adjudication stage run. */
export interface AdjudicationStageInput {
  readonly requestId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly mode: string;
  readonly resultKind: string;
  readonly contract: InterventionResultContract;
  readonly trajectoryRef?: { readonly trajectoryId: string; readonly chainHead: string };
  readonly submittedAt: string;
  /** The typed validation plan the stage runs under. */
  readonly plan: ValidationPlan;
  /** The selected validator (null for non-expert evaluator kinds). */
  readonly validator: ValidatorCandidate | null;
  /** Injected stage time (epoch ms). */
  readonly now: number;
}

/** THE A012 SEAM — the evaluation stage (judgment against criteria; NEVER establishes evidence). */
export interface EvaluationStagePort {
  run(input: AdjudicationStageInput): Promise<EvaluationStageResult>;
}

/** THE A013 SEAM — the verification stage (evidence supports claims; NEVER scores). */
export interface VerificationStagePort {
  run(input: AdjudicationStageInput): Promise<VerificationStageResult>;
}

// ---------------------------------------------------------------------------
// THE C005 SEAM (validator directory) + THE C002 SEAM (routing mirror)
// ---------------------------------------------------------------------------

/**
 * THE C005 SEAM — host-wired validator candidates carrying the C005
 * dimensional evidence projections (competency by skill, agreement
 * patterns). HOST CONTRACT: the directory returns experts of the tenant
 * or the reserved global `public` scope; the engine double-guards this
 * and eliminates cross-tenant candidates.
 */
export interface ValidatorDirectory {
  listValidatorCandidates(tenantId: string): Promise<readonly ValidatorCandidate[]>;
}

/**
 * The C002 routing-seam decision vocabulary (byte-equal mirror of the
 * closed no-match reason list and the matched/no-match union shared by
 * services/escalation-api and services/escalation-routing).
 */
export const ROUTING_NO_MATCH_REASONS = Object.freeze([
  'no-qualified-expert',
  'budget-below-floor',
  'locale-uncovered',
  'routing-unavailable',
] as const);
export type RoutingNoMatchReason = (typeof ROUTING_NO_MATCH_REASONS)[number];

/** The C002 routing-seam decision (matched expert ref | typed no-match). */
export type RoutingDecision =
  | { readonly outcome: 'matched'; readonly expertRef: string }
  | { readonly outcome: 'no-match'; readonly reason: RoutingNoMatchReason };

/**
 * THE C002 SEAM (structural mirror): an object with
 * `route(record: EscalationRecord): Promise<RoutingDecision>` satisfies
 * it — services/escalation-routing's EscalationRoutingService does, so
 * a host can inject the real routing engine wherever replacement
 * requests route back into MATCHING.
 */
export interface RoutingPortLike {
  route(request: EscalationRecord): Promise<RoutingDecision>;
}

// ---------------------------------------------------------------------------
// Persistence + events
// ---------------------------------------------------------------------------

import type { ValidationRecord } from '@arena/escalation-validation';

/** Persistence port for the append-only validation record (tenant-scoped). */
export interface ValidationStore {
  /** Persist a NEW validation record; throws on duplicate request id. */
  insert(record: ValidationRecord): Promise<void>;
  /** Replace the latest snapshot of an existing validation record. */
  update(record: ValidationRecord): Promise<void>;
  /** Tenant-scoped lookup (cross-tenant reads return undefined). */
  get(requestId: string, tenantId: string): Promise<ValidationRecord | undefined>;
  /** INTERNAL unscoped lookup — used ONLY to produce the typed cross-tenant failure. */
  findById(requestId: string): Promise<ValidationRecord | undefined>;
}

/** Webhook event delivery (escalation.validation.updated et al.). */
export interface EscalationEventSink {
  emit(event: EscalationWebhookEvent): Promise<void>;
}
