/**
 * Replay runtime composition tests (Work Order B011; apps/web/src/replay).
 *
 * The house style: REAL composed boundaries (the B004 local auth stack,
 * the B002 fakes, the B005 read-model service), injected session
 * probes. Asserts the fail-closed session composition and the
 * deterministic demo composition (the B006 posture).
 */

import { describe, expect, it } from 'vitest';
import { createLocalAuthStack } from '../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../../../packages/security/src/index.js';
import { ManualClock } from '../../../../packages/persistence/src/index.js';
import {
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
} from '../../../../packages/role-context/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import {
  getDemoReplayContext,
  resolveSessionReplay,
  resetDemoReplayContext,
} from './runtime.js';

const T = '2026-10-01T08:00:00.000Z';

const NO_COOKIE_PROBE = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

async function buildSessionProbe() {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'b011-test-session-secret-0123456789abcdefghij',
    credentials: [
      {
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'worker-1' } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: 'principal-b011-001',
          kind: 'customer-identity',
          tenantScope: 'tenant-b011',
          roles: ['tenant-owner'],
          label: 'b011-tester',
        }),
      },
    ],
    clock,
  });
  const principal = await auth.service.authenticate({ method: 'test-login', claims: { who: 'worker-1' } });
  const issuance = await auth.service.issueSession({
    principal,
    tenantId: 'tenant-b011',
    workspaceContext: createWorkspaceContext({
      identityId: 'principal-b011-001',
      tenantId: 'tenant-b011',
      workspaceId: 'tenant-b011-ws',
      permissionPolicy: createPermissionPolicy({
        policyId: 'tenant-b011-policy',
        tenantId: 'tenant-b011',
        descriptor: { kind: 'test-policy' },
        issuedAt: T,
      }),
      grantedRoles: ['owner'].map((roleId) =>
        grantRole({
          grantId: `grant-${roleId}`,
          identityId: 'principal-b011-001',
          tenantId: 'tenant-b011',
          roleId,
          policyId: 'tenant-b011-policy',
          grantedBy: 'test',
          grantedAt: T,
          validFrom: T,
        }),
      ),
    }),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'worker-1' } }),
  });
  return {
    cookieValue: () => Promise.resolve(issuance.cookie.value),
    validate: (token: string) => auth.service.validateSession(token),
  };
}

describe('session composition (fail closed through the B004 boundary)', () => {
  it('renders the typed unauthenticated outcome without a session cookie (negative)', async () => {
    const outcome = await resolveSessionReplay({ probe: NO_COOKIE_PROBE });
    expect(outcome.status).toBe('unauthenticated');
    if (outcome.status === 'unauthenticated') {
      expect(outcome.code).toBe('AUTH_SESSION_NOT_FOUND');
    }
  });

  it('exposes session facts + the canonical read port for an authenticated session (positive)', async () => {
    const probe = await buildSessionProbe();
    const outcome = await resolveSessionReplay({ probe });
    expect(outcome.status).toBe('authenticated');
    if (outcome.status === 'authenticated') {
      expect(outcome.facts.tenantId).toBe('tenant-b011');
      expect(outcome.facts.grantedRoleIds).toContain('owner');
      expect(typeof outcome.port.scroll).toBe('function');
    }
  });
});

describe('demo composition (B006 posture, deterministic)', () => {
  it('composes over the reserved demo tenant with the deterministic corpus (positive)', async () => {
    resetDemoReplayContext();
    const context = await getDemoReplayContext();
    expect(context.facts.tenantId).toBe('arena-demo');
    expect(context.corpus.runs).toHaveLength(3);
    expect(context.corpusHash.length).toBeGreaterThan(0);
    // The corpus hash is the demo store's determinism stamp — stable.
    const again = await getDemoReplayContext();
    expect(again.corpusHash).toBe(context.corpusHash);
  });

  it('recomposes identically after a reset (determinism, never a second authority)', async () => {
    const first = await getDemoReplayContext();
    resetDemoReplayContext();
    const second = await getDemoReplayContext();
    expect(second.corpus.corpusHash).toBe(first.corpus.corpusHash);
    expect(
      second.corpus.runs.map((run) => run.trajectory.chainHead),
    ).toEqual(first.corpus.runs.map((run) => run.trajectory.chainHead));
  });
});
