/**
 * Competitions-route composition tests (Work Order C013) — the
 * fail-closed route outcome (auth-required), the deterministic DEMO
 * composition over the REAL domain constructors (the full AE1.0 UX
 * chain with evidence links, the labelled discovery signal, the
 * verified result with its truth mark), the honest session-posture
 * empty states, and the honest error/loading states. House style: REAL
 * composed boundaries with injected session probes (the
 * developers-route test pattern).
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';

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
  buildDemoCompetitionsCorpus,
  CompetitionDetailView,
  CompetitionsAuthRequiredView,
  CompetitionsErrorView,
  CompetitionsLoadingView,
  resolveCompetitionDetailExperience,
  resolveCompetitionsHomeExperience,
} from './index.js';
import { competitionDetailViewModel } from './view-models.js';

const T = '2026-10-01T08:00:00.000Z';

const NO_COOKIE_PROBE = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

/** Build a REAL authenticated session probe for one tenant (the cockpit pattern). */
async function buildSessionProbe(tenantId: string, who: string) {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'c013-test-session-secret-0123456789abcdefghij',
    credentials: [
      {
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: `principal-c013-${who}`,
          kind: 'customer-identity',
          tenantScope: tenantId,
          roles: ['tenant-owner'],
          label: `c013-${who}`,
        }),
      },
    ],
    clock,
  });
  const principal = await auth.service.authenticate({ method: 'test-login', claims: { who } });
  const issuance = await auth.service.issueSession({
    principal,
    tenantId,
    workspaceContext: createWorkspaceContext({
      identityId: `principal-c013-${who}`,
      tenantId,
      workspaceId: `${tenantId}-ws`,
      permissionPolicy: createPermissionPolicy({
        policyId: `${tenantId}-policy`,
        tenantId,
        descriptor: { kind: 'test-policy' },
        issuedAt: T,
      }),
      grantedRoles: ['owner'].map((roleId) =>
        grantRole({
          grantId: `grant-${roleId}`,
          identityId: `principal-c013-${who}`,
          tenantId,
          roleId,
          policyId: `${tenantId}-policy`,
          grantedBy: 'test',
          grantedAt: T,
          validFrom: T,
        }),
      ),
    }),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who } }),
  });
  return {
    cookieValue: () => Promise.resolve(issuance.cookie.value),
    validate: (token: string) => auth.service.validateSession(token),
  };
}

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

const DEMO_COMPETITION_ID = buildDemoCompetitionsCorpus().competition.competitionId;

describe('fail-closed: unauthenticated visitors never see an anonymous arena', () => {
  it('both competitions routes render the auth-required notice (negative)', async () => {
    const home = await resolveCompetitionsHomeExperience({ probe: NO_COOKIE_PROBE });
    expect(home.kind).toBe('auth-required');
    const homeHtml = render(home.view);
    expect(homeHtml).toContain('data-arena-surface-auth="required"');
    expect(homeHtml).toContain('authenticated session (B004 session boundary)');

    const detail = await resolveCompetitionDetailExperience(DEMO_COMPETITION_ID, {
      probe: NO_COOKIE_PROBE,
    });
    expect(detail.kind).toBe('auth-required');
    expect(render(detail.view)).toContain('data-arena-surface-auth="required"');
  });

  it('the auth-required view renders the permission-denied state', () => {
    const html = render(<CompetitionsAuthRequiredView />);
    expect(html).toContain('data-arena-state="denied"');
    expect(html).not.toMatch(/sub_[0-9a-f]{32}/);
  });
});

