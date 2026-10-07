/**
 * PolicyPack control composition + typed conflict/infeasibility verdicts
 * (Work Order C018 acceptance: unit — control composition + conflict
 * verdicts; adversarial — packs attempting to weaken the tenant boundary
 * or re-admit excluded secrets must fail closed).
 */

import { describe, expect, it } from 'vitest';
import {
  createPolicyPack,
  validatePolicyPack,
  composePackControls,
} from './pack.js';
import { validateAndComposeControls } from './controls.js';
import type { PolicyPack } from './pack.js';
import { ExpertSessionPolicyError } from './errors.js';
import { toRetentionSchedule } from './retention.js';
import {
  TENANT_A,
  TENANT_B,
  T0,
  makeDataRights,
  validControls,
  validEscalationRecord,
  validPolicyPack,
  validRetentionSchedule,
} from './test-support.js';

describe('policy pack construction (tenant scoping)', () => {
  it('builds a frozen, tenant-scoped pack with all four retention classes and data rights', async () => {
    const pack = await validPolicyPack();
    expect(pack.packId).toBe('pack-enterprise-eu');
    expect(pack.tenantId).toBe(TENANT_A);
    expect(pack.controls.length).toBe(5);
    expect(pack.retention.entries.length).toBe(4);
    expect(pack.dataRights.owner).toBe(TENANT_A);
    expect(pack.jurisdictions).toEqual(['EU', 'GH']);
    expect(Object.isFrozen(pack)).toBe(true);
  });

  it('rejects a control whose tenant scope differs from the pack tenant (no silent boundary move)', () => {
    expect(() =>
      createPolicyPack({
        packId: 'pack-mixed-scope',
        version: 1,
        tenantId: TENANT_A,
        displayName: 'mixed scope',
        controls: [
          { controlVersion: 1, kind: 'tenant-boundary', tenantId: TENANT_B, payload: { kind: 'tenant-boundary', tenantId: TENANT_B } },
        ],
        retention: validRetentionSchedule(),
        dataRights: makeDataRights(TENANT_A, T0),
        now: T0,
      }),
    ).toThrow(ExpertSessionPolicyError);
  });

  it('rejects data-rights metadata owned by another tenant', () => {
    expect(() =>
      createPolicyPack({
        packId: 'pack-foreign-rights',
        version: 1,
        tenantId: TENANT_A,
        displayName: 'foreign rights',
        controls: validControls(TENANT_A),
        retention: validRetentionSchedule(),
        dataRights: makeDataRights(TENANT_B, T0),
        now: T0,
      }),
    ).toThrow(ExpertSessionPolicyError);
  });
});

