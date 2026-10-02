import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Evaluation-route composition tests (Work Order B012; issue #87) — the
 * fail-closed route outcomes (auth-required; honest not-found), the
 * authenticated session posture (honest empty states through the
 * canonical read path), and the deterministic demo compositions. The
 * house style: REAL composed boundaries (the B004 local auth stack, the
 * B002 fakes, the B005 read-model service), injected session probes.
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
  CertificationRunView,
  EvaluationAuthRequiredView,
  EvaluationHomeView,
  EvaluationNotFoundView,
  EvaluationReportDetailView,
  VerificationRecordView,
  resolveDemoCertificationExperience,
  resolveDemoEvaluationHome,
  resolveDemoEvaluationReportExperience,
  resolveDemoVerificationExperience,
  resolveEvaluationExperience,
  resolveEvaluationReportExperience,
} from './index.js';
import { EVALUATION_DEMO_IDS } from './fixtures.js';

const T = '2026-10-01T08:00:00.000Z';

const NO_COOKIE_PROBE = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

/** Build a REAL authenticated session fixture (the cockpit runtime-test pattern). */
async function buildSessionFixture() {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'b012-test-session-secret-0123456789abcdefghij',
    credentials: [
      {
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'worker-1' } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: 'principal-b012-001',
          kind: 'customer-identity',
          tenantScope: 'tenant-b012',
          roles: ['tenant-owner'],
          label: 'b012-tester',
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
      identityId: 'principal-b012-001',
      tenantId: 'tenant-b012',
      workspaceId: 'tenant-b012-ws',
      permissionPolicy: createPermissionPolicy({
        policyId: 'tenant-b012-policy',
        tenantId: 'tenant-b012',
        descriptor: { kind: 'test-policy' },
        issuedAt: T,
      }),
      grantedRoles: ['owner'].map((roleId) =>
        grantRole({
          grantId: `grant-${roleId}`,
          identityId: 'principal-b012-001',
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

describe('evaluation route composition (fail closed)', () => {
  it('renders the auth-required notice — never an anonymous surface (negative)', async () => {
    const experience = await resolveEvaluationExperience({ probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('auth-required');
    const html = renderToStaticMarkup(<EvaluationAuthRequiredView />);
    expect(html).toContain('data-arena-surface-auth="required"');
    expect(html).toContain('data-arena-state="denied"');
    expect(html).not.toContain('data-arena-report=');
    expect(html).toContain('/demo/evaluation');
  });

  it('the detail routes are auth-required without a session too (negative)', async () => {
    for (const outcome of [
      await resolveEvaluationReportExperience({ id: 'any', probe: NO_COOKIE_PROBE }),
    ]) {
      expect(outcome.kind).toBe('auth-required');
    }
  });
});

describe('evaluation session posture (honest empty states through the canonical read path)', () => {
  it('renders the honest empties — no fabricated evaluation, verification or certification data (negative)', async () => {
    const fixture = await buildSessionFixture();
    const experience = await resolveEvaluationExperience({ probe: fixture.probe });
    expect(experience.kind).toBe('home');
    if (experience.kind !== 'home') throw new Error('unreachable');
    const html = renderToStaticMarkup(<EvaluationHomeView view={experience.view} />);
    expect(html).toContain('data-arena-route="evaluation"');
    expect(html).toContain('data-arena-evaluation-distinction="true"');
    expect(html).toContain('No evaluation runs recorded yet');
    expect(html).toContain('No verification runs recorded yet');
    expect(html).toContain('No certification runs recorded yet');
    expect(html).toContain('No certification claims in the record store');
    // No demo labelling in the session posture.
    expect(html).not.toContain('data-arena-demo-banner="true"');
    // No fabricated report rows.
    expect(html).not.toContain('data-arena-report=');
  });

  it('the session detail routes resolve the honest not-found outcome (negative)', async () => {
    const fixture = await buildSessionFixture();
    const outcome = await resolveEvaluationReportExperience({
      id: 'missing-report',
      probe: fixture.probe,
    });
    expect(outcome).toEqual({ kind: 'not-found', reportId: 'missing-report' });
    const html = renderToStaticMarkup(
      <EvaluationNotFoundView
        title="Evaluation report not found"
        recordId="missing-report"
        hint="No append-once A012 record exists for this id in the local posture — nothing is fabricated."
      />,
    );
    expect(html).toContain('data-arena-detail-status="not-found"');
    expect(html).toContain('data-arena-state="empty"');
  });

  it('renders a certification claim read through the canonical read path with its truth class (positive)', async () => {
    const fixture = await buildSessionFixture();
    await fixture.repository.insert({
      recordId: 'tenant-b012.certification.release-1',
      tenantId: 'tenant-b012',
      kind: 'certification',
      version: 1,
      data: {
        certificationId: 'cert-release-1',
        subject: { bodyId: 'body-x', bodyVersion: '1.0.0' },
        certificationKind: 'body-release',
        verdict: 'certified',
        basis: 'evaluation pass + independent verification pass',
        certifiedAt: T,
      },
    });
    const experience = await resolveEvaluationExperience({
      probe: fixture.probe,
      readModel: fixture.readModel,
    });
    expect(experience.kind).toBe('home');
    if (experience.kind !== 'home') throw new Error('unreachable');
    expect(experience.view.claims).toHaveLength(1);
    const html = renderToStaticMarkup(<EvaluationHomeView view={experience.view} />);
    expect(html).toContain('data-arena-claim="tenant-b012.certification.release-1"');
    expect(html).toContain('data-arena-truth="certification"');
    expect(html).toContain('body-x@1.0.0');
  });
});

describe('demo evaluation route composition (B006 posture)', () => {
  it('composes the demo home over the reserved demo tenant, deterministically (positive)', async () => {
    const view = await resolveDemoEvaluationHome();
    expect(view.mode).toBe('demo');
    expect(view.tenantId).toBe('arena-demo');
    expect(view.demo.isDemo).toBe(true);
    expect(view.reports).toHaveLength(1);
    expect(view.verifications).toHaveLength(1);
    expect(view.certifications).toHaveLength(2);
    const one = renderToStaticMarkup(<EvaluationHomeView view={view} />);
    const two = renderToStaticMarkup(<EvaluationHomeView view={view} />);
    expect(one).toBe(two);
    expect(one).toContain('data-arena-demo-banner="true"');
    expect(one).toContain('data-arena-evaluation-distinction="true"');
    expect(one).toContain('data-arena-truth="evaluation"');
    expect(one).toContain('data-arena-truth="certification"');
    expect(one).toContain('data-arena-truth="verified"');
    expect(one).toContain('data-arena-certification-posture="revoked"');
    expect(one).toContain('data-arena-certification-posture="active"');
    // The demo claim from the canonical read path renders too.
    expect(one).toContain('data-arena-claim="demo.certification.software-engineer-v1-1-0"');
    expect(one).toContain('data-arena-corpus-hash="true"');
  });

  it('renders the demo report detail with scores, suite identity and the not-verified framing (positive)', async () => {
    const experience = await resolveDemoEvaluationReportExperience(EVALUATION_DEMO_IDS.report);
    expect(experience.kind).toBe('report');
    if (experience.kind !== 'report') throw new Error('unreachable');
    const html = renderToStaticMarkup(
      <EvaluationReportDetailView view={experience.view} demo />,
    );
    expect(html).toContain('data-arena-route="evaluation-report"');
    expect(html).toContain('data-arena-report-truth="evaluation-result"');
    expect(html).toContain('NOT a verification outcome');
    expect(html).toContain('data-arena-suite-criteria="criteria-payments-reliability"');
    expect(html).toContain('data-arena-metric="regression-coverage"');
    expect(html).toContain('data-arena-report-conditions="true"');
    expect(html).toContain('demo-seed-payments-reliability-001');
  });

  it('renders the demo verification detail with verifier identity, scope and append-only evidence (positive)', async () => {
    const experience = await resolveDemoVerificationExperience(EVALUATION_DEMO_IDS.verification);
    expect(experience.kind).toBe('verification');
    if (experience.kind !== 'verification') throw new Error('unreachable');
    const html = renderToStaticMarkup(<VerificationRecordView view={experience.view} demo />);
    expect(html).toContain('data-arena-route="evaluation-verification"');
    expect(html).toContain('data-arena-verification-truth="verified-fact"');
    expect(html).toContain('NEVER carries a score');
    expect(html).toContain('data-arena-verifier-id="verifier-payments-reliability"');
    expect(html).toContain('data-arena-requirement="req-regression-rerun"');
    expect(html).toContain('data-arena-evidence-address=');
    expect(html).toContain('regression-test-suite:arena-demo/regression-test-suite@1.0.0');
  });

  it('renders the demo certification detail with the FIVE-part tuple prominent and postures honest (positive)', async () => {
    const runA = await resolveDemoCertificationExperience(EVALUATION_DEMO_IDS.certificationRunA);
    const runB = await resolveDemoCertificationExperience(EVALUATION_DEMO_IDS.certificationRunB);
    expect(runA.kind).toBe('certification');
    expect(runB.kind).toBe('certification');
    if (runA.kind !== 'certification' || runB.kind !== 'certification') throw new Error('unreachable');

    const htmlA = renderToStaticMarkup(<CertificationRunView view={runA.view} demo />);
    expect(htmlA).toContain('data-arena-route="evaluation-certification"');
    expect(htmlA).toContain('data-arena-certification-tuple="true"');
    expect(htmlA).toContain('data-arena-tuple-part="body-version"');
    expect(htmlA).toContain('data-arena-tuple-part="substrate"');
    expect(htmlA).toContain('data-arena-tuple-part="environment"');
    expect(htmlA).toContain('data-arena-tuple-part="runtime"');
    expect(htmlA).toContain('data-arena-tuple-part="suite"');
    expect(htmlA).toContain('arena-reference/software-engineer-body@1.1.0');
    expect(htmlA).toContain('data-arena-certification-posture="revoked"');
    expect(htmlA).toContain('data-arena-certification-revocation="true"');
    expect(htmlA).toContain('mis-declared');

    const htmlB = renderToStaticMarkup(<CertificationRunView view={runB.view} demo />);
    expect(htmlB).toContain('data-arena-certification-posture="active"');
    expect(htmlB).toContain('data-arena-certification-level="CONDITIONAL"');
    expect(htmlB).toContain('data-arena-certification-verdict="satisfied"');
    expect(htmlB).toContain('never to a model in isolation');
  });

  it('unknown demo ids resolve the honest not-found outcome (negative)', async () => {
    expect(await resolveDemoEvaluationReportExperience('no.such.report')).toEqual({
      kind: 'not-found',
      reportId: 'no.such.report',
    });
    expect(await resolveDemoVerificationExperience('no.such.verification')).toEqual({
      kind: 'not-found',
      verificationId: 'no.such.verification',
    });
    expect(await resolveDemoCertificationExperience('no.such.certification')).toEqual({
      kind: 'not-found',
      certificationId: 'no.such.certification',
    });
  });
});
