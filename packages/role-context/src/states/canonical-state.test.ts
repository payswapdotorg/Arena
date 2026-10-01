/**
 * Canonical state classification suite (Work Order B003) — the product-truth
 * taxonomy (handoff §7): 11 kinds, total deterministic classification and
 * the distinctStateKinds contract (the UI can never collapse kinds).
 */

import { describe, expect, it } from 'vitest';
import {
  areStateKindsDisplayEquivalent,
  CANONICAL_STATE_DESCRIPTORS,
  canonicalStateDescriptor,
  canonicalStateLabel,
  classifyState,
  countStateKinds,
  DISTINCT_STATE_KINDS,
  stateKindDisplayGroup,
  toCanonicalStateKind,
} from '../index.js';
import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from '../index.js';
import { CANONICAL_STATE_KINDS } from '../index.js';

describe('the product-truth taxonomy (handoff §7)', () => {
  it('contains the 11 product-truth kinds in closed vocabulary order', () => {
    expect([...CANONICAL_STATE_KINDS]).toEqual([
      'verified-fact',
      'evidence',
      'expert-judgment',
      'model-output',
      'simulation-replay',
      'evaluation-result',
      'certification',
      'suggestion-hypothesis',
      'demo-state',
      'pending',
      'unknown',
    ]);
    expect([...DISTINCT_STATE_KINDS]).toEqual([...CANONICAL_STATE_KINDS]);
  });

  it('carries a complete descriptor set (label, meaning, guidance)', () => {
    expect(CANONICAL_STATE_DESCRIPTORS).toHaveLength(11);
    for (const kind of CANONICAL_STATE_KINDS) {
      const descriptor = canonicalStateDescriptor(kind);
      expect(descriptor.kind).toBe(kind);
      expect(descriptor.label.length).toBeGreaterThan(0);
      expect(descriptor.meaning.length).toBeGreaterThan(0);
      expect(descriptor.guidance.length).toBeGreaterThan(0);
      expect(descriptor.recordVersion).toBe(1);
      expect(Object.isFrozen(descriptor)).toBe(true);
    }
    // handoff §7 ground rules encoded as guidance
    expect(canonicalStateDescriptor('certification').guidance).toContain(
      'A purchased artifact is not automatically certified',
    );
    expect(canonicalStateDescriptor('simulation-replay').guidance).toContain(
      'A replay is not a live-world mutation',
    );
    expect(canonicalStateDescriptor('demo-state').guidance).toContain(
      'never customer-authoritative',
    );
    expect(canonicalStateDescriptor('expert-judgment').guidance).toContain(
      'A model is not automatically a professional',
    );
  });

  it('labels are human and distinct', () => {
    const labels = CANONICAL_STATE_DESCRIPTORS.map((descriptor) => descriptor.label);
    expect(new Set(labels).size).toBe(11);
    expect(canonicalStateLabel('verified-fact')).toBe('Verified fact');
    expect(canonicalStateLabel('suggestion-hypothesis')).toBe('Suggestion / Hypothesis');
    expect(canonicalStateLabel('simulation-replay')).toBe('Simulation / Replay');
  });
});

describe('classifyState (total, deterministic, fail honest)', () => {
  it('classifies objects carrying stateKind and bare kind strings', () => {
    expect(classifyState({ stateKind: 'evidence' })).toBe('evidence');
    expect(classifyState({ stateKind: 'demo-state' })).toBe('demo-state');
    expect(classifyState('certification')).toBe('certification');
    expect(classifyState('pending')).toBe('pending');
  });

  it('classifies ANYTHING unclassifiable as unknown — never throws, never guesses', () => {
    expect(classifyState(undefined)).toBe('unknown');
    expect(classifyState(null)).toBe('unknown');
    expect(classifyState(42)).toBe('unknown');
    expect(classifyState({})).toBe('unknown');
    expect(classifyState({ stateKind: undefined })).toBe('unknown');
    expect(classifyState({ stateKind: 'ai-result' })).toBe('unknown'); // the §7 anti-pattern
    expect(classifyState({ stateKind: 'verified' })).toBe('unknown'); // not a kind
    expect(classifyState({ kind: 'evidence' })).toBe('unknown'); // wrong field name
    expect(classifyState({ stateKind: ['evidence'] })).toBe('unknown');
  });

  it('toCanonicalStateKind is the strict form (typed rejection for unknown kinds)', () => {
    expect(toCanonicalStateKind('evidence')).toBe('evidence');
    try {
      toCanonicalStateKind('score');
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as RoleContextError).code).toBe(ROLE_CONTEXT_ERROR_CODES.INVALID_STATE);
      expect((error as RoleContextError).category).toBe('validation');
    }
  });

  it('countStateKinds counts deterministically, only non-zero keys', () => {
    const counts = countStateKinds([
      { stateKind: 'evidence' },
      { stateKind: 'evidence' },
      { stateKind: 'model-output' },
      'pending',
      { stateKind: 'not-a-kind' },
      null,
    ]);
    expect(counts).toEqual({
      evidence: 2,
      'model-output': 1,
      pending: 1,
      unknown: 2,
    });
    expect(countStateKinds([])).toEqual({});
  });
});

describe('distinctStateKinds contract (the UI may never collapse kinds)', () => {
  it('every kind maps to its OWN display group (injective grouping)', () => {
    const groups = CANONICAL_STATE_KINDS.map((kind) => stateKindDisplayGroup(kind));
    expect(new Set(groups).size).toBe(CANONICAL_STATE_KINDS.length);
    expect(groups).toEqual([...CANONICAL_STATE_KINDS]);
  });

  it('display equivalence is EXACTLY kind identity — for every pair of kinds', () => {
    for (const a of CANONICAL_STATE_KINDS) {
      for (const b of CANONICAL_STATE_KINDS) {
        expect(areStateKindsDisplayEquivalent(a, b)).toBe(a === b);
      }
    }
  });

  it('the §7 anti-collapse pairs are never display-equivalent', () => {
    // the classic collapse traps the taxonomy exists to prevent
    expect(areStateKindsDisplayEquivalent('model-output', 'verified-fact')).toBe(false);
    expect(areStateKindsDisplayEquivalent('model-output', 'expert-judgment')).toBe(false);
    expect(areStateKindsDisplayEquivalent('simulation-replay', 'verified-fact')).toBe(false);
    expect(areStateKindsDisplayEquivalent('certification', 'evidence')).toBe(false);
    expect(areStateKindsDisplayEquivalent('demo-state', 'verified-fact')).toBe(false);
    expect(areStateKindsDisplayEquivalent('suggestion-hypothesis', 'evaluation-result')).toBe(false);
    expect(areStateKindsDisplayEquivalent('pending', 'unknown')).toBe(false);
    expect(areStateKindsDisplayEquivalent('unknown', 'verified-fact')).toBe(false);
  });

  it('unclassifiable input groups with unknown, never with a real kind', () => {
    expect(stateKindDisplayGroup(classifyState('whatever'))).toBe('unknown');
    expect(areStateKindsDisplayEquivalent(classifyState('whatever'), 'evidence')).toBe(false);
    expect(areStateKindsDisplayEquivalent(classifyState(null), classifyState(42))).toBe(true);
  });
});
