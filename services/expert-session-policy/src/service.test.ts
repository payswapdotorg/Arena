/**
 * ExpertSessionPolicyService integration + adversarial tests (Work Order
 * C018 acceptance): resolution over injected C006/C007 ports on the
 * reference fabric; packs weakening the tenant boundary or re-admitting
 * excluded secrets fail closed; retention bypass via conflicting pack
 * versions; cross-tenant policy reads; deletion double-spend.
 */

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EscalationRecord } from '@arena/escalation';
import type { PolicyPack } from '@arena/expert-session-policy';
import { ExpertSessionPolicyError } from '@arena/expert-session-policy';
import { TENANT_A, TENANT_B, T0, T1, T2, makeDataRights, validControls, validRetentionSchedule } from '@arena/expert-session-policy';
import { ExpertSessionPolicyService } from './service.js';
import {
  InMemoryEscalationPolicyPort,
  ReferenceModePolicySink,
  ReferenceSessionPolicySink,
} from './fabric.js';
import { createPolicyPack, validEscalationRecord, validPolicyPack } from '@arena/expert-session-policy';

async function fixture(overrides: { escalation?: Partial<Parameters<typeof validEscalationRecord>[0]> } = {}) {
  const escalation = await validEscalationRecord(overrides.escalation as never);
  const port = new InMemoryEscalationPolicyPort();
  await port.seed(escalation);
  const sessionSink = new ReferenceSessionPolicySink();
  const modeSink = new ReferenceModePolicySink();
  const service = new ExpertSessionPolicyService({
    clock: { now: () => Date.parse(T0) },
    escalationPort: port,
    sessionSink,
    modeSink,
  });
  return { escalation, service, sessionSink, modeSink };
}

async function registerPack(service: ExpertSessionPolicyService, pack: PolicyPack): Promise<void> {
  await service.registerPolicyPack({
    packId: pack.packId,
    version: pack.version,
    tenantId: pack.tenantId,
    displayName: pack.displayName,
    description: pack.description,
    controls: pack.controls as unknown as readonly unknown[],
    retention: pack.retention,
    dataRights: pack.dataRights,
    jurisdictions: [...pack.jurisdictions],
    residencyRegions: [...pack.residencyRegions],
    now: pack.createdAt,
  });
}

describe('pack registration (typed closed verdicts)', () => {
  it('registers a valid pack; the audit trail records it', async () => {
    const { service } = await fixture();
    const pack = await validPolicyPack();
    const result = await service.registerPolicyPack({
      packId: pack.packId,
      version: 1,
      tenantId: TENANT_A,
      displayName: pack.displayName,
      controls: pack.controls as unknown as readonly unknown[],
      retention: validRetentionSchedule(),
      dataRights: makeDataRights(TENANT_A, T0),
      now: T0,
    });
    expect(result.outcome).toBe('registered');
    expect(result.validation.outcome).toBe('valid');
    const kinds = service.auditTrail().records.map((record) => record.payload.kind);
    expect(kinds).toContain('pack-registered');
  });

  it('REJECTS a weakening pack (un-restricted export channel) with reasons and never stores it', async () => {
    const { service } = await fixture();
    const result = await service.registerPolicyPack({
      packId: 'pack-weakening',
      version: 1,
      tenantId: TENANT_A,
      displayName: 'weakening pack',
      controls: [
        { controlVersion: 1, kind: 'clipboard-restriction', tenantId: TENANT_A, payload: { kind: 'clipboard-restriction', restricted: false } },
      ],
      retention: validRetentionSchedule(),
      dataRights: makeDataRights(TENANT_A, T0),
      now: T0,
    });
    expect(result.outcome).toBe('rejected');
    expect(result.validation.outcome).toBe('conflicting-controls');
    await expect(service.getPolicyPack({ packId: 'pack-weakening', tenantId: TENANT_A })).rejects.toBeInstanceOf(
      ExpertSessionPolicyError,
    );
    const kinds = service.auditTrail().records.map((record) => record.payload.kind);
    expect(kinds).toContain('pack-rejected');
  });

  it('duplicate registration and version regression are typed conflicts', async () => {
    const { service } = await fixture();
    const pack = await validPolicyPack();
    await registerPack(service, pack);
    await expect(
      service.registerPolicyPack({
        packId: pack.packId,
        version: 1,
        tenantId: TENANT_A,
        displayName: pack.displayName,
        controls: pack.controls as unknown as readonly unknown[],
        retention: pack.retention,
        dataRights: pack.dataRights,
        now: T1,
      }),
    ).rejects.toMatchObject({ code: 'EXPERT_SESSION_POLICY_RESOLUTION_CONFLICT' });
    await expect(
      service.registerPolicyPack({
        packId: pack.packId,
        version: 1,
        tenantId: TENANT_A,
        displayName: pack.displayName,
        controls: [],
        retention: pack.retention,
        dataRights: pack.dataRights,
        now: T1,
      }),
    ).resolves.toMatchObject({ outcome: 'rejected', validation: { outcome: 'conflicting-controls' } });
  });
});

