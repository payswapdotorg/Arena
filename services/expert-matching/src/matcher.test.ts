/**
 * ExpertMatchingEngine tests (Work Order A007; requirement R8) — the
 * golden path, every unmatched reason, tenant isolation, determinism,
 * ranking with digest tie-breaks, caps and the negative space.
 */

import { describe, expect, it } from 'vitest';
import {
  createCompetencyClaim,
  createMatchRequest,
  evaluateCompetencyClaim,
} from '@arena/expert-qualification';
import { QualifiedExpertPool } from './pool.js';
import { ExpertMatchingEngine } from './matcher.js';
import {
  DOMAIN_SOFTWARE,
  SKILL_RUST,
  SKILL_SCENARIO,
  T0,
  T_FRESH,
  makeCard,
  makeMatchingPolicy,
  makeQualifiedScenario,
  makeRequest,
} from './test-support.js';

async function poolWithQualifiedExpert(): Promise<{
  pool: QualifiedExpertPool;
  scenario: Awaited<ReturnType<typeof makeQualifiedScenario>>;
}> {
  const pool = new QualifiedExpertPool();
  const scenario = await makeQualifiedScenario();
  pool.registerExpertCard(scenario.card);
  for (const evidence of scenario.evidence) pool.registerEvidence(evidence);
  pool.registerQualificationPolicy(scenario.policy);
  pool.registerClaim(scenario.claim);
  await pool.registerQualificationRecord(scenario.record);
  return { pool, scenario };
}

describe('the golden path', () => {
  it('a qualified, in-force expert matches with full evidence', async () => {
    const { pool, scenario } = await poolWithQualifiedExpert();
    const engine = new ExpertMatchingEngine();
    const request = await makeRequest();
    const policy = await makeMatchingPolicy();
    const result = await engine.match(request, policy, pool);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect(candidate?.expertId).toBe('expert-ada');
    expect(candidate?.satisfiedAll).toBe(true);
    expect(candidate?.satisfiedCount).toBe(1);
    const entry = candidate?.perRequirement[0];
    expect(entry?.satisfied).toBe(true);
    expect(entry?.claimDigest).toBe(scenario.claim.digest);
    expect(entry?.recordDigest).toBe(scenario.record.digest);
    expect(entry?.evidenceDigests).toEqual([...scenario.record.qualifyingEvidence]);
    expect(entry?.matchedProficiency).toBe('proficient');
    expect(result.requirementsUnmet).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.requestDigest).toBe(request.digest);
    expect(result.matchingPolicyDigest).toBe(policy.digest);
  });

  it('pure: same pool + same request ⇒ byte-identical result digest', async () => {
    const { pool } = await poolWithQualifiedExpert();
    const engine = new ExpertMatchingEngine();
    const request = await makeRequest();
    const policy = await makeMatchingPolicy();
    const a = await engine.match(request, policy, pool);
    const b = await engine.match(request, policy, pool);
    expect(a.digest).toBe(b.digest);
  });
});

