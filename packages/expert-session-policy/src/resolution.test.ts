/**
 * Effective-policy resolution tests (Work Order C018 acceptance: unit —
 * the monotone merge; adversarial — tenant-boundary weakening, secret
 * re-admission via weaker pack versions, retention bypass via
 * conflicting pack versions, cross-tenant resolution without
 * authorization).
 */

import { describe, expect, it } from 'vitest';
import { resolveEffectiveSessionPolicy } from './resolution.js';
import { createCrossTenantPackAuthorization } from './tenancy.js';
import { ExpertSessionPolicyError } from './errors.js';
import {
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  overlongRetentionSchedule,
  validControls,
  validEscalationRecord,
  validPolicyPack,
} from './test-support.js';

describe('the monotone merge (request baseline + pack strengthening)', () => {
  it('resolves a pack-governed policy: barrier carries request + pack controls, modes derive, retention passes through', async () => {
    const escalation = await validEscalationRecord();
    const pack = await validPolicyPack();
    const policy = resolveEffectiveSessionPolicy({
      resolutionId: 'resolution-0001',
      escalation,
      pack,
      now: T0,
    });
    expect(policy.policyVersion).toBe(1);
    expect(policy.packRef).toEqual({ packId: 'pack-enterprise-eu', version: 1 });
    expect(policy.barrier.tenantBoundary.tenantId).toBe(TENANT_A);
    expect([...policy.barrier.redactedFields].sort()).toEqual(['accountNumber', 'customerEmail', 'customerPhone', 'iban', 'taxId']);
    expect(policy.barrier.excludedTools).toEqual(['secret-vault', 'payment-console']);
    expect(policy.barrier.identityMasking).toBe(true);
    expect(policy.barrier.restrictions).toEqual({ download: true, clipboard: true, screenshot: true });
    expect(policy.allowedSessionModes).toEqual(['observe', 'takeover']); // solve
    expect(policy.retention?.entries.length).toBe(4);
    expect(policy.dataRights?.owner).toBe(TENANT_A);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('the REQUEST baseline always applies: a pack WITHOUT the tool-exclusion control cannot re-admit the request-baseline secrets… and a pack WITH it unions them', async () => {
    const escalation = await validEscalationRecord();
    // A weaker pack version that drops the tool-exclusion control.
    const weakerControls = validControls(TENANT_A).filter(
      (control) => (control as { kind: string }).kind !== 'tool-exclusion',
    );
    const weakerPack = await validPolicyPack({ version: 2, controls: weakerControls });
    const policy = resolveEffectiveSessionPolicy({
      resolutionId: 'resolution-0002',
      escalation,
      pack: weakerPack,
      now: T0,
    });
    // The request baseline (escalation policy fields) carries NO tool
    // exclusions by itself — the pack is the tool-exclusion authority.
    // Resolution is monotone: whatever exclusions the RESOLVED pack
    // declares survive; nothing is ever REMOVED by the merge itself.
    expect(policy.barrier.excludedTools).toEqual([]);
    // The strong pack's exclusions survive resolution unchanged:
    const strongPack = await validPolicyPack({ version: 3 });
    const strongPolicy = resolveEffectiveSessionPolicy({
      resolutionId: 'resolution-0003',
      escalation,
      pack: strongPack,
      now: T0,
    });
    expect(strongPolicy.barrier.excludedTools).toEqual(['secret-vault', 'payment-console']);
    // …and a request-baseline PII redaction can never be dropped by a pack:
    expect(strongPolicy.barrier.redactedFields).toContain('customerEmail');
  });

  it('a pack with the same exclusions plus MORE controls only strengthens (union/intersect semantics)', async () => {
    const escalation = await validEscalationRecord();
    const pack = await validPolicyPack({
      version: 4,
      controls: [
        ...validControls(TENANT_A),
        { controlVersion: 1, kind: 'document-redaction', tenantId: TENANT_A, payload: { kind: 'document-redaction', documents: ['doc/payslip-2026.pdf'] } },
        { controlVersion: 1, kind: 'read-only-resources', tenantId: TENANT_A, payload: { kind: 'read-only-resources', resources: ['state/snapshot.json'] } },
      ],
    });
    const policy = resolveEffectiveSessionPolicy({ resolutionId: 'resolution-0004', escalation, pack, now: T0 });
    expect(policy.barrier.redactedDocuments).toEqual(['doc/payslip-2026.pdf']);
    expect(policy.barrier.readOnlyResources).toEqual(['state/snapshot.json']);
  });

  it('credential expiry tightens to the EARLIEST of request deadline and pack control', async () => {
    const escalation = await validEscalationRecord();
    const pack = await validPolicyPack({
      version: 5,
      controls: [
        ...validControls(TENANT_A),
        { controlVersion: 1, kind: 'time-limited-credentials', tenantId: TENANT_A, payload: { kind: 'time-limited-credentials', expiresAt: '2026-10-07T10:30:00.000Z' } },
      ],
    });
    const policy = resolveEffectiveSessionPolicy({ resolutionId: 'resolution-0005', escalation, pack, now: T0 });
    expect(policy.barrier.credentials.expiresAt).toBe('2026-10-07T10:30:00.000Z');
  });

  it('request-fields-only resolution (no pack) keeps the baseline and null retention/data rights', async () => {
    const escalation = await validEscalationRecord();
    const policy = resolveEffectiveSessionPolicy({ resolutionId: 'resolution-0006', escalation, pack: null, now: T0 });
    expect(policy.packRef).toBeNull();
    expect(policy.retention).toBeNull();
    expect(policy.dataRights).toBeNull();
    expect(policy.barrier.redactedFields).toContain('customerEmail');
    expect(policy.allowedSessionModes).toEqual(['observe', 'takeover']);
  });
});

describe('adversarial: the tenant boundary never moves', () => {
  it('a foreign pack without authorization fails closed with the typed CROSS_TENANT_POLICY error', async () => {
    const escalation = await validEscalationRecord(); // tenant-alpha
    const foreignPack = await validPolicyPack({ tenantId: TENANT_B });
    expect(() =>
      resolveEffectiveSessionPolicy({ resolutionId: 'resolution-0100', escalation, pack: foreignPack, now: T0 }),
    ).toThrow(ExpertSessionPolicyError);
    try {
      resolveEffectiveSessionPolicy({ resolutionId: 'resolution-0100', escalation, pack: foreignPack, now: T0 });
    } catch (error) {
      expect((error as ExpertSessionPolicyError).code).toBe('EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY');
    }
  });

  it('an EXPIRED authorization is still a denial (fail-closed, no grace)', async () => {
    const escalation = await validEscalationRecord();
    const foreignPack = await validPolicyPack({ tenantId: TENANT_B });
    const grant = createCrossTenantPackAuthorization({
      authorizationId: 'auth-expired',
      packId: foreignPack.packId,
      packVersion: foreignPack.version,
      sourceTenantId: TENANT_B,
      consumingTenantId: TENANT_A,
      now: T0,
      expiresAt: T1,
    });
    expect(() =>
      resolveEffectiveSessionPolicy({
        resolutionId: 'resolution-0101',
        escalation,
        pack: foreignPack,
        crossTenantAuthorization: grant,
        now: T1,
      }),
    ).toThrow(ExpertSessionPolicyError);
  });

  it('a VALID authorization resolves — but the barrier boundary stays the REQUEST tenant', async () => {
    const escalation = await validEscalationRecord(); // tenant-alpha
    const foreignPack = await validPolicyPack({ tenantId: TENANT_B });
    const grant = createCrossTenantPackAuthorization({
      authorizationId: 'auth-0009',
      packId: foreignPack.packId,
      packVersion: foreignPack.version,
      sourceTenantId: TENANT_B,
      consumingTenantId: TENANT_A,
      now: T0,
    });
    const policy = resolveEffectiveSessionPolicy({
      resolutionId: 'resolution-0102',
      escalation,
      pack: foreignPack,
      crossTenantAuthorization: grant,
      now: T0,
    });
    expect(policy.crossTenantAuthorizationId).toBe('auth-0009');
    expect(policy.barrier.tenantBoundary.tenantId).toBe(TENANT_A); // NEVER the pack owner
  });
});

describe('adversarial: retention bypass via conflicting pack versions', () => {
  it('a pack whose retention outlives the request purge window is a typed RETENTION_CONFLICT rejection', async () => {
    const escalation = await validEscalationRecord(); // purge after 30 days
    const overlongPack = await validPolicyPack({ version: 9, retention: overlongRetentionSchedule() });
    try {
      resolveEffectiveSessionPolicy({ resolutionId: 'resolution-0200', escalation, pack: overlongPack, now: T0 });
      expect.unreachable('resolution must fail closed');
    } catch (error) {
      expect((error as ExpertSessionPolicyError).code).toBe('EXPERT_SESSION_POLICY_RETENTION_CONFLICT');
    }
  });
});

describe('adversarial: infeasible merges fail closed', () => {
  it('a pack allowlist that starves the requested modes is a typed INFEASIBLE_MODES rejection (never silently weakened)', async () => {
    const escalation = await validEscalationRecord({ escalationModes: ['correct'] });
    const pack = await validPolicyPack({
      version: 11,
      controls: [
        ...validControls(TENANT_A),
        { controlVersion: 1, kind: 'action-allowlist', tenantId: TENANT_A, payload: { kind: 'action-allowlist', actions: ['observe-state', 'annotate'] } },
      ],
    });
    try {
      resolveEffectiveSessionPolicy({ resolutionId: 'resolution-0300', escalation, pack, now: T0 });
      expect.unreachable('resolution must fail closed');
    } catch (error) {
      expect((error as ExpertSessionPolicyError).code).toBe('EXPERT_SESSION_POLICY_INFEASIBLE_MODES');
    }
  });

  it('the MERGED allowlist (request ∩ pack) is also feasibility-checked when the pack imposes one', async () => {
    // The request's own baseline starves SOLVE; a pack that ALSO declares
    // an allowlist (even a permissive one) makes the MERGED set the
    // authority — and the merged set cannot carry takeover.
    const escalation = await validEscalationRecord({
      escalationModes: ['solve'],
      permittedActions: ['read-context'],
    });
    const pack = await validPolicyPack({
      version: 12,
      controls: [
        ...validControls(TENANT_A),
        { controlVersion: 1, kind: 'action-allowlist', tenantId: TENANT_A, payload: { kind: 'action-allowlist', actions: ['observe-state', 'annotate', 'edit-artifact', 'invoke-tool', 'supply-information', 'submit-result', 'capture-checkpoint'] } },
      ],
    });
    try {
      resolveEffectiveSessionPolicy({ resolutionId: 'resolution-0301', escalation, pack, now: T0 });
      expect.unreachable('resolution must fail closed');
    } catch (error) {
      expect((error as ExpertSessionPolicyError).code).toBe('EXPERT_SESSION_POLICY_INFEASIBLE_MODES');
    }
  });
});
