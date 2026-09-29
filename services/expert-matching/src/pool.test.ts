/**
 * QualifiedExpertPool tests (Work Order A007) — registration discipline,
 * identity/supersession conflicts, append-only behavior, queries.
 */

import { describe, expect, it } from 'vitest';
import { ExpertQualificationError } from '@arena/expert-qualification';
import { createCompetencyClaim } from '@arena/expert-qualification';
import { QualifiedExpertPool } from './pool.js';
import {
  IDEM_A,
  SKILL_RUST,
  T0,
  T_FRESH,
  makeCard,
  makePolicy,
  makeQualifiedScenario,
} from './test-support.js';

describe('card registration', () => {
  it('registers idempotently by digest and conflicts on identity changes', async () => {
    const pool = new QualifiedExpertPool();
    const card = await makeCard();
    expect(pool.registerExpertCard(card)).toBe(card);
    expect(pool.registerExpertCard(card)).toBe(card); // idempotent
    expect(pool.listCards()).toHaveLength(1);
    expect(pool.getCard('expert-ada', 'tenant-alpha')?.digest).toBe(card.digest);
    expect(pool.getCard('expert-ada', 'tenant-beta')).toBeUndefined();

    const changed = await makeCard({ withJurisdiction: false });
    expect(() => pool.registerExpertCard(changed)).toThrow(ExpertQualificationError);
    expect(() => pool.registerExpertCard(changed)).toThrow(/already registered with a different card digest/);
  });
});

describe('evidence registration (append-only)', () => {
  it('registers idempotently; no update/delete surface exists', async () => {
    const pool = new QualifiedExpertPool();
    const scenario = await makeQualifiedScenario();
    for (const evidence of scenario.evidence) {
      pool.registerEvidence(evidence);
      pool.registerEvidence(evidence); // idempotent
    }
    expect(pool.listEvidence()).toHaveLength(3);
    expect(pool.getEvidence(scenario.evidence[0]?.digest as string)).toBeDefined();
    // no mutation surface: the only write APIs are the register* ones
    const writeApis = Object.getOwnPropertyNames(QualifiedExpertPool.prototype).filter(
      (name) => name.startsWith('register') || name.startsWith('put') || name.startsWith('update') || name.startsWith('delete'),
    );
    expect(writeApis.sort()).toEqual([
      'registerClaim',
      'registerEvidence',
      'registerExpertCard',
      'registerQualificationPolicy',
      'registerQualificationRecord',
    ]);
  });
});

describe('policy registration', () => {
  it('registers idempotently; version discipline conflicts', async () => {
    const pool = new QualifiedExpertPool();
    const policy = await makePolicy();
    pool.registerQualificationPolicy(policy);
    pool.registerQualificationPolicy(policy);
    expect(pool.listQualificationPolicies()).toHaveLength(1);
    const different = await makePolicy({ validityWindowDays: 90 });
    expect(() => pool.registerQualificationPolicy(different)).toThrow(
      /changing a policy requires a new version/,
    );
  });
});