describe('resolution over injected C006/C007 ports (reference fabric)', () => {
  it('resolves a pack-governed policy and HANDS it to both seams', async () => {
    const { escalation, service, sessionSink, modeSink } = await fixture();
    await registerPack(service, await validPolicyPack());
    const policy = await service.resolveEffectivePolicy({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
    });
    expect(policy.packRef).toEqual({ packId: 'pack-enterprise-eu', version: 1 });
    expect(sessionSink.receivedPolicies().length).toBe(1);
    expect(modeSink.receivedPolicies().length).toBe(1);
    // Retention subjects were created for all four artifact classes.
    for (const artifactClass of ['session-transcript', 'observation-stream', 'artifacts', 'annotations'] as const) {
      const subject = await service.getRetentionSubject(
        `ret-${escalation.request.requestId}-${artifactClass}`,
        TENANT_A,
      );
      expect(subject.state).toBe('RETAIN');
    }
    const kinds = service.auditTrail().records.map((record) => record.payload.kind);
    expect(kinds).toContain('policy-resolved');
    expect(kinds.filter((kind) => kind === 'retention-transition').length).toBe(4);
  });

  it('re-resolution is IDEMPOTENT (same pack, same policy handed over again)', async () => {
    const { escalation, service } = await fixture();
    await registerPack(service, await validPolicyPack());
    const first = await service.resolveEffectivePolicy({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
    });
    const second = await service.resolveEffectivePolicy({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
    });
    expect(second.packRef).toEqual(first.packRef);
  });

  it('resolves request-fields-only when the tenant has no pack', async () => {
    const { escalation, service } = await fixture();
    const policy = await service.resolveEffectivePolicy({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
    });
    expect(policy.packRef).toBeNull();
    expect(policy.retention).toBeNull();
  });

  it('unknown escalation and cross-tenant escalation reads fail closed (typed + audited)', async () => {
    const { escalation, service } = await fixture();
    await expect(
      service.resolveEffectivePolicy({ requestId: 'esc_unknown', tenantId: TENANT_A }),
    ).rejects.toMatchObject({ code: 'EXPERT_SESSION_POLICY_INVALID_REQUEST' });
    await expect(
      service.resolveEffectivePolicy({ requestId: escalation.request.requestId, tenantId: TENANT_B }),
    ).rejects.toMatchObject({ code: 'EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY' });
    const kinds = service.auditTrail().records.map((record) => record.payload.kind);
    expect(kinds.filter((kind) => kind === 'resolution-denied').length).toBe(2);
  });
});

describe('adversarial: cross-tenant pack reads and reuse', () => {
  it('reading another tenant\'s pack is a typed CROSS_TENANT_POLICY failure (no leak)', async () => {
    const { service } = await fixture();
    await registerPack(service, await validPolicyPack({ tenantId: TENANT_A }));
    await expect(service.getPolicyPack({ packId: 'pack-enterprise-eu', tenantId: TENANT_B })).rejects.toMatchObject({
      code: 'EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY',
    });
  });

  it('resolving a foreign pack WITHOUT a grant fails closed; WITH a valid grant it resolves (boundary stays the request tenant)', async () => {
    const { escalation, service } = await fixture();
    await registerPack(service, await validPolicyPack({ tenantId: TENANT_B, packId: 'pack-beta' }));
    await expect(
      service.resolveEffectivePolicy({
        requestId: escalation.request.requestId,
        tenantId: TENANT_A,
        packId: 'pack-beta',
      }),
    ).rejects.toMatchObject({ code: 'EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY' });
    await service.grantCrossTenantPackReuse({
      authorizationId: 'auth-0001',
      packId: 'pack-beta',
      packVersion: 1,
      sourceTenantId: TENANT_B,
      consumingTenantId: TENANT_A,
      now: T0,
    });
    const policy = await service.resolveEffectivePolicy({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      packId: 'pack-beta',
    });
    expect(policy.crossTenantAuthorizationId).toBe('auth-0001');
    expect(policy.barrier.tenantBoundary.tenantId).toBe(TENANT_A);
  });
});

describe('adversarial: retention bypass via conflicting pack versions', () => {
  it('a request pinned to pack v1 CANNOT be re-resolved against v2 (typed conflict)', async () => {
    const { escalation, service } = await fixture();
    await registerPack(service, await validPolicyPack({ version: 1 }));
    await service.resolveEffectivePolicy({ requestId: escalation.request.requestId, tenantId: TENANT_A });
    // v2 drops the tool-exclusion control — the secret re-admission attempt.
    const weakerControls = validControls(TENANT_A).filter(
      (control) => (control as { kind: string }).kind !== 'tool-exclusion',
    );
    await registerPack(
      service,
      await validPolicyPack({ version: 2, controls: weakerControls, packId: 'pack-v2-attack' }),
    );
    await expect(
      service.resolveEffectivePolicy({
        requestId: escalation.request.requestId,
        tenantId: TENANT_A,
        packId: 'pack-v2-attack',
      }),
    ).rejects.toMatchObject({ code: 'EXPERT_SESSION_POLICY_RESOLUTION_CONFLICT' });
  });
});

