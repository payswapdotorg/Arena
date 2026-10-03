/**
 * Replay-route composition tests (Work Order B011; issue #86) — the
 * fail-closed route outcomes (auth-required; honest not-found; honest
 * invalid-continuation), the authenticated session posture (honest
 * empty run list), and the deterministic demo compositions rendered
 * through react-dom/server. The house style: REAL composed boundaries,
 * injected session probes.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { createLocalAuthStack } from '../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../../../packages/security/src/index.js';
import { FakeControlPlaneRepository, ManualClock } from '../../../../packages/persistence/src/index.js';
import { ReadModelService } from '../../../../services/read-model/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import {
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
} from '../../../../packages/role-context/src/index.js';
import { REPLAY_DEMO_IDS } from '../../../../packages/replay-ui/src/index.js';
import {
  ReplayAuthRequiredView,
  ReplayHomeView,
  ReplayInvalidContinuationView,
  ReplayRunNotFoundView,
  ReplayRunView,
  resolveDemoReplayHome,
  resolveDemoReplayRun,
  resolveReplayHome,
  resolveReplayRun,
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

describe('replay route composition (fail closed)', () => {
  it('renders the auth-required notice — never an anonymous surface (negative)', async () => {
    const experience = await resolveReplayHome({ probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('auth-required');
    const html = renderToStaticMarkup(<ReplayAuthRequiredView />);
    expect(html).toContain('data-arena-surface-auth="required"');
    expect(html).toContain('data-arena-state="denied"');
    expect(html).not.toContain('data-arena-run=');
    expect(html).toContain('/demo/replay');
  });

  it('the run detail route is auth-required without a session too (negative)', async () => {
    const experience = await resolveReplayRun({ runKey: 'any', probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('auth-required');
  });
});

describe('the authenticated session posture (honest empties, never fabricated)', () => {
  it('renders the honest empty run list — no runs are recorded in the local posture', async () => {
    const fixture = await buildSessionFixture();
    const experience = await resolveReplayHome({ probe: fixture.probe });
    expect(experience.kind).toBe('home');
    if (experience.kind !== 'home') throw new Error('expected home');
    expect(experience.view.runs).toHaveLength(0);
    expect(experience.view.nextContinuation).toBeNull();
    expect(experience.view.emptyNote).not.toBeNull();
    const html = renderToStaticMarkup(<ReplayHomeView view={experience.view} />);
    expect(html).toContain('data-arena-state="empty"');
    expect(html).toContain('No runs recorded yet');
    expect(html).not.toContain('data-arena-run=');
    // The observational banner is present even on the empty session list.
    expect(html).toContain('data-arena-replay-observational="true"');
    expect(html).toContain('no live-world mutation');
  });

  it('resolves the honest not-found outcome for any run detail (never a fabricated run)', async () => {
    const fixture = await buildSessionFixture();
    const experience = await resolveReplayRun({
      runKey: 'payments-reliability-a',
      probe: fixture.probe,
    });
    expect(experience.kind).toBe('not-found');
    if (experience.kind === 'not-found') {
      expect(experience.runKey).toBe('payments-reliability-a');
    }
    const html = renderToStaticMarkup(<ReplayRunNotFoundView runKey="payments-reliability-a" />);
    expect(html).toContain('data-arena-detail-status="not-found"');
    expect(html).toContain('Nothing to replay');
  });
});

describe('the demo run list (deterministic corpus, scroll + continuation)', () => {
  it('renders page one with the observational banner, truth marks and the continuation link', async () => {
    const experience = await resolveDemoReplayHome();
    expect(experience.kind).toBe('home');
    if (experience.kind !== 'home') throw new Error('expected home');
    expect(experience.view.mode).toBe('demo');
    expect(experience.view.runs.map((run) => run.runId)).toEqual([
      REPLAY_DEMO_IDS.runA,
      REPLAY_DEMO_IDS.runB,
    ]);
    expect(experience.view.totalKnown).toBe(3);
    expect(experience.view.nextContinuation).not.toBeNull();
    const html = renderToStaticMarkup(<ReplayHomeView view={experience.view} />);
    // Observational mark, always.
    expect(html).toContain('data-arena-replay-observational="true"');
    expect(html).toContain('Replay — no live-world mutation');
    // Demo labelling contract.
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain('Demo state is not customer state');
    expect(html).toContain('data-arena-state="demo"');
    // Truth classes on rows: simulation-replay + pending, never one
    // generic result. ('verified' appears exactly ONCE — the legend's
    // teaching row, never a run row.)
    expect(html).toContain('data-arena-truth="simulation"');
    expect(html).toContain('data-arena-truth="pending"');
    expect(html.match(/data-arena-truth="verified"/g)?.length).toBe(1);
    // Continuation link.
    expect(html).toContain('data-arena-continuation="true"');
    expect(html).toContain('More runs (continuation)');
  });

  it('scrolls onto page two through the continuation token (deterministic ordering)', async () => {
    const pageOne = await resolveDemoReplayHome();
    if (pageOne.kind !== 'home') throw new Error('expected home');
    const token = pageOne.view.nextContinuation;
    if (token === null) throw new Error('expected a continuation token');
    const pageTwo = await resolveDemoReplayHome({ continuation: token });
    expect(pageTwo.kind).toBe('home');
    if (pageTwo.kind !== 'home') throw new Error('expected home');
    expect(pageTwo.view.runs.map((run) => run.runId)).toEqual([REPLAY_DEMO_IDS.runC]);
    expect(pageTwo.view.nextContinuation).toBeNull();
  });

  it('renders the honest fail-closed notice for an invalid continuation token (negative)', async () => {
    const experience = await resolveDemoReplayHome({ continuation: 'garbage-token' });
    expect(experience.kind).toBe('invalid-continuation');
    if (experience.kind === 'invalid-continuation') {
      expect(experience.code).toBe('REPLAY_UI_INVALID_CONTINUATION');
      const html = renderToStaticMarkup(
        <ReplayInvalidContinuationView
          code={experience.code}
          message={experience.message}
          mode="demo"
        />,
      );
      expect(html).toContain('data-arena-detail-status="invalid-continuation"');
      expect(html).toContain('data-arena-state="error"');
      expect(html).toContain('rejected rather than guessed');
    }
  });

  it('renders the honest not-found for an unknown demo run key (negative)', async () => {
    const experience = await resolveDemoReplayRun({ runKey: 'does-not-exist' });
    expect(experience.kind).toBe('not-found');
  });
});

describe('the demo run detail (interactive run inspection)', () => {
  it('renders run A: timeline, step inspector, event stream and linkage under their own truth classes', async () => {
    const experience = await resolveDemoReplayRun({
      runKey: 'payments-reliability-a',
      requestedSequence: 3,
    });
    expect(experience.kind).toBe('run');
    if (experience.kind !== 'run') throw new Error('expected run');
    const html = renderToStaticMarkup(<ReplayRunView view={experience.view} />);
    // Observational mark, always.
    expect(html).toContain('data-arena-replay-observational="true"');
    // Demo labelling.
    expect(html).toContain('data-arena-demo-banner="true"');
    // Timeline: 8 steps, every row simulation-replay.
    expect(html.match(/data-arena-step="\d+"/g)?.length).toBe(8);
    expect(html.match(/data-arena-step-truth="simulation"/g)?.length).toBe(8);
    expect(html).toContain('data-arena-timeline-outcome="completed"');
    // Chain verification renders as verified (the recomputed full chain).
    expect(html).toContain('data-arena-chain-verification="verified"');
    // Step inspector: step 3 selected (the checkpoint) with its I/O.
    expect(html).toContain('data-arena-selection-state="selected"');
    expect(html).toContain('data-arena-selected-step="3"');
    expect(html).toContain('data-arena-selected-kind="checkpoint"');
    expect(html).toContain('ckpt-before-edit');
    // Event stream: the A010 events with step links.
    expect(html).toContain('data-arena-event-stream-state="ready"');
    expect(html).toContain('data-arena-event="run-submitted"');
    expect(html).toContain('data-arena-event="checkpoint-recorded"');
    expect(html).toContain('data-arena-event="run-result-produced"');
    // Linkage: evidence addresses + evaluation-result + verified-fact.
    expect(html).toContain('data-arena-linkage-evidence="true"');
    expect(html).toContain('data-arena-truth="evidence"');
    expect(html).toContain('data-arena-linkage-evaluations="true"');
    expect(html).toContain('data-arena-truth="evaluation"');
    expect(html).toContain('data-arena-linkage-verifications="true"');
    expect(html).toContain('data-arena-truth="verified"');
    expect(html).toContain('data-arena-verification-outcome="pass"');
    // No re-run affordance anywhere.
    expect(html.toLowerCase()).not.toContain('re-run against live');
    expect(html).not.toContain('data-arena-primary');
  });

  it('renders run B as PENDING (in flight — never guessed)', async () => {
    const experience = await resolveDemoReplayRun({ runKey: 'payments-reliability-b' });
    expect(experience.kind).toBe('run');
    if (experience.kind !== 'run') throw new Error('expected run');
    const html = renderToStaticMarkup(<ReplayRunView view={experience.view} />);
    expect(html).toContain('data-arena-timeline-outcome="pending"');
    expect(html).toContain('data-arena-timeline-pending="true"');
    expect(html).toContain('never guessed');
    // No run result for an in-flight run.
    expect(html).toContain('data-arena-run-result-readable="false"');
    // No evaluation/verification linkage.
    expect(html).toContain('No evaluation records linked to this run');
  });

  it('renders run C as failed with the error entry visible and no run result (A010 rule)', async () => {
    const experience = await resolveDemoReplayRun({
      runKey: 'payments-reliability-c',
      requestedSequence: 2,
    });
    expect(experience.kind).toBe('run');
    if (experience.kind !== 'run') throw new Error('expected run');
    const html = renderToStaticMarkup(<ReplayRunView view={experience.view} />);
    expect(html).toContain('data-arena-timeline-outcome="failed"');
    expect(html).toContain('data-arena-selected-kind="error"');
    expect(html).toContain('WORKLOAD_TIMEOUT');
    expect(html).toContain('data-arena-run-result-readable="false"');
    expect(html).toContain('event streams');
  });

  it('reports an out-of-range step request verbatim — never clamped (negative)', async () => {
    const experience = await resolveDemoReplayRun({
      runKey: 'payments-reliability-a',
      requestedSequence: 99,
    });
    expect(experience.kind).toBe('run');
    if (experience.kind !== 'run') throw new Error('expected run');
    const html = renderToStaticMarkup(<ReplayRunView view={experience.view} />);
    expect(html).toContain('data-arena-selection-state="out-of-range"');
    expect(html).toContain('Step 99 does not exist');
    expect(html).toContain('never clamped');
  });

  it('renders the role lens and the truthful denial for a not-granted role request', async () => {
    // The demo posture grants ALL reference roles — a foreign role id is
    // the not-granted case there; the session posture tests the granted-set
    // denial through the home view below.
    const experience = await resolveDemoReplayHome({ requestedRoleId: 'not-a-role' });
    expect(experience.kind === 'home').toBe(true);
    if (experience.kind === 'home') {
      expect(experience.view.roleSwitch.denied).toBe(true);
      expect(experience.view.roleSwitch.deniedRequested).toBe('not-a-role');
      const html = renderToStaticMarkup(<ReplayHomeView view={experience.view} />);
      expect(html).toContain('data-arena-role-denied="true"');
      expect(html).toContain('not-a-role');
      expect(html).toContain('never faked');
    }
  });

  it('lenses the demo home through an explicitly granted role (positive)', async () => {
    const experience = await resolveDemoReplayHome({ requestedRoleId: 'operator' });
    expect(experience.kind === 'home').toBe(true);
    if (experience.kind === 'home') {
      expect(experience.view.roleSwitch.denied).toBe(false);
      expect(experience.view.roleSwitch.activeRoleId).toBe('operator');
      const html = renderToStaticMarkup(<ReplayHomeView view={experience.view} />);
      expect(html).toContain('data-arena-active-role="operator"');
      expect(html).toContain('Investigate what the run did');
    }
  });

  it('renders the truthful role denial in the session posture (granted set = owner)', async () => {
    const fixture = await buildSessionFixture();
    const experience = await resolveReplayHome({
      probe: fixture.probe,
      requestedRoleId: 'expert',
    });
    expect(experience.kind).toBe('home');
    if (experience.kind !== 'home') throw new Error('expected home');
    expect(experience.view.roleSwitch.denied).toBe(true);
    expect(experience.view.roleSwitch.deniedRequested).toBe('expert');
    expect(experience.view.roleSwitch.activeRoleId).toBe('owner');
    const html = renderToStaticMarkup(<ReplayHomeView view={experience.view} />);
    expect(html).toContain('data-arena-role-denied="true"');
    expect(html).toContain('data-arena-state="denied"');
  });
});
