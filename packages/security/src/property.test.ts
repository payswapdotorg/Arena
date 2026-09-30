/**
 * Property-style invariants (Work Order A034), run as randomized
 * repetitions with a FIXED seed-driven generator (deterministic).
 */

import { describe, expect, it } from 'vitest';
import type { AuthorizationAction } from './authorization.js';
import {
  AuthorizationEngine,
  checkTenantBoundary,
  makeAnonymousPrincipal,
  makeTenantScopedRef,
  toPolicyBundle,
  toSecurityPrincipal,
  toTenantId,
  TENANT_BOUNDARY_CLASSES,
} from './index.js';
import { makeBundleInput, makeStatementInput, T1, TENANT_A, TENANT_B } from './test-support.js';
import type { SecurityTimestamp } from './shared.js';
import type { TenantBoundaryClass } from './tenancy.js';

/** Deterministic LCG — reproducible property runs (no Math.random). */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const EVALUATED_AT = T1 as SecurityTimestamp;

const ACTIONS = [
  'read',
  'write',
  'delete',
  'export',
  'publish',
  'use-for-learning',
  'certify',
  'administer',
  'audit-read',
] as const;

const ROLES = [
  'tenant-owner',
  'tenant-admin',
  'tenant-member',
  'expert-contributor',
  'auditor',
  'platform-operator',
  'system',
] as const;

describe('invariant: the engine never allows without a matching allow statement', () => {
  it('100 random (principal, action, resource) tuples over a deny-only bundle are all denied', async () => {
    const rng = makeRng(0x5eed034);
    const engine = new AuthorizationEngine(
      await toPolicyBundle(
        makeBundleInput([
          makeStatementInput({ statementId: 'deny-read', effect: 'deny', action: 'read' }),
        ]),
      ),
    );
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const action = ACTIONS[Math.floor(rng() * ACTIONS.length)] as AuthorizationAction;
      const role = ROLES[Math.floor(rng() * ROLES.length)];
      const principal = toSecurityPrincipal({
        recordVersion: 1,
        principalId: `principal-${String(iteration)}`,
        kind: 'customer-identity',
        tenantScope: TENANT_A,
        roles: [role],
        label: null,
      });
      const boundaryClass = TENANT_BOUNDARY_CLASSES[
        Math.floor(rng() * TENANT_BOUNDARY_CLASSES.length)
      ] as TenantBoundaryClass;
      const resource = makeTenantScopedRef(TENANT_A, boundaryClass, `record-${String(iteration)}`);
      const decision = engine.evaluate({ principal, action, resource, evaluatedAt: EVALUATED_AT });
      expect(decision.effect).toBe('deny');
    }
  });

  it('an empty bundle denies everything (the pure fail-closed default)', async () => {
    const rng = makeRng(0x5eed0a5);
    const engine = new AuthorizationEngine(
      await toPolicyBundle(makeBundleInput([])),
    );
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const action = ACTIONS[Math.floor(rng() * ACTIONS.length)] as AuthorizationAction;
      const principal = toSecurityPrincipal({
        recordVersion: 1,
        principalId: `principal-${String(iteration)}`,
        kind: 'customer-identity',
        tenantScope: TENANT_A,
        roles: ['tenant-owner'],
        label: null,
      });
      const decision = engine.evaluate({
        principal,
        action,
        resource: makeTenantScopedRef(TENANT_A, 'dataset', 'dataset-x'),
        evaluatedAt: EVALUATED_AT,
      });
      expect(decision.effect).toBe('deny');
      expect(decision.reason).toBe('no-matching-policy');
    }
  });
});

describe('invariant: tenancy is symmetric and strict', () => {
  it('accessor==resource tenant iff allowed, for 100 random pairs', () => {
    const rng = makeRng(0x5eed7e0);
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const ownerTenant = toTenantId(rng() < 0.5 ? TENANT_A : TENANT_B, 'owner');
      const accessorSame = rng() < 0.5;
      const resource = makeTenantScopedRef(
        ownerTenant,
        'dataset',
        `dataset-${String(iteration)}`,
      );
      const decision = checkTenantBoundary(
        accessorSame
          ? ownerTenant
          : toTenantId(ownerTenant === TENANT_A ? TENANT_B : TENANT_A, 'accessor'),
        resource,
      );
      expect(decision.allowed).toBe(accessorSame);
    }
  });

  it('the anonymous principal is untenanted by construction', () => {
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const anonymous = makeAnonymousPrincipal();
      expect(anonymous.tenantScope).toBe('untenanted');
      const decision = checkTenantBoundary(
        anonymous.tenantScope,
        makeTenantScopedRef(TENANT_A, 'dataset', 'dataset-any'),
      );
      expect(decision.allowed).toBe(false);
    }
  });
});

describe('invariant: tenant ids validate deterministically', () => {
  it('round-trips through the branded charset', () => {
    expect(toTenantId(TENANT_A, 'test')).toBe(TENANT_A);
    expect(toTenantId(TENANT_B, 'test')).toBe(TENANT_B);
  });
});