describe('retention engine over the service', () => {
  it('expiry sweep moves due subjects along the disposition graph (audited)', async () => {
    const { escalation, service } = await fixture();
    await registerPack(service, await validPolicyPack());
    await service.resolveEffectivePolicy({ requestId: escalation.request.requestId, tenantId: TENANT_A });
    const result = await service.advanceRetention({ tenantId: TENANT_A, asOf: T1 });
    expect(result.transitions.length).toBe(4);
    const transcript = await service.getRetentionSubject(
      `ret-${escalation.request.requestId}-session-transcript`,
      TENANT_A,
    );
    expect(transcript.state).toBe('ANONYMIZE');
    const stream = await service.getRetentionSubject(
      `ret-${escalation.request.requestId}-observation-stream`,
      TENANT_A,
    );
    expect(stream.state).toBe('DELETE_PENDING');
  });

  it('DELETION DOUBLE-SPEND: the second erasure request is a typed duplicate with no second effect', async () => {
    const { escalation, service } = await fixture();
    await registerPack(service, await validPolicyPack());
    await service.resolveEffectivePolicy({ requestId: escalation.request.requestId, tenantId: TENANT_A });
    const subjectId = `ret-${escalation.request.requestId}-session-transcript`;
    const first = await service.requestCustomerErasure({ subjectId, tenantId: TENANT_A, requestId: 'erasure-1', now: T1 });
    expect(first.outcome).toBe('erasure-scheduled');
    const second = await service.requestCustomerErasure({ subjectId, tenantId: TENANT_A, requestId: 'erasure-2', now: T2 });
    expect(second.outcome).toBe('duplicate-erasure-request');
    expect(second.subject.history.length).toBe(1);
    const executed = await service.executeDisposition({ subjectId, tenantId: TENANT_A, now: T2 });
    expect(executed.state).toBe('DELETED');
    expect(executed.history.length).toBe(2);
    // Audit history is RETAINED after deletion.
    const third = await service.requestCustomerErasure({ subjectId, tenantId: TENANT_A, requestId: 'erasure-3', now: T2 });
    expect(third.outcome).toBe('duplicate-erasure-request');
    const kinds = service.auditTrail().records.map((record) => record.payload.kind);
    expect(kinds.filter((kind) => kind === 'retention-duplicate').length).toBe(2);
    await expect(service.executeDisposition({ subjectId, tenantId: TENANT_A, now: T2 })).rejects.toMatchObject({
      code: 'EXPERT_SESSION_POLICY_DUPLICATE_DISPOSITION',
    });
  });

  it('expert withdrawal anonymizes and rejects a second withdrawal (typed)', async () => {
    const { escalation, service } = await fixture();
    await registerPack(service, await validPolicyPack());
    await service.resolveEffectivePolicy({ requestId: escalation.request.requestId, tenantId: TENANT_A });
    const subjectId = `ret-${escalation.request.requestId}-annotations`;
    const first = await service.requestExpertWithdrawal({ subjectId, tenantId: TENANT_A, requestId: 'w-1', now: T1 });
    expect(first.outcome).toBe('withdrawal-applied');
    const second = await service.requestExpertWithdrawal({ subjectId, tenantId: TENANT_A, requestId: 'w-2', now: T2 });
    expect(second.outcome).toBe('withdrawal-rejected');
  });

  it('cross-tenant retention subject reads fail closed (typed)', async () => {
    const { escalation, service } = await fixture();
    await registerPack(service, await validPolicyPack());
    await service.resolveEffectivePolicy({ requestId: escalation.request.requestId, tenantId: TENANT_A });
    await expect(
      service.getRetentionSubject(`ret-${escalation.request.requestId}-artifacts`, TENANT_B),
    ).rejects.toMatchObject({ code: 'EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY' });
  });

  it('the audit chain verifies (tamper-evident)', async () => {
    const { escalation, service } = await fixture();
    await registerPack(service, await validPolicyPack());
    await service.resolveEffectivePolicy({ requestId: escalation.request.requestId, tenantId: TENANT_A });
    const snapshot = await service.verifyAuditTrail();
    expect(snapshot.verified).toBe(true);
    expect(snapshot.records.length).toBeGreaterThan(4);
  });
});

describe('registerPolicyPack over a real escalation (integration fabric)', () => {
  it('createPolicyPack + registration over the reference fabric is end-to-end consistent', async () => {
    const escalation: EscalationRecord = await validEscalationRecord();
    const pack = await createPolicyPack({
      packId: 'pack-e2e',
      version: 1,
      tenantId: TENANT_A,
      displayName: 'E2E pack',
      controls: validControls(TENANT_A),
      retention: validRetentionSchedule(),
      dataRights: makeDataRights(TENANT_A, escalation.request.createdAt),
      jurisdictions: ['EU'],
      now: T0,
    });
    expect(pack.packId).toBe('pack-e2e');
    expect(randomUUID()).toMatch(/[0-9a-f-]{36}/);
  });
});
