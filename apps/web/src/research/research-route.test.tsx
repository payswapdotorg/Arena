import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Research-route composition tests (Work Order B012; issue #87) — the
 * fail-closed route outcome (auth-required), the authenticated session
 * posture (honest empty states), and the deterministic demo composition
 * (composition-scoped comparison, supersession, dataset lineage).
 */

import { createLocalAuthStack } from '../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../../../packages/security/src/index.js';
import { ManualClock } from '../../../../packages/persistence/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import {
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
} from '../../../../packages/role-context/src/index.js';
import {
  ResearchAuthRequiredView,
  ResearchHomeView,
  resolveDemoResearchHome,
  resolveResearchExperience,
} from './index.js';

const T = '2026-10-01T08:00:00.000Z';

const NO_COOKIE_PROBE = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

/** Build a REAL authenticated session fixture (the cockpit runtime-test pattern). */
async function buildSessionFixture() {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'b012-research-test-secret-0123456789abcdefgh',
    credentials: [
      {
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'worker-1' } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: 'principal-b012-002',
          kind: 'customer-identity',
          tenantScope: 'tenant-b012',
          roles: ['tenant-owner'],
          label: 'b012-researcher',
        }),
      },
    ],
    clock,
  });
  const principal = await auth.service.authenticate({ method: 'test-login', claims: { who: 'worker-1' } });
  const issuance = await auth.service.issueSession({
    principal,
    tenantId: 'tenant-b012',
    workspaceContext: createWorkspaceContext({
      identityId: 'principal-b012-002',
      tenantId: 'tenant-b012',
      workspaceId: 'tenant-b012-ws',
      permissionPolicy: createPermissionPolicy({
        policyId: 'tenant-b012-policy',
        tenantId: 'tenant-b012',
        descriptor: { kind: 'test-policy' },
        issuedAt: T,
      }),
      grantedRoles: ['researcher'].map((roleId) =>
        grantRole({
          grantId: `grant-${roleId}`,
          identityId: 'principal-b012-002',
          tenantId: 'tenant-b012',
          roleId,
          policyId: 'tenant-b012-policy',
          grantedBy: 'test',
          grantedAt: T,
          validFrom: T,
        }),
      ),
    }),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'worker-1' } }),
  });
  return {
    probe: {
      cookieValue: () => Promise.resolve(issuance.cookie.value),
      validate: (token: string) => auth.service.validateSession(token),
    },
  };
}

describe('research route composition (fail closed)', () => {
  it('renders the auth-required notice — never an anonymous research surface (negative)', async () => {
    const experience = await resolveResearchExperience({ probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('auth-required');
    const html = renderToStaticMarkup(<ResearchAuthRequiredView />);
    expect(html).toContain('data-arena-surface-auth="required"');
    expect(html).toContain('data-arena-state="denied"');
    expect(html).not.toContain('data-arena-benchmark-table');
    expect(html).toContain('/demo/research');
  });
});

describe('research session posture (honest empty states)', () => {
  it('renders the honest empties — no fabricated benchmark or lineage data (negative)', async () => {
    const fixture = await buildSessionFixture();
    const experience = await resolveResearchExperience({ probe: fixture.probe });
    expect(experience.kind).toBe('home');
    if (experience.kind !== 'home') throw new Error('unreachable');
    const html = renderToStaticMarkup(<ResearchHomeView view={experience.view} />);
    expect(html).toContain('data-arena-route="research"');
    expect(html).toContain('data-arena-research-distinction="true"');
    expect(html).toContain('No benchmark runs recorded yet');
    expect(html).toContain('No published datasets yet');
    expect(html).not.toContain('data-arena-demo-banner="true"');
    expect(html).not.toContain('data-arena-benchmark-run=');
  });
});

describe('demo research route composition (B006 posture)', () => {
  it('composes the demo home over the reserved demo tenant, deterministically (positive)', async () => {
    const view = await resolveDemoResearchHome();
    expect(view.mode).toBe('demo');
    expect(view.tenantId).toBe('arena-demo');
    expect(view.demo.isDemo).toBe(true);
    expect(view.runs).toHaveLength(2);
    const one = renderToStaticMarkup(<ResearchHomeView view={view} />);
    const two = renderToStaticMarkup(<ResearchHomeView view={view} />);
    expect(one).toBe(two);
    expect(one).toContain('data-arena-demo-banner="true"');
    expect(one).toContain('data-arena-research-distinction="true"');
    expect(one).toContain('NEVER a statement about the model alone');
  });

  it('renders the composition-scoped comparison table with supersession, never silent deletion (positive)', async () => {
    const view = await resolveDemoResearchHome();
    const html = renderToStaticMarkup(<ResearchHomeView view={view} />);
    expect(html).toContain('data-arena-benchmark-table="true"');
    expect(html).toContain('data-arena-benchmark-run="demo.research.benchmark.run-1"');
    expect(html).toContain('data-arena-benchmark-run="demo.research.benchmark.run-2"');
    expect(html).toContain('data-arena-benchmark-superseded="true"');
    expect(html).toContain('data-arena-benchmark-superseded="false"');
    expect(html).toContain('data-arena-supersession="true"');
    // Cells carry per-criterion scores; the aggregate carries the evaluation-result mark.
    expect(html).toContain('data-arena-benchmark-cell="regression-coverage:0.9"');
    expect(html).toContain('data-arena-truth="evaluation"');
    // The subject label names the FULL composition — never the model alone.
    expect(html).toContain('arena-reference/software-engineer-body@1.1.0');
    expect(html).toContain('substrate workspace-mount@1.0.0');
    expect(html).toContain('env sandboxed-workspace@1.0.0');
    expect(html).toContain('runtime arena-runtime@2.1.0');
    expect(html).toContain('data-arena-research-evidence="true"');
  });

  it('renders the dataset lineage as evidence with parent edges and derivation relations (positive)', async () => {
    const view = await resolveDemoResearchHome();
    const html = renderToStaticMarkup(<ResearchHomeView view={view} />);
    expect(html).toContain('data-arena-lineage-node="payments-reliability-benchmark"');
    expect(html).toContain('data-arena-lineage-node="payments-reliability-benchmark-holdout"');
    expect(html).toContain('data-arena-lineage-parents="true"');
    expect(html).toContain('data-arena-lineage-relation="extracted-from"');
    expect(html).toContain('data-arena-lineage-root="true"');
    expect(html).toContain('data-arena-truth="evidence"');
  });
});
