/**
 * Security service tests (Work Order A034): envelope round trips,
 * audited denials, registry conflicts, learning gate wiring.
 */

import { describe, expect, it } from 'vitest';
import {
  makePolicyBundleRegisteredEvent,
  makeRegisterPolicyBundleCommand,
  makeEvaluateAuthorizationCommand,
  makeAuthorizeLearningCommand,
  parseAuthorizationDecidedEvent,
  parseLearningAuthorizationDecidedEvent,
  parsePolicyBundleRegisteredEvent,
  SecurityError,
  toSecurityPrincipal,
  toTenantScopedRef,
} from '@arena/security';
import { serializeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { SecurityService } from './service.js';
import { SecurityPolicyRegistry } from './registry.js';

const CORR = 'corr-a034-service-0001' as CorrelationId;
const IDEM = 'idem-a034-service-0001' as IdempotencyKey;
const T1 = '2026-09-30T01:00:00.000Z';
const T5 = '2026-09-30T05:00:00.000Z';

const PRINCIPAL = toSecurityPrincipal({
  recordVersion: 1,
  principalId: 'principal-service-test',
  kind: 'customer-identity',
  tenantScope: 'tenant-alpha',
  roles: ['tenant-member'],
  label: null,
});

const RESOURCE = toTenantScopedRef({
  recordVersion: 1,
  tenantId: 'tenant-alpha',
  boundaryClass: 'dataset',
  recordId: 'dataset-service-test',
});

const BUNDLE = {
  recordVersion: 1,
  bundleId: 'bundle-service-test',
  version: '1.0.0',
  statements: [
    {
      recordVersion: 1,
      statementId: 'allow-read',
      effect: 'allow',
      tenantId: 'tenant-alpha',
      roles: ['tenant-member'],
      action: 'read',
      boundaryClass: 'dataset',
    },
    {
      recordVersion: 1,
      statementId: 'deny-export',
      effect: 'deny',
      tenantId: 'tenant-alpha',
      roles: ['tenant-member', 'tenant-admin'],
      action: 'export',
      boundaryClass: 'dataset',
    },
  ],
};

async function makeService(): Promise<SecurityService> {
  const service = new SecurityService();
  await service.handleRegisterPolicyBundleCommand(
    serializeEnvelope(
      makeRegisterPolicyBundleCommand({ bundle: BUNDLE }, CORR, IDEM),
    ),
  );
  return new SecurityService({
    registry: service.registry,
    auditLog: service.auditLog,
    defaultBundle: { bundleId: 'bundle-service-test', version: '1.0.0' },
  });
}

describe('register-policy-bundle round trip', () => {
  it('registers, audits and emits the event', async () => {
    const service = new SecurityService();
    const outcome = await service.handleRegisterPolicyBundleCommand(
      serializeEnvelope(makeRegisterPolicyBundleCommand({ bundle: BUNDLE }, CORR, IDEM)),
    );
    expect(outcome.bundle.statements.length).toBe(2);
    expect(outcome.auditRecord.payload.kind).toBe('policy-registered');
    expect(outcome.auditRecord.payload.correlationId).toBe(CORR);
    expect(outcome.auditRecord.payload.causationId).toBe(outcome.command.id);
    const parsed = parsePolicyBundleRegisteredEvent(outcome.serializedEvent);
    expect(parsed.payload.statementCount).toBe(2);
    expect(parsed.payload.digest).toBe(outcome.bundle.digest);
    expect(service.registry.size).toBe(1);
  });

  it('re-registration of the same statement set is idempotent', async () => {
    const service = new SecurityService();
    await service.handleRegisterPolicyBundleCommand(
      serializeEnvelope(makeRegisterPolicyBundleCommand({ bundle: BUNDLE }, CORR, IDEM)),
    );
    await service.handleRegisterPolicyBundleCommand(
      serializeEnvelope(makeRegisterPolicyBundleCommand({ bundle: BUNDLE }, CORR, IDEM)),
    );
    expect(service.registry.size).toBe(1);
  });

  it('a different statement set under the same identity is IDENTITY_CONFLICT', async () => {
    const service = new SecurityService();
    await service.handleRegisterPolicyBundleCommand(
      serializeEnvelope(makeRegisterPolicyBundleCommand({ bundle: BUNDLE }, CORR, IDEM)),
    );
    const mutated = {
      ...BUNDLE,
      statements: BUNDLE.statements.map((statement) => ({ ...statement, action: 'write' })),
    };
    await expect(
      service.handleRegisterPolicyBundleCommand(
        serializeEnvelope(makeRegisterPolicyBundleCommand({ bundle: mutated }, CORR, IDEM)),
      ),
    ).rejects.toThrowError(SecurityError);
  });

  it('a tampered bundle digest fails closed at registration', async () => {
    const service = new SecurityService();
    const tampered = { ...BUNDLE, digest: 'e'.repeat(64) };
    await expect(
      service.handleRegisterPolicyBundleCommand(
        serializeEnvelope(makeRegisterPolicyBundleCommand({ bundle: tampered }, CORR, IDEM)),
      ),
    ).rejects.toThrowError(/digest mismatch/);
  });
});

describe('evaluate-authorization round trip', () => {
  it('an allowed read returns a decision, an audit record and the event', async () => {
    const service = await makeService();
    const outcome = await service.handleEvaluateAuthorizationCommand(
      serializeEnvelope(
        makeEvaluateAuthorizationCommand(
          { principal: PRINCIPAL, action: 'read', resource: RESOURCE, evaluatedAt: T1 as never },
          CORR,
          IDEM,
        ),
      ),
    );
    expect(outcome.decision.effect).toBe('allow');
    expect(outcome.decision.reason).toBe('policy-allowed');
    expect(outcome.auditRecord.payload.kind).toBe('tenant-access-allowed');
    const parsed = parseAuthorizationDecidedEvent(outcome.serializedEvent);
    expect(parsed.payload.decision.effect).toBe('allow');
  });

  it('a denied export is a normal outcome: decision + audit + event', async () => {
    const service = await makeService();
    const outcome = await service.handleEvaluateAuthorizationCommand(
      serializeEnvelope(
        makeEvaluateAuthorizationCommand(
          { principal: PRINCIPAL, action: 'export', resource: RESOURCE, evaluatedAt: T1 as never },
          CORR,
          IDEM,
        ),
      ),
    );
    expect(outcome.decision.effect).toBe('deny');
    expect(outcome.decision.reason).toBe('deny-overrides');
    expect(outcome.auditRecord.payload.kind).toBe('authorization-decision');
    expect(outcome.auditRecord.payload.outcome?.effect).toBe('deny');
  });

  it('a cross-tenant read is denied AND audited as tenant-access-denied', async () => {
    const service = await makeService();
    const foreign = toTenantScopedRef({
      recordVersion: 1,
      tenantId: 'tenant-beta',
      boundaryClass: 'dataset',
      recordId: 'dataset-beta-1',
    });
    const outcome = await service.handleEvaluateAuthorizationCommand(
      serializeEnvelope(
        makeEvaluateAuthorizationCommand(
          { principal: PRINCIPAL, action: 'read', resource: foreign, evaluatedAt: T1 as never },
          CORR,
          IDEM,
        ),
      ),
    );
    expect(outcome.decision.effect).toBe('deny');
    expect(outcome.decision.reason).toBe('tenant-mismatch');
    expect(outcome.auditRecord.payload.kind).toBe('tenant-access-denied');
    expect(outcome.auditRecord.payload.outcome?.reason).toBe('tenant-mismatch');
  });

  it('no addressed policy bundle fails closed (no ambient policy)', async () => {
    const service = new SecurityService(); // no defaultBundle
    await expect(
      service.handleEvaluateAuthorizationCommand(
        serializeEnvelope(
          makeEvaluateAuthorizationCommand(
            { principal: PRINCIPAL, action: 'read', resource: RESOURCE, evaluatedAt: T1 as never },
            CORR,
            IDEM,
          ),
        ),
      ),
    ).rejects.toThrowError(/no policy bundle addressed/);
  });

  it('garbage commands fail closed with typed errors', async () => {
    const service = await makeService();
    await expect(service.handleEvaluateAuthorizationCommand('not json')).rejects.toThrowError(
      SecurityError,
    );
  });

  it('every handled command seals one more audit record and the chain verifies', async () => {
    const service = await makeService();
    const before = (await service.auditSnapshot()).length;
    await service.handleEvaluateAuthorizationCommand(
      serializeEnvelope(
        makeEvaluateAuthorizationCommand(
          { principal: PRINCIPAL, action: 'read', resource: RESOURCE, evaluatedAt: T1 as never },
          CORR,
          IDEM,
        ),
      ),
    );
    const after = (await service.auditSnapshot()).length;
    expect(after).toBe(before + 1);
    expect(await service.verifyAuditChain()).toBe(true);
  });
});

describe('authorize-learning round trip', () => {
  it('a fully-authorized request allows; everything else denies with closed reasons', async () => {
    const service = new SecurityService();
    const dataset = {
      recordVersion: 1,
      tenantId: 'tenant-alpha',
      boundaryClass: 'dataset',
      recordId: 'dataset-learn-1',
    };
    const grant = {
      recordVersion: 1,
      grantId: 'grant-learn-1',
      grantor: 'tenant-alpha',
      datasets: [dataset],
      grantedAt: T1,
      expiresAt: T5,
      status: 'active',
      revokedAt: null,
    };
    const rights = {
      recordVersion: 1,
      owner: 'tenant-alpha',
      source: 's',
      permittedUse: 'cross-tenant-learning',
      contractRef: 'c',
      retention: { recordVersion: 1, mode: 'none', retentionDays: null, expiresAt: null },
      publicationStatus: 'tenant-internal',
      recordedAt: T1,
    };

    const command = makeAuthorizeLearningCommand(
      {
        consumerTenant: 'tenant-beta',
        datasets: [dataset as never],
        grants: [grant],
        dataRights: { 'dataset-learn-1': rights },
        asOf: '2026-09-30T02:00:00.000Z',
      },
      CORR,
      IDEM,
    );
    const outcome = await service.handleAuthorizeLearningCommand(
      serializeEnvelope(command),
    );
    expect(outcome.decision.allowed).toBe(true);
    expect(outcome.decision.reason).toBe('grant-authorized');
    expect(outcome.auditRecord.payload.kind).toBe('learning-authorization');
    const parsed = parseLearningAuthorizationDecidedEvent(outcome.serializedEvent);
    expect(parsed.payload.decision.allowed).toBe(true);

    // Same request without grants denies — and the denial is audited:
    const denied = await service.handleAuthorizeLearningCommand(
      serializeEnvelope(
        makeAuthorizeLearningCommand(
          {
            consumerTenant: 'tenant-beta',
            datasets: [dataset as never],
            grants: [],
            dataRights: { 'dataset-learn-1': rights },
            asOf: '2026-09-30T02:00:00.000Z',
          },
          CORR,
          IDEM,
        ),
      ),
    );
    expect(denied.decision.allowed).toBe(false);
    expect(denied.decision.reason).toBe('grant-missing');
    expect(denied.auditRecord.payload.outcome?.effect).toBe('deny');
  });
});

describe('the registry', () => {
  it('list() exposes frozen bundles', async () => {
    const registry = new SecurityPolicyRegistry();
    await registry.registerBundle(BUNDLE);
    const listed = registry.list();
    expect(listed.length).toBe(1);
    expect(Object.isFrozen(listed)).toBe(true);
    expect(() => registry.byIdentity('missing', '9.9.9')).toThrowError(/not found/);
  });
});

/** Compile-time-only reference (exports stay exercised). */
void makePolicyBundleRegisteredEvent;
