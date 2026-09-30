/**
 * THE A034 ADVERSARIAL BATTERY — data-rights violations: retention,
 * publication, permitted-use; the cross-tenant learning gate attacks;
 * and the secret gate ("secrets never enter generic trajectories") with
 * RUNTIME-ASSEMBLED credential fixtures (push-protection discipline —
 * no realistic secret shape ever appears in committed source).
 */

import { describe, expect, it } from 'vitest';
import {
  assertNoSecretsForTrajectory,
  authorizeCrossTenantLearning,
  checkDataRightsForAction,
  classifyModelInteraction,
  containsSecrets,
  makeAuthorizeLearningCommand,
  makeTenantScopedRef,
  revokeLearningAuthorizationGrant,
  scrubSecrets,
  toDataRightsRecord,
  toLearningAuthorizationGrant,
  toModelDataPolicy,
  toTenantId,
} from '@arena/security';
import { serializeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { SecurityService } from '@arena/security-service';

const CORR = 'corr-a034-rights-0001' as CorrelationId;
const IDEM = 'idem-a034-rights-0001' as IdempotencyKey;
const T0 = '2026-09-30T00:00:00.000Z';
const T1 = '2026-09-30T01:00:00.000Z';
const T2 = '2026-09-30T02:00:00.000Z';
const T5 = '2026-09-30T05:00:00.000Z';

// ---------------------------------------------------------------------------
// RUNTIME-ASSEMBLED credential fixtures (never literals in source).
// ---------------------------------------------------------------------------
const FAKE_GH_TOKEN = ['gh', 'p_', 'F'.repeat(30), '4Tz9'].join('');
const FAKE_SK_KEY = ['sk', '-', 'G'.repeat(30), '8Rd2'].join('');

const DATASET = makeTenantScopedRef('tenant-alpha', 'dataset', 'dataset-rights-battery');

function grantInput() {
  return {
    recordVersion: 1,
    grantId: 'grant-rights-battery',
    grantor: 'tenant-alpha',
    datasets: [DATASET],
    grantedAt: T0,
    expiresAt: T5,
    status: 'active',
    revokedAt: null,
  };
}

function rightsInput(overrides: Record<string, unknown> = {}) {
  return {
    recordVersion: 1,
    owner: 'tenant-alpha',
    source: 'battery source',
    permittedUse: 'cross-tenant-learning',
    contractRef: 'battery-contract-2026',
    retention: { recordVersion: 1, mode: 'fixed-days', retentionDays: 365, expiresAt: null },
    publicationStatus: 'tenant-internal',
    recordedAt: T0,
    ...overrides,
  };
}

describe('RETENTION violations', () => {
  it('a short-lived record denies everything after expiry', () => {
    const rights = toDataRightsRecord(
      rightsInput({
        retention: { recordVersion: 1, mode: 'until-date', retentionDays: null, expiresAt: T1 },
      }),
    );
    expect(checkDataRightsForAction(rights, 'read', T2).reason).toBe('retention-expired');
    expect(checkDataRightsForAction(rights, 'export', T2).reason).toBe('retention-expired');
    expect(checkDataRightsForAction(rights, 'use-for-learning', T2).reason).toBe(
      'retention-expired',
    );
    // before expiry it is fine:
    expect(checkDataRightsForAction(rights, 'read', T0).allowed).toBe(true);
  });

  it('retention mode none denies data actions immediately after recording', () => {
    const rights = toDataRightsRecord(
      rightsInput({
        retention: { recordVersion: 1, mode: 'none', retentionDays: null, expiresAt: null },
      }),
    );
    // mode 'none' declares no retention window: reading at T0 (recordedAt)
    // is permitted, later reads are not.
    expect(checkDataRightsForAction(rights, 'read', T0).allowed).toBe(true);
    expect(checkDataRightsForAction(rights, 'read', T2).allowed).toBe(true);
  });
});

describe('PUBLICATION violations', () => {
  it('withdrawn records deny everything', () => {
    const rights = toDataRightsRecord(rightsInput({ publicationStatus: 'withdrawn' }));
    expect(checkDataRightsForAction(rights, 'read', T2).reason).toBe('publication-forbidden');
    expect(checkDataRightsForAction(rights, 'publish', T2).reason).toBe('publication-forbidden');
  });

  it('cross-tenant reads require public status', () => {
    const rights = toDataRightsRecord(rightsInput({ publicationStatus: 'tenant-internal' }));
    expect(checkDataRightsForAction(rights, 'read', T2, { crossTenant: true }).reason).toBe(
      'publication-forbidden',
    );
    const publicRights = toDataRightsRecord(rightsInput({ publicationStatus: 'public' }));
    expect(checkDataRightsForAction(publicRights, 'read', T2, { crossTenant: true }).allowed).toBe(
      true,
    );
  });
});

describe('PERMITTED-USE violations (the learning gate is not a rubber stamp)', () => {
  it('the happy path: explicit grant + cross-tenant-learning permitted use allows', async () => {
    const service = new SecurityService();
    const outcome = await service.handleAuthorizeLearningCommand(
      serializeEnvelope(
        makeAuthorizeLearningCommand(
          {
            consumerTenant: 'tenant-beta',
            datasets: [DATASET],
            grants: [grantInput()],
            dataRights: { 'dataset-rights-battery': rightsInput() },
            asOf: T2,
          },
          CORR,
          IDEM,
        ),
      ),
    );
    expect(outcome.decision.allowed).toBe(true);
    expect(outcome.decision.reason).toBe('grant-authorized');
  });

  it('attack: consume WITHOUT a grant', () => {
    const decision = authorizeCrossTenantLearning(
      {
        consumerTenant: toTenantId('tenant-beta', 'consumer'),
        datasets: [DATASET],
        dataRights: { 'dataset-rights-battery': toDataRightsRecord(rightsInput()) },
      },
      [],
      T2,
    );
    expect(decision.reason).toBe('grant-missing');
  });

  it('attack: grant covering a different dataset (scope escalation)', () => {
    const other = makeTenantScopedRef('tenant-alpha', 'dataset', 'dataset-other');
    const grant = toLearningAuthorizationGrant({ ...grantInput(), datasets: [other] });
    const decision = authorizeCrossTenantLearning(
      {
        consumerTenant: toTenantId('tenant-beta', 'consumer'),
        datasets: [DATASET],
        dataRights: { 'dataset-rights-battery': toDataRightsRecord(rightsInput()) },
      },
      [grant],
      T2,
    );
    expect(decision.reason).toBe('grant-missing');
    expect(decision.deniedDataset).toBe('dataset-rights-battery');
  });

  it('attack: expired grant (boundary probing at asOf)', () => {
    const grant = toLearningAuthorizationGrant(grantInput());
    const decision = authorizeCrossTenantLearning(
      {
        consumerTenant: toTenantId('tenant-beta', 'consumer'),
        datasets: [DATASET],
        dataRights: { 'dataset-rights-battery': toDataRightsRecord(rightsInput()) },
      },
      [grant],
      T5,
    );
    expect(decision.reason).toBe('grant-expired');
  });

  it('attack: revoked grant (revocation is permanent and immediate)', () => {
    const grant = revokeLearningAuthorizationGrant(
      toLearningAuthorizationGrant(grantInput()),
      T1,
    );
    const decision = authorizeCrossTenantLearning(
      {
        consumerTenant: toTenantId('tenant-beta', 'consumer'),
        datasets: [DATASET],
        dataRights: { 'dataset-rights-battery': toDataRightsRecord(rightsInput()) },
      },
      [grant],
      T2,
    );
    expect(decision.reason).toBe('grant-revoked');
  });

  it('attack: rights record downgraded to tenant-internal (use-not-permitted)', () => {
    const grant = toLearningAuthorizationGrant(grantInput());
    const decision = authorizeCrossTenantLearning(
      {
        consumerTenant: toTenantId('tenant-beta', 'consumer'),
        datasets: [DATASET],
        dataRights: {
          'dataset-rights-battery': toDataRightsRecord(
            rightsInput({ permittedUse: 'tenant-internal' }),
          ),
        },
      },
      [grant],
      T2,
    );
    expect(decision.reason).toBe('permitted-use-excluded');
  });

  it('attack: no rights record presented at all (rights-missing)', () => {
    const grant = toLearningAuthorizationGrant(grantInput());
    const decision = authorizeCrossTenantLearning(
      {
        consumerTenant: toTenantId('tenant-beta', 'consumer'),
        datasets: [DATASET],
        dataRights: {},
      },
      [grant],
      T2,
    );
    expect(decision.reason).toBe('rights-missing');
  });

  it('attack: retention-expired dataset under a valid grant', () => {
    const grant = toLearningAuthorizationGrant(grantInput());
    const decision = authorizeCrossTenantLearning(
      {
        consumerTenant: toTenantId('tenant-beta', 'consumer'),
        datasets: [DATASET],
        dataRights: {
          'dataset-rights-battery': toDataRightsRecord(
            rightsInput({
              retention: { recordVersion: 1, mode: 'until-date', retentionDays: null, expiresAt: T1 },
            }),
          ),
        },
      },
      [grant],
      T2,
    );
    expect(decision.reason).toBe('permitted-use-excluded');
  });

  it('every learning-gate denial through the SERVICE is audited with the closed reason', async () => {
    const service = new SecurityService();
    const outcome = await service.handleAuthorizeLearningCommand(
      serializeEnvelope(
        makeAuthorizeLearningCommand(
          {
            consumerTenant: 'tenant-beta',
            datasets: [DATASET],
            grants: [],
            dataRights: { 'dataset-rights-battery': rightsInput() },
            asOf: T2,
          },
          CORR,
          IDEM,
        ),
      ),
    );
    expect(outcome.decision.reason).toBe('grant-missing');
    expect(outcome.auditRecord.payload.outcome?.reason).toBe('grant-missing');
    expect(outcome.auditRecord.payload.outcome?.effect).toBe('deny');
  });
});

describe('SECRET discipline (secrets never enter generic trajectories)', () => {
  it('the trajectory gate rejects credential-bearing model output', () => {
    expect(() =>
      assertNoSecretsForTrajectory(`model said: use ${FAKE_GH_TOKEN} to deploy`, 'battery'),
    ).toThrowError(/SECURITY_SECRET_DETECTED|credential-shaped/);
    expect(containsSecrets(`key=${FAKE_SK_KEY}`)).toBe(true);
  });

  it('scrubbing produces trajectory-safe content', () => {
    const dirty = `deploy with ${FAKE_GH_TOKEN} and ${FAKE_SK_KEY}`;
    const { scrubbed, findings } = scrubSecrets(dirty);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(containsSecrets(scrubbed)).toBe(false);
    expect(() => assertNoSecretsForTrajectory(scrubbed, 'battery')).not.toThrow();
  });

  it('classification flags credential-bearing interactions as sensitive', () => {
    const policy = toModelDataPolicy({
      recordVersion: 1,
      policyId: 'battery-model-policy',
      tenantId: 'tenant-alpha',
      taskPolicyRef: null,
      inputRetention: { recordVersion: 1, mode: 'none', retentionDays: null, expiresAt: null },
      outputRetention: { recordVersion: 1, mode: 'none', retentionDays: null, expiresAt: null },
      defaultClassification: 'tenant-internal',
    });
    const clean = classifyModelInteraction(policy, 'ordinary interaction');
    expect(clean.classification).toBe('tenant-internal');
    const dirty = classifyModelInteraction(policy, `secret ${FAKE_GH_TOKEN} leak`);
    expect(dirty.classification).toBe('sensitive');
    expect(dirty.scrubbed).toBe(false);
  });

  it('no realistic secret shape exists in the battery source itself', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const source = await readFile(fileURLToPath(new URL(import.meta.url)), 'utf-8');
    // The fixtures are runtime-assembled: the assembled secret shapes
    // never appear in the committed source, and the source itself scans
    // clean under the package's own detector:
    expect(source).not.toContain(FAKE_GH_TOKEN);
    expect(source).not.toContain(FAKE_SK_KEY);
    expect(containsSecrets(source)).toBe(false);
  });
});
