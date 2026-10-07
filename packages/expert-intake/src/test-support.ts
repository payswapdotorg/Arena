/**
 * Test support for @arena/expert-intake (Work Order C003) — deterministic
 * fixtures: A004-shaped capability refs, a full happy-path interview run
 * helper and a 64-hex digest generator. Shared by the unit suites.
 */

import { createHash } from 'node:crypto';
import type { CapabilityNodeRefView } from '@arena/expert-qualification';
import { ScriptedInterviewerModel } from './model-adapter.js';
import { IntakeInterviewEngine } from './engine.js';
import type { IntakeOutcome } from './outcome.js';
import type { InterviewSession } from './session.js';
import type { DeclaredAnswer } from './session.js';

export function fakeDigest(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

export function capabilityRef(kind: string, id: string, version = '1.0.0'): CapabilityNodeRefView {
  return Object.freeze({ kind, id, version, digest: fakeDigest(`${kind}:${id}:${version}`) });
}

export const TENANT = 'acme' as const;
export const EXPERT_ID = 'expert-alice-01' as const;
export const CREATED_AT = '2026-10-07T12:00:00.000Z' as const;
export const ASSESSED_AT = '2026-10-07T12:05:00.000Z' as const;

export const CATALOG_SEED = Object.freeze({
  competencyRefs: Object.freeze([capabilityRef('capability', 'financial-audit'), capabilityRef('skill', 'regression-analysis')]),
  toolRefs: Object.freeze([capabilityRef('tool', 'ledger-cli')]),
  domainRef: capabilityRef('domain', 'finance'),
  demandLocales: Object.freeze(['en-US']),
});

/** The default happy-path answers keyed by the item's expected answer kind. */
export function defaultAnswers(session: InterviewSession, askedItemId: string): DeclaredAnswer | undefined {
  const item = session.catalog.find((candidate) => candidate.itemId === askedItemId);
  if (item === undefined) return undefined;
  switch (item.expected.answerKind) {
    case 'proficiency-selection':
      return { answerKind: 'proficiency-selection', proficiency: 'proficient' };
    case 'locale-declaration':
      return { answerKind: 'locale-declaration', locales: ['en-US'] };
    case 'jurisdiction-declaration':
      return { answerKind: 'jurisdiction-declaration', jurisdictions: [{ jurisdictionVersion: 1, country: 'US' }] };
    case 'years-experience':
      return { answerKind: 'years-experience', years: 7 };
    case 'evidence-pointer':
      return {
        answerKind: 'evidence-pointer',
        evidenceKind: 'work-product-ref',
        evidenceDigest: fakeDigest(`evidence:${item.itemId}`),
        description: 'audit work product reference',
      };
    case 'scenario-response':
      return { answerKind: 'scenario-response', response: 'I would re-run the ledger reconciliation and report the delta.' };
    case 'availability-window':
      return {
        answerKind: 'availability-window',
        windows: [{ windowVersion: 1, recurrence: 'weekly', dayOfWeek: 2, startUtc: '09:00', endUtc: '17:00' }],
      };
    case 'privacy-consent':
      return { answerKind: 'privacy-consent', consentGranted: true, transcriptRetentionConsent: true };
    default:
      return undefined;
  }
}

/**
 * Run a complete happy-path interview: ask every catalog item (adaptive
 * order), answer each with the default declaration, submit, assess.
 */
export async function runCompleteInterview(
  seed: string,
  sessionId = 'intake-test-01',
): Promise<{ engine: IntakeInterviewEngine; session: InterviewSession; outcome: IntakeOutcome }> {
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
  for (let index = 0; index < session.catalog.length; index += 1) {
    const asked = await engine.askNext(session, { at: '2026-10-07T12:01:00.000Z' });
    const answer = defaultAnswers(asked.session, asked.item.itemId);
    if (answer === undefined) throw new Error(`no default answer for ${asked.item.itemId}`);
    session = await engine.answer(asked.session, asked.item.itemId, answer, { at: '2026-10-07T12:02:00.000Z' });
  }
  session = await engine.submit(session, { at: '2026-10-07T12:03:00.000Z' });
  const assessed = await engine.assess(session, { at: ASSESSED_AT });
  return { engine, session: assessed.session, outcome: assessed.outcome };
}
