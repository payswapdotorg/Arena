import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NARRATIVE_VARIANT_ID,
  DEMO_CORPUS_RECORD_IDS,
  DEMO_ERROR_CODES,
  DEMO_NARRATIVE_VERSION,
  DemoError,
  NARRATIVE_VARIANTS,
  NARRATIVE_VARIANT_IDS,
  PRODUCT_TRUTH_LABELS,
  assertNarrativeReferencesCorpus,
  getDemoNarrative,
  getDemoNarrativeForVariant,
  getNarrativeVariant,
} from './index.js';

const STEP_IDS = getDemoNarrative().steps.map((step) => step.stepId);

describe('narrative script (B006: the guided first-run story)', () => {
  it('is versioned, ordered and frozen', () => {
    const narrative = getDemoNarrative();
    expect(narrative.version).toBe(DEMO_NARRATIVE_VERSION);
    expect(narrative.steps.map((step) => step.order)).toEqual(
      narrative.steps.map((_, index) => index + 1),
    );
    expect(Object.isFrozen(narrative)).toBe(true);
    expect(Object.isFrozen(narrative.steps)).toBe(true);
  });

  it('tells the required story arc (workspace → body → task run + trajectory → evaluation vs verification → Epoch → roles)', () => {
    expect(STEP_IDS).toEqual([
      'welcome',
      'agent-body',
      'task-run',
      'model-output',
      'evaluation',
      'verification',
      'epoch',
      'certification',
      'explore-by-role',
    ]);
  });

  it('every step read reference resolves to a corpus record and carries a valid product-truth label', () => {
    expect(() => assertNarrativeReferencesCorpus()).not.toThrow();
    const known = new Set<string>(DEMO_CORPUS_RECORD_IDS);
    for (const step of getDemoNarrative().steps) {
      expect((PRODUCT_TRUTH_LABELS as readonly string[]).includes(step.truth)).toBe(true);
      expect(step.readRefs.length).toBeGreaterThan(0);
      for (const ref of step.readRefs) {
        expect(known.has(ref.recordId)).toBe(true);
        expect(ref.recordId.startsWith('demo.')).toBe(true);
      }
    }
  });

  it('the story covers every product-truth label of the hierarchy', () => {
    const used = new Set(getDemoNarrative().steps.map((step) => step.truth));
    expect([...used].sort()).toEqual([...PRODUCT_TRUTH_LABELS].sort());
  });

  it('body copy is calm (no hype words)', () => {
    for (const step of getDemoNarrative().steps) {
      const lower = step.body.toLowerCase();
      expect(lower.includes('revolutionary')).toBe(false);
      expect(lower.includes('game-changing')).toBe(false);
      expect(lower.includes('magic')).toBe(false);
      expect(lower.includes('!')).toBe(false);
    }
  });
});

describe('role-scoped narrative variants (owner / agent-builder / expert)', () => {
  it('ships at least the owner, agent-builder and expert variants', () => {
    expect([...NARRATIVE_VARIANT_IDS]).toEqual(
      expect.arrayContaining(['owner', 'agent-builder', 'expert']),
    );
    expect(NARRATIVE_VARIANTS.length).toBeGreaterThanOrEqual(3);
  });

  it('every variant is a permutation of the canonical steps (same truth, role order)', () => {
    for (const variant of NARRATIVE_VARIANTS) {
      expect([...variant.stepIds].sort()).toEqual([...STEP_IDS].sort());
    }
  });

  it('the default variant is the owner lens (a permutation, not a subset)', () => {
    expect(DEFAULT_NARRATIVE_VARIANT_ID).toBe('owner');
    const owner = getDemoNarrativeForVariant('owner').steps.map((step) => step.stepId);
    expect([...owner].sort()).toEqual([...STEP_IDS].sort());
    expect(owner.length).toBe(STEP_IDS.length);
  });

  it('variants reorder the SAME frozen step objects', () => {
    const expert = getDemoNarrativeForVariant('expert');
    expect(expert.version).toBe(DEMO_NARRATIVE_VERSION);
    expect(expert.steps[0]?.stepId).toBe('welcome');
    expect(expert.steps[1]?.stepId).toBe('explore-by-role');
    const agentBuilder = getDemoNarrativeForVariant('agent-builder');
    expect(agentBuilder.steps[1]?.stepId).toBe('agent-body');
  });

  it('an unknown variant fails closed with the typed error', () => {
    expect(() => getNarrativeVariant('administrator')).toThrow(DemoError);
    try {
      getNarrativeVariant('nope');
    } catch (error) {
      expect((error as DemoError).code).toBe(DEMO_ERROR_CODES.INVALID_INPUT);
    }
  });
});