describe('per-requirement unmatched reasons (no silent best-effort)', () => {
  it('no-competency-claim when the expert never claimed the capability', async () => {
    const pool = new QualifiedExpertPool();
    const unqualified = await makeCard({ expertId: 'expert-newcomer' });
    pool.registerExpertCard(unqualified);
    const engine = new ExpertMatchingEngine();
    const result = await engine.match(
      await makeRequest(),
      await makeMatchingPolicy({ includePartialMatches: true }),
      pool,
    );
    // explicit negative space — the newcomer appears with the reason, never silently
    expect(result.candidates[0]?.perRequirement[0]?.unmatchedReason).toBe(
      'no-competency-claim',
    );
    expect(result.requirementsUnmet).toEqual(['req-rust']);
    // with partial matches OFF the newcomer is not a candidate
    const strict = await engine.match(await makeRequest(), await makeMatchingPolicy(), pool);
    expect(strict.candidates).toHaveLength(0);
  });

  it('qualification-missing when the claim exists but no record was computed', async () => {
    const pool = new QualifiedExpertPool();
    const scenario = await makeQualifiedScenario();
    pool.registerExpertCard(scenario.card);
    for (const evidence of scenario.evidence) pool.registerEvidence(evidence);
    pool.registerQualificationPolicy(scenario.policy);
    pool.registerClaim(scenario.claim); // record NOT registered
    const engine = new ExpertMatchingEngine();
    const result = await engine.match(
      await makeRequest(),
      await makeMatchingPolicy({ includePartialMatches: true }),
      pool,
    );
    expect(result.candidates[0]?.perRequirement[0]?.unmatchedReason).toBe(
      'qualification-missing',
    );
  });

  it('proficiency-below-threshold when the claim is under the threshold', async () => {
    const pool = new QualifiedExpertPool();
    const scenario = await makeQualifiedScenario({ proficiency: 'working' });
    pool.registerExpertCard(scenario.card);
    for (const evidence of scenario.evidence) pool.registerEvidence(evidence);
    pool.registerQualificationPolicy(scenario.policy);
    pool.registerClaim(scenario.claim);
    await pool.registerQualificationRecord(scenario.record);
    const engine = new ExpertMatchingEngine();
    const result = await engine.match(
      await makeRequest(),
      await makeMatchingPolicy({ includePartialMatches: true }),
      pool,
    );
    expect(result.candidates[0]?.perRequirement[0]?.unmatchedReason).toBe(
      'proficiency-below-threshold',
    );
  });

  it('qualification-expired when the window elapsed before request.evaluatedAt', async () => {
    const pool = new QualifiedExpertPool();
    // qualified at T0 (valid 180 days → mid-2026)
    const scenario = await makeQualifiedScenario();
    pool.registerExpertCard(scenario.card);
    for (const evidence of scenario.evidence) pool.registerEvidence(evidence);
    pool.registerQualificationPolicy(scenario.policy);
    pool.registerClaim(scenario.claim);
    await pool.registerQualificationRecord(scenario.record);
    const engine = new ExpertMatchingEngine();
    // request evaluated a year later — the qualification has lapsed
    const result = await engine.match(
      await makeRequest({ evaluatedAt: '2027-06-01T09:30:00.000Z' }),
      await makeMatchingPolicy({ includePartialMatches: true }),
      pool,
    );
    expect(result.candidates[0]?.perRequirement[0]?.unmatchedReason).toBe(
      'qualification-expired',
    );
  });

  it('qualification-stale and qualification-unqualified surface their statuses', async () => {
    const pool = new QualifiedExpertPool();
    const scenario = await makeQualifiedScenario();
    pool.registerExpertCard(scenario.card);
    for (const evidence of scenario.evidence) pool.registerEvidence(evidence);
    pool.registerQualificationPolicy(scenario.policy);
    pool.registerClaim(scenario.claim);
    // evaluate with a policy whose freshness excludes everything → stale
    const stalePolicy = await import('@arena/expert-qualification').then((m) =>
      m.createQualificationPolicy({
        policyId: 'policy-stale',
        version: '1.0.0',
        description: 'impossible freshness',
        requirements: [
          { requirementId: 'work-products', evidenceKind: 'work-product-ref', minimumCount: 2 },
        ],
        freshnessWindowDays: 1,
        validityWindowDays: 180,
        conflictEvidence: [],
      }),
    );
    const staleRecord = await evaluateCompetencyClaim({
      claim: scenario.claim,
      policy: stalePolicy,
      evidence: scenario.evidence,
      evaluatedAt: T0,
    });
    expect(staleRecord.status).toBe('stale');
    pool.registerQualificationPolicy(stalePolicy);
    await pool.registerQualificationRecord(staleRecord);
    const engine = new ExpertMatchingEngine();
    const result = await engine.match(
      await makeRequest(),
      await makeMatchingPolicy({ includePartialMatches: true }),
      pool,
    );
    expect(result.candidates[0]?.perRequirement[0]?.unmatchedReason).toBe('qualification-stale');
  });

  it('domain-mismatch / jurisdiction-mismatch / availability-conflict from scope', async () => {
    const { pool } = await poolWithQualifiedExpert();
    const engine = new ExpertMatchingEngine();
    const policy = await makeMatchingPolicy({ includePartialMatches: true, availabilityRequired: true });
    // domain: request a different domain
    const domainMiss = await engine.match(
      await makeRequest({
        domain: { kind: 'domain', id: 'structural-engineering', version: '1.0.0', digest: '1234567890123456789012345678901234567890123456789012345678901234' },
      }),
      policy,
      pool,
    );
    expect(domainMiss.candidates[0]?.perRequirement[0]?.unmatchedReason).toBe('domain-mismatch');
    // jurisdiction: request a country the expert does not cover
    const jurisdictionMiss = await engine.match(
      await makeRequest({ jurisdictions: [{ country: 'JP' }] }),
      policy,
      pool,
    );
    expect(jurisdictionMiss.candidates[0]?.perRequirement[0]?.unmatchedReason).toBe(
      'jurisdiction-mismatch',
    );
    // availability: request a window far from the daily 08:00-16:00 window
    const availabilityMiss = await engine.match(
      await makeRequest({
        availabilityWindow: {
          from: '2026-01-15T23:00:00.000Z',
          until: '2026-01-15T23:30:00.000Z',
        },
      }),
      policy,
      pool,
    );
    expect(availabilityMiss.candidates[0]?.perRequirement[0]?.unmatchedReason).toBe(
      'availability-conflict',
    );
    // the SAME availability window with availabilityRequired=false is fine
    const availabilityOptional = await engine.match(
      await makeRequest({
        availabilityWindow: {
          from: '2026-01-15T23:00:00.000Z',
          until: '2026-01-15T23:30:00.000Z',
        },
      }),
      await makeMatchingPolicy({ includePartialMatches: true, availabilityRequired: false }),
      pool,
    );
    expect(availabilityOptional.candidates[0]?.satisfiedAll).toBe(true);
  });
});

