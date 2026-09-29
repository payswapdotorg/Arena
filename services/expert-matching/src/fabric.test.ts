/**
 * ExpertMatchingFabric tests (Work Order A007) — command orchestration,
 * idempotency (lock rule 17), decay appends, envelope round trips,
 * NOT_FOUND failures, observability.
 */

import { describe, expect, it } from 'vitest';
import { ExpertQualificationError, evaluateCompetencyClaim } from '@arena/expert-qualification';
import { ExpertMatchingFabric } from './fabric.js';
import { QualifiedExpertPool } from './pool.js';
import {
  CORR_A,
  IDEM_A,
  IDEM_B,
  T0,
  makeMatchingPolicy,
  makeQualifiedScenario,
  makeRequest,
} from './test-support.js';

async function seededFabric(): Promise<{
  fabric: ExpertMatchingFabric;
  scenario: Awaited<ReturnType<typeof makeQualifiedScenario>>;
}> {
  const fabric = new ExpertMatchingFabric();
  const scenario = await makeQualifiedScenario();
  fabric.registerExpertCard(scenario.card);
  for (const evidence of scenario.evidence) fabric.registerEvidence(evidence);
  fabric.registerQualificationPolicy(scenario.policy);
  fabric.registerClaim(scenario.claim);
  return { fabric, scenario };
}

describe('qualifyClaim (command)', () => {
  it('runs the pure engine, appends the record, emits the event', async () => {
    const { fabric, scenario } = await seededFabric();
    const { record, event } = await fabric.qualifyClaim(
      { claimRef: scenario.claim.digest, policyRef: scenario.policy.digest, evaluatedAt: T0, renew: false },
      { correlationId: CORR_A, idempotencyKey: IDEM_A },
    );
    expect(record.status).toBe('qualified');
    expect(record.claimDigest).toBe(scenario.claim.digest);
    expect(event.kind).toBe('event');
    expect(event.schema).toBe(
      'arena:schema/expert-qualification/qualification-recorded-event@1.0.0',
    );
    expect(event.payload.record.digest).toBe(record.digest);
    expect(fabric.listEvents()).toHaveLength(1);
    expect(fabric.pool.getQualificationRecord(record.digest)?.digest).toBe(record.digest);
    expect(fabric.describe().qualificationRecords).toBe(1);
  });

  it('idempotent: same key + same command replays the stored record', async () => {
    const { fabric, scenario } = await seededFabric();
    const first = await fabric.qualifyClaim(
      { claimRef: scenario.claim.digest, policyRef: scenario.policy.digest, evaluatedAt: T0, renew: false },
      { correlationId: CORR_A, idempotencyKey: IDEM_A },
    );
    const replay = await fabric.qualifyClaim(
      { claimRef: scenario.claim.digest, policyRef: scenario.policy.digest, evaluatedAt: T0, renew: false },
      { correlationId: CORR_A, idempotencyKey: IDEM_A },
    );
    expect(replay.record.digest).toBe(first.record.digest);
    expect(fabric.describe().qualificationRecords).toBe(1); // no duplicate append
    expect(fabric.listEvents()).toHaveLength(1);
  });

  it('conflict: same key + different command fails loudly', async () => {
    const { fabric, scenario } = await seededFabric();
    await fabric.qualifyClaim(
      { claimRef: scenario.claim.digest, policyRef: scenario.policy.digest, evaluatedAt: T0, renew: false },
      { correlationId: CORR_A, idempotencyKey: IDEM_A },
    );
    await expect(
      fabric.qualifyClaim(
        { claimRef: scenario.claim.digest, policyRef: scenario.policy.digest, evaluatedAt: '2026-01-16T09:30:00.000Z', renew: false },
        { correlationId: CORR_A, idempotencyKey: IDEM_A },
      ),
    ).rejects.toThrow(/is already bound to a different qualify-claim command/);
  });

  it('NOT_FOUND for unknown claims and policies; MISSING_EVIDENCE for partial evidence', async () => {
    const { fabric, scenario } = await seededFabric();
    await expect(
      fabric.qualifyClaim(
        {
          claimRef: '9999999999999999999999999999999999999999999999999999999999999999',
          policyRef: scenario.policy.digest,
          evaluatedAt: T0,
          renew: false,
        },
        { correlationId: CORR_A, idempotencyKey: IDEM_A },
      ),
    ).rejects.toThrow(ExpertQualificationError);
    await expect(
      fabric.qualifyClaim(
        {
          claimRef: scenario.claim.digest,
          policyRef: '9999999999999999999999999999999999999999999999999999999999999999',
          evaluatedAt: T0,
          renew: false,
        },
        { correlationId: CORR_A, idempotencyKey: IDEM_A },
      ),
    ).rejects.toThrow(/no qualification policy registered/);

    // partial evidence: register the claim but drop one evidence record
    const fabric2 = new ExpertMatchingFabric();
    fabric2.registerExpertCard(scenario.card);
    fabric2.registerQualificationPolicy(scenario.policy);
    fabric2.registerClaim(scenario.claim); // no evidence registered
    await expect(
      fabric2.qualifyClaim(
        { claimRef: scenario.claim.digest, policyRef: scenario.policy.digest, evaluatedAt: T0, renew: false },
        { correlationId: CORR_A, idempotencyKey: IDEM_A },
      ),
    ).rejects.toThrow(/references evidence digest.*but no such record is registered/);
  });

  it('renew=true supersedes the latest record of the claim', async () => {
    const { fabric, scenario } = await seededFabric();
    const first = await fabric.qualifyClaim(
      { claimRef: scenario.claim.digest, policyRef: scenario.policy.digest, evaluatedAt: T0, renew: false },
      { correlationId: CORR_A, idempotencyKey: IDEM_A },
    );
    const renewal = await fabric.qualifyClaim(
      {
        claimRef: scenario.claim.digest,
        policyRef: scenario.policy.digest,
        evaluatedAt: '2026-01-20T09:30:00.000Z',
        renew: true,
      },
      { correlationId: CORR_A, idempotencyKey: IDEM_B },
    );
    expect(renewal.record.supersedes).toBe(first.record.digest);
    expect(renewal.record.status).toBe('qualified');
    expect(fabric.describe().qualificationRecords).toBe(2);
    expect(fabric.pool.latestRecordForClaim(scenario.claim.digest)?.digest).toBe(
      renewal.record.digest,
    );
  });
});

