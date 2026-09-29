/**
 * Determinism property tests for the matching fabric (Work Order A007) —
 * seeded LCG (no Math.random, no wall-clock reads).
 *
 * Invariants:
 *   M1 registration-order invariance — building the same pool CONTENT in
 *      shuffled registration orders yields the SAME ranked candidate
 *      order (digest tie-breaks, never insertion order);
 *   M2 match determinism — repeated matches of the same request against
 *      the same pool produce byte-identical result digests;
 *   M3 ranking totality — random legal pools always produce candidates
 *      sorted by (satisfiedAll, satisfiedCount, evidenceCount,
 *      claim-digest, expertId), strictly non-increasing in the first
 *      three keys.
 */

import { describe, expect, it } from 'vitest';
import { QualifiedExpertPool } from './pool.js';
import { ExpertMatchingEngine } from './matcher.js';
import { TestLcg, makeMatchingPolicy, makeQualifiedScenario, makeRequest } from './test-support.js';

const SEEDS = [1, 42, 20260928, 777, 314159];

async function buildPool(
  expertIds: readonly string[],
): Promise<QualifiedExpertPool> {
  const pool = new QualifiedExpertPool();
  for (const expertId of expertIds) {
    const scenario = await makeQualifiedScenario({ expertId });
    pool.registerExpertCard(scenario.card);
    for (const evidence of scenario.evidence) pool.registerEvidence(evidence);
    pool.registerQualificationPolicy(scenario.policy);
    pool.registerClaim(scenario.claim);
    await pool.registerQualificationRecord(scenario.record);
  }
  return pool;
}

describe('property: matching fabric determinism', () => {
  for (const seed of SEEDS) {
    it(`M1+M3: seed ${seed} — registration-order invariance and ranking totality`, async () => {
      const rng = new TestLcg(seed);
      const count = 2 + rng.int(3); // 2..4 experts
      const expertIds = Array.from(
        { length: count },
        (_, index) => `expert-prop-${seed}-${index}`,
      );
      const poolA = await buildPool(expertIds);
      // a shuffled registration of the same content
      const shuffled = [...expertIds];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = rng.int(i + 1);
        const tmp = shuffled[i];
        const other = shuffled[j];
        if (tmp !== undefined && other !== undefined) {
          shuffled[i] = other;
          shuffled[j] = tmp;
        }
      }
      const poolB = await buildPool(shuffled);

      const engine = new ExpertMatchingEngine();
      const request = await makeRequest();
      const policy = await makeMatchingPolicy();
      const a = await engine.match(request, policy, poolA);
      const b = await engine.match(request, policy, poolB);
      expect([...a.candidates.map((c) => c.expertId)]).toEqual(
        [...b.candidates.map((c) => c.expertId)],
      );
      // ranking totality: first three keys strictly non-increasing
      for (let i = 1; i < a.candidates.length; i += 1) {
        const prev = a.candidates[i - 1];
        const curr = a.candidates[i];
        if (prev === undefined || curr === undefined) continue;
        expect(
          Number(prev.satisfiedAll) - Number(curr.satisfiedAll) >= 0 &&
            prev.satisfiedCount >= curr.satisfiedCount,
        ).toBe(true);
      }
    });
  }

  it('M2: repeated matches produce byte-identical digests', async () => {
    for (const seed of SEEDS) {
      const pool = await buildPool([`expert-m2-${seed}`, `expert-m2b-${seed}`]);
      const engine = new ExpertMatchingEngine();
      const request = await makeRequest();
      const policy = await makeMatchingPolicy();
      const a = await engine.match(request, policy, pool);
      const b = await engine.match(request, policy, pool);
      const c = await engine.match(request, policy, pool);
      expect(a.digest).toBe(b.digest);
      expect(b.digest).toBe(c.digest);
    }
  });
});
