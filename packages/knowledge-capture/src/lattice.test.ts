/**
 * Lattice tests (Work Order C008) — the four tiers, structured scopes,
 * evidence/validation/rights requirements and THE NO-SILENT-PROMOTION
 * WALL (enforced structurally and adversarially).
 */

import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_CAPTURE_ERROR_CODES, KnowledgeCaptureError } from './errors.js';
import {
  checkKnowledgePromotion,
  createLatticeKnowledgeRecord,
  isLatticeKnowledgeRecord,
  knowledgeContentKey,
  promoteLatticeKnowledge,
  validationEvidenceOf,
} from './lattice.js';
import { parseScopeDeclaration } from './scope.js';
import { makeArtifact, makeCaptureInput, T2, T3 } from './test-support.js';

const TASK_SCOPE = Object.freeze({ kind: 'task', ref: 'task-2026-1042' });
const CASE_SCOPE = Object.freeze({ kind: 'case', ref: 'case-77' });
const DOMAIN_SCOPE = Object.freeze({ kind: 'domain', ref: 'eu-vat-filing' });
const JURISDICTION_SCOPE = Object.freeze({ kind: 'jurisdiction', ref: 'eu' });
const GRANTED = { granted: true, statement: 'Expert grants reusable-learning rights.' };

describe('the four tiers (C006 vocabulary, typed lattice)', () => {
  it('captures a task-specific-guidance artifact at task scope without consent', () => {
    const record = createLatticeKnowledgeRecord(
      makeCaptureInput(makeArtifact({ tier: 'task-specific-guidance', scope: 'task:task-2026-1042' }), TASK_SCOPE),
    );
    expect(record.artifact.tier).toBe('task-specific-guidance');
    expect(record.scope.kind).toBe('task');
    expect(record.rights).toBeNull();
    expect(record.validation.state).toBe('unvalidated');
  });

  it('captures scoped-reusable-knowledge with granted rights and evidence', () => {
    const record = createLatticeKnowledgeRecord(makeCaptureInput(makeArtifact(), CASE_SCOPE));
    expect(record.artifact.tier).toBe('scoped-reusable-knowledge');
    expect(record.rights?.granted).toBe(true);
    expect(record.evidenceRefs.length).toBe(2);
    expect(record.contentKey).toBe(knowledgeContentKey(record.artifact, record.scope));
  });

  it('verified-domain-constraint requires validation evidence at capture', () => {
    expect(() =>
      createLatticeKnowledgeRecord(
        makeCaptureInput(makeArtifact({ tier: 'verified-domain-constraint' }), DOMAIN_SCOPE),
      ),
    ).toThrow(/validationRef|validation evidence/);
    const verified = createLatticeKnowledgeRecord(
      makeCaptureInput(
        makeArtifact({ tier: 'verified-domain-constraint', validationRef: 'val-receipt-009' }),
        DOMAIN_SCOPE,
      ),
    );
    expect(verified.validation.state).toBe('validated');
    expect(verified.validation.validationRef).toBe('val-receipt-009');
  });

  it('reusable tiers without granted rights fail closed (lock rule 31)', () => {
    expect(() =>
      createLatticeKnowledgeRecord(
        makeCaptureInput(
          makeArtifact({ consent: { granted: false, statement: 'no reuse' } }),
          CASE_SCOPE,
        ),
      ),
    ).toThrow(/consent|rights/);
  });

  it('evidence is mandatory — a claim without evidence fails closed', () => {
    const artifact = makeArtifact();
    expect(() =>
      createLatticeKnowledgeRecord({ ...makeCaptureInput(artifact, CASE_SCOPE), evidenceRefs: [] }),
    ).toThrow(/evidence/);
  });

  it('provenance tampering fails closed (artifact session != capture session)', () => {
    const artifact = makeArtifact();
    expect(() =>
      createLatticeKnowledgeRecord({
        ...makeCaptureInput(artifact, CASE_SCOPE),
        sessionId: 'session-somewhere-else-0001',
      }),
    ).toThrow(KnowledgeCaptureError);
  });

  it('free-text scopes are rejected — the scope must be a typed declaration', () => {
    const artifact = makeArtifact();
    expect(() =>
      createLatticeKnowledgeRecord(
        makeCaptureInput(artifact, { kind: 'planet' as never, ref: 'x' }),
      ),
    ).toThrow(/typed declaration/);
  });

  it('records are deep-frozen (append-only by construction)', () => {
    const record = createLatticeKnowledgeRecord(makeCaptureInput(makeArtifact(), CASE_SCOPE));
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.scope)).toBe(true);
    expect(Object.isFrozen(record.promotions)).toBe(true);
    expect(() => {
      (record.scope as { kind: string }).kind = 'domain';
    }).toThrow();
  });
});