describe('deterministic DEMO composition (visibly labelled, full AE1.0 chain)', () => {
  let demoProbe: Awaited<ReturnType<typeof buildSessionProbe>>;

  beforeAll(async () => {
    demoProbe = await buildSessionProbe('arena-demo', 'demo-arena');
  });

  it('the arena home renders the chain + the law + the demo label', async () => {
    const experience = await resolveCompetitionsHomeExperience({ probe: demoProbe });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-demo="true"');
    expect(html).toContain('data-arena-list="competition-chain"');
    for (const step of ['Problem', 'Solutions', 'Challenge', 'Proof', 'Response', 'Community signal', 'Adjudication', 'Verified result']) {
      expect(html).toContain(`<li>${step}</li>`);
    }
    expect(html).toContain('never bypass Verifier authority');
    expect(html).toContain('deterministic demo competition corpus');
  });

  it('the detail view renders the full UX chain with evidence links on every claim', async () => {
    const experience = await resolveCompetitionDetailExperience(DEMO_COMPETITION_ID, {
      probe: demoProbe,
    });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    for (const section of ['problem', 'solutions', 'adjudication', 'verified-result']) {
      expect(html).toContain(`data-arena-section="${section}"`);
    }
    // Every judgment renders its claim AND its evidence links.
    expect(html).toContain('data-arena-list="judgments"');
    expect(html).toContain('data-arena-list="evidence"');
    expect(html).toContain('drawings/S-304-revision-B');
    expect(html).toContain('revision B schedules 94 connections');
    // The six judgment types render typed.
    expect(html).toContain('data-arena-judgment="challenge"');
    expect(html).toContain('data-arena-judgment="reject_challenge"');
    expect(html).toContain('data-arena-judgment="upvote_with_proof"');
    expect(html).toContain('data-arena-judgment="downvote_with_proof"');
    expect(html).toContain('data-arena-judgment="needs_more_evidence"');
  });

  it('the community signal is visibly labelled a DISCOVERY signal — never a verified badge (shared state vocabulary)', async () => {
    const experience = await resolveCompetitionDetailExperience(DEMO_COMPETITION_ID, {
      probe: demoProbe,
    });
    const html = render(experience.view);
    expect(html).toContain('data-arena-section="community-signal"');
    expect(html).toContain('discovery signal — not a verified badge');
    expect(html).toContain('data-arena-fact="signal-ratio"');
    expect(html).toContain('Discovery signal only');
    // The signal section carries NO verified truth mark — the two vocabularies are never equivalent.
    const signalStart = html.indexOf('data-arena-section="community-signal"');
    const signalEnd = html.indexOf('data-arena-section="adjudication"');
    const signalSection = html.slice(signalStart, signalEnd);
    expect(signalSection).not.toContain('data-arena-truth="verified"');
  });

  it('the verified result carries the verified truth mark + formula disclosure', async () => {
    const experience = await resolveCompetitionDetailExperience(DEMO_COMPETITION_ID, {
      probe: demoProbe,
    });
    const html = render(experience.view);
    expect(html).toContain('data-arena-truth="verified"');
    expect(html).toContain('data-arena-fact="formula"');
    expect(html).toContain('formula v1');
    expect(html).toContain('never a certification itself');
    expect(html).toContain('data-arena-list="limitations"');
    expect(html).toContain('EXCLUDED from these inputs by construction');
  });

  it('an unknown demo competition id fails closed (no fabricated competition)', async () => {
    const experience = await resolveCompetitionDetailExperience('cmp_00000000000000000000000000000000', {
      probe: demoProbe,
    });
    expect(experience.kind).toBe('error');
    expect(render(experience.view)).toContain('no fabricated competition');
  });
});

describe('authenticated non-demo session: honest empty states (never fabricated)', () => {
  it('the arena home renders the empty competitions state', async () => {
    const probe = await buildSessionProbe('tenant-c013', 'live-arena');
    const experience = await resolveCompetitionsHomeExperience({ probe });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-demo="false"');
    expect(html).toContain('No competitions yet');
    expect(html).not.toContain('data-arena-competition=');
  });

  it('the detail posture renders the honest empty home (no fabricated detail)', async () => {
    const probe = await buildSessionProbe('tenant-c013', 'live-arena');
    const experience = await resolveCompetitionDetailExperience(DEMO_COMPETITION_ID, { probe });
    expect(experience.kind).toBe('ok');
    expect(render(experience.view)).toContain('No competitions yet');
  });
});

describe('the honest error and loading states (UX quality gates)', () => {
  it('the error view renders fail-closed with a retry action', () => {
    const html = render(
      <CompetitionsErrorView detail="competition store unwired (fail closed)" />,
    );
    expect(html).toContain('data-arena-state="error"');
    expect(html).toContain('Competition read failed');
    expect(html).toContain('fail closed');
  });

  it('the loading view renders the pending state', () => {
    const html = render(<CompetitionsLoadingView />);
    expect(html).toContain('data-arena-state="loading"');
  });

  it('the detail view renders standalone with the demo label', () => {
    const corpus = buildDemoCompetitionsCorpus();
    const html = render(
      <CompetitionDetailView
        tenantLabel="arena-demo (demo)"
        demo={true}
        model={competitionDetailViewModel(corpus)}
      />,
    );
    expect(html).toContain('data-arena-demo="true"');
    expect(html).toContain('deterministic demo competition');
  });
});
