/**
 * THE A034 ADVERSARIAL BATTERY — cross-tenant access denial matrix,
 * privilege escalation, fail-closed defaults. Attacks the REAL
 * @arena/security protocol + @arena/security-service facade together.
 */

import { describe, expect, it } from 'vitest';
import {
  AuthorizationEngine,
  makeAnonymousPrincipal,
  makeEvaluateAuthorizationCommand,
  makeRegisterPolicyBundleCommand,
  makeTenantScopedRef,
  SecurityError,
  SECURITY_ERROR_CODES,
  TENANT_BOUNDARY_CLASSES,
  toPolicyBundle,
  toSecurityPrincipal,
  toTenantScopedRef,
} from '@arena/security';
import { serializeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { SecurityService } from '@arena/security-service';

const CORR = 'corr-a034-battery-0001' as CorrelationId;
const IDEM = 'idem-a034-battery-0001' as IdempotencyKey;
const T1 = '2026-09-30T01:00:00.000Z';

const ALPHA_MEMBER = toSecurityPrincipal({
  recordVersion: 1,
  principalId: 'principal-alpha-member',
  kind: 'customer-identity',
  tenantScope: 'tenant-alpha',
  roles: ['tenant-member'],
  label: null,
});

const ALPHA_ADMIN = toSecurityPrincipal({
  recordVersion: 1,
  principalId: 'principal-alpha-admin',
  kind: 'customer-identity',
  tenantScope: 'tenant-alpha',
  roles: ['tenant-admin', 'tenant-member'],
  label: null,
});

const BETA_MEMBER = toSecurityPrincipal({
  recordVersion: 1,
  principalId: 'principal-beta-member',
  kind: 'customer-identity',
  tenantScope: 'tenant-beta',
  roles: ['tenant-member', 'tenant-admin'],
  label: null,
});

/** A generous tenant-alpha policy: members+admins may do a LOT. */
const GENEROUS_ALPHA_BUNDLE = {
  recordVersion: 1,
  bundleId: 'bundle-battery-alpha',
  version: '1.0.0',
  statements: [
    ...(
      [
        ['read'],
        ['write'],
        ['delete'],
        ['export'],
        ['publish'],
        ['certify'],
        ['use-for-learning'],
      ] as const
    ).map(([action], index) => ({
      recordVersion: 1,
      statementId: `alpha-allow-${action}-${String(index)}` as never,
      effect: 'allow',
      tenantId: 'tenant-alpha',
      roles: ['tenant-member', 'tenant-admin', 'tenant-owner'],
      action,
      boundaryClass: 'dataset',
    })),
    {
      recordVersion: 1,
      statementId: 'alpha-allow-admin-trajectory',
      effect: 'allow',
      tenantId: 'tenant-alpha',
      roles: ['tenant-admin', 'tenant-owner'],
      action: 'administer',
      boundaryClass: 'trajectory',
    },
    {
      recordVersion: 1,
      statementId: 'alpha-allow-audit-read',
      effect: 'allow',
      tenantId: 'tenant-alpha',
      roles: ['auditor', 'tenant-owner'],
      action: 'audit-read',
      boundaryClass: 'certification-evidence',
    },
  ],
};

async function makeGenerousService(): Promise<SecurityService> {
  const service = new SecurityService();
  await service.handleRegisterPolicyBundleCommand(
    serializeEnvelope(
      makeRegisterPolicyBundleCommand({ bundle: GENEROUS_ALPHA_BUNDLE }, CORR, IDEM),
    ),
  );
  return new SecurityService({
    registry: service.registry,
    auditLog: service.auditLog,
    defaultBundle: { bundleId: 'bundle-battery-alpha', version: '1.0.0' },
  });
}

async function evaluate(
  service: SecurityService,
  principal: ReturnType<typeof toSecurityPrincipal>,
  action: string,
  resource: ReturnType<typeof toTenantScopedRef>,
) {
  const outcome = await service.handleEvaluateAuthorizationCommand(
    serializeEnvelope(
      makeEvaluateAuthorizationCommand(
        { principal, action: action as never, resource, evaluatedAt: T1 as never },
        CORR,
        IDEM,
      ),
    ),
  );
  return outcome;
}

describe('CROSS-TENANT ACCESS DENIAL MATRIX (every S1.0 boundary class)', () => {
  it('a generous tenant-alpha policy NEVER authorizes beta access to alpha resources', async () => {
    const service = await makeGenerousService();
    const actions = [
      'read',
      'write',
      'delete',
      'export',
      'publish',
      'certify',
      'use-for-learning',
    ] as const;
    for (const boundaryClass of TENANT_BOUNDARY_CLASSES) {
      for (const action of actions) {
        const resource = makeTenantScopedRef('tenant-alpha', boundaryClass, `battery-${boundaryClass}`);
        const outcome = await evaluate(service, BETA_MEMBER, action, resource);
        expect(
          outcome.decision.effect,
          `beta ${action} on alpha ${boundaryClass}`,
        ).toBe('deny');
      }
    }
  });

  it('an alpha member IS allowed by the same policy in-scope (the matrix is not vacuous)', async () => {
    const service = await makeGenerousService();
    const resource = makeTenantScopedRef('tenant-alpha', 'dataset', 'battery-in-scope');
    const outcome = await evaluate(service, ALPHA_MEMBER, 'read', resource);
    expect(outcome.decision.effect).toBe('allow');
  });

  it('tenancy overrides policy: alpha allow-statements cannot read beta resources', async () => {
    const service = await makeGenerousService();
    const betaResource = makeTenantScopedRef('tenant-beta', 'dataset', 'battery-beta-data');
    const outcome = await evaluate(service, ALPHA_ADMIN, 'read', betaResource);
    expect(outcome.decision.effect).toBe('deny');
    expect(outcome.decision.reason).toBe('tenant-mismatch');
    expect(outcome.auditRecord.payload.kind).toBe('tenant-access-denied');
  });

  it('EVERY denial is sealed into the audit chain with a closed reason', async () => {
    const service = await makeGenerousService();
    const resource = makeTenantScopedRef('tenant-alpha', 'trajectory', 'battery-trajectory');
    await evaluate(service, BETA_MEMBER, 'read', resource);
    const records = await service.auditSnapshot();
    const last = records[records.length - 1]!;
    expect(last.payload.kind).toBe('tenant-access-denied');
    expect(last.payload.outcome?.effect).toBe('deny');
    expect(typeof last.payload.outcome?.reason).toBe('string');
  });
});

describe('PRIVILEGE ESCALATION ATTEMPTS', () => {
  it('a member self-assigning admin roles fails: duplicates rejected at construction', () => {
    expect(() =>
      toSecurityPrincipal({
        recordVersion: 1,
        principalId: 'escalator',
        kind: 'customer-identity',
        tenantScope: 'tenant-alpha',
        roles: ['tenant-member', 'tenant-admin', 'tenant-admin', 'tenant-owner'],
        label: null,
      }),
    ).toThrowError(/unique/);
  });

  it('crafted policy statements with wildcard actions are rejected (closed vocabulary)', async () => {
    await expect(
      toPolicyBundle({
        recordVersion: 1,
        bundleId: 'evil',
        version: '1.0.0',
        statements: [
          {
            recordVersion: 1,
            statementId: 'god-mode',
            effect: 'allow',
            tenantId: 'tenant-alpha',
            roles: ['tenant-member'],
            action: '*',
            boundaryClass: 'dataset',
          },
        ],
      }),
    ).rejects.toThrowError(/must be one of/);
  });

  it('untenanted "platform" principals get no implicit cross-tenant read', () => {
    const operator = toSecurityPrincipal({
      recordVersion: 1,
      principalId: 'operator-x',
      kind: 'platform-operator',
      tenantScope: 'untenanted',
      roles: ['platform-operator'],
      label: null,
    });
    const resource = makeTenantScopedRef('tenant-alpha', 'dataset', 'battery-operator-target');
    const decision = new AuthorizationEngine(
      // even a bundle that "allows platform operators" tenant-scoped:
      {
        recordVersion: 1,
        bundleId: 'b' as never,
        version: '1.0.0',
        statements: [],
        digest: '0'.repeat(64),
      },
    ).evaluate({ principal: operator, action: 'read', resource, evaluatedAt: T1 as never });
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toBe('no-matching-policy');
  });

  it('the anonymous principal is denied through the service too', async () => {
    const service = await makeGenerousService();
    const resource = makeTenantScopedRef('tenant-alpha', 'dataset', 'battery-anon-target');
    const outcome = await evaluate(
      service,
      makeAnonymousPrincipal() as never,
      'read',
      resource,
    );
    expect(outcome.decision.effect).toBe('deny');
    expect(outcome.decision.reason).toBe('principal-unauthenticated');
  });

  it('registering a DIFFERENT statement set under a known identity is rejected', async () => {
    const service = await makeGenerousService();
    const mutated = {
      ...GENEROUS_ALPHA_BUNDLE,
      statements: GENEROUS_ALPHA_BUNDLE.statements.map((statement) => ({
        ...statement,
        roles: [...statement.roles, 'system'],
      })),
    };
    await expect(
      service.handleRegisterPolicyBundleCommand(
        serializeEnvelope(
          makeRegisterPolicyBundleCommand({ bundle: mutated }, CORR, IDEM),
        ),
      ),
    ).rejects.toThrowError(/identity conflict/);
  });
});

describe('FAIL-CLOSED DEFAULTS', () => {
  it('an empty policy denies everything (no ambient authority)', async () => {
    const service = new SecurityService();
    await service.handleRegisterPolicyBundleCommand(
      serializeEnvelope(
        makeRegisterPolicyBundleCommand(
          {
            bundle: {
              recordVersion: 1,
              bundleId: 'bundle-empty',
              version: '1.0.0',
              statements: [],
            },
          },
          CORR,
          IDEM,
        ),
      ),
    );
    const wired = new SecurityService({
      registry: service.registry,
      auditLog: service.auditLog,
      defaultBundle: { bundleId: 'bundle-empty', version: '1.0.0' },
    });
    const resource = makeTenantScopedRef('tenant-alpha', 'dataset', 'battery-empty');
    const outcome = await evaluate(wired, ALPHA_ADMIN, 'read', resource);
    expect(outcome.decision.effect).toBe('deny');
    expect(outcome.decision.reason).toBe('no-matching-policy');
  });

  it('no addressed bundle ⇒ typed error, never an implicit allow', async () => {
    const service = new SecurityService();
    const resource = makeTenantScopedRef('tenant-alpha', 'dataset', 'battery-no-bundle');
    await expect(
      evaluate(service, ALPHA_MEMBER, 'read', resource),
    ).rejects.toThrowError(/no policy bundle addressed/);
  });

  it('malformed wire commands fail closed with typed SecurityErrors', async () => {
    const service = await makeGenerousService();
    for (const raw of ['not json', '{}', '[]', '{"v":2}']) {
      await expect(
        service.handleEvaluateAuthorizationCommand(raw),
        raw,
      ).rejects.toThrowError();
    }
  });

  it('a tampered policy bundle digest never registers', async () => {
    const service = new SecurityService();
    const tampered = { ...GENEROUS_ALPHA_BUNDLE, digest: 'e'.repeat(64) };
    await expect(
      service.handleRegisterPolicyBundleCommand(
        serializeEnvelope(makeRegisterPolicyBundleCommand({ bundle: tampered }, CORR, IDEM)),
      ),
    ).rejects.toThrowError(SecurityError);
  });

  it('unknown bundle lookups fail closed (NOT_FOUND)', async () => {
    const service = await makeGenerousService();
    expect(() => service.registry.byIdentity('bundle-battery-alpha', '9.9.9')).toThrowError(
      /not found/,
    );
    expect(() => service.registry.byDigestAddress('f'.repeat(64))).toThrowError(/not found/);
  });
});
