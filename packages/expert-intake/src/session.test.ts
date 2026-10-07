/**
 * Session lifecycle + transcript suite (Work Order C003): lifecycle table,
 * append-only transcript immutability, digest-chain integrity, determinism
 * (identical seeds ⇒ identical session digests) and answer validation.
 */

import { describe, expect, it } from 'vitest';
import { ScriptedInterviewerModel } from './model-adapter.js';
import { IntakeInterviewEngine } from './engine.js';
import {
  createInterviewSession,
  recomputeSessionDigest,
  verifyTranscriptIntegrity,
  TERMINAL_INTERVIEW_STATES,
} from './session.js';
import { ExpertIntakeError, EXPERT_INTAKE_ERROR_CODES } from './errors.js';
import { CATALOG_SEED, CREATED_AT, EXPERT_ID, TENANT, capabilityRef, defaultAnswers, fakeDigest } from './test-support.js';

const AT = '2026-10-07T12:01:00.000Z';

async function newSession(seed = 'seed-a', sessionId = 'intake-lifecycle-01') {
  const engine = new IntakeInterviewEngine(new ScriptedInterviewerModel());
  const session = await engine.create({
    sessionId,
    tenant: TENANT,
    expertId: EXPERT_ID,
    catalogSeed: CATALOG_SEED,
    selectionSeed: seed,
    privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
    createdAt: CREATED_AT,
  });
  return { engine, session };
}

describe('interview session lifecycle', () => {
  it('creates a CREATED session with a deterministic catalog and digest', async () => {
    const { session } = await newSession();
    expect(session.state).toBe('CREATED');
    expect(session.catalog.length).toBeGreaterThan(0);
    expect(session.digest).toMatch(/^[0-9a-f]{64}$/);
    await expect(recomputeSessionDigest(session)).resolves.toBe(session.digest);
  });

  it('walks CREATED → IN_PROGRESS → SUBMITTED → ASSESSED', async () => {
    const { engine, session } = await newSession();
    const asked = await engine.askNext(session, { at: AT });
    expect(asked.session.state).toBe('IN_PROGRESS');
    const answered = await engine.answer(asked.session, asked.item.itemId, defaultAnswers(asked.session, asked.item.itemId), { at: AT });
    const submitted = await engine.submit(answered, { at: AT });
    expect(submitted.state).toBe('SUBMITTED');
    const assessed = await engine.assess(submitted, { at: AT });
    expect(assessed.session.state).toBe('ASSESSED');
    expect(TERMINAL_INTERVIEW_STATES).toContain('ASSESSED');
  });

  it('supports explicit abandon (terminal) and timeout (terminal)', async () => {
    const { engine, session } = await newSession('seed-b', 'intake-lifecycle-02');
    const asked = await engine.askNext(session, { at: AT });
    const abandoned = await engine.abandon(asked.session, { at: AT });
    expect(abandoned.state).toBe('ABANDONED');
    await expect(engine.submit(abandoned, { at: AT })).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT,
    });

    const { engine: engine2, session: session2 } = await newSession('seed-c', 'intake-lifecycle-03');
    const asked2 = await engine2.askNext(session2, { at: AT });
    const timedOut = await engine2.timeout(asked2.session, { at: AT });
    expect(timedOut.state).toBe('TIMED_OUT');
    await expect(engine2.assess(timedOut, { at: AT })).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT,
    });
  });

  it('rejects invalid lifecycle jumps with typed LIFECYCLE_CONFLICT', async () => {
    const { engine, session } = await newSession();
    await expect(engine.assess(session, { at: AT })).rejects.toBeInstanceOf(ExpertIntakeError);
    await expect(engine.submit(session, { at: AT })).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT,
    });
  });
});

describe('append-only transcript integrity', () => {
  it('records questions + declared answers in an immutable digest chain', async () => {
    const { engine, session } = await newSession();
    const asked = await engine.askNext(session, { at: AT });
    const first = asked.session.transcript[0];
    expect(first).toBeDefined();
    expect(first?.prevEntryDigest).toBeNull();
    expect(first?.question).toContain(asked.item.kind);
    const answered = await engine.answer(asked.session, asked.item.itemId, defaultAnswers(asked.session, asked.item.itemId), { at: AT });
    await expect(verifyTranscriptIntegrity(answered)).resolves.toBeUndefined();
    expect(Object.isFrozen(answered.transcript)).toBe(true);
    expect(Object.isFrozen(answered.transcript[0])).toBe(true);
  });

  it('mutating an entry breaks the chain and fails closed with TAMPERED', async () => {
    const { engine, session } = await newSession('seed-d', 'intake-tamper-01');
    const asked = await engine.askNext(session, { at: AT });
    const answered = await engine.answer(asked.session, asked.item.itemId, defaultAnswers(asked.session, asked.item.itemId), { at: AT });
    const tampered = {
      ...answered,
      transcript: Object.freeze([
        { ...answered.transcript[0]!, answer: { answeredAt: AT as never, answer: { answerKind: 'years-experience', years: 99 } } } as never,
      ]),
    };
    await expect(verifyTranscriptIntegrity(tampered)).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.TAMPERED,
    });
    await expect(recomputeSessionDigest(tampered)).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.TAMPERED,
    });
  });

  it('answers are append-only — no re-answers, no edits', async () => {
    const { engine, session } = await newSession();
    const asked = await engine.askNext(session, { at: AT });
    const answered = await engine.answer(asked.session, asked.item.itemId, defaultAnswers(asked.session, asked.item.itemId), { at: AT });
    await expect(
      engine.answer(answered, asked.item.itemId, defaultAnswers(answered, asked.item.itemId), { at: AT }),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT });
  });

  it('rejects answering an unasked item (NOT_FOUND)', async () => {
    const { engine, session } = await newSession();
    await expect(engine.answer(session, 'cap:nowhere:1.0.0', { answerKind: 'years-experience', years: 1 }, { at: AT })).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.NOT_FOUND,
    });
  });
});

