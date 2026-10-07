/**
 * In-memory reference fabric for the expert-session-policy service (Work
 * Order C018) — the services-layer house pattern (A013/A015/C001/C006):
 * injected ports with an in-process, zero-external-dependency reference
 * implementation. Hosts swap the fabric for real persistence
 * (adapters/*, never here).
 *
 *   - InMemoryPolicyPackStore — tenant-scoped packs with duplicate /
 *     version-regression detection and latest-family selection;
 *   - InMemoryCrossTenantAuthorizationStore — explicit reuse grants;
 *   - InMemoryRetentionLedger — tenant-scoped retention subjects;
 *   - InMemoryEscalationPolicyPort — the C001 seam over plain
 *     @arena/escalation records (pure delegation);
 *   - InMemoryResolutionStore — the request → pack pinning;
 *   - ReferenceSessionPolicySink / ReferenceModePolicySink — THE C006 /
 *     C007 SEAMS, clearly-labelled REFERENCE implementations that prove
 *     the resolved policy is directly consumable by the merged
 *     dependency surfaces: the session sink re-derives the barrier with
 *     C006's own composePrivacyBarrier and checks the capsule floor,
 *     the mode sink runs C007's checkModeAuthorization for every
 *     permitted escalation mode. Enforcement stays theirs; resolution
 *     only hands the policy over.
 */

import type { EscalationRecord } from '@arena/escalation';
import { checkModeAuthorization } from '@arena/intervention';
import { composePrivacyBarrier } from '@arena/expert-session';
import type {
  CrossTenantPackAuthorization,
  EffectiveSessionPolicy,
  PolicyPack,
  RetentionSubject,
} from '@arena/expert-session-policy';
import { ExpertSessionPolicyError } from '@arena/expert-session-policy';
import type {
  CrossTenantAuthorizationStore,
  EscalationPolicyPort,
  ModePolicySink,
  PolicyPackStore,
  PolicyResolutionRecord,
  ResolutionStore,
  RetentionLedger,
  SessionPolicySink,
} from './ports.js';

// ---------------------------------------------------------------------------
// Pack store
// ---------------------------------------------------------------------------

export class InMemoryPolicyPackStore implements PolicyPackStore {
  private readonly byKey = new Map<string, PolicyPack>();
  private readonly order: PolicyPack[] = [];

  async insert(pack: PolicyPack): Promise<void> {
    const key = `${pack.tenantId}:${pack.packId}:${String(pack.version)}`;
    if (this.byKey.has(key)) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_RESOLUTION_CONFLICT', {
        message: `pack '${pack.packId}' v${String(pack.version)} is already registered for tenant '${pack.tenantId}' (duplicate registration)`,
        details: { packId: pack.packId, version: pack.version, tenantId: pack.tenantId },
      });
    }
    const latest = await this.latest(pack.packId, pack.tenantId);
    if (latest !== undefined && pack.version <= latest.version) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_RESOLUTION_CONFLICT', {
        message: `pack '${pack.packId}' v${String(pack.version)} regresses behind the registered latest v${String(latest.version)} (versions are monotonically increasing)`,
        details: { packId: pack.packId, version: pack.version, latestVersion: latest.version },
      });
    }
    this.byKey.set(key, pack);
    this.order.push(pack);
  }

  async get(packId: string, version: number, tenantId: string): Promise<PolicyPack | undefined> {
    const pack = this.byKey.get(`${tenantId}:${packId}:${String(version)}`);
    return pack;
  }

  async latest(packId: string, tenantId: string): Promise<PolicyPack | undefined> {
    let found: PolicyPack | undefined;
    for (const pack of this.order) {
      if (pack.tenantId === tenantId && pack.packId === packId && (found === undefined || pack.version > found.version)) {
        found = pack;
      }
    }
    return found;
  }

  async findById(packId: string, version: number): Promise<PolicyPack | undefined> {
    for (const pack of this.order) {
      if (pack.packId === packId && pack.version === version) return pack;
    }
    return undefined;
  }

  async latestFamily(tenantId: string): Promise<PolicyPack | undefined> {
    for (let index = this.order.length - 1; index >= 0; index -= 1) {
      const pack = this.order[index];
      if (pack !== undefined && pack.tenantId === tenantId) return pack;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Cross-tenant authorization store
// ---------------------------------------------------------------------------

export class InMemoryCrossTenantAuthorizationStore implements CrossTenantAuthorizationStore {
  private readonly byKey = new Map<string, CrossTenantPackAuthorization>();

  async insert(authorization: CrossTenantPackAuthorization): Promise<void> {
    const key = `${authorization.consumingTenantId}:${authorization.packId}:${String(authorization.packVersion)}`;
    this.byKey.set(key, authorization);
  }

  async find(
    packId: string,
    packVersion: number,
    consumingTenantId: string,
  ): Promise<CrossTenantPackAuthorization | undefined> {
    return this.byKey.get(`${consumingTenantId}:${packId}:${String(packVersion)}`);
  }
}

// ---------------------------------------------------------------------------
// Retention ledger
// ---------------------------------------------------------------------------

export class InMemoryRetentionLedger implements RetentionLedger {
  private readonly bySubjectId = new Map<string, RetentionSubject>();

  async insert(subject: RetentionSubject): Promise<void> {
    if (this.bySubjectId.has(subject.subjectId)) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
        message: `duplicate retention subject id: ${subject.subjectId}`,
      });
    }
    this.bySubjectId.set(subject.subjectId, subject);
  }

  async update(subject: RetentionSubject): Promise<void> {
    if (!this.bySubjectId.has(subject.subjectId)) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
        message: `unknown retention subject id: ${subject.subjectId}`,
      });
    }
    this.bySubjectId.set(subject.subjectId, subject);
  }

  async get(subjectId: string, tenantId: string): Promise<RetentionSubject | undefined> {
    const subject = this.bySubjectId.get(subjectId);
    if (subject === undefined || subject.tenantId !== tenantId) return undefined;
    return subject;
  }

  async findById(subjectId: string): Promise<RetentionSubject | undefined> {
    return this.bySubjectId.get(subjectId);
  }

  async listByRequest(requestId: string, tenantId: string): Promise<readonly RetentionSubject[]> {
    return [...this.bySubjectId.values()].filter(
      (subject) => subject.tenantId === tenantId && subject.requestId === requestId,
    );
  }

  async listForTenant(tenantId: string): Promise<readonly RetentionSubject[]> {
    return [...this.bySubjectId.values()].filter((subject) => subject.tenantId === tenantId);
  }
}

