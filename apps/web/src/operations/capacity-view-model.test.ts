/**
 * Capacity view-model tests (Work Order B014).
 *
 * Positive: all four closed FT2.0 postures project verbatim with visible
 * ceilings; exhaustion renders fail-closed with its structured reason;
 * the board carries the no-billable-fallback guarantee as data.
 * Adversarial: foreign statuses render unknown AND fail-closed (never
 * healthy, never unlimited); unreadable dimensions degrade truthfully;
 * an empty board never fabricates a healthy overall.
 */

import { describe, expect, it } from 'vitest';

import {
  buildOperationsDemoCorpus,
  buildSessionProviderHealths,
  OPERATIONS_DEMO_EPOCH_MS,
} from './fixtures.js';
import { toCapacityBoardView, toProviderCapacityView } from './capacity-view-model.js';

describe('capacity view projection (positive)', () => {
  it('projects all four closed FT2.0 postures verbatim with visible ceilings', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const views = corpus.providers.map((entry) =>
      toProviderCapacityView({ health: entry.health, role: entry.role, note: entry.note }),
    );
    const byId = new Map(views.map((view) => [view.providerId, view]));

    const controlPlane = byId.get('control-plane-store');
    expect(controlPlane?.status).toBe('AVAILABLE');
    expect(controlPlane?.failClosed).toBe(false);
    expect(controlPlane?.truthClass).toBe('verified-fact');
    const storage = controlPlane?.dimensions.find((dim) => dim.dimension === 'storage');
    expect(storage?.used).toBe(210);
    expect(storage?.limit).toBe(512);
    expect(storage?.remaining).toBe(302);
    expect(storage?.ceilingUnknown).toBe(false);

    const coordination = byId.get('coordination-store');
    expect(coordination?.status).toBe('DEGRADED');
    expect(coordination?.failClosed).toBe(false);
    expect(
      coordination?.reasons.some((reason) => reason.code === 'dimension-near-limit'),
    ).toBe(true);

    const objectStore = byId.get('object-store');
    expect(objectStore?.status).toBe('EXHAUSTED');
    expect(objectStore?.failClosed).toBe(true);
    expect(objectStore?.reasons.some((reason) => reason.code === 'quota-exhausted')).toBe(true);
    // Exhaustion NEVER silently degrades to unlimited: the ceiling stays visible.
    const exhausted = objectStore?.dimensions.find((dim) => dim.dimension === 'storage');
    expect(exhausted?.limit).toBe(10_240);
    expect(exhausted?.remaining).toBe(0);
    expect(exhausted?.ceilingUnknown).toBe(false);

    const compute = byId.get('job-compute');
    expect(compute?.status).toBe('DISABLED');
    expect(compute?.failClosed).toBe(true);
    expect(compute?.reasons).toEqual([{ code: 'configuration-missing' }]);
    expect(compute?.dimensions).toEqual([]);
  });

  it('the board carries the no-billable-fallback guarantee as data (rendered verbatim)', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const providers = corpus.providers.map((entry) =>
      toProviderCapacityView({ health: entry.health, role: entry.role, note: entry.note }),
    );
    const board = toCapacityBoardView({ providers, checkedAt: OPERATIONS_DEMO_EPOCH_MS });
    expect(board.overall).toBe('DISABLED'); // worst-of — the honest aggregate
    expect(board.exhaustionPolicy).toBe('fail-closed');
    expect(board.noBillableFallback).toBe(true);
    expect(board.guaranteeNote).toContain('never silently degrades');
    expect(board.guaranteeNote).toContain('billable');
    expect(board.checkedAt).toBe(OPERATIONS_DEMO_EPOCH_MS);
    expect(board.truthClass).toBe('verified-fact');
  });

  it('the session posture board: every provider DISABLED (fail closed, visible)', () => {
    const healths = buildSessionProviderHealths(OPERATIONS_DEMO_EPOCH_MS);
    const providers = healths.map((health) =>
      toProviderCapacityView({
        health,
        role: 'session-posture provider',
        note: 'not wired in this posture',
      }),
    );
    const board = toCapacityBoardView({ providers, checkedAt: OPERATIONS_DEMO_EPOCH_MS });
    expect(board.overall).toBe('DISABLED');
    for (const provider of board.providers) {
      expect(provider.status).toBe('DISABLED');
      expect(provider.failClosed).toBe(true);
      expect(provider.truthClass).toBe('verified-fact');
    }
  });
});

describe('capacity view projection (adversarial — truthful degradation)', () => {
  it('a foreign status renders unknown AND fail-closed — never healthy, never unlimited', () => {
    const view = toProviderCapacityView({
      health: { providerId: 'provider-x', status: 'INFINITE', checkedAt: 1000 },
      role: 'test provider',
    });
    expect(view.status).toBe('unknown');
    expect(view.failClosed).toBe(true);
    expect(view.truthClass).toBe('unknown');
    expect(view.readable).toBe(false);
    expect(view.unknownFields.join(' ')).toContain('INFINITE');
  });

  it('unreadable dimensions are dropped with named unknowns — no fabricated ceilings', () => {
    const view = toProviderCapacityView({
      health: {
        providerId: 'provider-x',
        status: 'AVAILABLE',
        checkedAt: 1000,
        dimensions: [
          { dimension: 'storage', used: 10, limit: 5, remaining: -5 },
          { dimension: 'requests', used: 1, limit: 10, remaining: 9, windowMs: null },
        ],
        reasons: [],
      },
      role: 'test provider',
    });
    expect(view.status).toBe('AVAILABLE');
    expect(view.dimensions).toHaveLength(1);
    expect(view.dimensions[0]?.dimension).toBe('requests');
    expect(view.unknownFields.join(' ')).toContain('dimension #1');
  });

  it('an unknown ceiling renders ceiling-unknown — never as unbounded', () => {
    const view = toProviderCapacityView({
      health: {
        providerId: 'provider-x',
        status: 'AVAILABLE',
        checkedAt: 1000,
        dimensions: [{ dimension: 'requests', used: 12, limit: null, remaining: null, windowMs: null }],
        reasons: [{ code: 'limit-unknown', dimension: 'requests' }],
      },
      role: 'test provider',
    });
    const dimension = view.dimensions[0];
    expect(dimension?.ceilingUnknown).toBe(true);
    expect(dimension?.limit).toBeUndefined();
    expect(view.reasons[0]?.code).toBe('limit-unknown');
  });

  it('an empty board never fabricates a healthy overall (unknown, fail-closed)', () => {
    const board = toCapacityBoardView({ providers: [] });
    expect(board.overall).toBe('unknown');
    expect(board.truthClass).toBe('unknown');
    expect(board.readable).toBe(false);
    expect(board.unknownFields.join(' ')).toContain('no provider postures');
    // The guarantee still renders — it is a contract, not a measurement.
    expect(board.exhaustionPolicy).toBe('fail-closed');
    expect(board.noBillableFallback).toBe(true);
  });

  it('non-object health inputs degrade without throwing', () => {
    for (const payload of [null, undefined, 42, 'health']) {
      const view = toProviderCapacityView({ health: payload, role: 'test provider' });
      expect(view.status).toBe('unknown');
      expect(view.failClosed).toBe(true);
      expect(view.providerId).toBeUndefined();
    }
  });
});