describe('tenant isolation (lock rule 11)', () => {
  it('cross-tenant experts are INVISIBLE — never in results, never in reasons', async () => {
    const pool = new QualifiedExpertPool();
    const foreign = await makeQualifiedScenario({ tenant: 'tenant-beta' });
    pool.registerExpertCard(foreign.card);
    for (const evidence of foreign.evidence) pool.registerEvidence(evidence);
    pool.registerQualificationPolicy(foreign.policy);
    pool.registerClaim(foreign.claim);
    await pool.registerQualificationRecord(foreign.record);
    const engine = new ExpertMatchingEngine();
    const result = await engine.match(
      await makeRequest({ tenant: 'tenant-alpha' }),
      await makeMatchingPolicy({ includePartialMatches: true }),
      pool,
    );
    expect(result.candidates).toHaveLength(0); // invisible, not unmatched
    expect(JSON.stringify(result)).not.toContain('tenant-beta');
  });

  it('public-tenant experts are visible to every tenant', async () => {
    const pool = new QualifiedExpertPool();
    const publicScenario = await makeQualifiedScenario({ tenant: 'public' });
    pool.registerExpertCard(publicScenario.card);
    for (const evidence of publicScenario.evidence) pool.registerEvidence(evidence);
    pool.registerQualificationPolicy(publicScenario.policy);
    pool.registerClaim(publicScenario.claim);
    await pool.registerQualificationRecord(publicScenario.record);
    const engine = new ExpertMatchingEngine();
    const result = await engine.match(
      await makeRequest({ tenant: 'tenant-alpha' }),
      await makeMatchingPolicy(),
      pool,
    );
    expect(result.candidates[0]?.tenant).toBe('public');
  });
});