// ---------------------------------------------------------------------------
// C001 escalation seam
// ---------------------------------------------------------------------------

export class InMemoryEscalationPolicyPort implements EscalationPolicyPort {
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
}

// ---------------------------------------------------------------------------
// Resolution store (request → pack pinning)
// ---------------------------------------------------------------------------

export class InMemoryResolutionStore implements ResolutionStore {
  private readonly byKey = new Map<string, PolicyResolutionRecord>();

  async insert(record: PolicyResolutionRecord): Promise<void> {
    const key = `${record.tenantId}:${record.requestId}`;
    if (this.byKey.has(key)) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_RESOLUTION_CONFLICT', {
        message: `escalation ${record.requestId} already has a pinned policy resolution`,
        details: { requestId: record.requestId, tenantId: record.tenantId },
      });
    }
    this.byKey.set(key, record);
  }

  async findByRequest(requestId: string, tenantId: string): Promise<PolicyResolutionRecord | undefined> {
    return this.byKey.get(`${tenantId}:${requestId}`);
  }
}

// ---------------------------------------------------------------------------
// THE C006 / C007 SEAMS — reference sinks (clearly labelled)
// ---------------------------------------------------------------------------

/**
 * REFERENCE C006 sink — proves the resolved effective policy is directly
 * consumable by the expert-session builder: the barrier is re-derived
 * with C006's own composePrivacyBarrier (fail-closed) and the floor
 * observation action is verified present. Production wiring hands the
 * policy to services/expert-session's capsule materializer through the
 * host's adapter (never edited from this work order).
 */
export class ReferenceSessionPolicySink implements SessionPolicySink {
  private readonly received: EffectiveSessionPolicy[] = [];

  async receiveEffectivePolicy(policy: EffectiveSessionPolicy): Promise<void> {
    // Fail-closed consumption proof: the policy must rebuild cleanly
    // through C006's own composition surface.
    const barrier = composePrivacyBarrier({
      tenantId: policy.tenantId,
      redactedFields: policy.barrier.redactedFields,
      redactedDocuments: policy.barrier.redactedDocuments,
      excludedTools: policy.barrier.excludedTools,
      identityMasking: policy.barrier.identityMasking,
      timeLimitedCredentials: policy.barrier.credentials.timeLimited,
      credentialsExpiresAt: policy.barrier.credentials.expiresAt ?? policy.resolvedAt,
      readOnlyResources: policy.barrier.readOnlyResources,
      actionAllowlist: policy.barrier.actionAllowlist,
      restrictions: policy.barrier.restrictions,
    });
    if (!barrier.actionAllowlist.includes('observe-state')) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INFEASIBLE_MODES', {
        message: 'the effective policy violates the EES1.0 observation floor (observe-state is not allowlisted)',
      });
    }
    this.received.push(policy);
  }

  /** Policies handed to the C006 seam so far (test surface). */
  receivedPolicies(): readonly EffectiveSessionPolicy[] {
    return Object.freeze([...this.received]);
  }
}

/**
 * REFERENCE C007 sink — proves the resolved effective policy is directly
 * consumable by the intervention mode guards: every permitted escalation
 * mode passes C007's own checkModeAuthorization against the request's
 * declared environment session mode.
 */
export class ReferenceModePolicySink implements ModePolicySink {
  private readonly received: EffectiveSessionPolicy[] = [];

  async receiveEffectivePolicy(policy: EffectiveSessionPolicy): Promise<void> {
    for (const mode of policy.permittedEscalationModes) {
      const verdict = checkModeAuthorization(
        { escalationModes: policy.permittedEscalationModes },
        mode,
      );
      if (!verdict.allowed) {
        throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INFEASIBLE_MODES', {
          message: `escalation mode '${mode}' fails the C007 mode guard for the resolved policy (${verdict.reason})`,
          details: { mode, reason: verdict.reason },
        });
      }
    }
    this.received.push(policy);
  }

  /** Policies handed to the C007 seam so far (test surface). */
  receivedPolicies(): readonly EffectiveSessionPolicy[] {
    return Object.freeze([...this.received]);
  }
}