describe('typed conflict verdicts (closed outcomes, with reasons)', () => {
  it('validates a clean pack as outcome "valid"', async () => {
    const pack = await validPolicyPack();
    const verdict = validatePolicyPack(pack);
    expect(verdict.outcome).toBe('valid');
    expect(verdict.packRef).toEqual({ packId: 'pack-enterprise-eu', version: 1 });
  });

  it('rejects a weakening control (masking off) with the typed weakening-control reason', () => {
    const verdict = validateAndComposeControls([
      { controlVersion: 1, kind: 'identity-masking', tenantId: TENANT_A, payload: { kind: 'identity-masking', maskIdentity: false } },
    ]);
    expect('conflicts' in verdict).toBe(true);
    if ('conflicts' in verdict) {
      expect(verdict.conflicts[0]?.code).toBe('weakening-control');
    }
  });

  it('rejects an export-restriction control that attempts to un-restrict a channel', () => {
    const verdict = validateAndComposeControls([
      { controlVersion: 1, kind: 'download-restriction', tenantId: TENANT_A, payload: { kind: 'download-restriction', restricted: false } },
    ]);
    expect('conflicts' in verdict).toBe(true);
    if ('conflicts' in verdict) {
      expect(verdict.conflicts[0]?.code).toBe('weakening-control');
    }
  });

  it('rejects a tenant-boundary control whose payload tenant disagrees with its scope', () => {
    const verdict = validateAndComposeControls([
      { controlVersion: 1, kind: 'tenant-boundary', tenantId: TENANT_A, payload: { kind: 'tenant-boundary', tenantId: TENANT_B } },
    ]);
    expect('conflicts' in verdict).toBe(true);
    if ('conflicts' in verdict) {
      expect(verdict.conflicts[0]?.code).toBe('tenant-boundary-mismatch');
    }
  });

  it('rejects a payload kind that does not match the control kind', () => {
    const verdict = validateAndComposeControls([
      { controlVersion: 1, kind: 'field-redaction', tenantId: TENANT_A, payload: { kind: 'tool-exclusion', tools: ['x'] } },
    ]);
    expect('conflicts' in verdict).toBe(true);
    if ('conflicts' in verdict) {
      expect(verdict.conflicts[0]?.code).toBe('control-kind-mismatch');
    }
  });

  it('rejects empty tool-exclusion controls (no-op exclusion lists are fail-closed, never silently empty)', () => {
    const verdict = validateAndComposeControls([
      { controlVersion: 1, kind: 'tool-exclusion', tenantId: TENANT_A, payload: { kind: 'tool-exclusion', tools: [] } },
    ]);
    expect('conflicts' in verdict).toBe(true);
    if ('conflicts' in verdict) {
      expect(verdict.conflicts[0]?.code).toBe('empty-control-payload');
    }
  });

  it('rejects an empty control composition (an ungoverned session is never allowed)', () => {
    const verdict = validateAndComposeControls([]);
    expect('conflicts' in verdict).toBe(true);
  });

  it('rejects controls spanning multiple tenant scopes in one composition', () => {
    const verdict = validateAndComposeControls([
      { controlVersion: 1, kind: 'identity-masking', tenantId: TENANT_A, payload: { kind: 'identity-masking', maskIdentity: true } },
      { controlVersion: 1, kind: 'identity-masking', tenantId: TENANT_B, payload: { kind: 'identity-masking', maskIdentity: true } },
    ]);
    expect('conflicts' in verdict).toBe(true);
    if ('conflicts' in verdict) {
      expect(verdict.conflicts.some((entry) => entry.code === 'tenant-boundary-mismatch')).toBe(true);
    }
  });
});

describe('monotone composition semantics', () => {
  it('unions redactions/exclusions, ORs masking/restrictions, MINs credentials, INTERSECTS allowlists', async () => {
    const pack = await validPolicyPack({
      controls: [
        ...validControls(TENANT_A),
        { controlVersion: 1, kind: 'field-redaction', tenantId: TENANT_A, payload: { kind: 'field-redaction', fields: ['salary'] } },
        { controlVersion: 1, kind: 'action-allowlist', tenantId: TENANT_A, payload: { kind: 'action-allowlist', actions: ['observe-state', 'annotate', 'edit-artifact', 'submit-result', 'supply-information', 'invoke-tool', 'capture-checkpoint'] } },
        { controlVersion: 1, kind: 'time-limited-credentials', tenantId: TENANT_A, payload: { kind: 'time-limited-credentials', expiresAt: '2026-10-07T11:00:00.000Z' } },
      ],
    });
    const composed = composePackControls(pack);
    expect([...composed.redactedFields].sort()).toEqual(['iban', 'salary', 'taxId']);
    expect(composed.excludedTools).toEqual(['secret-vault', 'payment-console']);
    expect(composed.identityMasking).toBe(true);
    expect(composed.restrictions).toEqual({ download: true, clipboard: false, screenshot: false });
    expect(composed.credentialsExpiresAt).toBe('2026-10-07T11:00:00.000Z');
    expect(composed.actionAllowlist).toContain('edit-artifact');
  });
});

