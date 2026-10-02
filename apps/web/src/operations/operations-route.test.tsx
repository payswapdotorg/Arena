import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Operations-route composition tests (Work Order B014) — the fail-closed
 * route outcomes (auth-required; honest not-found), the authenticated
 * session posture (honest empty jobs, REAL no-data SLO evaluations,
 * DISABLED capacity, empty audit), and the deterministic demo
 * compositions. The house style: REAL composed boundaries (the B004
 * local auth stack, the B002 fakes, the B005 read-model service),
 * injected session probes.
 */

import { createLocalAuthStack } from '../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../../../packages/security/src/index.js';
import {
  FakeControlPlaneRepository,
  ManualClock,
} from '../../../../packages/persistence/src/index.js';
import { ReadModelService } from '../../../../services/read-model/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import {
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
} from '../../../../packages/role-context/src/index.js';
import {
  AuditStreamScreenView,
  CapacityPanelView,
  JobDetailView,
  JobsListView,
  OperationsAuthRequiredView,
  OperationsHomeView,
  OperationsNotFoundView,
  resolveDemoOperationsAudit,
  resolveDemoOperationsCapacity,
  resolveDemoOperationsHome,
  resolveDemoOperationsJobExperience,
  resolveDemoOperationsJobs,
  resolveOperationsAuditExperience,
  resolveOperationsCapacityExperience,
  resolveOperationsExperience,
  resolveOperationsJobExperience,
  resolveOperationsJobsExperience,
} from './index.js';
import { OPERATIONS_DEMO_EPOCH_MS, OPERATIONS_DEMO_JOB_IDS } from './fixtures.js';

const T = '2026-10-01T08:00:00.000Z';

const NO_COOKIE_PROBE = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

/** Build a REAL authenticated session fixture (the cockpit runtime-test pattern). */
async function buildSessionFixture() {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'b014-test-session-secret-0123456789abcdefghij',
    credentials: [
      {
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'worker-1' } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: 'principal-b014-001',
          kind: 'customer-identity',
          tenantScope: 'tenant-b014',
          roles: ['tenant-owner'],
          label: 'b014-tester',
        }),
      },
    ],
    clock,
  });
  const principal = await auth.service.authenticate({ method: 'test-login', claims: { who: 'worker-1' } });
  const issuance = await auth.service.issueSession({
    principal,
    tenantId: 'tenant-b014',
    workspaceContext: createWorkspaceContext({
      identityId: 'principal-b014-001',
      tenantId: 'tenant-b014',
      workspaceId: 'tenant-b014-ws',
      permissionPolicy: createPermissionPolicy({
        policyId: 'tenant-b014-policy',
        tenantId: 'tenant-b014',
        descriptor: { kind: 'test-policy' },
        issuedAt: T,
      }),
      grantedRoles: ['owner', 'operator', 'administrator'].map((roleId) =>
        grantRole({
          grantId: `grant-${roleId}`,
          identityId: 'principal-b014-001',
          tenantId: 'tenant-b014',
          roleId,
          policyId: 'tenant-b014-policy',
          grantedBy: 'test',
          grantedAt: T,
          validFrom: T,
        }),
      ),
    }),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'worker-1' } }),
  });
  const repository = new FakeControlPlaneRepository({ clock });
  const readModel = new ReadModelService({ repository, clock });
  return {
    probe: {
      cookieValue: () => Promise.resolve(issuance.cookie.value),
      validate: (token: string) => auth.service.validateSession(token),
    },
    repository,
    readModel,
  };
}

