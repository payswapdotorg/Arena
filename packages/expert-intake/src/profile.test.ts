/**
 * IntakeProfile output-contract suite (Work Order C003): claim/evidence
 * separation (an evidence-free claim is not a claim), the authority/PII
 * field-name screen (intake output can never masquerade as an access
 * grant), content addressing and the A006/A007 handoff views.
 */

import { describe, expect, it } from 'vitest';
import {
  buildIntakeProfile,
  profileDigestView,
  recomputeIntakeProfileDigest,
  screenProfileFieldNames,
  toQualificationClaimInputs,
  toRegistryProposal,
} from './profile.js';
import { EXPERT_INTAKE_ERROR_CODES } from './errors.js';
import { IntakeInterviewEngine } from './engine.js';
import { ScriptedInterviewerModel } from './model-adapter.js';
import { runCompleteInterview, CATALOG_SEED, CREATED_AT, EXPERT_ID, TENANT, defaultAnswers } from './test-support.js';

describe('the IntakeProfile output contract', () => {
  it('pairs every competency claim with its evidence pointers (claim/evidence separation)', async () => {
    const { outcome } = await runCompleteInterview('seed-profile');
    if (outcome.outcome !== 'complete-with-claims') throw new Error('expected complete');
    for (const claim of outcome.profile.competencyClaims) {
      expect(claim.evidence.length).toBeGreaterThan(0);
      for (const pointer of claim.evidence) {
        expect(pointer.digest).toMatch(/^[0-9a-f]{64}$/);
        expect(['credential-ref', 'work-product-ref', 'verification-ref', 'evaluation-ref']).toContain(pointer.evidenceKind);
      }
    }
  });

  it('is content-addressed and tamper-evident', async () => {
    const { outcome } = await runCompleteInterview('seed-profile');
    if (outcome.outcome !== 'complete-with-claims') throw new Error('expected complete');
    await expect(recomputeIntakeProfileDigest(outcome.profile)).resolves.toBe(outcome.profile.digest);
    const tampered = { ...outcome.profile, locales: ['fr-FR'] };
    await expect(recomputeIntakeProfileDigest(tampered)).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.TAMPERED,
    });
    expect(profileDigestView(outcome.profile).locales).toEqual(['en-US']);
  });

  it('maps to A007 claim-candidate inputs (evidence digests ride along)', async () => {
    const { outcome } = await runCompleteInterview('seed-profile');
    if (outcome.outcome !== 'complete-with-claims') throw new Error('expected complete');
    const inputs = toQualificationClaimInputs(outcome.profile);
    expect(inputs.length).toBe(outcome.profile.competencyClaims.length);
    for (const input of inputs) {
      expect(input.expertId).toBe(EXPERT_ID);
      expect(input.tenant).toBe(TENANT);
      expect(input.evidence.length).toBeGreaterThan(0);
      expect(input.declaredAt).toBe(CREATED_AT);
    }
  });

  it('maps to the A006 registry-field-group proposal (pure data)', async () => {
    const { outcome } = await runCompleteInterview('seed-profile');
    if (outcome.outcome !== 'complete-with-claims') throw new Error('expected complete');
    const proposal = toRegistryProposal(outcome.profile);
    expect(proposal.competencies.length).toBe(2);
    expect(proposal.privacyPolicy.transcriptRetentionConsent).toBe(true);
    expect(proposal.availabilityWindows.length).toBeGreaterThan(0);
    expect(proposal.domainScope).toBeDefined();
  });
});

describe('the authority/PII field-name screen (lock rule 9)', () => {
  it('rejects authority-shaped field names at any depth', () => {
    expect(() => screenProfileFieldNames({ systemRole: 'admin' }, 'x')).toThrow(/authority-shaped/);
    expect(() => screenProfileFieldNames({ nested: { grantedPermissions: ['read'] } }, 'x')).toThrow(/authority-shaped/);
    expect(() => screenProfileFieldNames({ items: [{ authorizedFor: 'payments' }] }, 'x')).toThrow(/authority-shaped/);
  });

  it('rejects PII-shaped field names at any depth', () => {
    expect(() => screenProfileFieldNames({ email: 'x' }, 'x')).toThrow(/PII-shaped/);
    expect(() => screenProfileFieldNames({ nested: { phone_number: 'x' } }, 'x')).toThrow(/PII-shaped/);
  });

  it('accepts the legitimate intake vocabulary', () => {
    expect(() =>
      screenProfileFieldNames(
        {
          competencyClaims: [{ capability: { kind: 'skill' }, proficiency: 'proficient', evidence: [{ evidenceKind: 'work-product-ref', digest: 'd' }] }],
          domainScope: { domainRef: { kind: 'domain' }, limitations: [] },
        },
        'x',
      ),
    ).not.toThrow();
  });
});

describe('evidence-free claims are structurally not claims', () => {
  it('profile construction fails closed when a claimed capability carries no evidence pointer', async () => {
    // Ask every catalog item; answer everything EXCEPT the evidence
    // requests, so the capability claims ride evidence-free.
    const engine = new IntakeInterviewEngine(new ScriptedInterviewerModel());
    let current = await engine.create({
      sessionId: 'intake-noevi-01',
      tenant: TENANT,
      expertId: EXPERT_ID,
      catalogSeed: CATALOG_SEED,
      selectionSeed: 'seed-noevi',
      privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
      createdAt: CREATED_AT,
    });
    for (let index = 0; index < current.catalog.length; index += 1) {
      const asked = await engine.askNext(current, { at: '2026-10-07T12:01:00.000Z' });
      current = asked.session;
      if (asked.item.expected.answerKind === 'evidence-pointer') continue; // leave unanswered
      const answer = defaultAnswers(current, asked.item.itemId);
      if (answer === undefined) throw new Error('missing default answer');
      current = await engine.answer(current, asked.item.itemId, answer, { at: '2026-10-07T12:02:00.000Z' });
    }
    const submitted = await engine.submit(current, { at: '2026-10-07T12:03:00.000Z' });
    await expect(buildIntakeProfile(submitted, { assessedAt: '2026-10-07T12:04:00.000Z' })).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.INVALID_PROFILE,
    });
  });
});
