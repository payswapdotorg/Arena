/**
 * Property suite (Work Order C003) — repeatable determinism invariants:
 * replay equivalence (identical seeds ⇒ byte-identical session digests
 * and transcripts) and catalog construction stability across seeds.
 */

import { describe, expect, it } from 'vitest';
import { buildInterviewCatalog, catalogFromDemandProfile } from './items.js';
import { selectNextItem } from './selection.js';
import { IntakeInterviewEngine } from './engine.js';
import { ScriptedInterviewerModel } from './model-adapter.js';
import { capabilityNodeRefViewKey } from '@arena/expert-qualification';
import type { DemandProfileView } from '@arena/escalation-routing';
import { CATALOG_SEED, CREATED_AT, EXPERT_ID, TENANT, capabilityRef, defaultAnswers, fakeDigest } from './test-support.js';

const AT = '2026-10-07T12:01:00.000Z';
const SEEDS = ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'];

async function replayOnce(seed: string, sessionId: string) {
  const engine = new IntakeInterviewEngine(new ScriptedInterviewerModel());
  let session = await engine.create({
    sessionId,
    tenant: TENANT,
    expertId: EXPERT_ID,
    catalogSeed: CATALOG_SEED,
    selectionSeed: seed,
    privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
    createdAt: CREATED_AT,
  });
  const digestTrail: string[] = [session.digest];
  for (let index = 0; index < session.catalog.length; index += 1) {
    const asked = await engine.askNext(session, { at: AT });
    const answer = defaultAnswers(asked.session, asked.item.itemId);
    if (answer === undefined) throw new Error('missing default answer');
    session = await engine.answer(asked.session, asked.item.itemId, answer, { at: AT });
    digestTrail.push(session.digest);
  }
  return { final: session, digestTrail };
}

describe('determinism properties', () => {
  it('every seed replays byte-identically (two runs, same digests)', async () => {
    for (const seed of SEEDS) {
      const a = await replayOnce(seed, `intake-prop-${seed}`);
      const b = await replayOnce(seed, `intake-prop-${seed}`);
      expect(a.digestTrail).toEqual(b.digestTrail);
      expect(a.final.digest).toBe(b.final.digest);
      expect(JSON.stringify(a.final.transcript)).toBe(JSON.stringify(b.final.transcript));
    }
  });

  it('the catalog is seed-independent and stable (same seed ⇒ same items)', () => {
    const a = buildInterviewCatalog(CATALOG_SEED);
    const b = buildInterviewCatalog(CATALOG_SEED);
    expect(a.map((item) => item.itemId)).toEqual(b.map((item) => item.itemId));
    // Every competency ref yields probe + experience + evidence items.
    for (const ref of CATALOG_SEED.competencyRefs) {
      const key = capabilityNodeRefViewKey(ref);
      expect(a.some((item) => item.itemId === `cap:${key}`)).toBe(true);
      expect(a.some((item) => item.itemId === `exp:${key}`)).toBe(true);
      expect(a.some((item) => item.itemId === `evi:${key}`)).toBe(true);
    }
  });

  it('selection is a pure function of (catalog, transcript, seed)', () => {
    const catalog = buildInterviewCatalog(CATALOG_SEED);
    for (const seed of SEEDS) {
      const transcript = catalog.slice(0, 3).map((item) => ({ itemId: item.itemId, answered: true }));
      const a = selectNextItem(catalog, transcript, seed);
      const b = selectNextItem(catalog, transcript, seed);
      expect(a.rationale.chosenItemId).toBe(b.rationale.chosenItemId);
      expect(a.rationale.scored.map((candidate) => candidate.score)).toEqual(
        b.rationale.scored.map((candidate) => candidate.score),
      );
    }
  });

  it('catalogs seed deterministically from a C002 DemandProfile view', () => {
    const demand = {
      profileVersion: 1 as const,
      tenantId: TENANT,
      clientAppId: 'app-1',
      capabilityNeed: 'finance.financial-audit',
      domainRef: capabilityRef('domain', 'finance'),
      requiredCompetencyRefs: [capabilityRef('capability', 'financial-audit')],
      requiredToolRefs: [capabilityRef('tool', 'ledger-cli')],
      locales: ['en-US'],
      jurisdictions: [{ jurisdictionVersion: 1 as const, country: 'US' }],
      budget: { amountMinorUnits: 10000, currency: 'USD' },
      deadlineMs: 1,
      createdAtMs: 0,
      urgency: 'high',
      privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
      escalationModes: ['SOLVE'],
      evaluatedAt: '2026-10-07T00:00:00.000Z',
    } as unknown as DemandProfileView;
    const a = catalogFromDemandProfile(demand);
    const b = catalogFromDemandProfile(demand);
    expect(a).toEqual(b);
    expect(buildInterviewCatalog(a).length).toBeGreaterThan(0);
    void fakeDigest;
  });
});
