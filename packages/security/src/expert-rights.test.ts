/**
 * Expert rights tests (Work Order A034): the five S1.0 fields, attribution
 * derivation, withdrawal/deletion policy hooks.
 */

import { describe, expect, it } from 'vitest';
import type { ExpertRightsRecord } from './expert-rights.js';
import {
  applyExpertWithdrawal,
  ATTRIBUTION_POLICIES,
  canDeleteExpertRecord,
  deriveAttribution,
  derivedArtifactPolicyAfterWithdrawal,
  isExpertRightsRecord,
  toExpertRightsRecord,
} from './index.js';
import { makeExpertRightsInput, T3 } from './test-support.js';

describe('expert rights records carry ALL FIVE mandatory S1.0 fields', () => {
  it('a well-formed record validates and freezes', () => {
    const record = toExpertRightsRecord(makeExpertRightsInput());
    expect(record.contributorIdentity).toBe('expert-principal-1');
    expect(record.compensationTerms.status).toBe('agreed');
    expect(record.attributionPolicy).toBe('pseudonymous');
    expect(record.derivedArtifactRights).toBe('attribution-required');
    expect(record.withdrawalPolicy.noticePeriodDays).toBe(30);
    expect(Object.isFrozen(record)).toBe(true);
    expect(isExpertRightsRecord(record)).toBe(true);
  });

  it('dropping any of the five fields is a validation error', () => {
    for (const field of [
      'contributorIdentity',
      'compensationTerms',
      'attributionPolicy',
      'derivedArtifactRights',
      'withdrawalPolicy',
    ]) {
      const input = makeExpertRightsInput();
      delete input[field];
      expect(() => toExpertRightsRecord(input), `missing ${field}`).toThrowError(
        /missing required field/,
      );
    }
  });

  it('closed vocabularies: attribution policies and derived rights', () => {
    expect(ATTRIBUTION_POLICIES).toEqual(['named', 'pseudonymous', 'anonymous']);
    expect(() =>
      toExpertRightsRecord(makeExpertRightsInput({ attributionPolicy: 'semi-anonymous' })),
    ).toThrowError(/must be one of/);
    expect(() =>
      toExpertRightsRecord(makeExpertRightsInput({ derivedArtifactRights: 'everything' })),
    ).toThrowError(/must be one of/);
  });

  it('deletionApplicable must be an explicit boolean (no silent defaults)', () => {
    expect(() =>
      toExpertRightsRecord(
        makeExpertRightsInput({
          withdrawalPolicy: {
            noticePeriodDays: 30,
            deletionApplicable: 'maybe',
            derivedArtifactTreatment: 'retain-anonymized',
          },
        }),
      ),
    ).toThrowError(/explicit boolean/);
  });
});

describe('attribution derivation honors the policy EXACTLY', () => {
  it('named attribution carries the contributor identity', () => {
    const record = toExpertRightsRecord(makeExpertRightsInput({ attributionPolicy: 'named' }));
    const attribution = deriveAttribution(record);
    expect(attribution.kind).toBe('named');
    expect(attribution).toHaveProperty('contributorIdentity', 'expert-principal-1');
  });

  it('pseudonymous attribution carries ONLY the pseudonym (identity never leaks)', () => {
    const record = toExpertRightsRecord(makeExpertRightsInput());
    const attribution = deriveAttribution(record);
    expect(attribution.kind).toBe('pseudonymous');
    expect(attribution).toHaveProperty('pseudonym', 'expert-pseudonym-1');
    expect(JSON.stringify(attribution)).not.toContain('expert-principal-1');
  });

  it('anonymous attribution carries neither', () => {
    const record = toExpertRightsRecord(makeExpertRightsInput({ attributionPolicy: 'anonymous' }));
    const attribution = deriveAttribution(record);
    expect(attribution.kind).toBe('anonymous');
    expect(JSON.stringify(attribution)).not.toContain('expert-principal-1');
    expect(JSON.stringify(attribution)).not.toContain('expert-pseudonym-1');
  });
});

describe('withdrawal policy hooks', () => {
  it('applyExpertWithdrawal returns a NEW record; the original is untouched', () => {
    const record = toExpertRightsRecord(makeExpertRightsInput());
    const withdrawn = applyExpertWithdrawal(record, T3);
    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.withdrawnAt).toBe(T3);
    expect(withdrawn.compensationTerms.status).toBe('withdrawn');
    expect(record.status).toBe('active'); // append-only: original immutable
    expect(() =>
      applyExpertWithdrawal(withdrawn, '2026-09-30T06:00:00.000Z'),
    ).toThrowError(/already withdrawn/);
  });

  it('withdrawal with remove-identity switches derived attribution to anonymous', () => {
    const record = toExpertRightsRecord(
      makeExpertRightsInput({
        attributionPolicy: 'named',
        withdrawalPolicy: {
          noticePeriodDays: 30,
          deletionApplicable: false,
          derivedArtifactTreatment: 'remove-identity',
        },
      }),
    );
    const policy = derivedArtifactPolicyAfterWithdrawal(record);
    expect(policy.treatment).toBe('remove-identity');
    expect(policy.attribution.kind).toBe('anonymous');
  });

  it('deletion is applicable only where contractually + technically possible', () => {
    const deletable = toExpertRightsRecord(makeExpertRightsInput());
    expect(canDeleteExpertRecord(deletable, { referencedByCertificationEvidence: false })).toBe(
      false,
    ); // still active — deletion happens after withdrawal

    const withdrawn = applyExpertWithdrawal(deletable, T3);
    expect(canDeleteExpertRecord(withdrawn, { referencedByCertificationEvidence: false })).toBe(
      true,
    );

    // certification evidence references immutable artifacts — not deletable
    expect(
      canDeleteExpertRecord(withdrawn, { referencedByCertificationEvidence: true }),
    ).toBe(false);

    const nonDeletable = toExpertRightsRecord(
      makeExpertRightsInput({
        withdrawalPolicy: {
          noticePeriodDays: 30,
          deletionApplicable: false,
          derivedArtifactTreatment: 'retain-anonymized',
        },
      }),
    );
    const withdrawnNonDeletable = applyExpertWithdrawal(nonDeletable, T3);
    expect(
      canDeleteExpertRecord(withdrawnNonDeletable, { referencedByCertificationEvidence: false }),
    ).toBe(false);
  });
});

/** Compile-time guard for the exported record type. */
export type _ExpertRightsRecord = ExpertRightsRecord;