describe('infeasibility-for-session-modes verdicts', () => {
  it('rejects a pack whose allowlist cannot carry the requested modes (CORRECT requested, edit forbidden)', async () => {
    const escalation = await validEscalationRecord({ escalationModes: ['correct'] });
    const pack = await validPolicyPack({
      controls: [
        ...validControls(TENANT_A),
        { controlVersion: 1, kind: 'action-allowlist', tenantId: TENANT_A, payload: { kind: 'action-allowlist', actions: ['observe-state', 'annotate', 'supply-information'] } },
      ],
    });
    const verdict = validatePolicyPack(pack, { escalationModes: escalation.request.escalationModes });
    expect(verdict.outcome).toBe('infeasible-for-session-modes');
    if (verdict.outcome === 'infeasible-for-session-modes' && verdict.infeasibleModes !== undefined) {
      expect(verdict.infeasibleModes.some((entry) => entry.code === 'mode-requires-action-not-allowlisted')).toBe(true);
      expect(verdict.infeasibleModes.some((entry) => entry.action === 'edit-artifact')).toBe(true);
    }
  });

  it('rejects a pack that violates the observation floor for ANY mode set', async () => {
    const escalation = await validEscalationRecord();
    const pack = await validPolicyPack({
      controls: [
        ...validControls(TENANT_A),
        { controlVersion: 1, kind: 'action-allowlist', tenantId: TENANT_A, payload: { kind: 'action-allowlist', actions: ['annotate'] } },
      ],
    });
    const verdict = validatePolicyPack(pack, { escalationModes: escalation.request.escalationModes });
    expect(verdict.outcome).toBe('infeasible-for-session-modes');
    if (verdict.outcome === 'infeasible-for-session-modes' && verdict.infeasibleModes !== undefined) {
      expect(verdict.infeasibleModes.some((entry) => entry.code === 'observation-floor-violated')).toBe(true);
    }
  });

  it('accepts a pack whose allowlist carries every required action of the requested modes', async () => {
    const escalation = await validEscalationRecord({ escalationModes: ['solve'] });
    const pack = await validPolicyPack();
    const verdict = validatePolicyPack(pack, { escalationModes: escalation.request.escalationModes });
    expect(verdict.outcome).toBe('valid');
  });
});

describe('fail-closed error forms', () => {
  it('throws the typed CONFLICTING_CONTROLS failure from the guard form', () => {
    const pack = {
      packVersion: 1 as const,
      packId: 'pack-weakened',
      version: 1,
      tenantId: TENANT_A,
      displayName: 'weakened',
      description: null,
      controls: [
        { controlVersion: 1, kind: 'clipboard-restriction', tenantId: TENANT_A, payload: { kind: 'clipboard-restriction', restricted: false } },
      ] as never,
      retention: validRetentionSchedule(),
      dataRights: null as never,
      jurisdictions: [],
      residencyRegions: [],
      createdAt: T0,
      supersedes: null,
    } as unknown as PolicyPack;
    let thrown: unknown;
    try {
      composePackControls(pack);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ExpertSessionPolicyError);
    expect((thrown as ExpertSessionPolicyError).code).toBe('EXPERT_SESSION_POLICY_CONFLICTING_CONTROLS');
  });

  it('rejects a retention schedule missing an artifact class (every class is governed)', () => {
    expect(() =>
      toRetentionSchedule({
        entries: [
          { artifactClass: 'session-transcript', retentionDays: 30, disposition: 'ANONYMIZE' },
          { artifactClass: 'observation-stream', retentionDays: 30, disposition: 'DELETE' },
          { artifactClass: 'artifacts', retentionDays: 25, disposition: 'DELETE' },
        ],
      }),
    ).toThrow(ExpertSessionPolicyError);
    expect(() => toRetentionSchedule({ entries: [] })).toThrow(ExpertSessionPolicyError);
    expect(() =>
      toRetentionSchedule({
        entries: [
          { artifactClass: 'session-transcript', retentionDays: -1, disposition: 'ANONYMIZE' },
          { artifactClass: 'observation-stream', retentionDays: 30, disposition: 'DELETE' },
          { artifactClass: 'artifacts', retentionDays: 25, disposition: 'DELETE' },
          { artifactClass: 'annotations', retentionDays: 20, disposition: 'ANONYMIZE' },
        ],
      }),
    ).toThrow(ExpertSessionPolicyError);
  });
});
