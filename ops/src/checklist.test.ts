/**
 * OPS1.0 checklist tests: positive + adversarial (fail-closed).
 */

import { describe, expect, it } from 'vitest';
import { OPS_ERROR_CODES, OpsError } from './shared.js';
import {
  evaluateChecklist,
  isReleaseChecklist,
  toReleaseChecklist,
} from './checklist.js';
import { buildReferenceReleaseChecklist, referenceChecklistDigest } from './reference.js';
import type { EvidenceCitation, ReleaseChecklist } from './checklist.js';

const DIGEST = 'a'.repeat(64);
const CITATION: EvidenceCitation = { kind: 'manifest', path: 'deploy/src/reference.ts', digest: DIGEST };

function checklistFor(items: Partial<ReleaseChecklist['items'][number]>[]): ReleaseChecklist {
  return {
    checklistVersion: 1,
    checklistId: 'checklist-test',
    items: items.map((item, index) => ({
      itemId: item.itemId ?? `item-${index}`,
      kind: item.kind ?? 'required',
      description: item.description ?? 'test item',
      evidence: item.evidence ?? [],
    })),
    authoredBy: 'arena-release-engineering',
    createdAt: 1_791_232_000_000,
  };
}

describe('OPS1.0 checklist — positive', () => {
  it('accepts a valid checklist and evaluates go when every required item has evidence', () => {
    const checklist = checklistFor([{ evidence: [CITATION] }, { evidence: [CITATION] }]);
    expect(isReleaseChecklist(checklist)).toBe(true);
    const evaluation = evaluateChecklist(checklist);
    expect(evaluation.verdict).toBe('go');
    expect(evaluation.failedRequiredItems).toEqual([]);
  });

  it('advisory items never block (surface as notes)', () => {
    const checklist = checklistFor([
      { kind: 'advisory', evidence: [] },
      { evidence: [CITATION] },
    ]);
    const evaluation = evaluateChecklist(checklist);
    expect(evaluation.verdict).toBe('go');
    expect(evaluation.advisoryNotes).toHaveLength(1);
  });

  it('the reference v1 checklist is valid, complete and reproducible', async () => {
    const checklist = await buildReferenceReleaseChecklist();
    expect(isReleaseChecklist(checklist)).toBe(true);
    const evaluation = evaluateChecklist(checklist);
    expect(evaluation.verdict).toBe('go');
    expect(checklist.items.filter((item) => item.kind === 'required')).toHaveLength(6);
    expect(await referenceChecklistDigest()).toBe(await referenceChecklistDigest());
    expect(await referenceChecklistDigest()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('OPS1.0 checklist — adversarial (fail-closed)', () => {
  it('required item without evidence → no-go', () => {
    const evaluation = evaluateChecklist(checklistFor([{ evidence: [] }]));
    expect(evaluation.verdict).toBe('no-go');
    expect(evaluation.failedRequiredItems).toEqual(['item-0']);
  });

  it('unsigned evidence (missing digest) is structurally rejected', () => {
    const unsigned = checklistFor([
      { evidence: [{ kind: 'manifest', path: 'x', digest: 'deadbeef' }] },
    ]);
    expect(isReleaseChecklist(unsigned)).toBe(false);
  });

  it('duplicate item ids are rejected (typed error)', () => {
    const duplicated = checklistFor([
      { itemId: 'dup' },
      { itemId: 'dup', evidence: [CITATION] },
    ]);
    expect(() => toReleaseChecklist(duplicated)).toThrow(OpsError);
    try {
      toReleaseChecklist(duplicated);
    } catch (error) {
      expect((error as OpsError).code).toBe(OPS_ERROR_CODES.INVALID_CHECKLIST);
    }
  });

  it('wrong schema version is rejected (version discipline)', () => {
    const bad = { ...checklistFor([{ evidence: [CITATION] }]), checklistVersion: 2 };
    expect(isReleaseChecklist(bad)).toBe(false);
  });
});