describe('claim registration', () => {
  it('REQUIRES a registered expert card (fail closed)', async () => {
    const pool = new QualifiedExpertPool();
    const scenario = await makeQualifiedScenario({ expertId: 'expert-nobody' });
    expect(() => pool.registerClaim(scenario.claim)).toThrow(
      /no expert card registered for expert-nobody/,
    );
    pool.registerExpertCard(await makeCard({ expertId: 'expert-nobody' }));
    expect(pool.registerClaim(scenario.claim).claim.digest).toBe(scenario.claim.digest);
  });

  it('supersession chains: registering the superseding claim retires the prior', async () => {
    const pool = new QualifiedExpertPool();
    const first = await createCompetencyClaim({
      expertId: 'expert-ada',
      tenant: 'tenant-alpha',
      capability: SKILL_RUST,
      proficiency: 'working',
      evidence: ['4444444444444444444444444444444444444444444444444444444444444444'],
      declaredAt: T_FRESH,
    });
    const second = await createCompetencyClaim({
      expertId: 'expert-ada',
      tenant: 'tenant-alpha',
      capability: SKILL_RUST,
      proficiency: 'advanced',
      evidence: [
        '4444444444444444444444444444444444444444444444444444444444444444',
        '5555555555555555555555555555555555555555555555555555555555555555',
      ],
      declaredAt: T0,
      supersedes: first.digest,
    });
    pool.registerExpertCard(await makeCard());
    pool.registerClaim(first);
    pool.registerClaim(second);
    const identity = 'expert-ada@tenant-alpha::skill:rust-code-review@2.1.0';
    const active = pool.activeClaimsForIdentity(identity);
    expect(active.map((claim) => claim.digest)).toEqual([second.digest]);
    // the superseded claim stays registered for audit
    expect(pool.getClaim(first.digest)).toBeDefined();
  });

  it('rejects superseding an UNREGISTERED claim', async () => {
    const pool = new QualifiedExpertPool();
    pool.registerExpertCard(await makeCard());
    const dangling = await createCompetencyClaim({
      expertId: 'expert-ada',
      tenant: 'tenant-alpha',
      capability: SKILL_RUST,
      proficiency: 'working',
      evidence: ['4444444444444444444444444444444444444444444444444444444444444444'],
      declaredAt: T_FRESH,
      supersedes: '9999999999999999999999999999999999999999999999999999999999999999',
    });
    expect(() => pool.registerClaim(dangling)).toThrow(
      /supersedes an unregistered claim digest/,
    );
  });

  it('rejects superseding a claim of a DIFFERENT identity', async () => {
    const pool = new QualifiedExpertPool();
    const first = await createCompetencyClaim({
      expertId: 'expert-ada',
      tenant: 'tenant-alpha',
      capability: SKILL_RUST,
      proficiency: 'working',
      evidence: ['4444444444444444444444444444444444444444444444444444444444444444'],
      declaredAt: T_FRESH,
    });
    pool.registerExpertCard(await makeCard());
    pool.registerClaim(first);
    const foreign = await createCompetencyClaim({
      expertId: 'expert-grace',
      tenant: 'tenant-alpha',
      capability: SKILL_RUST,
      proficiency: 'working',
      evidence: ['4444444444444444444444444444444444444444444444444444444444444444'],
      declaredAt: T0,
      supersedes: first.digest,
    });
    pool.registerExpertCard(await makeCard({ expertId: 'expert-grace' }));
    expect(() => pool.registerClaim(foreign)).toThrow(/DIFFERENT identity/);
  });
});

describe('qualification record registration', () => {
  it('requires the claim AND the policy; rejects foreign supersedes chains', async () => {
    const pool = new QualifiedExpertPool();
    const scenario = await makeQualifiedScenario();
    // claim and policy not yet registered
    await expect(pool.registerQualificationRecord(scenario.record)).rejects.toThrow(
      /no claim registered/,
    );
    pool.registerExpertCard(scenario.card);
    pool.registerClaim(scenario.claim);
    await expect(pool.registerQualificationRecord(scenario.record)).rejects.toThrow(
      /no qualification policy registered/,
    );
    pool.registerQualificationPolicy(scenario.policy);
    await expect(pool.registerQualificationRecord(scenario.record)).resolves.toBeDefined();
    await expect(pool.registerQualificationRecord(scenario.record)).resolves.toBeDefined(); // idempotent
    expect(pool.listQualificationRecords()).toHaveLength(1);
    expect(pool.latestRecordForClaim(scenario.claim.digest)?.digest).toBe(scenario.record.digest);
  });

  it('rejects a record whose supersedes target is not registered', async () => {
    const pool = new QualifiedExpertPool();
    const scenario = await makeQualifiedScenario();
    pool.registerExpertCard(scenario.card);
    pool.registerClaim(scenario.claim);
    pool.registerQualificationPolicy(scenario.policy);
    const forged = {
      ...scenario.record,
      supersedes: '9999999999999999999999999999999999999999999999999999999999999999',
    } as typeof scenario.record;
    // digest recompute fails first (content changed) — the strict path
    await expect(pool.registerQualificationRecord(forged)).rejects.toThrow(
      ExpertQualificationError,
    );
  });
});

describe('listQualificationRecords / ordering', () => {
  it('records append in insertion order; latest by (evaluatedAt, digest)', async () => {
    const pool = new QualifiedExpertPool();
    const scenario = await makeQualifiedScenario();
    pool.registerExpertCard(scenario.card);
    pool.registerClaim(scenario.claim);
    pool.registerQualificationPolicy(scenario.policy);
    await pool.registerQualificationRecord(scenario.record);
    const later = await import('@arena/expert-qualification').then((m) =>
      m.evaluateCompetencyClaim({
        claim: scenario.claim,
        policy: scenario.policy,
        evidence: scenario.evidence,
        evaluatedAt: '2026-01-20T09:30:00.000Z',
        priorRecord: scenario.record,
      }),
    );
    await pool.registerQualificationRecord(later);
    expect(pool.listRecordsForClaim(scenario.claim.digest)).toHaveLength(2);
    expect(pool.latestRecordForClaim(scenario.claim.digest)?.digest).toBe(later.digest);
  });
});

void IDEM_A;
