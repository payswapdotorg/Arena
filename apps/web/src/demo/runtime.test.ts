import { describe, expect, it } from 'vitest';

/**
 * Demo runtime composition tests (Work Order B006; issue #73):
 * the zero-credential demo session through the B004 local wiring, the
 * deterministic demo store, and canonical reads THROUGH the B005
 * ReadModelService (the real service, not a test double).
 */

import { createDemoRuntime, getDemoRuntime, resetDemoRuntime } from './runtime.js';
import { buildDemoLandingView, resolveVariantId, truthStateKind } from './narrative-view.js';
import { computeDemoCorpusHash, DEMO_TENANT_ID } from '@arena/demo';

describe('demo runtime (zero credentials, deterministic)', () => {
  it('authenticates the demo principal with no provider and no real secret', async () => {
    const runtime = await createDemoRuntime();
    expect(runtime.session.tenantId).toBe(DEMO_TENANT_ID);
    expect(runtime.session.principalId).toBe('principal-demo-001');
    expect(runtime.session.issuedAt).toBeGreaterThan(0);
  });

  it('seeds the identical corpus hash on every composition', async () => {
    const left = await createDemoRuntime();
    const right = await createDemoRuntime();
    expect(left.corpusHash).toBe(computeDemoCorpusHash());
    expect(right.corpusHash).toBe(left.corpusHash);
  });

  it('reads demo records through the B005 canonical read path', async () => {
    const runtime = await createDemoRuntime();
    const read = await runtime.reads.read('demo.agent-body.software-engineer');
    expect(read.tenantId).toBe(DEMO_TENANT_ID);
    expect(read.kind).toBe('agent-body');
    expect(read.readAt).toBe(runtime.session.issuedAt);
  });

  it('reset() returns the demo store to the identical corpus hash', async () => {
    const runtime = await createDemoRuntime();
    await runtime.store.repository.delete('demo.capability-case.payments-reliability');
    expect(await runtime.store.isSeeded()).toBe(false);
    const report = await runtime.store.reset();
    expect(report.corpusHash).toBe(runtime.corpusHash);
    expect(await runtime.store.isSeeded()).toBe(true);
  });

  it('the module singleton composes once and reseeds identically after reset', async () => {
    resetDemoRuntime();
    const first = await getDemoRuntime();
    const again = await getDemoRuntime();
    expect(again).toBe(first);
    const report = await first.store.reset();
    expect(report.corpusHash).toBe(first.corpusHash);
    resetDemoRuntime();
  });
});

describe('demo landing view composition', () => {
  it('builds the owner lens with all nine steps, in owner order', async () => {
    const runtime = await createDemoRuntime();
    const view = await buildDemoLandingView({
      variantId: 'owner',
      read: (recordId) => runtime.reads.read(recordId),
      inventory: () => runtime.reads.inventory(),
      corpusHash: runtime.corpusHash,
    });
    expect(view.variantId).toBe('owner');
    expect(view.roleName.length).toBeGreaterThan(0);
    expect(view.roleGoal.length).toBeGreaterThan(0);
    expect(view.steps.length).toBe(9);
    expect(view.steps.map((step) => step.stepId).sort()).toEqual(
      [
        'welcome',
        'agent-body',
        'task-run',
        'model-output',
        'evaluation',
        'verification',
        'epoch',
        'certification',
        'explore-by-role',
      ].sort(),
    );
    expect(view.inventory.kinds.length).toBe(4);
  });

  it('every step and every summary carries a truth treatment (no unlabelled datum)', async () => {
    const runtime = await createDemoRuntime();
    const view = await buildDemoLandingView({
      variantId: 'expert',
      read: (recordId) => runtime.reads.read(recordId),
      inventory: () => runtime.reads.inventory(),
      corpusHash: runtime.corpusHash,
    });
    for (const step of view.steps) {
      expect(step.truthState.length).toBeGreaterThan(0);
      for (const summary of step.summaries) {
        expect(summary.truth.length).toBeGreaterThan(0);
        expect(summary.facts.length).toBeGreaterThan(0);
      }
    }
  });

  it('two builds of the same lens produce identical view models', async () => {
    const runtime = await createDemoRuntime();
    const build = () =>
      buildDemoLandingView({
        variantId: 'agent-builder',
        read: (recordId) => runtime.reads.read(recordId),
        inventory: () => runtime.reads.inventory(),
        corpusHash: runtime.corpusHash,
      });
    expect(JSON.stringify(await build())).toBe(JSON.stringify(await build()));
  });

  it('resolveVariantId is explicit query state with a fail-safe default', () => {
    expect(resolveVariantId(undefined)).toBe('owner');
    expect(resolveVariantId('expert')).toBe('expert');
    expect(resolveVariantId('nonsense')).toBe('owner');
  });

  it('truth labels map onto DISTINCT design-system treatments', () => {
    const kinds = new Set(
      (
        [
          'verified-fact',
          'evidence',
          'expert-judgment',
          'model-output',
          'simulation-replay',
          'evaluation-result',
          'certification',
          'suggestion',
        ] as const
      ).map(truthStateKind),
    );
    expect(kinds.size).toBe(8);
  });
});
