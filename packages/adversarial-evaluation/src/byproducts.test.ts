/**
 * Byproduct + research-candidate tests (Work Order C013): provenance and
 * rights carry onto the A030 candidate projection; strict validation.
 */

import { describe, expect, it } from 'vitest';

import {
  BYPRODUCT_KINDS,
  createByproductRecord,
  isByproductRecord,
  toResearchCandidates,
} from './byproducts.js';
import { AdversarialEvaluationError } from './errors.js';

const BASE = {
  byproductId: 'bp_00000000000000000000000000000001',
  competitionId: 'cmp_00000000000000000000000000000000',
  refs: ['traj:abc123', 'disagreement:def456'],
  rights: {
    license: 'arena-research-only',
    provenance: 'arena adversarial competition; experts consented to research reuse',
    consentForResearch: true,
  },
  createdAt: '2026-10-07T10:00:00.000Z',
};

describe('byproduct records', () => {
  it('creates each AE1.0 byproduct kind, frozen, rights-carrying', () => {
    for (const kind of BYPRODUCT_KINDS) {
      const record = createByproductRecord({ ...BASE, kind });
      expect(record.kind).toBe(kind);
      expect(Object.isFrozen(record)).toBe(true);
      expect(isByproductRecord(record)).toBe(true);
      expect(record.rights.license).toBe('arena-research-only');
    }
  });

  it('rejects unknown kinds and empty refs (fail closed)', () => {
    expect(() => createByproductRecord({ ...BASE, kind: 'gossip' })).toThrow(/closed vocabulary/);
    expect(() => createByproductRecord({ ...BASE, kind: 'benchmark-material', refs: [] })).toThrow(
      /non-empty string array/,
    );
    expect(() =>
      createByproductRecord({
        ...BASE,
        kind: 'benchmark-material',
        rights: { ...BASE.rights, consentForResearch: 'yes' as unknown as boolean },
      }),
    ).toThrow(/consentForResearch/);
  });

  it('projects into A030 research/benchmark CANDIDATES with rights + provenance attached', () => {
    const record = createByproductRecord({ ...BASE, kind: 'disagreement-data' });
    const candidates = toResearchCandidates(record);
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      expect(candidate.kind).toBe('research-candidate');
      expect(candidate.license).toBe('arena-research-only');
      expect(candidate.provenance).toContain('adversarial competition');
      expect(candidate.consentForResearch).toBe(true);
      expect(candidate.competitionId).toBe(record.competitionId);
    }
    const benchmark = createByproductRecord({ ...BASE, kind: 'benchmark-material' });
    expect(toResearchCandidates(benchmark)[0]?.kind).toBe('benchmark-candidate');
  });

  it('a research-consent denial is projected honestly (no silent reuse)', () => {
    const record = createByproductRecord({
      ...BASE,
      kind: 'adversarial-trajectory',
      rights: { ...BASE.rights, consentForResearch: false },
    });
    expect(toResearchCandidates(record)[0]?.consentForResearch).toBe(false);
  });
});

describe('strict byproduct validation', () => {
  it('rejects unknown fields (smuggled authority shapes)', () => {
    expect(() =>
      createByproductRecord({
        ...BASE,
        kind: 'benchmark-material',
        ...( { certified: true } as unknown as Record<string, unknown>),
      }),
    ).toThrow(/rejects unknown field/);
    expect(() => createByproductRecord(null as unknown as Parameters<typeof createByproductRecord>[0])).toThrow(
      AdversarialEvaluationError,
    );
  });
});
