/**
 * Candidate validation tests — the closed source-kind vocabulary, the
 * LE1.0 surface explicitness, the ≥1 validated evidence rule and the
 * closed rights vocabulary.
 */

import { describe, expect, it } from 'vitest';
import { createImprovementCandidate } from './candidate.js';
import { CANDIDATE_SOURCE_KINDS, CANDIDATE_RIGHTS_STATUSES } from './candidate.js';
import { makeCandidate, makeCandidateInput, DIGEST_A, DIGEST_C } from './test-support.js';

describe('improvement candidate construction', () => {
  it('creates a content-addressed candidate with the explicit changed surface', async () => {
    const candidate = await makeCandidate();
    expect(candidate.recordVersion).toBe(1);
    expect(candidate.changedSurface).toBe('skills');
    expect(candidate.rights.status).toBe('granted-for-global-reuse');
    expect(candidate.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(candidate)).toBe(true);
  });

  it('is deterministic: identical input ⇒ identical digest', async () => {
    const a = await makeCandidate();
    const b = await makeCandidate();
    expect(a.digest).toBe(b.digest);
  });

  for (const sourceKind of CANDIDATE_SOURCE_KINDS) {
    it(`accepts the closed source kind ${sourceKind}`, async () => {
      const candidate = await makeCandidate({ sourceKind });
      expect(candidate.sourceKind).toBe(sourceKind);
    });
  }

  for (const status of CANDIDATE_RIGHTS_STATUSES) {
    it(`accepts the closed rights status ${status}`, async () => {
      const candidate = await makeCandidate({ rightsStatus: status });
      expect(candidate.rights.status).toBe(status);
    });
  }

  it('rejects an unknown source kind', async () => {
    await expect(makeCandidate({ sourceKind: 'mystery-pipeline' })).rejects.toMatchObject({
      name: 'CapabilityLearningError',
      code: 'CAPABILITY_LEARNING_INVALID_CANDIDATE',
    });
  });

  it('rejects an undeclared/ambiguous changed surface (the LE1.0 nine only)', async () => {
    await expect(makeCandidate({ changedSurface: 'prompts' })).rejects.toMatchObject({
      code: 'CAPABILITY_LEARNING_INVALID_CANDIDATE',
    });
    await expect(makeCandidate({ changedSurface: '' })).rejects.toMatchObject({
      code: 'CAPABILITY_LEARNING_INVALID_CANDIDATE',
    });
  });

  it('rejects an empty evidence set (fail-closed: validated evidence is required)', async () => {
    await expect(makeCandidate({ evidenceRefs: [] })).rejects.toMatchObject({
      code: 'CAPABILITY_LEARNING_INVALID_CANDIDATE',
    });
  });

  it('rejects malformed digests (the REAL @arena/learning digest guard throws, fail-closed)', async () => {
    await expect(
      createImprovementCandidate({ ...makeCandidateInput(), sourceRecordRef: 'not-a-digest' }),
    ).rejects.toThrow();
    await expect(
      createImprovementCandidate({
        ...makeCandidateInput(),
        evidenceRefs: [DIGEST_C, 'zz'],
      }),
    ).rejects.toThrow();
  });

  it('rejects an experiment plan without protected capabilities (Q1.0 condition 4 must be measurable)', async () => {
    const input = makeCandidateInput();
    await expect(
      createImprovementCandidate({
        ...input,
        experimentPlan: {
          ...input.experimentPlan,
          protectedCapabilities: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_INVALID_CANDIDATE' });
  });

  it('binds the source surface by digest (historical digests are enumerable)', async () => {
    const candidate = await makeCandidate({ supersedes: DIGEST_A });
    const historical = [candidate.sourceRecordRef as string, ...candidate.evidenceRefs, candidate.supersedes as string];
    expect(historical).toContain(DIGEST_C);
    expect(historical).toContain(DIGEST_A);
  });
});