describe('operations route composition (fail closed)', () => {
  it('renders the auth-required notice — never an anonymous surface (negative)', async () => {
    const experience = await resolveOperationsExperience({ probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('auth-required');
    const html = renderToStaticMarkup(<OperationsAuthRequiredView />);
    expect(html).toContain('data-arena-surface-auth="required"');
    expect(html).toContain('data-arena-state="denied"');
    expect(html).not.toContain('data-arena-job=');
    expect(html).toContain('/demo/operations');
  });

  it('the screen routes are auth-required without a session too (negative)', async () => {
    const outcomes = [
      await resolveOperationsJobsExperience({ probe: NO_COOKIE_PROBE }),
      await resolveOperationsJobExperience({ id: 'any', probe: NO_COOKIE_PROBE }),
      await resolveOperationsAuditExperience({ probe: NO_COOKIE_PROBE }),
      await resolveOperationsCapacityExperience({ probe: NO_COOKIE_PROBE }),
    ];
    for (const outcome of outcomes) {
      expect(outcome.kind).toBe('auth-required');
    }
  });
});

describe('operations session posture (honest states, nothing fabricated)', () => {
  it('renders honest empty jobs, REAL no-data SLO rows, DISABLED capacity and an empty audit stream', async () => {
    const fixture = await buildSessionFixture();
    const experience = await resolveOperationsExperience({
      probe: fixture.probe,
      now: OPERATIONS_DEMO_EPOCH_MS,
    });
    expect(experience.kind).toBe('home');
    if (experience.kind !== 'home') throw new Error('unreachable');
    const view = experience.view;

    // Jobs: honestly empty, with the posture note.
    expect(view.jobs).toEqual([]);
    // SLO: the REAL evaluator over zero samples — every row no-data, fail closed.
    expect(view.sloRows).toHaveLength(8);
    for (const row of view.sloRows) {
      expect(row.posture).toBe('no-data');
      expect(row.verdict).toBe('no-data');
      expect(row.measured).toBeNull();
    }
    // Capacity: every provider DISABLED (configuration-missing), overall DISABLED.
    expect(view.capacity.overall).toBe('DISABLED');
    for (const provider of view.capacity.providers) {
      expect(provider.status).toBe('DISABLED');
      expect(provider.failClosed).toBe(true);
    }
    // Audit: honestly empty.
    expect(view.auditPreview).toEqual([]);

    const html = renderToStaticMarkup(<OperationsHomeView view={view} />);
    expect(html).toContain('data-arena-route="operations"');
    expect(html).toContain('data-arena-surface-mode="session"');
    expect(html).toContain('data-arena-operations-law="true"');
    expect(html).toContain('No job records');
    expect(html).toContain('no-data');
    expect(html).toContain('fail closed');
    expect(html).toContain('configuration-missing');
    expect(html).toContain('No audit events');
    // The role lens renders its facts and the absent-capabilities note.
    expect(html).toContain('data-arena-role-lens="true"');
    expect(html).toContain('data-arena-lens-absent="true"');
    expect(html).toContain('operator');
    // No demo labelling in the session posture.
    expect(html).not.toContain('data-arena-demo-banner="true"');
    // No fabricated job rows.
    expect(html).not.toContain('data-arena-job=');
  });

  it('the job detail route resolves the honest not-found outcome (negative)', async () => {
    const fixture = await buildSessionFixture();
    const outcome = await resolveOperationsJobExperience({
      id: 'missing-job',
      probe: fixture.probe,
    });
    expect(outcome).toEqual({ kind: 'not-found', jobId: 'missing-job' });
    const html = renderToStaticMarkup(
      <OperationsNotFoundView
        title="Job not found"
        recordId="missing-job"
        hint="No A015 job record exists for this id in this posture — the canonical records are never guessed."
      />,
    );
    expect(html).toContain('data-arena-detail-status="not-found"');
    expect(html).toContain('data-arena-state="empty"');
  });

  it('the audit and capacity screens render their honest session postures', async () => {
    const fixture = await buildSessionFixture();
    const audit = await resolveOperationsAuditExperience({
      probe: fixture.probe,
      now: OPERATIONS_DEMO_EPOCH_MS,
    });
    expect(audit.kind).toBe('stream');
    if (audit.kind !== 'stream') throw new Error('unreachable');
    const auditHtml = renderToStaticMarkup(<AuditStreamScreenView view={audit.view} />);
    expect(auditHtml).toContain('data-arena-route="operations-audit"');
    expect(auditHtml).toContain('No audit events');

    const capacity = await resolveOperationsCapacityExperience({
      probe: fixture.probe,
      now: OPERATIONS_DEMO_EPOCH_MS,
    });
    expect(capacity.kind).toBe('board');
    if (capacity.kind !== 'board') throw new Error('unreachable');
    const capacityHtml = renderToStaticMarkup(<CapacityPanelView view={capacity.view} />);
    expect(capacityHtml).toContain('data-arena-route="operations-capacity"');
    expect(capacityHtml).toContain('data-arena-exhaustion-policy="fail-closed"');
    expect(capacityHtml).toContain('data-arena-no-billable-fallback="true"');
    expect(capacityHtml).toContain('DISABLED');
    expect(capacityHtml).toContain('configuration-missing');
    // The jobs list screen renders its honest empty.
    const jobs = await resolveOperationsJobsExperience({
      probe: fixture.probe,
      now: OPERATIONS_DEMO_EPOCH_MS,
    });
    expect(jobs.kind).toBe('list');
    if (jobs.kind !== 'list') throw new Error('unreachable');
    const jobsHtml = renderToStaticMarkup(<JobsListView view={jobs.view} />);
    expect(jobsHtml).toContain('data-arena-route="operations-jobs"');
    expect(jobsHtml).toContain('No job records');
  });
});

describe('operations demo posture (deterministic, visibly labelled)', () => {
  it('renders the full corpus under the demo labelling contract (positive)', async () => {
    const view = await resolveDemoOperationsHome();
    const html = renderToStaticMarkup(<OperationsHomeView view={view} />);
    expect(html).toContain('data-arena-route="operations"');
    expect(html).toContain('data-arena-surface-mode="demo"');
    expect(html).toContain('data-arena-demo-banner="true"');
    // Jobs: five demo rows across the lifecycle vocabulary.
    expect(html).toContain('data-arena-job-counts=');
    expect(html).toContain('succeeded: 1');
    expect(html).toContain('failed: 1');
    for (const jobId of Object.values(OPERATIONS_DEMO_JOB_IDS)) {
      expect(html).toContain(jobId);
    }
    // SLO: verdicts render verbatim, including the honest no-data row.
    expect(html).toContain('data-arena-slo-verdict="breached"');
    expect(html).toContain('data-arena-slo-verdict="no-data"');
    // Capacity: all four closed postures + the guarantee.
    expect(html).toContain('data-arena-provider-status="EXHAUSTED"');
    expect(html).toContain('data-arena-provider-status="DISABLED"');
    expect(html).toContain('data-arena-capacity-guarantee="true"');
    expect(html).toContain('quota-exhausted');
    // Audit preview: evidence rows with actor identity.
    expect(html).toContain('data-arena-audit-kind=');
    expect(html).toContain('demo-corr-ops-0001');
    // The determinism stamp renders.
    expect(html).toContain('data-arena-corpus-hash="true"');
  });

  it('the demo home is deterministic (two resolutions, identical corpus hash)', async () => {
    const first = await resolveDemoOperationsHome();
    const second = await resolveDemoOperationsHome();
    expect(first.demo.corpusHash).toBe(second.demo.corpusHash);
    expect(first.jobs.map((job) => job.jobId)).toEqual(second.jobs.map((job) => job.jobId));
    expect(JSON.stringify(first.sloRows.map((row) => row.verdict))).toBe(
      JSON.stringify(second.sloRows.map((row) => row.verdict)),
    );
  });

  it('the demo job detail renders the append-only histories; unknown ids are honestly not-found', async () => {
    const found = await resolveDemoOperationsJobExperience(OPERATIONS_DEMO_JOB_IDS.report);
    expect(found.kind).toBe('job');
    if (found.kind !== 'job') throw new Error('unreachable');
    const html = renderToStaticMarkup(<JobDetailView view={found.view} />);
    expect(html).toContain('data-arena-route="operations-job"');
    expect(html).toContain('data-arena-job-failure="true"');
    expect(html).toContain('dependency-unavailable');
    // Three failed attempts in the append-only history.
    expect(html).toContain('data-arena-attempt-outcome="failed"');
    expect(html).toContain('job-retried');
    expect(html).toContain('job-failed');

    const missing = await resolveDemoOperationsJobExperience('demo.job.does-not-exist');
    expect(missing).toEqual({ kind: 'not-found', jobId: 'demo.job.does-not-exist' });
  });

  it('the demo audit stream renders the verified chain with digests; the capacity panel renders all four states with ceilings', async () => {
    const auditView = await resolveDemoOperationsAudit();
    const auditHtml = renderToStaticMarkup(<AuditStreamScreenView view={auditView} />);
    expect(auditHtml).toContain('data-arena-audit-chain-verified="true"');
    expect(auditHtml).toContain('tenant-access-denied');
    expect(auditHtml).toContain('demo-corr-ops-0002');
    expect(auditHtml).toContain('data-arena-audit-effect="deny"');

    const capacityView = await resolveDemoOperationsCapacity();
    const capacityHtml = renderToStaticMarkup(<CapacityPanelView view={capacityView} />);
    expect(capacityHtml).toContain('data-arena-provider-status="EXHAUSTED"');
    expect(capacityHtml).toContain('data-arena-provider-status="DEGRADED"');
    expect(capacityHtml).toContain('dimension-near-limit');
    // Visible ceilings: the exhausted dimension keeps its limit (never unlimited).
    expect(capacityHtml).toContain('data-arena-dimension-ceiling-unknown="false"');
    expect(capacityHtml).toContain('ceiling unknown');
    // The demo jobs list renders all five rows.
    const jobsView = await resolveDemoOperationsJobs();
    const jobsHtml = renderToStaticMarkup(<JobsListView view={jobsView} />);
    expect(jobsHtml).toContain('data-arena-route="operations-jobs"');
    expect(jobsHtml).toContain('data-arena-surface-mode="demo"');
    for (const jobId of Object.values(OPERATIONS_DEMO_JOB_IDS)) {
      expect(jobsHtml).toContain(jobId);
    }
  });
});