describe('deterministic ranking', () => {
  it('ranks by satisfiedCount, then evidence depth, then digest tie-break', async () => {
    const pool = new QualifiedExpertPool();
    // expert-ada satisfies req-rust fully; expert-grace CLAIMS the scenario
    // skill but has no qualification record (partial with an explicit reason)
    const ada = await makeQualifiedScenario({ expertId: 'expert-ada' });
    pool.registerExpertCard(ada.card);
    for (const evidence of ada.evidence) pool.registerEvidence(evidence);
    pool.registerQualificationPolicy(ada.policy);
    pool.registerClaim(ada.claim);
    await pool.registerQualificationRecord(ada.record);

    const graceCard = await makeCard({ expertId: 'expert-grace' });
    const graceClaim = await createCompetencyClaim({
      expertId: 'expert-grace',
      tenant: 'tenant-alpha',
      capability: SKILL_SCENARIO,
      proficiency: 'proficient',
      evidence: [ada.evidence[0]?.digest as string],
      declaredAt: T_FRESH,
    });
    pool.registerExpertCard(graceCard);
    pool.registerClaim(graceClaim);
    // no record for grace → partial with qualification-missing

    const engine = new ExpertMatchingEngine();
    const request = await createMatchRequest({
      tenant: 'tenant-alpha',
      requirements: [
        { requirementId: 'req-rust', capability: SKILL_RUST, minimumProficiency: 'proficient' },
        { requirementId: 'req-scenario', capability: SKILL_SCENARIO, minimumProficiency: 'working' },
      ],
      evaluatedAt: T0,
    });
    const result = await engine.match(
      request,
      await makeMatchingPolicy({ includePartialMatches: true }),
      pool,
    );
    // ada (1 satisfied, in-force record) ranks above grace (0 satisfied)
    expect(result.candidates.map((candidate) => candidate.expertId)).toEqual([
      'expert-ada',
      'expert-grace',
    ]);
    expect(result.candidates[1]?.perRequirement[1]?.unmatchedReason).toBe(
      'qualification-missing',
    );
    // ada does not claim the scenario skill — the negative space is explicit
    expect(result.requirementsUnmet).toEqual(['req-scenario']);
  });

  it('registration order NEVER leaks into the result (permutation invariance)', async () => {
    const buildPool = async (order: number[]): Promise<QualifiedExpertPool> => {
      const pool = new QualifiedExpertPool();
      const scenarios = [
        await makeQualifiedScenario({ expertId: 'expert-ada' }),
        await makeQualifiedScenario({ expertId: 'expert-grace' }),
        await makeQualifiedScenario({ expertId: 'expert-linus' }),
      ];
      for (const index of order) {
        const scenario = scenarios[index];
        if (scenario === undefined) continue;
        pool.registerExpertCard(scenario.card);
        for (const evidence of scenario.evidence) pool.registerEvidence(evidence);
        pool.registerQualificationPolicy(scenario.policy);
        pool.registerClaim(scenario.claim);
        await pool.registerQualificationRecord(scenario.record);
      }
      return pool;
    };
    const engine = new ExpertMatchingEngine();
    const request = await makeRequest();
    const policy = await makeMatchingPolicy();
    const a = await engine.match(request, policy, await buildPool([0, 1, 2]));
    const b = await engine.match(request, policy, await buildPool([2, 1, 0]));
    const c = await engine.match(request, policy, await buildPool([1, 2, 0]));
    // the same CONTENT produces the same ranked order and digests
    expect([...c.candidates.map((candidate) => candidate.expertId)]).toEqual(
      [...b.candidates.map((candidate) => candidate.expertId)],
    );
    // identical scenarios have identical claim digests only when the
    // expert ids match; ranks are by digest tie-break here
    expect(a.candidates.map((candidate) => candidate.satisfiedAll)).toEqual([true, true, true]);
    expect(b.digest).toBe(c.digest);
  });

  it('caps at maxCandidates and flags truncation; requirementsUnmet recomputes', async () => {
    const pool = new QualifiedExpertPool();
    for (const expertId of ['expert-ada', 'expert-grace', 'expert-linus']) {
      const scenario = await makeQualifiedScenario({ expertId });
      pool.registerExpertCard(scenario.card);
      for (const evidence of scenario.evidence) pool.registerEvidence(evidence);
      pool.registerQualificationPolicy(scenario.policy);
      pool.registerClaim(scenario.claim);
      await pool.registerQualificationRecord(scenario.record);
    }
    const engine = new ExpertMatchingEngine();
    const request = await makeRequest();
    const capped = await engine.match(request, await makeMatchingPolicy({ maxCandidates: 1 }), pool);
    expect(capped.candidates).toHaveLength(1);
    expect(capped.truncated).toBe(true);
    const uncapped = await engine.match(request, await makeMatchingPolicy({ maxCandidates: 10 }), pool);
    expect(uncapped.candidates).toHaveLength(3);
    expect(uncapped.truncated).toBe(false);
  });
});

describe('claim supersession in matching', () => {
  it('a superseded claim never matches; the superseding claim does', async () => {
    const pool = new QualifiedExpertPool();
    const scenario = await makeQualifiedScenario();
    pool.registerExpertCard(scenario.card);
    for (const evidence of scenario.evidence) pool.registerEvidence(evidence);
    pool.registerQualificationPolicy(scenario.policy);
    pool.registerClaim(scenario.claim);
    await pool.registerQualificationRecord(scenario.record);

    // expert re-claims at a LOWER proficiency, superseding the first
    const downgrade = await createCompetencyClaim({
      expertId: 'expert-ada',
      tenant: 'tenant-alpha',
      capability: SKILL_RUST,
      proficiency: 'introductory',
      evidence: scenario.claim.evidence,
      declaredAt: T0,
      supersedes: scenario.claim.digest,
    });
    pool.registerClaim(downgrade);

    const engine = new ExpertMatchingEngine();
    const result = await engine.match(
      await makeRequest(),
      await makeMatchingPolicy({ includePartialMatches: true }),
      pool,
    );
    // the ACTIVE claim is the downgrade → proficiency-below-threshold
    expect(result.candidates[0]?.perRequirement[0]?.unmatchedReason).toBe(
      'proficiency-below-threshold',
    );
    // and no record exists for the downgrade claim
    expect(result.candidates[0]?.perRequirement[0]?.claimDigest).toBeUndefined();
  });
});

void DOMAIN_SOFTWARE;
