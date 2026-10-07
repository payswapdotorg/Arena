/**
 * Expert-session service ports (Work Order C006) — the ONLY things
 * services/expert-session depends on besides the domain packages
 * (@arena/expert-session, @arena/escalation, @arena/protocol-core).
 *
 * Mirroring services/escalation-api's ports.ts discipline:
 *   - Clock              — time is INJECTED (the service never reads a
 *                          wall clock; architecture-lock rule 17);
 *   - EscalationSessionPort — THE C001 SEAM: the escalation lifecycle
 *                          (@arena/escalation) is read/write CONSUMED
 *                          through this injected port; this service
 *                          never imports another service and never
 *                          edits C001 code;
 *   - SessionStore       — persistence for expert session records
 *                          (capsule + append-only event stream + state
 *                          history), tenant-scoped lookups;
 *   - CapsuleMaterializer — THE A009/A010 SEAM: adapters/expert-environment
 *                          materializes ExpertSessionCapsules against
 *                          the environment protocol/runtime; this
 *                          service only consumes the port (the
 *                          reference implementation in fabric.ts is
 *                          clearly labelled).
 *
 * Authority boundary (lock rule 16): the service OWNS session
 * orchestration only — binding sessions to escalation states, enforcing
 * mode + privacy policy on every expert action, and handing the
 * completed submission back to C001 validation. It NEVER judges domain
 * outcomes (validation verdicts are C009's) and never grants access
 * beyond the derived capsule.
 */

import type { EscalationRecord } from '@arena/escalation';
import type {
  ExpertSessionCapsule,
  ExpertSessionMode,
  ExpertSessionRecord,
  ExecutionCapsuleSource,
} from '@arena/expert-session';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/**
 * THE C001 SEAM — the escalation lifecycle consumed through injected
 * ports (C001 code is read-only for this work order).
 */
export interface EscalationSessionPort {
  /** Tenant-scoped lookup by escalation request id (cross-tenant reads return undefined). */
  get(requestId: string, tenantId: string): Promise<EscalationRecord | undefined>;
  /**
   * INTERNAL unscoped lookup — used ONLY to produce the typed
   * cross-tenant failure on session paths (the domain layer enforces
   * the tenant guard). Never exposed on read surfaces.
   */
  findById(requestId: string): Promise<EscalationRecord | undefined>;
  /** Persist the latest escalation record snapshot (the C001 store owns durability). */
  update(record: EscalationRecord): Promise<void>;
}

/** Persistence port for expert session records. */
export interface SessionStore {
  /** Persist a NEW session record; throws on duplicate session id or duplicate escalation binding. */
  insert(record: ExpertSessionRecord): Promise<void>;
  /** Replace the latest snapshot of an existing session record (append-only at the event level). */
  update(record: ExpertSessionRecord): Promise<void>;
  /** Tenant-scoped lookup by session id (cross-tenant reads return undefined). */
  get(sessionId: string, tenantId: string): Promise<ExpertSessionRecord | undefined>;
  /** All session records (expiry sweeps / scans). */
  list(): Promise<readonly ExpertSessionRecord[]>;
}

/** The escalation policy fields the materializer derives the barrier from. */
export interface EscalationPolicyView {
  /** Permitted actions from the EscalationRequest (C001 closed vocabulary). */
  readonly permittedActions: readonly string[];
  readonly privacyClassification: 'public' | 'internal' | 'confidential';
  readonly pii: 'forbid' | 'redact' | 'allow';
  readonly sanitization: 'standard' | 'strict';
  /** The escalation deadline (bounds every derived capsule). */
  readonly deadline: string;
}

/** THE A009/A010 SEAM — capsule materialization against the environment protocol/runtime. */
export interface CapsuleMaterializer {
  /**
   * Materialize a bounded ExpertSessionCapsule from an execution
   * capsule source under the escalation's declared policy. Fail-closed:
   * every policy violation surfaces as a typed @arena/expert-session
   * error.
   */
  materialize(command: CapsuleMaterializationCommand): Promise<ExpertSessionCapsule>;
}

export interface CapsuleMaterializationCommand {
  readonly escalationRef: { readonly requestId: string; readonly tenantId: string };
  readonly sessionMode: ExpertSessionMode;
  readonly allowedModes: readonly ExpertSessionMode[];
  readonly source: ExecutionCapsuleSource;
  readonly escalationPolicy: EscalationPolicyView;
  readonly now: number | string | Date;
  readonly expiresAt: number | string | Date;
  readonly sessionId?: string;
}
