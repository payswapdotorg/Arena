/**
 * ExpertSessionPolicyService — the reference resolution service for
 * Arena enterprise session policy packs (Work Order C018; issue #124;
 * mirrors the C006 ExpertSessionService pattern: injected dependencies,
 * fail-closed typed error normalization, NO network/HTTP layer —
 * adapters own the wire transports).
 *
 *   - registerPolicyPack — typed closed validation verdicts
 *     (valid / conflicting-controls / infeasible-for-session-modes);
 *     rejected packs are audited and NEVER stored or weakened;
 *     duplicate registration and version regression are typed conflicts;
 *   - getPolicyPack — tenant-scoped reads (cross-tenant reads are typed
 *     failures, never leaks);
 *   - resolveEffectivePolicy — an EscalationRequest's policy fields +
 *     the applicable tenant pack → the concrete effective policy handed
 *     to the C006 session builder and the C007 mode guards through the
 *     injected sinks; a request's governing pack is PINNED (a different
 *     pack on re-resolution is the typed retention-bypass /
 *     version-swap conflict); retention subjects are created for every
 *     artifact class;
 *   - advanceRetention / requestCustomerErasure / requestExpertWithdrawal
 *     / executeDisposition — the retention disposition engine with
 *     double-spend safety and audit history retained after deletion;
 *   - every apply/redact/mask/deny decision lands on the append-only,
 *     tamper-evident PolicyAuditLog (A015 discipline).
 *
 * Fail-closed everywhere: wrong tenant, unknown escalation, foreign pack
 * without authorization, conflicting controls, infeasible modes,
 * retention conflicts, illegal disposition transitions — all typed
 * ExpertSessionPolicyError failures.
 */

import { randomUUID } from 'node:crypto';
import type { EscalationRecord } from '@arena/escalation';
import {
  applyDispositionTransition,
  checkAllowlistFeasibility,
  createPolicyPack,
  createRetentionSubject,
  evaluateRetentionExpiry,
  executeDisposition as executeDispositionTransition,
  requestCustomerErasure as requestErasure,
  requestExpertWithdrawal as requestWithdrawal,
  resolveEffectiveSessionPolicy,
  validateAndComposeControls,
} from '@arena/expert-session-policy';
import type {
  CreatePolicyPackInput,
  EffectiveSessionPolicy,
  PolicyAuditEvent,
  PolicyAuditSnapshot,
  PolicyPack,
  PolicyPackValidation,
  RetentionSubject,
} from '@arena/expert-session-policy';
import { PolicyAuditLog } from '@arena/expert-session-policy';
import { ExpertSessionPolicyError } from '@arena/expert-session-policy';
import type {
  Clock,
  CrossTenantAuthorizationStore,
  EscalationPolicyPort,
  ModePolicySink,
  PolicyPackStore,
  ResolutionStore,
  RetentionLedger,
  SessionPolicySink,
} from './ports.js';
import {
  InMemoryCrossTenantAuthorizationStore,
  InMemoryEscalationPolicyPort,
  InMemoryPolicyPackStore,
  InMemoryResolutionStore,
  InMemoryRetentionLedger,
  ReferenceModePolicySink,
  ReferenceSessionPolicySink,
} from './fabric.js';

export interface ExpertSessionPolicyServiceConfig {
  readonly clock?: Clock;
  readonly escalationPort?: EscalationPolicyPort;
  readonly packStore?: PolicyPackStore;
  readonly authorizationStore?: CrossTenantAuthorizationStore;
  readonly retentionLedger?: RetentionLedger;
  readonly resolutionStore?: ResolutionStore;
  readonly sessionSink?: SessionPolicySink;
  readonly modeSink?: ModePolicySink;
}

export interface RegisterPolicyPackInput extends CreatePolicyPackInput {
  /** Optional registration-time feasibility check against these escalation modes. */
  readonly escalationModes?: readonly string[];
  readonly actor?: string;
}

/** The closed registration outcome vocabulary. */
export const REGISTRATION_OUTCOMES = Object.freeze(['registered', 'rejected'] as const);
export type RegistrationOutcome = (typeof REGISTRATION_OUTCOMES)[number];

