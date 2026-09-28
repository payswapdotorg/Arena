/**
 * Competency tests (Work Order A006; §8 competencies; R7 evidence-backed).
 * Positive and negative for the competency validator and list discipline.
 */

import { describe, expect, it } from 'vitest';
import {
  COMPETENCY_NODE_KINDS,
  DOMAIN_COMPETENCY_TYPE_PATTERN_SOURCE,
  DOMAIN_METADATA_VALUE_TYPES,
  EXPERT_COMPETENCY_VERSION,
  PROFICIENCY_LEVELS,
  competencyCapabilityKey,
  competencyKey,
  isExpertCompetency,
  isProficiencyLevel,
  toExpertCompetency,
  toExpertCompetencyList,
} from './competencies.js';
import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import {
  DIGEST_B,
  DIGEST_C,
  expectThrowsCode,
} from './test-support.js';

const valid = () => ({
  capability: {
    kind: 'expert-competency',
    id: 'accounts-payable-reconciliation',
    version: '1.2.0',
    digest: DIGEST_B,
  },
  proficiency: 'proficient',
  proficiencyEvidence: [
    { digest: DIGEST_C, description: 'Annotated trajectory set (2026 Q2).' },
  ],
});

describe('expert competencies (positive)', () => {
  it('accepts an evidenced competency and freezes it', () => {
    const competency = toExpertCompetency(valid());
    expect(isExpertCompetency(competency)).toBe(true);
    expect(competency.competencyVersion).toBe(EXPERT_COMPETENCY_VERSION);
    expect(Object.isFrozen(competency)).toBe(true);
    expect(Object.isFrozen(competency.proficiencyEvidence)).toBe(true);
    expect(competencyKey(competency)).toContain('accounts-payable-reconciliation');
    expect(competencyCapabilityKey(competency)).toContain('expert-competency');
  });

  it('accepts all four competency node kinds', () => {
    for (const kind of COMPETENCY_NODE_KINDS) {
      const competency = toExpertCompetency({
        ...valid(),
        capability: { ...valid().capability, kind },
      });
      expect(competency.capability.kind).toBe(kind);
    }
    expect(COMPETENCY_NODE_KINDS).toEqual([
      'capability',
      'sub-capability',
      'skill',
      'expert-competency',
    ]);
  });

  it('exposes the proficiency vocabulary and metadata value types', () => {
    expect(PROFICIENCY_LEVELS).toHaveLength(5);
    expect(isProficiencyLevel('distinguished')).toBe(true);
    expect(DOMAIN_METADATA_VALUE_TYPES).toEqual(['string', 'number', 'boolean']);
    expect(DOMAIN_COMPETENCY_TYPE_PATTERN_SOURCE).toContain('^');
  });

  it('accepts pack-declared domainType and typed domainMetadata', () => {
    const competency = toExpertCompetency({
      ...valid(),
      domainType: 'structural.load-analysis',
      domainMetadata: { stampEligibility: 'informational only', yearsOfPractice: 12 },
    });
    expect(competency.domainType).toBe('structural.load-analysis');
    expect(competency.domainMetadata?.['yearsOfPractice']).toBe(12);
    expect(Object.isFrozen(competency.domainMetadata)).toBe(true);
  });
});

describe('expert competencies (negative)', () => {
  it('rejects non-competency node kinds', () => {
    expect(() =>
      toExpertCompetency({ ...valid(), capability: { ...valid().capability, kind: 'domain' } }),
    ).toThrow(/not allowed here/);
    expect(() =>
      toExpertCompetency({ ...valid(), capability: { ...valid().capability, kind: 'tool' } }),
    ).toThrow(ExpertRegistryError);
  });

  it('rejects unknown proficiency levels', () => {
    expect(() => toExpertCompetency({ ...valid(), proficiency: 'guru' })).toThrow(
      /unknown proficiency level/,
    );
    expect(isProficiencyLevel('guru')).toBe(false);
  });

  it('rejects evidence-free competencies (R7)', () => {
    expect(() => toExpertCompetency({ ...valid(), proficiencyEvidence: [] })).toThrow(
      /at least one digest-addressed proficiency evidence/,
    );
    expect(() => toExpertCompetency({ ...valid(), proficiencyEvidence: undefined as never })).toThrow(
      ExpertRegistryError,
    );
  });

  it('rejects duplicate proficiency evidence and malformed refs', () => {
    expect(() =>
      toExpertCompetency({
        ...valid(),
        proficiencyEvidence: [
          { digest: DIGEST_C, description: 'a' },
          { digest: DIGEST_C, description: 'b' },
        ],
      }),
    ).toThrow(ExpertRegistryError);
    expect(() =>
      toExpertCompetency({
        ...valid(),
        proficiencyEvidence: [{ digest: 'bad', description: 'a' }],
      }),
    ).toThrow(/invalid evidence digest/);
    expect(() =>
      toExpertCompetency({
        ...valid(),
        proficiencyEvidence: [{ digest: DIGEST_C, description: '' }],
      }),
    ).toThrow(/non-empty/);
  });

  it('rejects malformed domainType and domainMetadata', () => {
    expect(() => toExpertCompetency({ ...valid(), domainType: 'Bad Type' })).toThrow(
      /invalid domain competency type/,
    );
    expect(() =>
      toExpertCompetency({ ...valid(), domainMetadata: {} }),
    ).toThrow(/at least one entry/);
    expect(() =>
      toExpertCompetency({
        ...valid(),
        domainMetadata: { x: { nested: 'object' } as unknown as boolean },
      }),
    ).toThrow(/string\/number\/boolean/);
  });

  it('rejects authority-shaped and PII-shaped domain declarations (lock rule 9)', () => {
    expectThrowsCode(
      () => toExpertCompetency({ ...valid(), domainType: 'adminOf' }),
      EXPERT_ERROR_CODES.AUTHORITY_FIELD_REJECTED,
    );
    expectThrowsCode(
      () => toExpertCompetency({ ...valid(), domainMetadata: { email: 'x' } }),
      EXPERT_ERROR_CODES.PII_FIELD_REJECTED,
    );
    expectThrowsCode(
      () => toExpertCompetency({ ...valid(), domainMetadata: { scopes: 'read' } }),
      EXPERT_ERROR_CODES.AUTHORITY_FIELD_REJECTED,
    );
  });

  it('list discipline: >= 1 competency, no duplicate capabilities', () => {
    expect(() => toExpertCompetencyList([])).toThrow(
      /at least one competency/,
    );
    expect(() => toExpertCompetencyList([valid(), valid()])).toThrow(
      /duplicate competency/,
    );
    const list = toExpertCompetencyList([
      valid(),
      {
        ...valid(),
        proficiency: 'advanced',
        capability: { ...valid().capability, id: 'erp-export-analysis' },
      },
    ]);
    expect(list).toHaveLength(2);
    expect(Object.isFrozen(list)).toBe(true);
  });
});