describe('recordQualificationExpiry (command — decay appends)', () => {
  it('appends the expired decay record after the window lapses', async () => {
    const { fabric, scenario } = await seededFabric();
    const qualified = await fabric.qualifyClaim(
      { claimRef: scenario.claim.digest, policyRef: scenario.policy.digest, evaluatedAt: T0, renew: false },
      { correlationId: CORR_A, idempotencyKey: IDEM_A },
    );
    const after = new Date(
      Date.parse(qualified.record.validUntil as string) + 48 * 60 * 60 * 1000,
    ).toISOString();
    const { record } = await fabric.recordQualificationExpiry(
      { claimRef: scenario.claim.digest, evaluatedAt: after },
      { correlationId: CORR_A, idempotencyKey: IDEM_B },
    );
    expect(record.status).toBe('expired');
    expect(record.supersedes).toBe(qualified.record.digest);
    // the qualified record is untouched (append-only, lock rule 6)
    expect(fabric.pool.getQualificationRecord(qualified.record.digest)?.status).toBe('qualified');
    // idempotent replay
    const replay = await fabric.recordQualificationExpiry(
      { claimRef: scenario.claim.digest, evaluatedAt: after },
      { correlationId: CORR_A, idempotencyKey: IDEM_B },
    );
    expect(replay.record.digest).toBe(record.digest);
  });

  it('fails loudly when the qualification is still in force', async () => {
    const { fabric, scenario } = await seededFabric();
    await fabric.qualifyClaim(
      { claimRef: scenario.claim.digest, policyRef: scenario.policy.digest, evaluatedAt: T0, renew: false },
      { correlationId: CORR_A, idempotencyKey: IDEM_A },
    );
    await expect(
      fabric.recordQualificationExpiry(
        { claimRef: scenario.claim.digest, evaluatedAt: T0 },
        { correlationId: CORR_A, idempotencyKey: IDEM_B },
      ),
    ).rejects.toThrow(/still in force/);
  });
});