describe('scope declarations', () => {
  it('parses the "<kind>:<ref>" convention', () => {
    expect(parseScopeDeclaration('task:task-42')).toEqual({ kind: 'task', ref: 'task-42' });
    expect(parseScopeDeclaration('domain:eu-vat-filing')).toEqual({
      kind: 'domain',
      ref: 'eu-vat-filing',
    });
    expect(parseScopeDeclaration('free text scope')).toBeNull();
    expect(parseScopeDeclaration('planet:mars')).toBeNull();
    expect(parseScopeDeclaration('task:')).toBeNull();
  });
});

describe('THE NO-SILENT-PROMOTION WALL', () => {
  it('task-scoped guidance promoted straight to a domain rule fails closed (overgeneralization)', () => {
    const record = createLatticeKnowledgeRecord(
      makeCaptureInput(
        makeArtifact({ tier: 'task-specific-guidance', scope: 'task:task-2026-1042' }),
        TASK_SCOPE,
      ),
    );
    const verdict = checkKnowledgePromotion({
      record,
      toTier: 'candidate-domain-rule',
      toScope: DOMAIN_SCOPE,
      consent: GRANTED,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('wall_overgeneralization');
    expect(() =>
      promoteLatticeKnowledge({
        record,
        toTier: 'candidate-domain-rule',
        toScope: DOMAIN_SCOPE,
        justification: 'expert insisted it is universal',
        consent: GRANTED,
        now: 0,
      }),
    ).toThrow(/wall_overgeneralization/);
  });

  it('task-scoped guidance promoted straight to a verified jurisdiction constraint fails closed', () => {
    const record = createLatticeKnowledgeRecord(
      makeCaptureInput(
        makeArtifact({ tier: 'task-specific-guidance', scope: 'task:task-2026-1042' }),
        TASK_SCOPE,
      ),
    );
    expect(() =>
      promoteLatticeKnowledge({
        record,
        toTier: 'verified-domain-constraint',
        toScope: JURISDICTION_SCOPE,
        justification: 'call it universal',
        consent: GRANTED,
        validationRef: 'val-forged',
        now: 0,
      }),
    ).toThrow(KnowledgeCaptureError);
  });

  it('one-rank widening with granted consent succeeds and is append-only', () => {
    const record = createLatticeKnowledgeRecord(
      makeCaptureInput(makeArtifact({ tier: 'task-specific-guidance', scope: 'task:task-2026-1042' }), TASK_SCOPE),
    );
    const promoted = promoteLatticeKnowledge({
      record,
      toTier: 'scoped-reusable-knowledge',
      toScope: CASE_SCOPE,
      justification: 'applies across the whole engagement case; expert consented',
      consent: GRANTED,
      now: T2,
    });
    expect(promoted.artifact.tier).toBe('scoped-reusable-knowledge');
    expect(promoted.scope).toEqual(CASE_SCOPE);
    expect(promoted.promotions.length).toBe(1);
    expect(promoted.promotions[0]?.justification).toContain('engagement case');
    expect(record.promotions.length).toBe(0); // the original is untouched
    expect(promoted).not.toBe(record);
  });

  it('the stepwise path task -> case -> domain requires two explicit promotions', () => {
    const task = createLatticeKnowledgeRecord(
      makeCaptureInput(makeArtifact({ tier: 'task-specific-guidance', scope: 'task:task-2026-1042' }), TASK_SCOPE),
    );
    const reusable = promoteLatticeKnowledge({
      record: task,
      toTier: 'scoped-reusable-knowledge',
      toScope: CASE_SCOPE,
      justification: 'case-level reuse, expert consented',
      consent: GRANTED,
      now: T2,
    });
    const domainRule = promoteLatticeKnowledge({
      record: reusable,
      toTier: 'candidate-domain-rule',
      toScope: DOMAIN_SCOPE,
      justification: 'candidate domain rule for eu-vat-filing; flagged for validation',
      consent: GRANTED,
      now: T3,
    });
    expect(domainRule.artifact.tier).toBe('candidate-domain-rule');
    expect(domainRule.scope).toEqual(DOMAIN_SCOPE);
    expect(domainRule.promotions.length).toBe(2);
    expect(domainRule.artifact.promotedFrom).toBe(reusable.artifact.artifactId);
  });

  it('verified promotion requires validation evidence', () => {
    const reusable = promoteLatticeKnowledge({
      record: createLatticeKnowledgeRecord(
        makeCaptureInput(makeArtifact({ tier: 'task-specific-guidance', scope: 'task:task-2026-1042' }), TASK_SCOPE),
      ),
      toTier: 'scoped-reusable-knowledge',
      toScope: CASE_SCOPE,
      justification: 'case-level reuse',
      consent: GRANTED,
      now: T2,
    });
    expect(() =>
      promoteLatticeKnowledge({
        record: reusable,
        toTier: 'verified-domain-constraint',
        toScope: DOMAIN_SCOPE,
        justification: 'verified by magic',
        consent: GRANTED,
        now: T3,
      }),
    ).toThrow(/wall_verified_requires_validation/);
    const verified = promoteLatticeKnowledge({
      record: reusable,
      toTier: 'verified-domain-constraint',
      toScope: DOMAIN_SCOPE,
      justification: 'validation receipt attached',
      consent: GRANTED,
      validationRef: 'val-receipt-010',
      now: T3,
    });
    expect(verified.validation.state).toBe('validated');
  });

  it('demotion and same-tier promotion are denied (monotonic lattice)', () => {
    const record = createLatticeKnowledgeRecord(makeCaptureInput(makeArtifact(), CASE_SCOPE));
    expect(
      checkKnowledgePromotion({ record, toTier: 'task-specific-guidance', toScope: CASE_SCOPE, consent: GRANTED })
        .reason,
    ).toBe('wall_not_upward');
    expect(
      checkKnowledgePromotion({ record, toTier: 'scoped-reusable-knowledge', toScope: CASE_SCOPE, consent: GRANTED })
        .reason,
    ).toBe('wall_same_tier');
    expect(
      checkKnowledgePromotion({ record, toTier: 'not-a-tier', toScope: CASE_SCOPE, consent: GRANTED }).reason,
    ).toBe('wall_unknown_tier');
  });

  it('promotion without a recorded justification fails closed (never silent)', () => {
    const record = createLatticeKnowledgeRecord(makeCaptureInput(makeArtifact(), CASE_SCOPE));
    expect(() =>
      promoteLatticeKnowledge({
        record,
        toTier: 'candidate-domain-rule',
        toScope: CASE_SCOPE,
        justification: '',
        consent: GRANTED,
        now: 0,
      }),
    ).toThrow(/justification/);
  });

  it('jurisdiction -> domain narrowing is not overgeneralization (conservative, allowed)', () => {
    const record = createLatticeKnowledgeRecord(
      makeCaptureInput(makeArtifact(), JURISDICTION_SCOPE),
    );
    const verdict = checkKnowledgePromotion({
      record,
      toTier: 'candidate-domain-rule',
      toScope: DOMAIN_SCOPE,
      consent: GRANTED,
    });
    expect(verdict.reason).toBe('promotion_ok');
  });
});

describe('wire guards and validation state', () => {
  it('structural guard accepts constructed records and rejects lookalikes', () => {
    const record = createLatticeKnowledgeRecord(makeCaptureInput(makeArtifact(), CASE_SCOPE));
    expect(isLatticeKnowledgeRecord(record)).toBe(true);
    expect(isLatticeKnowledgeRecord({ recordVersion: 99 })).toBe(false);
    expect(isLatticeKnowledgeRecord(null)).toBe(false);
  });

  it('validation evidence derives from the artifact validation reference', () => {
    expect(validationEvidenceOf(makeArtifact()).state).toBe('unvalidated');
    expect(
      validationEvidenceOf(makeArtifact({ validationRef: 'val-x' })).state,
    ).toBe('validated');
  });

  it('error taxonomy: unknown codes rejected at parse time', async () => {
    const { parseWireKnowledgeCaptureError } = await import('./errors.js');
    expect(() => parseWireKnowledgeCaptureError({ code: 'NOPE' })).toThrow(KnowledgeCaptureError);
    const parsed = parseWireKnowledgeCaptureError({
      code: KNOWLEDGE_CAPTURE_ERROR_CODES.PROMOTION_DENIED,
      category: 'scope',
      message: 'wall',
    });
    expect(parsed.code).toBe('KNOWLEDGE_CAPTURE_PROMOTION_DENIED');
  });

  it('duplicate captures carry the same content key (dedup support)', () => {
    const artifact = makeArtifact({ artifactId: 'esknow_0000000000000000000000000000000a' });
    const first = createLatticeKnowledgeRecord(
      makeCaptureInput(artifact, CASE_SCOPE),
    );
    const second = createLatticeKnowledgeRecord(makeCaptureInput(artifact, CASE_SCOPE));
    expect(first.contentKey).toBe(second.contentKey);
    expect(first.recordId).not.toBe(second.recordId);
  });
});
