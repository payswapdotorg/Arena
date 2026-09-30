/**
 * Authorization engine tests (Work Order A034): fail-closed defaults,
 * deny-overrides-allow, closed decisions, no-wildcard policies,
 * privilege escalation attempts.
 */

import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_ACTIONS,
  AUTHORIZATION_DECISION_REASONS,
  AuthorizationEngine,
  computePolicyBundleDigest,
  DENY_DECISION_REASONS,
  isAuthorizationDecision,
  makeAnonymousPrincipal,
  SECURITY_ERROR_CODES,
  SecurityError,
  toAuthorizationDecision,
  toPolicyBundle,
  toPolicyStatement,
  toSecurityPrincipal,
} from './index.js';
import {
  captureSecurityErrorAsync,
  makeBundleInput,
  makePrincipalInput,
  makeStatementInput,
  makeTenantScopedRefInput,
  T1,
  TENANT_A,
  TENANT_B,
} from './test-support.js';
import { toTenantScopedRef } from './tenancy.js';
import type { SecurityTimestamp } from './shared.js';

const EVALUATED_AT = T1 as SecurityTimestamp;

function makeTenantScopedRef() {
  return toTenantScopedRef(makeTenantScopedRefInput());
}

async function makeEngine(statements: Record<string, unknown>[]) {
  const bundle = await toPolicyBundle(makeBundleInput(statements));
  return new AuthorizationEngine(bundle);
}

describe('policy statement validation (no wildcards, no escalation)', () => {
  it('accepts a well-formed allow statement', () => {
    const statement = toPolicyStatement(makeStatementInput());
    expect(statement.effect).toBe('allow');
    expect(statement.action).toBe('read');
  });

  it('rejects wildcard actions and boundary classes (closed vocabularies)', () => {
    expect(() => toPolicyStatement(makeStatementInput({ action: '*' }))).toThrowError(
      /must be one of/,
    );
    expect(() =>
      toPolicyStatement(makeStatementInput({ boundaryClass: 'everything' })),
    ).toThrowError(/must be one of/);
  });

  it('rejects unknown effects and unknown fields', () => {
    expect(() => toPolicyStatement(makeStatementInput({ effect: 'maybe' }))).toThrowError(
      SecurityError,
    );
    expect(() =>
      toPolicyStatement(makeStatementInput({ condition: 'always' })),
    ).toThrowError(/unknown field/);
  });

  it('rejects duplicate statement ids inside a bundle (identity conflict)', async () => {
    const duplicate = [makeStatementInput(), makeStatementInput()];
    await expect(toPolicyBundle(makeBundleInput(duplicate))).rejects.toThrowError(
      /duplicate statementIds/,
    );
  });

  it('a tampered digest fails closed (recomputed digest is authoritative)', async () => {
    const bundle = await toPolicyBundle(makeBundleInput([makeStatementInput()]));
    const tampered = { ...bundle, digest: 'f'.repeat(64) };
    const tamperError = await captureSecurityErrorAsync(() => toPolicyBundle(tampered));
    expect(tamperError.code).toBe(SECURITY_ERROR_CODES.TAMPERED);
  });

  it('statement order does not change the bundle digest (content addressing)', async () => {
    const first = toPolicyStatement(makeStatementInput({ statementId: 'stmt-a' }));
    const second = toPolicyStatement(
      makeStatementInput({ statementId: 'stmt-b', roles: ['tenant-admin'] }),
    );
    const digestOne = await computePolicyBundleDigest([first, second]);
    const digestTwo = await computePolicyBundleDigest([second, first]);
    expect(digestOne).toBe(digestTwo);
  });
});

describe('the engine is fail-closed by default', () => {
  it('no matching policy ⇒ deny with reason no-matching-policy (THE default)', async () => {
    const engine = await makeEngine([
      makeStatementInput({ statementId: 'stmt-write', action: 'write' }),
    ]);
    const principal = toSecurityPrincipal(makePrincipalInput());
    const decision = engine.evaluate({
      principal,
      action: 'delete',
      resource: makeTenantScopedRef(),
      evaluatedAt: EVALUATED_AT,
    });
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toBe('no-matching-policy');
  });

  it('anonymous principals are denied everything', async () => {
    const engine = await makeEngine([
      makeStatementInput({
        roles: [
          'tenant-member',
          'tenant-owner',
          'tenant-admin',
          'expert-contributor',
          'auditor',
          'platform-operator',
          'system',
        ],
      }),
    ]);
    const decision = engine.evaluate({
      principal: makeAnonymousPrincipal(),
      action: 'read',
      resource: makeTenantScopedRef(),
      evaluatedAt: EVALUATED_AT,
    });
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toBe('principal-unauthenticated');
  });

  it('invalid principal shape ⇒ deny principal-invalid, never an exception', async () => {
    const engine = await makeEngine([makeStatementInput()]);
    const decision = engine.evaluate({
      principal: { not: 'a principal' } as never,
      action: 'read',
      resource: makeTenantScopedRef(),
      evaluatedAt: EVALUATED_AT,
    });
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toBe('principal-invalid');
  });

  it('unknown action ⇒ deny unknown-action (closed action vocabulary)', async () => {
    const engine = await makeEngine([makeStatementInput()]);
    const decision = engine.evaluate({
      principal: toSecurityPrincipal(makePrincipalInput()),
      action: 'sudo' as never,
      resource: makeTenantScopedRef(),
      evaluatedAt: EVALUATED_AT,
    });
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toBe('unknown-action');
  });

  it('invalid resource ⇒ deny resource-invalid', async () => {
    const engine = await makeEngine([makeStatementInput()]);
    const decision = engine.evaluate({
      principal: toSecurityPrincipal(makePrincipalInput()),
      action: 'read',
      resource: null as never,
      evaluatedAt: EVALUATED_AT,
    });
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toBe('resource-invalid');
  });
});