describe('matchExperts (query)', () => {
  it('round-trips the query/response envelopes and returns the result', async () => {
    const { fabric, scenario } = await seededFabric();
    await fabric.qualifyClaim(
      { claimRef: scenario.claim.digest, policyRef: scenario.policy.digest, evaluatedAt: T0, renew: false },
      { correlationId: CORR_A, idempotencyKey: IDEM_A },
    );
    const request = await makeRequest();
    const policy = await makeMatchingPolicy();
    const { result, query, response } = await fabric.matchExperts(request, policy, {
      correlationId: CORR_A,
    });
    expect(query.kind).toBe('query');
    expect(query.idempotencyKey).toBeNull();
    expect(query.schema).toBe('arena:schema/expert-qualification/match-experts-query@1.0.0');
    expect(response.kind).toBe('response');
    expect(response.schema).toBe('arena:schema/expert-qualification/match-completed-response@1.0.0');
    expect(response.payload.result.digest).toBe(result.digest);
    expect(result.candidates[0]?.expertId).toBe('expert-ada');
  });

  it('matching after decay: the expired record no longer matches', async () => {
    const { fabric, scenario } = await seededFabric();
    const qualified = await fabric.qualifyClaim(
      { claimRef: scenario.claim.digest, policyRef: scenario.policy.digest, evaluatedAt: T0, renew: false },
      { correlationId: CORR_A, idempotencyKey: IDEM_A },
    );
    const late = new Date(
      Date.parse(qualified.record.validUntil as string) + 48 * 60 * 60 * 1000,
    ).toISOString();
    await fabric.recordQualificationExpiry(
      { claimRef: scenario.claim.digest, evaluatedAt: late },
      { correlationId: CORR_A, idempotencyKey: IDEM_B },
    );
    const request = await makeRequest({ evaluatedAt: late });
    const { result } = await fabric.matchExperts(request, await makeMatchingPolicy(), {
      correlationId: CORR_A,
    });
    // full-match policy: no candidates; the request requirement is unmet
    expect(result.candidates).toHaveLength(0);
    expect(result.requirementsUnmet).toEqual(['req-rust']);
    // partial policy shows the expired reason explicitly
    const partial = await fabric.matchExperts(
      request,
      await makeMatchingPolicy({ includePartialMatches: true }),
      { correlationId: CORR_A },
    );
    expect(partial.result.candidates[0]?.perRequirement[0]?.unmatchedReason).toBe(
      'qualification-expired',
    );
  });
});

describe('fabric construction', () => {
  it('accepts a pre-populated pool (createExpertMatchingFabric)', async () => {
    const pool = new QualifiedExpertPool();
    const scenario = await makeQualifiedScenario();
    pool.registerExpertCard(scenario.card);
    for (const evidence of scenario.evidence) pool.registerEvidence(evidence);
    pool.registerQualificationPolicy(scenario.policy);
    pool.registerClaim(scenario.claim);
    const record = await evaluateCompetencyClaim({
      claim: scenario.claim,
      policy: scenario.policy,
      evidence: scenario.evidence,
      evaluatedAt: T0,
    });
    await pool.registerQualificationRecord(record);
    const { createExpertMatchingFabric } = await import('./fabric.js');
    const fabric = createExpertMatchingFabric(pool);
    expect(fabric.pool).toBe(pool);
    const { result } = await fabric.matchExperts(await makeRequest(), await makeMatchingPolicy(), {
      correlationId: CORR_A,
    });
    expect(result.candidates[0]?.satisfiedAll).toBe(true);
  });
});
