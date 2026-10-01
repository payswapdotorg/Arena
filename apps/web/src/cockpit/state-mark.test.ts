import { describe, expect, it } from 'vitest';

import {
  CANONICAL_KIND_TREATMENT,
  DEMO_LABEL_TO_CANONICAL_KIND,
  classifyDatum,
  isBadgeTreatment,
  truthTreatment,
} from './state-mark.js';
import { CANONICAL_STATE_KINDS } from '../../../../packages/role-context/src/index.js';
import { STATE_KINDS } from '@arena/ui-platform';

describe('cockpit truth treatments (B007: no two product-truth meanings collapse)', () => {
  it('maps every one of the 11 canonical kinds to a treatment (total)', () => {
    for (const kind of CANONICAL_STATE_KINDS) {
      expect(truthTreatment(kind)).toBeDefined();
    }
  });

  it('is injective on the ten B001 badge kinds — no two canonical kinds share a badge', () => {
    const badgeKinds = CANONICAL_STATE_KINDS.filter((kind) =>
      isBadgeTreatment(CANONICAL_KIND_TREATMENT[kind]),
    );
    expect(badgeKinds).toHaveLength(9);
    const treatments = new Set(badgeKinds.map((kind) => CANONICAL_KIND_TREATMENT[kind]));
    expect(treatments.size).toBe(9);
    for (const treatment of treatments) {
      expect(STATE_KINDS as readonly string[]).toContain(treatment);
    }
  });

  it('renders pending and unknown through the cockpit marks, never a badge (never guessed)', () => {
    expect(isBadgeTreatment('pending')).toBe(false);
    expect(isBadgeTreatment('unknown')).toBe(false);
    expect(CANONICAL_KIND_TREATMENT.pending).toBe('pending');
    expect(CANONICAL_KIND_TREATMENT.unknown).toBe('unknown');
  });

  it('classifies a datum carrying its canonical stateKind; everything else is unknown (fail honest)', () => {
    expect(classifyDatum({ stateKind: 'pending' }).treatment).toBe('pending');
    expect(classifyDatum({ stateKind: 'verified-fact' }).treatment).toBe('verified');
    expect(classifyDatum({ stateKind: 'nonsense' }).treatment).toBe('unknown');
    expect(classifyDatum({}).kind).toBe('unknown');
    expect(classifyDatum('certification').kind).toBe('certification');
    expect(classifyDatum(null).kind).toBe('unknown');
  });

  it('labels every classification with its canonical human label', () => {
    expect(classifyDatum({ stateKind: 'pending' }).label).toBe('Pending');
    expect(classifyDatum({ stateKind: 'unknown' }).label).toBe('Unknown');
    expect(classifyDatum({ stateKind: 'simulation-replay' }).label).toBe('Simulation / Replay');
  });

  it('maps the B006 demo truth labels onto the canonical taxonomy (suggestion -> suggestion-hypothesis)', () => {
    expect(DEMO_LABEL_TO_CANONICAL_KIND.suggestion).toBe('suggestion-hypothesis');
    expect(DEMO_LABEL_TO_CANONICAL_KIND['simulation-replay']).toBe('simulation-replay');
    expect(DEMO_LABEL_TO_CANONICAL_KIND.certification).toBe('certification');
  });
});
