/**
 * Knowledge-capture tiers + session completion suites (Work Order C006;
 * EES1.0 "Knowledge capture" + "Session completion" — architecture-lock
 * rules 31, 32).
 *
 * THE NO-SILENT-PROMOTION LAW, tested structurally:
 *   - constructed artifacts are frozen (tier can never be rewritten);
 *   - promotion is explicit, produces a NEW artifact with a promotedFrom
 *     chain, a justification and fresh granted consent;
 *   - demotion / same-tier re-issue denied (TIER_PROMOTION_DENIED);
 *   - verified-domain-constraint requires a validationRef (an
 *     unverified claim can never be constructed as verified);
 *   - submissions carry the REQUIRED consent/rights statement, and
 *     knowledge artifacts require GRANTED consent.
 */

import { describe, expect, it } from 'vitest';
import {
  createKnowledgeArtifact,
  promoteKnowledgeArtifact,
  checkTierPromotion,
  isKnowledgeArtifact,
  KNOWLEDGE_TIERS,
} from './knowledge.js';
import { createExpertSessionSubmission, isExpertSessionSubmission } from './submission.js';
import { createToolGapSignal } from './toolgap.js';
import { ExpertSessionError, EXPERT_SESSION_ERROR_CODES } from './errors.js';
import { T0, T1, T2 } from './test-support.js';

const SESSION_ID = 'session-knowledge-test-1';
const CONSENT = { granted: true, statement: 'Reusable under Arena escalation terms.' };

describe('knowledge-capture tiers', () => {
  it('exposes the four EES1.0 tiers', () => {
    expect([...KNOWLEDGE_TIERS]).toEqual([
      'task-specific-guidance',
      'scoped-reusable-knowledge',
      'candidate-domain-rule',
      'verified-domain-constraint',
    ]);
  });

  it('task-specific guidance needs no consent; reusable tiers require granted consent', () => {
    const guidance = createKnowledgeArtifact({
      tier: 'task-specific-guidance',
      statement: 'For THIS invoice set, match on tax id before name.',
      scope: 'task/invoice-reconciliation-42',
      sessionId: SESSION_ID,
      now: T0,
    });
    expect(guidance.consent).toBeNull();
    expect(() =>
      createKnowledgeArtifact({
        tier: 'scoped-reusable-knowledge',
        statement: 'Vendor matching should prefer tax ids.',
        scope: 'domain/vendor-matching',
        sessionId: SESSION_ID,
        now: T0,
      }),
    ).toThrowError(ExpertSessionError);
    expect(() =>
      createKnowledgeArtifact({
        tier: 'scoped-reusable-knowledge',
        statement: 'Vendor matching should prefer tax ids.',
        scope: 'domain/vendor-matching',
        sessionId: SESSION_ID,
        consent: { granted: false, statement: 'no' },
        now: T0,
      }),
    ).toThrowError(ExpertSessionError);
  });

  it('ADVERSARIAL: verified-domain-constraint without validation evidence can never be constructed', () => {
    expect(() =>
      createKnowledgeArtifact({
        tier: 'verified-domain-constraint',
        statement: 'Tax ids are globally unique per vendor.',
        scope: 'domain/vendor-matching',
        sessionId: SESSION_ID,
        consent: CONSENT,
        now: T0,
      }),
    ).toThrowError(ExpertSessionError);
    const verified = createKnowledgeArtifact({
      tier: 'verified-domain-constraint',
      statement: 'Tax ids are globally unique per vendor.',
      scope: 'domain/vendor-matching',
      sessionId: SESSION_ID,
      consent: CONSENT,
      validationRef: 'validation/eval-vendor-7',
      now: T0,
    });
    expect(verified.validationRef).toBe('validation/eval-vendor-7');
    expect(isKnowledgeArtifact(verified)).toBe(true);
  });

  it('NO SILENT PROMOTION: artifacts are frozen — the tier field can never be rewritten', () => {
    const artifact = createKnowledgeArtifact({
      tier: 'task-specific-guidance',
      statement: 'Prefer tax ids.',
      scope: 'task/invoice-reconciliation-42',
      sessionId: SESSION_ID,
      now: T0,
    });
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(() => {
      (artifact as unknown as Record<string, unknown>)['tier'] = 'verified-domain-constraint';
    }).toThrowError(TypeError);
    expect(artifact.tier).toBe('task-specific-guidance');
  });

  it('promotion is EXPLICIT: new artifact, promotedFrom chain, justification, fresh consent', () => {
    const original = createKnowledgeArtifact({
      tier: 'task-specific-guidance',
      statement: 'Prefer tax ids.',
      scope: 'task/invoice-reconciliation-42',
      sessionId: SESSION_ID,
      now: T0,
    });
    const promoted = promoteKnowledgeArtifact({
      artifact: original,
      toTier: 'scoped-reusable-knowledge',
      justification: 'Confirmed across three further escalations in this domain.',
      consent: CONSENT,
      now: T1,
    });
    expect(promoted.tier).toBe('scoped-reusable-knowledge');
    expect(promoted.promotedFrom).toBe(original.artifactId);
    expect(promoted.artifactId).not.toBe(original.artifactId);
    expect(original.tier).toBe('task-specific-guidance'); // untouched — append-only
    expect(isKnowledgeArtifact(promoted)).toBe(true);
  });

  it('promotion verdicts are machine-readable; demotion and same-tier denied', () => {
    expect(checkTierPromotion('task-specific-guidance', 'scoped-reusable-knowledge')).toMatchObject({
      allowed: true,
      reason: 'promotion_ok',
    });
    expect(checkTierPromotion('candidate-domain-rule', 'scoped-reusable-knowledge')).toMatchObject({
      allowed: false,
      reason: 'promotion_not_upward',
    });
    expect(checkTierPromotion('scoped-reusable-knowledge', 'scoped-reusable-knowledge')).toMatchObject({
      allowed: false,
      reason: 'promotion_same_tier',
    });
    const original = createKnowledgeArtifact({
      tier: 'candidate-domain-rule',
      statement: 'Tax ids disambiguate vendors.',
      scope: 'domain/vendor-matching',
      sessionId: SESSION_ID,
      consent: CONSENT,
      now: T0,
    });
    expect(() =>
      promoteKnowledgeArtifact({ artifact: original, toTier: 'task-specific-guidance', justification: 'x', consent: CONSENT, now: T1 }),
    ).toThrowError(ExpertSessionError);
    try {
      promoteKnowledgeArtifact({ artifact: original, toTier: 'scoped-reusable-knowledge', justification: 'x', consent: CONSENT, now: T1 });
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.TIER_PROMOTION_DENIED);
    }
  });

  it('promotion to verified requires a validationRef; promotion without justification denied', () => {
    const scoped = createKnowledgeArtifact({
      tier: 'scoped-reusable-knowledge',
      statement: 'Tax ids disambiguate vendors.',
      scope: 'domain/vendor-matching',
      sessionId: SESSION_ID,
      consent: CONSENT,
      now: T0,
    });
    expect(() =>
      promoteKnowledgeArtifact({ artifact: scoped, toTier: 'verified-domain-constraint', justification: 'j', consent: CONSENT, now: T1 }),
    ).toThrowError(ExpertSessionError);
    expect(() =>
      promoteKnowledgeArtifact({ artifact: scoped, toTier: 'candidate-domain-rule', justification: '', consent: CONSENT, now: T1 }),
    ).toThrowError(ExpertSessionError);
  });
});

