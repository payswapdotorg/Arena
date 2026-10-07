/**
 * Typed intake outcome suite (Work Order C003): the three closed outcomes
 * (complete-with-claims / incomplete-with-gap-list / rejected-with-reasons),
 * never a bare boolean; determinism of assessment.
 */

import { describe, expect, it } from 'vitest';
import { ScriptedInterviewerModel } from './model-adapter.js';
import { IntakeInterviewEngine } from './engine.js';
import { assessInterview, isIntakeOutcome, INTAKE_GAP_REASONS, INTAKE_REJECTION_REASONS } from './outcome.js';
import { EXPERT_INTAKE_ERROR_CODES } from './errors.js';
import { CATALOG_SEED, CREATED_AT, EXPERT_ID, TENANT, defaultAnswers, runCompleteInterview } from './test-support.js';
import type { InterviewSession } from './session.js';

const AT = '2026-10-07T12:01:00.000Z';

async function sessionWith(nAnswered: number, sessionId: string): Promise<InterviewSession> {
  const engine = new IntakeInterviewEngine(new ScriptedInterviewerModel());
  let session = await engine.create({
    sessionId,
    tenant: TENANT,
    expertId: EXPERT_ID,
    catalogSeed: CATALOG_SEED,
    selectionSeed: 'seed-outcome',
    privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
    createdAt: CREATED_AT,
  });
  for (let index = 0; index < nAnswered && index < session.catalog.length; index += 1) {
    const asked = await engine.askNext(session, { at: AT });
    const answer = defaultAnswers(asked.session, asked.item.itemId);
    if (answer === undefined) throw new Error('missing default answer');
    session = await engine.answer(asked.session, asked.item.itemId, answer, { at: AT });
  }
  return engine.submit(session, { at: AT });
}

describe('typed intake outcomes', () => {
  it('complete happy path yields complete-with-claims and a structured profile', async () => {
    const { outcome } = await runCompleteInterview('seed-complete');
    expect(isIntakeOutcome(outcome)).toBe(true);
    if (outcome.outcome !== 'complete-with-claims') throw new Error('expected complete');
    expect(outcome.profile.competencyClaims.length).toBe(2);
    expect(outcome.profile.locales).toContain('en-US');
    expect(outcome.profile.privacy.transcriptRetentionConsent).toBe(true);
    expect(outcome.profile.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('partially answered interviews yield incomplete-with-gap-list (machine-readable)', async () => {
    const submitted = await sessionWith(2, 'intake-gap-01');
    const outcome = await assessInterview(submitted, { assessedAt: AT });
    expect(outcome.outcome).toBe('incomplete-with-gap-list');
    if (outcome.outcome !== 'incomplete-with-gap-list') throw new Error('unreachable');
    expect(outcome.gaps.length).toBeGreaterThan(0);
    for (const gap of outcome.gaps) {
      expect(INTAKE_GAP_REASONS).toContain(gap.reason);
      expect(gap.itemId).toMatch(/^(cap|exp|evi|sce):/);
    }
  });

  it('denied consent yields rejected-with-reasons (not a gap — not repairable)', async () => {
    const engine = new IntakeInterviewEngine(new ScriptedInterviewerModel());
    let session = await engine.create({
      sessionId: 'intake-reject-01',
      tenant: TENANT,
      expertId: EXPERT_ID,
      catalogSeed: CATALOG_SEED,
      selectionSeed: 'seed-reject',
      privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
      createdAt: CREATED_AT,
    });
    while (true) {
      const selection = engine.selectNext(session);
      if (selection.item === null) break;
      const asked = await engine.askNext(session, { at: AT });
      session = asked.session;
      const answer =
        asked.item.expected.answerKind === 'privacy-consent'
          ? { answerKind: 'privacy-consent' as const, consentGranted: false, transcriptRetentionConsent: false }
          : defaultAnswers(asked.session, asked.item.itemId);
      if (answer === undefined) throw new Error('missing answer');
      session = await engine.answer(session, asked.item.itemId, answer, { at: AT });
    }
    session = await engine.submit(session, { at: AT });
    const outcome = await assessInterview(session, { assessedAt: AT });
    expect(outcome.outcome).toBe('rejected-with-reasons');
    if (outcome.outcome !== 'rejected-with-reasons') throw new Error('unreachable');
    expect(outcome.reasons.some((reason) => reason.reason === 'privacy-consent-denied')).toBe(true);
    expect(INTAKE_REJECTION_REASONS).toContain('privacy-consent-denied');
  });

  it('an empty submitted transcript is rejected (empty-transcript)', async () => {
    const engine = new IntakeInterviewEngine(new ScriptedInterviewerModel());
    const session = await engine.create({
      sessionId: 'intake-empty-01',
      tenant: TENANT,
      expertId: EXPERT_ID,
      catalogSeed: CATALOG_SEED,
      selectionSeed: 'seed-empty',
      privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
      createdAt: CREATED_AT,
    });
    // Defensive branch: a session that reached SUBMITTED with no questions
    // (unreachable through the engine — submit requires IN_PROGRESS — but
    // the assessor must fail closed on it anyway).
    const submitted = { ...session, state: 'SUBMITTED' as const };
    const outcome = await assessInterview(submitted, { assessedAt: AT });
    expect(outcome.outcome).toBe('rejected-with-reasons');
    if (outcome.outcome !== 'rejected-with-reasons') throw new Error('unreachable');
    expect(outcome.reasons.some((reason) => reason.reason === 'empty-transcript')).toBe(true);
  });

  it('assessment requires a SUBMITTED session (fail closed)', async () => {
    const engine = new IntakeInterviewEngine(new ScriptedInterviewerModel());
    const session = await engine.create({
      sessionId: 'intake-state-01',
      tenant: TENANT,
      expertId: EXPERT_ID,
      catalogSeed: CATALOG_SEED,
      selectionSeed: 'seed-state',
      privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
      createdAt: CREATED_AT,
    });
    await expect(assessInterview(session, { assessedAt: AT })).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT,
    });
  });

  it('assessment is deterministic: same transcript ⇒ same outcome', async () => {
    const submitted = await sessionWith(3, 'intake-det-01');
    const a = await assessInterview(submitted, { assessedAt: AT });
    const b = await assessInterview(submitted, { assessedAt: AT });
    expect(a).toEqual(b);
  });
});
