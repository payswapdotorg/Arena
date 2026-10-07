/**
 * Adversarial minimum suite (Work Order C003): PII smuggling beyond the
 * declared policy, qualification-masquerading-as-authorization (intake
 * output consumed as an access grant must fail closed), tampered
 * submissions and model-adapter fault containment.
 */

import { describe, expect, it } from 'vitest';
import { IntakeInterviewEngine } from './engine.js';
import { ScriptedInterviewerModel, renderQuestionFailClosed, type InterviewerModelPort } from './model-adapter.js';
import { verifyTranscriptIntegrity } from './session.js';
import { assessInterview } from './outcome.js';
import { toRegistryProposal, toQualificationClaimInputs, screenProfileFieldNames } from './profile.js';
import { EXPERT_INTAKE_ERROR_CODES } from './errors.js';
import { CATALOG_SEED, CREATED_AT, EXPERT_ID, TENANT, defaultAnswers, runCompleteInterview } from './test-support.js';

const AT = '2026-10-07T12:01:00.000Z';

async function startedSession(sessionId: string) {
  const engine = new IntakeInterviewEngine(new ScriptedInterviewerModel());
  const session = await engine.create({
    sessionId,
    tenant: TENANT,
    expertId: EXPERT_ID,
    catalogSeed: CATALOG_SEED,
    selectionSeed: 'seed-adv',
    privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
    createdAt: CREATED_AT,
  });
  return { engine, session };
}

describe('PII smuggling beyond the declared policy (fail closed)', () => {
  it('rejects email-shaped scenario responses with PRIVACY_VIOLATION', async () => {
    const { engine, session } = await startedSession('intake-adv-01');
    let current = session;
    let scenarioItemId: string | null = null;
    while (scenarioItemId === null) {
      const asked = await engine.askNext(current, { at: AT });
      current = asked.session;
      if (asked.item.expected.answerKind === 'scenario-response') {
        scenarioItemId = asked.item.itemId;
        await expect(
          engine.answer(current, scenarioItemId, { answerKind: 'scenario-response', response: 'reach me at alice@example.com anytime' }, { at: AT }),
        ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.PRIVACY_VIOLATION });
        break;
      }
      const answer = defaultAnswers(current, asked.item.itemId);
      if (answer === undefined) throw new Error('missing default answer');
      current = await engine.answer(current, asked.item.itemId, answer, { at: AT });
    }
    expect(scenarioItemId).not.toBeNull();
  });

  it('rejects phone-shaped evidence descriptions with PRIVACY_VIOLATION', async () => {
    const { engine, session } = await startedSession('intake-adv-02');
    let current = session;
    while (true) {
      const asked = await engine.askNext(current, { at: AT });
      current = asked.session;
      if (asked.item.expected.answerKind === 'evidence-pointer') {
        await expect(
          engine.answer(
            current,
            asked.item.itemId,
            { answerKind: 'evidence-pointer', evidenceKind: 'work-product-ref', evidenceDigest: 'a'.repeat(64), description: 'call me at +1 (555) 010-2039' },
            { at: AT },
          ),
        ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.PRIVACY_VIOLATION });
        break;
      }
      const answer = defaultAnswers(current, asked.item.itemId);
      if (answer === undefined) throw new Error('missing default answer');
      current = await engine.answer(current, asked.item.itemId, answer, { at: AT });
    }
  });

  it('assessment re-screens a tampered PII-carrying transcript (defense in depth)', async () => {
    const { engine, session } = await startedSession('intake-adv-03');
    let current = session;
    while (true) {
      const selection = engine.selectNext(current);
      if (selection.item === null) break;
      const asked = await engine.askNext(current, { at: AT });
      current = asked.session;
      const answer = defaultAnswers(current, asked.item.itemId);
      if (answer === undefined) throw new Error('missing default answer');
      current = await engine.answer(current, asked.item.itemId, answer, { at: AT });
    }
    const submitted = await engine.submit(current, { at: AT });
    // Tamper: splice a PII-carrying scenario answer INTO the transcript
    // (bypassing validation), keeping the chain recomputed via the API is
    // impossible — so verify the integrity gate fires first instead.
    const scenarioIndex = submitted.transcript.findIndex((entry) => entry.itemId.startsWith('sce:'));
    const entry = submitted.transcript[scenarioIndex];
    if (entry === undefined) throw new Error('no scenario entry');
    const tampered = {
      ...submitted,
      transcript: Object.freeze([
        ...submitted.transcript.slice(0, scenarioIndex),
        { ...entry, answer: { answeredAt: AT as never, answer: { answerKind: 'scenario-response', response: 'alice@example.com' } } } as never,
        ...submitted.transcript.slice(scenarioIndex + 1),
      ]),
    };
    const outcome = await assessInterview(tampered, { assessedAt: AT });
    // Either the digest chain rejects (TAMPERED → rejected) or the PII
    // re-screen rejects — both are closed rejections, never silent pass.
    expect(outcome.outcome).toBe('rejected-with-reasons');
  });
});