describe('session completion contract', () => {
  it('carries result + evidence + annotations + corrections + consent (EES1.0 minimum)', () => {
    const submission = createExpertSessionSubmission({
      sessionId: SESSION_ID,
      result: { matched: 'vendor-7', confidence: 0.98 },
      evidence: [
        { kind: 'event-ref', ref: 'esevt_00000000000000000000000000000010' },
        { kind: 'capsule-resource-ref', ref: 'logs/agent-trace.jsonl' },
      ],
      annotations: [{ subjectRef: 'docs/vendor-catalog.md', note: 'Catalog entry 7 is stale.' }],
      corrections: [{ correctedRef: 'artifact/match-9', replacement: { vendor: 'vendor-7' } }],
      consentRightsStatement: CONSENT,
      now: T2,
    });
    expect(isExpertSessionSubmission(submission)).toBe(true);
    expect(Object.isFrozen(submission)).toBe(true);
    expect(submission.knowledgeArtifacts).toBeUndefined();
    expect(submission.toolGapSignals).toBeUndefined();
  });

  it('REQUIRES evidence and the consent/rights statement (fail-closed)', () => {
    expect(() =>
      createExpertSessionSubmission({
        sessionId: SESSION_ID,
        result: { ok: true },
        evidence: [],
        consentRightsStatement: CONSENT,
        now: T2,
      }),
    ).toThrowError(ExpertSessionError);
    expect(() =>
      createExpertSessionSubmission({
        sessionId: SESSION_ID,
        result: { ok: true },
        evidence: [{ kind: 'event-ref', ref: 'r' }],
        now: T2,
      } as never),
    ).toThrowError(ExpertSessionError);
  });

  it('knowledge artifacts require GRANTED consent and must originate from the session', () => {
    const artifact = createKnowledgeArtifact({
      tier: 'task-specific-guidance',
      statement: 'Prefer tax ids.',
      scope: 'task/invoice-reconciliation-42',
      sessionId: SESSION_ID,
      now: T0,
    });
    expect(() =>
      createExpertSessionSubmission({
        sessionId: SESSION_ID,
        result: { ok: true },
        evidence: [{ kind: 'event-ref', ref: 'r' }],
        knowledgeArtifacts: [artifact],
        consentRightsStatement: { granted: false, statement: 'No reuse.' },
        now: T2,
      }),
    ).toThrowError(ExpertSessionError);
    expect(() =>
      createExpertSessionSubmission({
        sessionId: SESSION_ID,
        result: { ok: true },
        evidence: [{ kind: 'event-ref', ref: 'r' }],
        knowledgeArtifacts: [
          {
            ...artifact,
            provenance: { ...artifact.provenance, sessionId: 'session-other-1' as never },
          },
        ],
        consentRightsStatement: CONSENT,
        now: T2,
      }),
    ).toThrowError(ExpertSessionError);
  });

  it('carries optional tool-gap signals bound to the same session', () => {
    const signal = createToolGapSignal({
      sessionId: SESSION_ID,
      toolName: 'vendor-registry-lookup',
      capabilityProvided: 'vendor identity resolution',
      whyNeeded: 'name ambiguity',
      nature: 'external-tool',
      evidenceOfUse: ['esevt_00000000000000000000000000000011'],
      recommendedIntegrationBoundary: 'adapter-request',
      substitutionPossible: false,
      now: T1,
    });
    const submission = createExpertSessionSubmission({
      sessionId: SESSION_ID,
      result: { ok: true },
      evidence: [{ kind: 'event-ref', ref: 'r' }],
      toolGapSignals: [signal],
      consentRightsStatement: CONSENT,
      now: T2,
    });
    expect(submission.toolGapSignals).toHaveLength(1);
  });
});