describe('determinism (identical seeds ⇒ identical sessions)', () => {
  it('two identical runs produce identical session digests and transcripts', async () => {
    const runA = await newSession('same-seed', 'intake-det-01');
    const runB = await newSession('same-seed', 'intake-det-01');
    expect(runA.session.digest).toBe(runB.session.digest);

    const askA = await runA.engine.askNext(runA.session, { at: AT });
    const askB = await runB.engine.askNext(runB.session, { at: AT });
    expect(askA.session.digest).toBe(askB.session.digest);
    expect(askA.question).toBe(askB.question);
    expect(askA.item.itemId).toBe(askB.item.itemId);
  });

  it('different seeds may order items differently (adaptive variance)', async () => {
    const engine = new IntakeInterviewEngine(new ScriptedInterviewerModel());
    const base = {
      tenant: TENANT,
      expertId: EXPERT_ID,
      catalogSeed: CATALOG_SEED,
      privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
      createdAt: CREATED_AT,
    };
    const a = await engine.create({ ...base, sessionId: 'intake-det-a', selectionSeed: 'seed-1' });
    const b = await engine.create({ ...base, sessionId: 'intake-det-b', selectionSeed: 'seed-2' });
    expect(a.digest).not.toBe(b.digest); // different seeds ⇒ different session content
  });
});

describe('answer validation (fail closed)', () => {
  it('rejects wrong answer kinds and out-of-range values with typed errors', async () => {
    const { engine, session } = await newSession();
    const asked = await engine.askNext(session, { at: AT });
    await expect(engine.answer(asked.session, asked.item.itemId, { answerKind: 'years-experience', years: 3 }, { at: AT })).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER,
    });
  });

  it('rejects malformed sessions and non-neutral expert ids by construction', async () => {
    await expect(
      createInterviewSession({
        tenant: TENANT,
        expertId: 'alice@example.com',
        catalogSeed: CATALOG_SEED,
        selectionSeed: 'seed-x',
        privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
        createdAt: CREATED_AT,
      }),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION });

    await expect(
      createInterviewSession({
        tenant: TENANT,
        expertId: EXPERT_ID,
        catalogSeed: { competencyRefs: [capabilityRef('domain', 'finance')] },
        selectionSeed: 'seed-x',
        privacyPolicy: { dataClassification: 'top-secret', pii: 'minimal' },
        createdAt: CREATED_AT,
      }),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION });
  });

  it('evidence pointers require 64-hex digests', async () => {
    const engine = new IntakeInterviewEngine(new ScriptedInterviewerModel());
    const session = await engine.create({
      sessionId: 'intake-evi-01',
      tenant: TENANT,
      expertId: EXPERT_ID,
      catalogSeed: CATALOG_SEED,
      selectionSeed: 'seed-evi',
      privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
      createdAt: CREATED_AT,
    });
    // Force-select the evidence item by asking until it appears.
    let current = session;
    let evidenceItemId: string | null = null;
    while (evidenceItemId === null) {
      const selection = engine.selectNext(current);
      if (selection.item === null) break;
      const asked = await engine.askNext(current, { at: AT });
      current = asked.session;
      if (asked.item.expected.answerKind === 'evidence-pointer') {
        evidenceItemId = asked.item.itemId;
        await expect(
          engine.answer(current, evidenceItemId, { answerKind: 'evidence-pointer', evidenceKind: 'work-product-ref', evidenceDigest: 'not-a-digest' }, { at: AT }),
        ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.INVALID_REF });
        const answered = await engine.answer(
          current,
          evidenceItemId,
          { answerKind: 'evidence-pointer', evidenceKind: 'work-product-ref', evidenceDigest: fakeDigest('ok') },
          { at: AT },
        );
        expect(answered.transcript[0]?.answer).toBeDefined();
        break;
      }
      current = await engine.answer(current, asked.item.itemId, defaultAnswers(current, asked.item.itemId), { at: AT });
    }
    expect(evidenceItemId).not.toBeNull();
  });
});
