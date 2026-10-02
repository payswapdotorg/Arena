/**
 * B017 M1 — determinism + B016 seed parity.
 *
 * The E2E battery's determinism contract:
 *   1. two fresh demo runtimes construct the IDENTICAL corpus hash
 *      (and it equals the frozen @arena/demo constant);
 *   2. every demo surface view model is byte-identical across double
 *      resolution (no wall-clock, no randomness leaking in);
 *   3. every rendered surface markup is byte-identical across double
 *      render;
 *   4. the read-model freshness stamps are the fixed narrative epoch —
 *      no wall-clock read ever enters the demo composition;
 *   5. B016 PARITY: the real `node scripts/product/seed.mjs` command
 *      (spawned as a subprocess with a scratch state dir) seeds the
 *      SAME corpus the app's demo mode seeds — same record ids, same
 *      tenant, same hash summary — proving the app demo state and the
 *      B016 local-store seed are one corpus, not two. The scratch state
 *      dir is wiped afterwards (the battery cleans up after itself).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  DEMO_NARRATIVE_EPOCH_MS,
  computeDemoCorpusHash,
  demoCorpusHashSummary,
} from '../../packages/demo/src/index.js';
import { getDemoRuntime } from '../../apps/web/src/demo/runtime.js';
import { resolveDemoCockpitView } from '../../apps/web/src/cockpit/home-route.js';
import { CockpitHomeView } from '../../apps/web/src/cockpit/cockpit-home-view.js';
import {
  resolveDemoCaseList,
  resolveDemoCaseDetail,
  resolveDemoTask,
} from '../../apps/web/src/capability/case-routes.js';
import {
  CaseListView,
  CaseDetailView,
  TaskDetailView,
} from '../../apps/web/src/capability/capability-views.js';
import { resolveDemoEvaluationHome } from '../../apps/web/src/evaluation/evaluation-route.js';
import { EvaluationHomeView } from '../../apps/web/src/evaluation/evaluation-home-view.js';
import { resolveDemoResearchHome } from '../../apps/web/src/research/research-route.js';
import { ResearchHomeView } from '../../apps/web/src/research/research-views.js';
import { resolveDemoBodiesStudioView } from '../../apps/web/src/bodies/bodies-route.js';
import { BodyStudioView } from '../../apps/web/src/bodies/bodies-home-view.js';
import {
  resolveDemoOperationsHome,
  resolveDemoOperationsJobs,
  resolveDemoOperationsAudit,
  resolveDemoOperationsCapacity,
} from '../../apps/web/src/operations/operations-route.js';
import {
  JobsListView,
  AuditStreamScreenView,
  CapacityPanelView,
} from '../../apps/web/src/operations/operations-screens.js';
import { OperationsHomeView } from '../../apps/web/src/operations/operations-home-view.js';
import { OPERATIONS_DEMO_EPOCH_MS } from '../../apps/web/src/operations/fixtures.js';
import { buildDemoLandingView } from '../../apps/web/src/demo/narrative-view.js';
import { DemoLandingView } from '../../apps/web/src/demo/demo-landing-view.js';
import { bootDemoApp, resetDemoApp } from './driver/demo-boot.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');

describe('B017 M1 — determinism (the frozen corpus, byte-identical surfaces)', () => {
  it('two fresh demo runtimes construct the identical corpus hash (the frozen constant)', async () => {
    await resetDemoApp();
    const first = await getDemoRuntime();
    await resetDemoApp();
    const second = await getDemoRuntime();
    expect(first.corpusHash).toBe(second.corpusHash);
    expect(first.corpusHash).toBe(computeDemoCorpusHash());
    expect(demoCorpusHashSummary(first.corpusHash)).toHaveLength(8);
    await resetDemoApp();
  });

  it('every demo surface view model is byte-identical across double resolution', async () => {
    await resetDemoApp();
    const resolveTwice = <T>(fn: () => Promise<T>): Promise<[T, T]> =>
      Promise.all([fn(), fn()]);
    const pairs = await Promise.all([
      resolveTwice(() => resolveDemoCockpitView('owner')),
      resolveTwice(() => resolveDemoCockpitView('researcher')),
      resolveTwice(() => resolveDemoCaseList('owner')),
      resolveTwice(() => resolveDemoCaseList('expert')),
      resolveTwice(() => resolveDemoCaseDetail('demo.capability-case.payments-reliability', 'owner')),
      resolveTwice(() => resolveDemoTask('task-reproduce')),
      resolveTwice(() => resolveDemoEvaluationHome()),
      resolveTwice(() => resolveDemoResearchHome()),
      resolveTwice(() => resolveDemoBodiesStudioView('agent-builder')),
      resolveTwice(() => resolveDemoOperationsHome()),
      resolveTwice(() => resolveDemoOperationsJobs()),
      resolveTwice(() => resolveDemoOperationsAudit()),
      resolveTwice(() => resolveDemoOperationsCapacity()),
    ]);
    for (const [first, second] of pairs) {
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
    await resetDemoApp();
  });

  it('every rendered demo surface markup is byte-identical across double render', async () => {
    await resetDemoApp();
    const runtime = await getDemoRuntime();
    const renderTwice = async (
      build: () => Promise<{ key: string; element: ReturnType<typeof createElement> }>,
    ): Promise<void> => {
      const first = await build();
      const second = await build();
      expect(renderToStaticMarkup(second.element), `${first.key} markup is deterministic`).toBe(
        renderToStaticMarkup(first.element),
      );
    };
    await renderTwice(async () => ({
      key: 'cockpit',
      element: createElement(CockpitHomeView, { view: await resolveDemoCockpitView('owner') }),
    }));
    await renderTwice(async () => ({
      key: 'cases',
      element: createElement(CaseListView, { view: await resolveDemoCaseList('owner') }),
    }));
    await renderTwice(async () => {
      const detail = await resolveDemoCaseDetail('demo.capability-case.payments-reliability', 'owner');
      if ('unreadable' in detail) throw new Error('narrative case detail unreadable');
      return { key: 'case-detail', element: createElement(CaseDetailView, { view: detail }) };
    });
    await renderTwice(async () => ({
      key: 'task',
      element: createElement(TaskDetailView, { view: await resolveDemoTask('task-review') }),
    }));
    await renderTwice(async () => ({
      key: 'evaluation',
      element: createElement(EvaluationHomeView, { view: await resolveDemoEvaluationHome() }),
    }));
    await renderTwice(async () => ({
      key: 'research',
      element: createElement(ResearchHomeView, { view: await resolveDemoResearchHome() }),
    }));
    await renderTwice(async () => ({
      key: 'bodies',
      element: createElement(BodyStudioView, {
        view: await resolveDemoBodiesStudioView('agent-builder'),
      }),
    }));
    await renderTwice(async () => ({
      key: 'operations',
      element: createElement(OperationsHomeView, { view: await resolveDemoOperationsHome() }),
    }));
    await renderTwice(async () => ({
      key: 'jobs',
      element: createElement(JobsListView, { view: await resolveDemoOperationsJobs() }),
    }));
    await renderTwice(async () => ({
      key: 'audit',
      element: createElement(AuditStreamScreenView, { view: await resolveDemoOperationsAudit() }),
    }));
    await renderTwice(async () => ({
      key: 'capacity',
      element: createElement(CapacityPanelView, { view: await resolveDemoOperationsCapacity() }),
    }));
    await renderTwice(async () => ({
      key: 'demo-landing',
      element: createElement(DemoLandingView, {
        view: await buildDemoLandingView({
          variantId: 'owner',
          read: (recordId) => runtime.reads.read(recordId),
          inventory: () => runtime.reads.inventory(),
          corpusHash: runtime.corpusHash,
        }),
      }),
    }));
    await resetDemoApp();
  });

  it('the demo read stamps are the fixed narrative epoch (no wall-clock in the composition)', async () => {
    const boot = await bootDemoApp();
    const cockpit = await resolveDemoCockpitView('owner');
    expect(cockpit.readAt).toBe(DEMO_NARRATIVE_EPOCH_MS);
    const caseList = await resolveDemoCaseList('owner');
    expect(caseList.readAt).toBe(DEMO_NARRATIVE_EPOCH_MS);
    // The operations corpus closes every snapshot on its own fixed epoch
    // (the B014 determinism constant — never a wall-clock read).
    const capacity = await resolveDemoOperationsCapacity();
    expect(capacity.board.checkedAt).toBe(OPERATIONS_DEMO_EPOCH_MS);
    await resetDemoApp();
  });
});

describe('B017 M1 — B016 seed parity (the app demo state and the local-store seed are one corpus)', () => {
  it('the real seed command seeds the identical corpus (same hash summary, same record ids, same tenant)', async () => {
    const boot = await bootDemoApp();
    const stateDir = mkdtempSync(join(tmpdir(), 'arena-b017-parity-'));
    try {
      const seeded = spawnSync(
        process.execPath,
        [join(REPO_ROOT, 'scripts', 'product', 'seed.mjs')],
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          env: { ...process.env, ARENA_LOCAL_STATE_DIR: stateDir },
        },
      );
      expect(seeded.status, `seed.mjs failed:\n${String(seeded.stderr)}`).toBe(0);
      // Same tenant, same labelling truth, same determinism claim.
      expect(seeded.stdout).toContain('demo tenant: arena-demo');
      expect(seeded.stdout).toContain('Demo state is not customer state');
      // THE PARITY PROOF: the B016-seeded store hash summary equals the
      // app demo runtime's corpus hash summary.
      expect(seeded.stdout).toContain(`hash summary ${boot.corpusHashSummary}`);
      // Idempotent re-seed (deterministic, creates nothing new).
      const rerun = spawnSync(
        process.execPath,
        [join(REPO_ROOT, 'scripts', 'product', 'seed.mjs')],
        {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          env: { ...process.env, ARENA_LOCAL_STATE_DIR: stateDir },
        },
      );
      expect(rerun.status).toBe(0);
      expect(rerun.stdout).toContain('already present: 5 record(s)');
    } finally {
      // The battery cleans up after itself: wipe the scratch state dir.
      rmSync(stateDir, { recursive: true, force: true });
    }
    await resetDemoApp();
  });
});
