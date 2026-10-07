/**
 * Expert-session-policy service ports (Work Order C018) — the ONLY things
 * services/expert-session-policy depends on besides the domain packages
 * (@arena/expert-session-policy, @arena/escalation, @arena/expert-session,
 * @arena/intervention, @arena/security, @arena/protocol-core).
 *
 * Mirroring services/expert-session's ports.ts discipline:
 *   - Clock                      — time is INJECTED (architecture-lock
 *                                  rule 17; the service never reads a
 *                                  wall clock);
 *   - EscalationPolicyPort       — THE C001 SEAM: the EscalationRequest
 *                                  (whose policy fields packs bind at
 *                                  request time) is read through this
 *                                  injected port; this service never
 *                                  imports another service and never
 *                                  edits C001 code;
 *   - PolicyPackStore            — tenant-scoped pack persistence with
 *                                  version-conflict detection;
 *   - CrossTenantAuthorizationStore — explicit typed grants for foreign
 *                                  pack reuse (lock rule 11);
 *   - RetentionLedger            — retention subject persistence;
 *   - SessionPolicySink          — THE C006 SEAM: the resolved effective
 *                                  policy is HANDED to the expert-session
 *                                  builder through this port (C006 owns
 *                                  barrier enforcement);
 *   - ModePolicySink             — THE C007 SEAM: the resolved effective
 *                                  policy is HANDED to the intervention
 *                                  mode guards (C007 owns mode
 *                                  enforcement).
 *
 * Authority boundary: this service OWNS resolution + audit only. It
 * never enforces barriers or mode guards itself and never grants access
 * beyond what C006/C007 enforce — the resolution-owns /
 * enforcement-borrows boundary of Work Order C018.
 */

import type { EscalationRecord } from '@arena/escalation';
import type {
  CrossTenantPackAuthorization,
  EffectiveSessionPolicy,
  PolicyPack,
  RetentionSubject,
} from '@arena/expert-session-policy';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** THE C001 SEAM — the escalation (and its policy fields) via injected port. */
export interface EscalationPolicyPort {
  /** Tenant-scoped lookup by escalation request id (cross-tenant reads return undefined). */
  get(requestId: string, tenantId: string): Promise<EscalationRecord | undefined>;
  /**
   * INTERNAL unscoped lookup — used ONLY to produce the typed
   * cross-tenant failure on resolution paths. Never exposed on read
   * surfaces.
   */
  findById(requestId: string): Promise<EscalationRecord | undefined>;
}

/** Tenant-scoped policy pack persistence. */
export interface PolicyPackStore {
  /** Persist a NEW pack version; throws on duplicate (packId, version) or version regression. */
  insert(pack: PolicyPack): Promise<void>;
  /** Tenant-scoped lookup by exact version (cross-tenant reads return undefined). */
  get(packId: string, version: number, tenantId: string): Promise<PolicyPack | undefined>;
  /** The latest registered version of a pack family for a tenant. */
  latest(packId: string, tenantId: string): Promise<PolicyPack | undefined>;
  /** INTERNAL unscoped lookup — used ONLY for the typed cross-tenant failure. */
  findById(packId: string, version: number): Promise<PolicyPack | undefined>;
  /** The most recently registered pack family for a tenant (the default resolution source). */
  latestFamily(tenantId: string): Promise<PolicyPack | undefined>;
}

/** Explicit typed cross-tenant pack reuse grants. */
export interface CrossTenantAuthorizationStore {
  insert(authorization: CrossTenantPackAuthorization): Promise<void>;
  /** The grant for (pack, consuming tenant) at the exact version, if any. */
  find(packId: string, packVersion: number, consumingTenantId: string): Promise<CrossTenantPackAuthorization | undefined>;
}

/** Retention subject persistence (the disposition state machine's store). */
export interface RetentionLedger {
  /** Persist a NEW subject; throws on duplicate subject id. */
  insert(subject: RetentionSubject): Promise<void>;
  /** Replace the latest snapshot of an existing subject. */
  update(subject: RetentionSubject): Promise<void>;
  /** Tenant-scoped lookup by subject id (cross-tenant reads return undefined). */
  get(subjectId: string, tenantId: string): Promise<RetentionSubject | undefined>;
  /** INTERNAL unscoped lookup — used ONLY for the typed cross-tenant failure. */
  findById(subjectId: string): Promise<RetentionSubject | undefined>;
  /** All subjects of one escalation (the resolution's four classes). */
  listByRequest(requestId: string, tenantId: string): Promise<readonly RetentionSubject[]>;
  /** All subjects of a tenant (expiry sweeps). */
  listForTenant(tenantId: string): Promise<readonly RetentionSubject[]>;
}

/** THE C006 SEAM — the session builder consumes the resolved effective policy. */
export interface SessionPolicySink {
  /** Receive the effective policy governing one escalation's expert session. */
  receiveEffectivePolicy(policy: EffectiveSessionPolicy): Promise<void>;
}

/** THE C007 SEAM — the intervention mode guards consume the resolved effective policy. */
export interface ModePolicySink {
  /** Receive the effective policy governing one escalation's interventions. */
  receiveEffectivePolicy(policy: EffectiveSessionPolicy): Promise<void>;
}

/** A durable resolution record (pins a request's governing pack). */
export interface PolicyResolutionRecord {
  readonly recordVersion: 1;
  readonly resolutionId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly packRef: { readonly packId: string; readonly version: number } | null;
  readonly policy: EffectiveSessionPolicy;
  readonly createdAt: string;
}

/** Persistence for resolution records (the request → pack pinning). */
export interface ResolutionStore {
  insert(record: PolicyResolutionRecord): Promise<void>;
  findByRequest(requestId: string, tenantId: string): Promise<PolicyResolutionRecord | undefined>;
}