describe('deny overrides allow', () => {
  it('a matching deny beats any number of matching allows', async () => {
    const engine = await makeEngine([
      makeStatementInput({ statementId: 'allow-1' }),
      makeStatementInput({ statementId: 'allow-2', roles: ['tenant-owner'] }),
      makeStatementInput({ statementId: 'deny-1', effect: 'deny' }),
    ]);
    const decision = engine.evaluate({
      principal: toSecurityPrincipal(makePrincipalInput()),
      action: 'read',
      resource: makeTenantScopedRef(),
      evaluatedAt: EVALUATED_AT,
    });
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toBe('deny-overrides');
    expect(decision.matchedDenyIds).toEqual(['deny-1']);
  });
});

describe('tenant scoping of policy statements', () => {
  it('a tenant-A statement never authorizes a tenant-B principal', async () => {
    const engine = await makeEngine([makeStatementInput({ tenantId: TENANT_A })]);
    const decision = engine.evaluate({
      principal: toSecurityPrincipal(
        makePrincipalInput({ tenantScope: TENANT_B, principalId: 'principal-b-1' }),
      ),
      action: 'read',
      resource: toTenantScopedRef(
        makeTenantScopedRefInput({ tenantId: TENANT_B, recordId: 'dataset-b-1' }),
      ),
      evaluatedAt: EVALUATED_AT,
    });
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toBe('no-matching-policy');
  });
});

describe('privilege escalation attempts (negative)', () => {
  it('tenant-member cannot use admin actions absent an allow statement', async () => {
    const engine = await makeEngine([
      makeStatementInput({ statementId: 'read-only', action: 'read' }),
    ]);
    const principal = toSecurityPrincipal(makePrincipalInput({ roles: ['tenant-member'] }));
    for (const action of [
      'administer',
      'delete',
      'publish',
      'certify',
      'export',
      'audit-read',
      'use-for-learning',
      'write',
    ] as const) {
      const decision = engine.evaluate({
        principal,
        action,
        resource: makeTenantScopedRef(),
        evaluatedAt: EVALUATED_AT,
      });
      expect(decision.effect).toBe('deny');
      expect(decision.reason).toBe('no-matching-policy');
    }
  });

  it('role escalation via duplicate roles is rejected at construction', () => {
    expect(() =>
      toSecurityPrincipal(
        makePrincipalInput({ roles: ['tenant-member', 'tenant-admin', 'tenant-admin'] }),
      ),
    ).toThrowError(/unique/);
  });

  it('an allow statement for one action does not leak to other actions', async () => {
    const engine = await makeEngine([
      makeStatementInput({ statementId: 'read-dataset', action: 'read' }),
    ]);
    const principal = toSecurityPrincipal(
      makePrincipalInput({ roles: ['tenant-member', 'tenant-admin'] }),
    );
    const decision = engine.evaluate({
      principal,
      action: 'write',
      resource: makeTenantScopedRef(),
      evaluatedAt: EVALUATED_AT,
    });
    expect(decision.effect).toBe('deny');
  });
});

describe('decision records are closed and frozen', () => {
  it('allow decisions carry exactly reason policy-allowed and the driving statement id', async () => {
    const engine = await makeEngine([makeStatementInput()]);
    const decision = engine.evaluate({
      principal: toSecurityPrincipal(makePrincipalInput()),
      action: 'read',
      resource: makeTenantScopedRef(),
      evaluatedAt: EVALUATED_AT,
    });
    expect(decision.effect).toBe('allow');
    expect(decision.reason).toBe('policy-allowed');
    expect(decision.policyStatementId).toBe('stmt-allow-read-dataset');
    expect(Object.isFrozen(decision)).toBe(true);
    expect(isAuthorizationDecision(decision)).toBe(true);
  });

  it('allow reason is reserved: a deny carrying policy-allowed is rejected', () => {
    expect(() =>
      toAuthorizationDecision({
        recordVersion: 1,
        effect: 'deny',
        reason: 'policy-allowed',
        principalId: 'p',
        tenantScope: TENANT_A,
        action: 'read',
        boundaryClass: 'dataset',
        recordId: 'r',
        policyStatementId: null,
        matchedDenyIds: [],
        evaluatedAt: T1,
      }),
    ).toThrowError(/never carry reason 'policy-allowed'/);
  });

  it('deny decisions carry closed reasons only', () => {
    for (const reason of DENY_DECISION_REASONS) {
      expect(AUTHORIZATION_DECISION_REASONS).toContain(reason);
    }
    expect(DENY_DECISION_REASONS).not.toContain('policy-allowed');
  });

  it('the action vocabulary is closed and frozen', () => {
    expect(Object.isFrozen(AUTHORIZATION_ACTIONS)).toBe(true);
    expect(AUTHORIZATION_ACTIONS).not.toContain('*');
    expect(AUTHORIZATION_ACTIONS).not.toContain('sudo');
  });
});