describe('qualification-masquerading-as-authorization (fail closed)', () => {
  it('intake output carries no permission-shaped fields — the screen rejects them', async () => {
    const { outcome } = await runCompleteInterview('seed-masquerade');
    if (outcome.outcome !== 'complete-with-claims') throw new Error('expected complete');
    const proposal = toRegistryProposal(outcome.profile);
    const claims = toQualificationClaimInputs(outcome.profile);
    // The typed outputs are declaration DATA — no authority vocabulary.
    expect(() => screenProfileFieldNames(proposal, 'registryProposal')).not.toThrow();
    expect(claims.every((claim) => !('permissions' in (claim as Record<string, unknown>)))).toBe(true);
    // Injecting an access-grant-shaped field fails closed at the data layer.
    expect(() => screenProfileFieldNames({ ...proposal, accessLevel: 'root' }, 'registryProposal')).toThrow(/authority-shaped/);
    expect(() => screenProfileFieldNames({ competencies: [{ grantedScopes: ['escalate'] }] }, 'x')).toThrow(/authority-shaped/);
  });

  it('a session expertId is a neutral string — authority vocabulary lives in FIELD NAMES, which the screen governs', async () => {
    // The neutral-locator charset admits neutral strings like
    // 'admin-of-arena' (an id, not a permission); the authority screen
    // rejects authority-shaped FIELD NAMES at any depth — ids are data.
    await expect(
      new IntakeInterviewEngine(new ScriptedInterviewerModel()).create({
        sessionId: 'intake-adv-04',
        tenant: TENANT,
        expertId: 'admin-of-arena',
        catalogSeed: CATALOG_SEED,
        selectionSeed: 'seed-adv',
        privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
        createdAt: CREATED_AT,
      }),
    ).resolves.toBeDefined();
  });
});

describe('tampered / replayed submissions', () => {
  it('a spliced transcript fails the digest chain (TAMPERED, fail closed)', async () => {
    const { engine, session } = await startedSession('intake-adv-05');
    const asked = await engine.askNext(session, { at: AT });
    const answered = await engine.answer(asked.session, asked.item.itemId, defaultAnswers(asked.session, asked.item.itemId), { at: AT });
    await expect(verifyTranscriptIntegrity(answered)).resolves.toBeUndefined();
    const spliced = {
      ...answered,
      transcript: Object.freeze([...answered.transcript, { ...answered.transcript[0]!, seq: 99 } as never]),
    };
    await expect(verifyTranscriptIntegrity(spliced)).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.TAMPERED });
  });

  it('selection never re-picks an already-asked item (append-only transcript)', async () => {
    const { engine, session } = await startedSession('intake-adv-06');
    const asked = await engine.askNext(session, { at: AT });
    const item = asked.item;
    await expect(engine.askNext(asked.session, { at: AT })).resolves.toMatchObject({
      item: expect.objectContaining({ itemId: expect.not.stringMatching(item.itemId) }),
    });
  });
});

describe('model-adapter fault containment (lock rule 10)', () => {
  it('a throwing adapter fails closed with MODEL_ADAPTER_FAILURE', async () => {
    const failing: InterviewerModelPort = {
      modelId: 'failing-adapter@0',
      async renderQuestion() {
        throw new Error('model exploded');
      },
    };
    const engine = new IntakeInterviewEngine(failing);
    const session = await engine.create({
      sessionId: 'intake-adv-07',
      tenant: TENANT,
      expertId: EXPERT_ID,
      catalogSeed: CATALOG_SEED,
      selectionSeed: 'seed-adv',
      privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
      createdAt: CREATED_AT,
    });
    await expect(engine.askNext(session, { at: AT })).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.MODEL_ADAPTER_FAILURE,
    });
  });

  it('a non-neutral adapter response fails closed', async () => {
    const weird: InterviewerModelPort = {
      modelId: 'weird-adapter@0',
      async renderQuestion() {
        return { question: 'x'.repeat(4096 + 1) };
      },
    };
    await expect(
      renderQuestionFailClosed(weird, {
        sessionId: 'intake-adv-08',
        item: { itemVersion: 1, itemId: 'x', kind: 'capability-probe', expected: { answerKind: 'locale-declaration', maximumLocales: 1 }, routingInput: 'locale' },
        questionNumber: 0,
      }),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.MODEL_ADAPTER_FAILURE });
  });
});

describe('recordDeclaredAnswer contract', () => {
  it('unknown answer fields are rejected (exact-field validation)', async () => {
    const { engine, session } = await startedSession('intake-adv-09');
    const asked = await engine.askNext(session, { at: AT });
    await expect(
      engine.answer(asked.session, asked.item.itemId, { ...defaultAnswers(asked.session, asked.item.itemId), extraField: 'x' }, { at: AT }),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER });
  });

  it('answers cannot be recorded onto a SUBMITTED session', async () => {
    const { engine, session } = await startedSession('intake-adv-10');
    const asked = await engine.askNext(session, { at: AT });
    const answered = await engine.answer(asked.session, asked.item.itemId, defaultAnswers(asked.session, asked.item.itemId), { at: AT });
    const submitted = await engine.submit(answered, { at: AT });
    await expect(
      engine.answer(submitted, asked.item.itemId, defaultAnswers(submitted, asked.item.itemId), { at: AT }),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT });
  });
});
