import { describe, expect, it } from 'vitest';

/**
 * Marketplace runtime tests (Work Order B013) — the house style: plain node
 * environment, REAL composed boundaries (the B004 local auth stack, the B005
 * read-model service + read-API boundary), injected session probes (no
 * next/headers request scope needed).
 */

import { createLocalAuthStack } from '../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../../../packages/security/src/index.js';
import { ManualClock } from '../../../../packages/persistence/src/index.js';
import {
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
} from '../../../../packages/role-context/src/index.js';
import type { WorkspaceContext } from '../../../../packages/role-context/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import {
  getDemoMarketplaceContext,
  resolveMarketplaceSession,
} from './runtime.js';
import type { MarketplaceSessionProbe } from './runtime.js';

const T = '2026-10-01T08:00:00.000Z';

function buildWorkspace(tenantId: string, roleIds: readonly string[]): WorkspaceContext {
  return createWorkspaceContext({
    identityId: 'marketplace-visitor',
    tenantId,
    workspaceId: `${tenantId}-ws`,
    permissionPolicy: createPermissionPolicy({
      policyId: `${tenantId}-policy`,
      tenantId,
      descriptor: { kind: 'test-policy' },
      issuedAt: T,
    }),
    grantedRoles: roleIds.map((roleId, index) =>
      grantRole({
        grantId: `grant-${roleId}-${String(index)}`,
        identityId: 'marketplace-visitor',
        tenantId,
        roleId,
        policyId: `${tenantId}-policy`,
        grantedBy: 'test',
        grantedAt: T,
        validFrom: T,
      }),
    ),
  });
}

async function buildSessionProbe(
  tenantId: string,
): Promise<MarketplaceSessionProbe> {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'test-session-secret-0123456789abcdefghijklmnop',
    credentials: [
      {
        credential: createAuthMethodDescriptor({
          method: 'test-login',
          claims: { who: 'marketplace-visitor' },
        }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: 'marketplace-visitor',
          kind: 'customer-identity',
          tenantScope: tenantId,
          roles: ['tenant-member'],
          label: 'marketplace-visitor',
        }),
      },
    ],
    clock,
  });
  const principal = await auth.service.authenticate({
    method: 'test-login',
    claims: { who: 'marketplace-visitor' },
  });
  const issuance = await auth.service.issueSession({
    principal,
    tenantId,
    workspaceContext: buildWorkspace(tenantId, ['marketplace-participant']),
    authMethod: createAuthMethodDescriptor({
      method: 'test-login',
      claims: { who: 'marketplace-visitor' },
    }),
  });
  const cookieValue = issuance.cookie.value;
  return {
    cookieValue: () => Promise.resolve(cookieValue),
    validate: (token: string) => auth.service.validateSession(token),
  };
}

const NO_COOKIE_PROBE: MarketplaceSessionProbe = {
  cookieValue: () => Promise.resolve(null),
  validate: () => {
    throw new Error('unreachable: no cookie means validate is never called');
  },
};

describe('marketplace runtime (B013 — fail closed, never anonymous)', () => {
  it('fails closed without a session cookie (negative)', async () => {
    const outcome = await resolveMarketplaceSession({ probe: NO_COOKIE_PROBE });
    expect(outcome.status).toBe('unauthenticated');
    if (outcome.status === 'unauthenticated') {
      expect(outcome.code).toBe('AUTH_SESSION_NOT_FOUND');
    }
  });

  it('fails closed on typed AUTH failures (negative)', async () => {
    const error = new Error('session expired') as Error & { code: string };
    error.code = 'AUTH_SESSION_EXPIRED';
    const probe: MarketplaceSessionProbe = {
      cookieValue: () => Promise.resolve('stale-token'),
      validate: () => {
        throw error;
      },
    };
    const outcome = await resolveMarketplaceSession({ probe });
    expect(outcome.status).toBe('unauthenticated');
    if (outcome.status === 'unauthenticated') {
      expect(outcome.code).toBe('AUTH_SESSION_EXPIRED');
    }
  });

  it('resolves an authenticated session with facts + port + corpus (positive)', async () => {
    const probe = await buildSessionProbe('tenant-a');
    const outcome = await resolveMarketplaceSession({ probe });
    expect(outcome.status).toBe('authenticated');
    if (outcome.status === 'authenticated') {
      expect(outcome.facts.tenantId).toBe('tenant-a');
      expect(outcome.facts.workspaceId).toBe('tenant-a-ws');
      expect(outcome.facts.principalLabel).toBe('marketplace-visitor');
      expect(outcome.facts.grantedRoleIds).toContain('marketplace-participant');
      expect(outcome.corpus.mode).toBe('session');
      expect(outcome.corpus.tenant).toBe('tenant-a');
      // The certification read port works over the (empty, honest) read model.
      const page = await outcome.port.scroll('certification');
      expect(page.records).toHaveLength(0);
    }
  });

  it('scopes a second-tenant session through the same boundary (positive)', async () => {
    const probe = await buildSessionProbe('tenant-b');
    const outcome = await resolveMarketplaceSession({ probe });
    expect(outcome.status).toBe('authenticated');
    if (outcome.status === 'authenticated') {
      expect(outcome.facts.tenantId).toBe('tenant-b');
      expect(outcome.facts.workspaceId).toBe('tenant-b-ws');
      // The session corpus is tenant-seeded; the reading tenant is the lens.
      expect(outcome.corpus.tenant).toBe('tenant-a');
    }
  });

  it('composes the demo context over the shared demo runtime (positive)', async () => {
    const context = await getDemoMarketplaceContext();
    expect(context.facts.tenantId).toBe('arena-demo');
    expect(context.facts.workspaceId).toBe('demo-workspace');
    expect(context.corpus.mode).toBe('demo');
    // The shared demo runtime stamps its corpus snapshot; the marketplace
    // corpus carries its own sha256 content hash.
    expect(context.corpusHash.length).toBeGreaterThan(0);
    expect(context.marketplaceCorpusHash).toMatch(/^[0-9a-f]{64}$/);
    // The demo certification record scrolls through the canonical read path.
    const page = await context.port.scroll('certification');
    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.kind).toBe('certification');
  });
});