export interface RegisterPolicyPackResult {
  readonly outcome: RegistrationOutcome;
  readonly packRef: { readonly packId: string; readonly version: number } | null;
  readonly validation: PolicyPackValidation;
}

export interface ResolveEffectivePolicyInput {
  readonly requestId: string;
  readonly tenantId: string;
  /** Explicit pack family selector (default: the tenant's latest registered family). */
  readonly packId?: string;
  readonly now?: number | string | Date;
  readonly actor?: string;
}

export interface RetentionSweepResult {
  readonly tenantId: string;
  readonly asOf: string;
  readonly transitions: readonly { subjectId: string; from: string; to: string }[];
}

export interface ErasureRequestInput {
  readonly subjectId: string;
  readonly tenantId: string;
  readonly requestId: string;
  readonly now?: number | string | Date;
}

export interface WithdrawalRequestInput extends ErasureRequestInput {
  /** Withdrawal carries the same fields as erasure (kept explicit for the API surface). */
  readonly kind?: 'expert-withdrawal';
}

export interface DispositionExecutionInput {
  readonly subjectId: string;
  readonly tenantId: string;
  readonly now?: number | string | Date;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ExpertSessionPolicyService {
  private readonly clock: Clock;
  private readonly escalationPort: EscalationPolicyPort;
  private readonly packStore: PolicyPackStore;
  private readonly authorizationStore: CrossTenantAuthorizationStore;
  private readonly retentionLedger: RetentionLedger;
  private readonly resolutionStore: ResolutionStore;
  private readonly sessionSink: SessionPolicySink;
  private readonly modeSink: ModePolicySink;
  private readonly auditLog = new PolicyAuditLog();

  constructor(config: ExpertSessionPolicyServiceConfig = {}) {
    this.clock = config.clock ?? { now: () => 0 };
    this.escalationPort = config.escalationPort ?? new InMemoryEscalationPolicyPort();
    this.packStore = config.packStore ?? new InMemoryPolicyPackStore();
    this.authorizationStore = config.authorizationStore ?? new InMemoryCrossTenantAuthorizationStore();
    this.retentionLedger = config.retentionLedger ?? new InMemoryRetentionLedger();
    this.resolutionStore = config.resolutionStore ?? new InMemoryResolutionStore();
    this.sessionSink = config.sessionSink ?? new ReferenceSessionPolicySink();
    this.modeSink = config.modeSink ?? new ReferenceModePolicySink();
  }

  private now(input: { readonly now?: number | string | Date | undefined }): number {
    return input.now !== undefined ? this.coerceMs(input.now) : this.clock.now();
  }

  private coerceMs(value: number | string | Date): number {
    const ms = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value);
    if (!Number.isFinite(ms)) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
        message: `invalid timestamp: ${JSON.stringify(value)}`,
      });
    }
    return ms;
  }

  private async audit(
    kind: PolicyAuditEvent['kind'],
    input: {
      tenantId: string | null;
      action: string;
      effect: 'allow' | 'deny' | 'recorded';
      reason: string;
      correlationId: string;
      principalId?: string | undefined;
      causationId?: string | null | undefined;
      occurredAt: string;
    },
  ): Promise<void> {
    await this.auditLog.append({
      recordVersion: 1,
      eventId: randomUUID(),
      kind,
      tenantId: input.tenantId,
      principalId: input.principalId ?? null,
      action: input.action,
      boundaryClass: 'environments',
      outcome: { effect: input.effect, reason: input.reason },
      correlationId: input.correlationId as PolicyAuditEvent['correlationId'],
      causationId: input.causationId ?? null,
      occurredAt: input.occurredAt,
    });
  }

  // -------------------------------------------------------------------------
  // Pack registration + reads
  // -------------------------------------------------------------------------

  /** Register a pack version. Rejected packs are audited and NOT stored. */
  async registerPolicyPack(input: RegisterPolicyPackInput): Promise<RegisterPolicyPackResult> {
    const nowIso = new Date(this.now({ now: input.now })).toISOString();
    const packRef = { packId: input.packId, version: input.version };
    const composition = validateAndComposeControls(input.controls);
    if ('conflicts' in composition) {
      const validation = {
        outcome: 'conflicting-controls' as const,
        packRef,
        conflictingControls: composition.conflicts,
      };
      await this.audit('pack-rejected', {
        tenantId: input.tenantId,
        action: 'register-policy-pack',
        effect: 'deny',
        reason: 'conflicting-controls',
        correlationId: `pack-${input.packId}-v${String(input.version)}`,
        principalId: input.actor,
        occurredAt: nowIso,
      });
      return { outcome: 'rejected', packRef, validation };
    }
    if (input.escalationModes !== undefined) {
      const feasibility = checkAllowlistFeasibility(composition.composed.actionAllowlist, input.escalationModes);
      if (!feasibility.feasible) {
        const validation = {
          outcome: 'infeasible-for-session-modes' as const,
          packRef,
          infeasibleModes: feasibility.infeasibleModes,
        };
        await this.audit('pack-rejected', {
          tenantId: input.tenantId,
          action: 'register-policy-pack',
          effect: 'deny',
          reason: 'infeasible-for-session-modes',
          principalId: input.actor,
          correlationId: `pack-${input.packId}-v${String(input.version)}`,
          occurredAt: nowIso,
        });
        return { outcome: 'rejected', packRef, validation };
      }
    }
    const pack = createPolicyPack(input);
    await this.packStore.insert(pack);
    await this.audit('pack-registered', {
      tenantId: pack.tenantId,
      action: 'register-policy-pack',
      effect: 'allow',
      reason: 'pack-valid',
      correlationId: `pack-${pack.packId}-v${String(pack.version)}`,
      principalId: input.actor,
      occurredAt: pack.createdAt,
    });
    return {
      outcome: 'registered',
      packRef: { packId: pack.packId, version: pack.version },
      validation: { outcome: 'valid' as const, packRef: { packId: pack.packId, version: pack.version } },
    };
  }

  /** Tenant-scoped pack read. Cross-tenant reads fail closed (typed). */
  async getPolicyPack(input: {
    packId: string;
    tenantId: string;
    version?: number;
  }): Promise<PolicyPack> {
    const pack =
      input.version !== undefined
        ? await this.packStore.get(input.packId, input.version, input.tenantId)
        : await this.packStore.latest(input.packId, input.tenantId);
    if (pack !== undefined) return pack;
    const unscoped =
      input.version !== undefined
        ? await this.packStore.findById(input.packId, input.version)
        : (await this.packStore.latest(input.packId, input.tenantId)) === undefined
          ? await this.findLatestUnscoped(input.packId)
          : undefined;
    if (unscoped !== undefined) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY', {
        message: `pack '${input.packId}' belongs to tenant '${unscoped.tenantId}' (cross-tenant pack reads require explicit typed authorization)`,
        details: { packId: input.packId, tenantId: input.tenantId, ownerTenantId: unscoped.tenantId },
      });
    }
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: `unknown policy pack '${input.packId}' for tenant '${input.tenantId}'`,
      details: { packId: input.packId, tenantId: input.tenantId },
    });
  }

  private async findLatestUnscoped(packId: string): Promise<PolicyPack | undefined> {
    for (let version = 1; version < 1000; version += 1) {
      const found = await this.packStore.findById(packId, version);
      if (found === undefined) continue;
      const next = await this.packStore.findById(packId, version + 1);
      if (next === undefined) return found;
    }
    return undefined;
  }

  /** Grant (or revoke) explicit cross-tenant pack reuse. */
  async grantCrossTenantPackReuse(input: {
    authorizationId: string;
    packId: string;
    packVersion: number;
    sourceTenantId: string;
    consumingTenantId: string;
    expiresAt?: number | string | Date | null | undefined;
    now?: number | string | Date | undefined;
  }): Promise<void> {
    const { createCrossTenantPackAuthorization } = await import('@arena/expert-session-policy');
    const authorization = createCrossTenantPackAuthorization({
      authorizationId: input.authorizationId,
      packId: input.packId,
      packVersion: input.packVersion,
      sourceTenantId: input.sourceTenantId,
      consumingTenantId: input.consumingTenantId,
      now: this.now({ now: input.now }),
      expiresAt: input.expiresAt ?? null,
    });
    await this.authorizationStore.insert(authorization);
    await this.audit('cross-tenant-pack-authorized', {
      tenantId: input.consumingTenantId,
      action: 'grant-cross-tenant-pack-reuse',
      effect: 'allow',
      reason: 'authorized',
      correlationId: input.authorizationId,
      occurredAt: authorization.grantedAt,
    });
  }

  // -------------------------------------------------------------------------
  // Effective policy resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve the effective session policy for an escalation and hand it to
   * the C006 session builder + C007 mode guards through the injected
   * sinks. A request's governing pack is PINNED on first resolution; a
   * re-resolution with a DIFFERENT pack (the version-swap / retention-
   * bypass adversarial) is the typed RESOLUTION_CONFLICT failure.
   */
  async resolveEffectivePolicy(input: ResolveEffectivePolicyInput): Promise<EffectiveSessionPolicy> {
    const nowIso = new Date(this.now({ now: input.now })).toISOString();
    const correlationId = `resolve-${input.requestId}`;
    try {
      const escalation = await this.loadEscalation(input.requestId, input.tenantId);
      const pinned = await this.resolutionStore.findByRequest(input.requestId, input.tenantId);
      const pack = await this.selectPack(escalation, input.packId, input.tenantId);
      if (pinned !== undefined && pack !== null) {
        const pinnedRef = pinned.packRef;
        if (
          pinnedRef !== null &&
          (pinnedRef.packId !== pack.packId || pinnedRef.version !== pack.version)
        ) {
          throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_RESOLUTION_CONFLICT', {
            message: `escalation ${input.requestId} is already governed by pack '${pinnedRef.packId}' v${String(pinnedRef.version)}; resolving against '${pack.packId}' v${String(pack.version)} is a typed conflict (a request's governing policy never silently swaps — the retention/version-swap bypass is closed)`,
            details: { requestId: input.requestId, pinned: pinnedRef, requested: { packId: pack.packId, version: pack.version } },
          });
        }
      }
      const authorization =
        pack !== null && pack.tenantId !== escalation.request.tenantId
          ? await this.authorizationStore.find(pack.packId, pack.version, escalation.request.tenantId)
          : null;
      if (pack !== null && pack.tenantId !== escalation.request.tenantId && authorization !== null) {
        await this.audit('cross-tenant-pack-authorized', {
          tenantId: escalation.request.tenantId,
          action: 'resolve-effective-policy',
          effect: 'allow',
          reason: 'authorized',
          correlationId,
          occurredAt: nowIso,
        });
      }
      const resolutionId = `resolution-${randomUUID().slice(0, 8)}`;
      const policy = resolveEffectiveSessionPolicy({
        resolutionId,
        escalation,
        pack,
        ...(authorization !== null && authorization !== undefined
          ? { crossTenantAuthorization: authorization }
          : {}),
        now: nowIso,
      });
      if (pinned === undefined) {
        await this.resolutionStore.insert({
          recordVersion: 1,
          resolutionId: policy.resolutionId,
          requestId: escalation.request.requestId,
          tenantId: escalation.request.tenantId,
          packRef: policy.packRef,
          policy,
          createdAt: nowIso,
        });
        await this.createRetentionSubjects(policy, escalation);
      }
      await this.sessionSink.receiveEffectivePolicy(policy);
      await this.modeSink.receiveEffectivePolicy(policy);
      await this.audit('policy-resolved', {
        tenantId: policy.tenantId,
        action: 'resolve-effective-policy',
        effect: 'allow',
        reason: policy.packRef !== null ? 'pack-applied' : 'request-baseline',
        correlationId,
        principalId: input.actor,
        occurredAt: nowIso,
      });
      return policy;
    } catch (error) {
      const reason =
        error instanceof ExpertSessionPolicyError ? error.code : 'EXPERT_SESSION_POLICY_UNKNOWN_ERROR';
      await this.audit('resolution-denied', {
        tenantId: input.tenantId,
        action: 'resolve-effective-policy',
        effect: 'deny',
        reason,
        correlationId,
        principalId: input.actor,
        occurredAt: nowIso,
      });
      throw error;
    }
  }

  private async loadEscalation(requestId: string, tenantId: string): Promise<EscalationRecord> {
    const record = await this.escalationPort.get(requestId, tenantId);
    if (record !== undefined) return record;
    const unscoped = await this.escalationPort.findById(requestId);
    if (unscoped !== undefined) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY', {
        message: `escalation ${requestId} belongs to another tenant`,
        details: { requestId, tenantId },
      });
    }
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: `unknown escalation request: ${requestId}`,
      details: { requestId, tenantId },
    });
  }

  private async selectPack(
    escalation: EscalationRecord,
    packId: string | undefined,
    tenantId: string,
  ): Promise<PolicyPack | null> {
    if (packId !== undefined) {
      // Resolution may address a FOREIGN pack family explicitly — the
      // typed cross-tenant authorization check happens inside
      // resolveEffectiveSessionPolicy (fail-closed), while the plain READ
      // surface (getPolicyPack) stays tenant-scoped.
      const scoped = await this.packStore.latest(packId, tenantId);
      if (scoped !== undefined) return scoped;
      const foreign = await this.findLatestUnscoped(packId);
      if (foreign !== undefined) return foreign;
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
        message: `unknown policy pack '${packId}' (no tenant-scoped or authorized foreign family)`,
        details: { packId, tenantId },
      });
    }
    const family = await this.packStore.latestFamily(escalation.request.tenantId);
    return family ?? null;
  }

  private async createRetentionSubjects(
    policy: EffectiveSessionPolicy,
    escalation: EscalationRecord,
  ): Promise<void> {
    if (policy.retention === null) return;
    for (const entry of policy.retention.entries) {
      const subject = createRetentionSubject({
        subjectId: `ret-${escalation.request.requestId}-${entry.artifactClass}`,
        tenantId: policy.tenantId,
        requestId: escalation.request.requestId,
        artifactClass: entry.artifactClass,
        entry,
        now: policy.resolvedAt,
      });
      await this.retentionLedger.insert(subject);
      await this.audit('retention-transition', {
        tenantId: subject.tenantId,
        action: 'create-retention-subject',
        effect: 'recorded',
        reason: `scheduled:${entry.artifactClass}`,
        correlationId: `retention-${escalation.request.requestId}`,
        occurredAt: subject.recordedAt,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Retention engine
  // -------------------------------------------------------------------------

  /** Expiry sweep: every due RETAIN subject moves to its target disposition. */
  async advanceRetention(input: { tenantId: string; asOf?: number | string | Date | undefined }): Promise<RetentionSweepResult> {
    const asOf = new Date(this.now({ now: input.asOf })).toISOString();
    const subjects = await this.retentionLedger.listForTenant(input.tenantId);
    const transitions: { subjectId: string; from: string; to: string }[] = [];
    for (const subject of subjects) {
      const verdict = evaluateRetentionExpiry(subject, asOf);
      if (verdict.outcome !== 'disposition-due') continue;
      const to = subject.targetDisposition === 'ANONYMIZE' ? 'ANONYMIZE' : 'DELETE_PENDING';
      const next = applyDispositionTransition(subject, { to, reason: 'retention-expiry', now: asOf });
      await this.retentionLedger.update(next);
      transitions.push({ subjectId: subject.subjectId, from: subject.state, to });
      await this.audit('retention-transition', {
        tenantId: subject.tenantId,
        action: 'advance-retention',
        effect: 'recorded',
        reason: `retention-expiry:${subject.artifactClass}`,
        correlationId: `retention-${subject.subjectId}`,
        occurredAt: asOf,
      });
    }
    return { tenantId: input.tenantId, asOf, transitions: Object.freeze(transitions) };
  }

  /** Customer erasure request (explicit state machine; double-spend safe). */
  async requestCustomerErasure(input: ErasureRequestInput): Promise<ReturnType<typeof requestErasure>> {
    const subject = await this.loadSubject(input.subjectId, input.tenantId);
    const nowIso = new Date(this.now({ now: input.now })).toISOString();
    const verdict = requestErasure(subject, { requestId: input.requestId, now: nowIso });
    if (verdict.outcome === 'erasure-scheduled') {
      await this.retentionLedger.update(verdict.subject);
      await this.audit('retention-transition', {
        tenantId: subject.tenantId,
        action: 'request-customer-erasure',
        effect: 'recorded',
        reason: 'customer-erasure',
        correlationId: `erasure-${input.requestId}`,
        occurredAt: nowIso,
      });
    } else {
      await this.audit('retention-duplicate', {
        tenantId: subject.tenantId,
        action: 'request-customer-erasure',
        effect: 'deny',
        reason: 'duplicate-erasure-request',
        correlationId: `erasure-${input.requestId}`,
        occurredAt: nowIso,
      });
    }
    return verdict;
  }

  /** Expert withdrawal request (explicit state machine). */
  async requestExpertWithdrawal(input: WithdrawalRequestInput): Promise<ReturnType<typeof requestWithdrawal>> {
    const subject = await this.loadSubject(input.subjectId, input.tenantId);
    const nowIso = new Date(this.now({ now: input.now })).toISOString();
    const verdict = requestWithdrawal(subject, { requestId: input.requestId, now: nowIso });
    if (verdict.outcome === 'withdrawal-applied') {
      await this.retentionLedger.update(verdict.subject);
      await this.audit('retention-transition', {
        tenantId: subject.tenantId,
        action: 'request-expert-withdrawal',
        effect: 'recorded',
        reason: 'expert-withdrawal',
        correlationId: `withdrawal-${input.requestId}`,
        occurredAt: nowIso,
      });
    } else {
      await this.audit('retention-rejected', {
        tenantId: subject.tenantId,
        action: 'request-expert-withdrawal',
        effect: 'deny',
        reason: 'withdrawal-rejected',
        correlationId: `withdrawal-${input.requestId}`,
        occurredAt: nowIso,
      });
    }
    return verdict;
  }

  /** Execute the terminal deletion (DELETE_PENDING → DELETED). */
  async executeDisposition(input: DispositionExecutionInput): Promise<RetentionSubject> {
    const subject = await this.loadSubject(input.subjectId, input.tenantId);
    const nowIso = new Date(this.now({ now: input.now })).toISOString();
    const next = executeDispositionTransition(subject, nowIso);
    await this.retentionLedger.update(next);
    await this.audit('retention-transition', {
      tenantId: subject.tenantId,
      action: 'execute-disposition',
      effect: 'recorded',
      reason: 'disposition-executed',
      correlationId: `retention-${subject.subjectId}`,
      occurredAt: nowIso,
    });
    return next;
  }

  /** Tenant-scoped retention subject read (cross-tenant reads fail closed). */
  async getRetentionSubject(subjectId: string, tenantId: string): Promise<RetentionSubject> {
    return this.loadSubject(subjectId, tenantId);
  }

  private async loadSubject(subjectId: string, tenantId: string): Promise<RetentionSubject> {
    const subject = await this.retentionLedger.get(subjectId, tenantId);
    if (subject !== undefined) return subject;
    const unscoped = await this.retentionLedger.findById(subjectId);
    if (unscoped !== undefined) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY', {
        message: `retention subject '${subjectId}' belongs to another tenant`,
        details: { subjectId, tenantId, ownerTenantId: unscoped.tenantId },
      });
    }
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: `unknown retention subject: ${subjectId}`,
      details: { subjectId, tenantId },
    });
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  /** The audit snapshot (append-only history retained after deletion). */
  auditTrail(): PolicyAuditSnapshot {
    return this.auditLog.snapshot();
  }

  /** Recompute and verify the whole audit chain (tamper-evident). */
  async verifyAuditTrail(): Promise<PolicyAuditSnapshot> {
    return this.auditLog.verify();
  }
}
