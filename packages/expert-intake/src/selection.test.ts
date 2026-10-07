/**
 * Expected-information-value selection suite (Work Order C003): determinism
 * (identical catalog/transcript/seed ⇒ identical choice), inspectable
 * rationale (per-component scores for EVERY candidate), tie-breaking and
 * exhaustion.
 */

import { describe, expect, it } from 'vitest';
import { buildInterviewCatalog } from './items.js';
import { selectNextItem, ROUTING_CRITICALITY_WEIGHTS, SELECTION_COMPONENTS } from './selection.js';
import { CATALOG_SEED, capabilityRef } from './test-support.js';

const catalog = buildInterviewCatalog(CATALOG_SEED);

describe('next-item selection by expected information value', () => {
  it('is deterministic given identical seeds', () => {
    const transcript = [{ itemId: catalog[0]!.itemId, answered: true }];
    const a = selectNextItem(catalog, transcript, 'seed-1');
    const b = selectNextItem(catalog, transcript, 'seed-1');
    expect(a.item?.itemId).toBe(b.item?.itemId);
    expect(a.rationale).toEqual(b.rationale);
  });

  it('never re-selects an already-asked item (novelty)', () => {
    const askedAll = catalog.map((item) => ({ itemId: item.itemId, answered: true }));
    const result = selectNextItem(catalog, askedAll, 'seed-1');
    expect(result.item).toBeNull();
    expect(result.rationale.chosenItemId).toBeNull();
    expect(result.rationale.scored.every((candidate) => !candidate.eligible)).toBe(true);
  });

  it('exposes an inspectable per-component rationale for every candidate', () => {
    const result = selectNextItem(catalog, [], 'seed-9');
    expect(result.rationale.scored.length).toBe(catalog.length);
    for (const candidate of result.rationale.scored) {
      expect(Object.keys(candidate.components).sort()).toEqual([...SELECTION_COMPONENTS].sort());
      const sum =
        candidate.components.novelty +
        candidate.components.routingCriticality +
        candidate.components.coverageGap +
        candidate.components.stageOrder +
        candidate.components.answerEntropy +
        candidate.components.seedJitter;
      expect(candidate.score).toBeCloseTo(sum, 3);
      expect(candidate.components.seedJitter).toBeLessThanOrEqual(0.5);
    }
    const chosen = result.rationale.scored.find((candidate) => candidate.itemId === result.rationale.chosenItemId);
    expect(chosen).toBeDefined();
    expect(chosen?.eligible).toBe(true);
  });

  it('records the declared routing criticality weights (ES1.0 routing inputs)', () => {
    for (const tag of ['privacy', 'locale', 'jurisdiction', 'availability', 'capability', 'evidence', 'scenario']) {
      expect((ROUTING_CRITICALITY_WEIGHTS[tag] ?? -1)).toBeGreaterThan(0);
    }
    expect((ROUTING_CRITICALITY_WEIGHTS.privacy ?? 0)).toBeGreaterThan(ROUTING_CRITICALITY_WEIGHTS.scenario ?? 0);
  });

  it('prefers privacy//locale routing blockers over scenario color at the start', () => {
    const result = selectNextItem(catalog, [], 'seed-1');
    const privacyOrLocale = result.rationale.scored
      .filter((candidate) => candidate.routingInput === 'privacy' || candidate.routingInput === 'locale')
      .map((candidate) => candidate.score);
    const scenarios = result.rationale.scored.filter((candidate) => candidate.routingInput === 'scenario').map((candidate) => candidate.score);
    expect(Math.max(...privacyOrLocale)).toBeGreaterThan(Math.max(...scenarios));
  });

  it('tie-breaks stably by highest score then lexicographic item id', () => {
    // All items asked except one: selection must pick the remaining one
    // regardless of seed (novelty dominates; jitter is bounded at 0.5).
    const catalog = buildInterviewCatalog({ competencyRefs: [capabilityRef('skill', 'one-skill')] });
    const last = catalog[catalog.length - 1]!;
    const askedAllButLast = catalog.filter((item) => item.itemId !== last.itemId).map((item) => ({ itemId: item.itemId, answered: true }));
    for (const seed of ['a', 'b', 'c']) {
      const result = selectNextItem(catalog, askedAllButLast, seed);
      expect(result.item?.itemId).toBe(last.itemId);
      expect(result.rationale.tieBreakRule).toBe('highest-score-then-item-id');
    }
  });

  it('rejects an empty catalog (fail closed)', () => {
    expect(() => selectNextItem([], [], 'seed-1')).toThrow();
  });
});
