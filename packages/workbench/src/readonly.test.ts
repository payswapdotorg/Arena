/**
 * Read-only guarantee (Work Order A017): the workbench NEVER mutates
 * domain state. Structural proof: every view derives from frozen
 * inputs, freezeWorkbenchCorpus deep-freezes the whole corpus, and
 * rendering the ENTIRE surface (including mutation attempts) leaves
 * every domain record byte-identical. Domain-level fail-closed
 * verification is exercised app-side (the console suite's convention),
 * where the reference services drive the records; here the guarantee is
 * the byte-stability of the frozen corpus plus the frozen-structure
 * negatives.
 */

import { describe, expect, it } from 'vitest';
import { freezeWorkbenchCorpus, isSectionSupplyState } from './corpus.js';
import { isDeepFrozen } from './freeze.js';
import { WORKBENCH_ERROR_CODES, isWorkbenchError } from './errors.js';
import { WORKBENCH_ROUTES, handleWorkbenchRequest } from './router.js';
import { makeFixtureCorpus, FIXTURE_TRAJECTORY_ID } from './test-support.js';

const ALL_ROUTES = [...WORKBENCH_ROUTES, `/trajectories/${FIXTURE_TRAJECTORY_ID}`] as const;

describe('read-only guarantee', () => {
  it('freezeWorkbenchCorpus returns a deep-frozen corpus (positive)', async () => {
    const corpus = freezeWorkbenchCorpus(await makeFixtureCorpus());
    expect(isDeepFrozen(corpus)).toBe(true);
    expect(() => {
      (corpus as unknown as Record<string, unknown>)['profiles'] = [];
    }).toThrow();
    expect(() => {
      (corpus.profiles[0] as unknown as Record<string, unknown>)['status'] = 'retired';
    }).toThrow();
  });

  it('freezeWorkbenchCorpus validates the supply states (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    const malformed = { ...corpus, expertSupply: { ...corpus.expertSupply, available: 'yes' } };
    let error: unknown;
    try {
      freezeWorkbenchCorpus(malformed as never);
    } catch (caught) {
      error = caught;
    }
    expect(isWorkbenchError(error)).toBe(true);
    expect((error as { code: string }).code).toBe(WORKBENCH_ERROR_CODES.INVALID_SUPPLY_STATE);

    const badTimestamp = {
      ...corpus,
      jobStore: { ...corpus.jobStore, lastKnownAt: '2026-10-05' },
    };
    expect(() => freezeWorkbenchCorpus(badTimestamp as never)).toThrowError(
      WORKBENCH_ERROR_CODES.INVALID_SUPPLY_STATE,
    );
  });

  it('rendering the whole surface (including mutations) leaves the corpus byte-identical (negative)', async () => {
    const corpus = freezeWorkbenchCorpus(await makeFixtureCorpus());
    const before = JSON.stringify(corpus);
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      for (const path of [...ALL_ROUTES, '/nope', '/trajectories/unknown']) {
        handleWorkbenchRequest({ method, path }, corpus);
      }
    }
    expect(JSON.stringify(corpus)).toBe(before);
    expect(isDeepFrozen(corpus)).toBe(true);
  });

  it('isSectionSupplyState accepts only well-formed states (negative)', () => {
    expect(
      isSectionSupplyState({
        section: 'experts',
        available: true,
        detail: 'ok',
        lastKnownAt: '2026-10-05T09:00:00.000Z',
      }),
    ).toBe(true);
    expect(
      isSectionSupplyState({
        section: 'not-a-section',
        available: true,
        detail: 'ok',
        lastKnownAt: '2026-10-05T09:00:00.000Z',
      }),
    ).toBe(false);
    expect(isSectionSupplyState(null)).toBe(false);
    expect(isSectionSupplyState({ section: 'experts' })).toBe(false);
  });
});
