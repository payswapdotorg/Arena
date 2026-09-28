/**
 * Domain-scope tests (Work Order A006; §8 domain/jurisdiction;
 * architecture-lock rule 23: safety, privacy, licensing and professional
 * limitations are explicit metadata). Positive and negative.
 */

import { describe, expect, it } from 'vitest';
import {
  COUNTRY_CODE_PATTERN_SOURCE,
  EXPERT_DOMAIN_SCOPE_VERSION,
  JURISDICTION_VERSION,
  LIMITATION_CLASSES,
  LIMITATION_VERSION,
  isExpertDomainScope,
  isJurisdictionView,
  isLimitationClass,
  isProfessionalLimitation,
  jurisdictionKey,
  toExpertDomainScope,
  toJurisdictionView,
  toProfessionalLimitation,
} from './domain-scope.js';
import { ExpertRegistryError } from './errors.js';
import { AT, AT_LATER, DIGEST_B } from './test-support.js';

const valid = () => ({
  domains: [{ kind: 'domain', id: 'accounts-payable', version: '1.0.0', digest: DIGEST_B }],
  jurisdictions: [{ country: 'DE' }],
  limitations: [
    {
      class: 'professional-scope',
      statement:
        'Provides reconciliation analysis only; does not issue financial statements or tax filings.',
    },
  ],
});

describe('jurisdictions (positive + negative)', () => {
  it('accepts ISO country + optional region and freezes them', () => {
    const j = toJurisdictionView({ country: 'US', region: 'CA' });
    expect(isJurisdictionView(j)).toBe(true);
    expect(j.jurisdictionVersion).toBe(JURISDICTION_VERSION);
    expect(Object.isFrozen(j)).toBe(true);
    expect(jurisdictionKey(j)).toBe('US-CA');
    expect(jurisdictionKey(toJurisdictionView({ country: 'DE' }))).toBe('DE');
  });

  it('rejects malformed countries and regions', () => {
    expect(() => toJurisdictionView({ country: 'de' })).toThrow(
      /ISO 3166-1 alpha-2, uppercase/,
    );
    expect(() => toJurisdictionView({ country: 'USA' })).toThrow(ExpertRegistryError);
    expect(() => toJurisdictionView({ country: 'US', region: 'california' })).toThrow(
      /ISO 3166-2/,
    );
    expect(isJurisdictionView({ country: 'xx' })).toBe(false);
    expect(COUNTRY_CODE_PATTERN_SOURCE).toBe('^[A-Z]{2}$');
  });
});

describe('professional limitations (positive + negative)', () => {
  it('accepts typed limitations over the closed class vocabulary', () => {
    expect(LIMITATION_CLASSES).toEqual([
      'safety',
      'privacy',
      'licensing',
      'professional-scope',
      'jurisdictional',
      'capacity',
    ]);
    for (const cls of LIMITATION_CLASSES) {
      const limitation = toProfessionalLimitation({
        class: cls,
        statement: 'An honest, explicit limitation statement.',
      });
      expect(isProfessionalLimitation(limitation)).toBe(true);
      expect(limitation.limitationVersion).toBe(LIMITATION_VERSION);
      expect(Object.isFrozen(limitation)).toBe(true);
      expect(isLimitationClass(cls)).toBe(true);
    }
  });

  it('accepts jurisdictional scoping and expiry', () => {
    const limitation = toProfessionalLimitation({
      class: 'licensing',
      statement: 'Not a licensed tax advisor in any jurisdiction.',
      jurisdiction: { country: 'DE' },
      appliesUntil: AT_LATER,
    });
    expect(limitation.jurisdiction?.country).toBe('DE');
    expect(limitation.appliesUntil).toBe(AT_LATER);
  });

  it('rejects unknown classes, empty and oversized statements', () => {
    expect(() =>
      toProfessionalLimitation({ class: 'legal', statement: 'x' }),
    ).toThrow(/unknown limitation class/);
    expect(() =>
      toProfessionalLimitation({ class: 'safety', statement: '' }),
    ).toThrow(/non-empty statement/);
    expect(() =>
      toProfessionalLimitation({ class: 'safety', statement: 'x'.repeat(2001) }),
    ).toThrow(/2000 characters/);
    expect(() =>
      toProfessionalLimitation({ class: 'safety', statement: 'x', appliesUntil: AT }),
    ).not.toThrow();
    expect(isProfessionalLimitation({ class: 'safety', statement: 'x' })).toBe(false);
  });
});

describe('the domain scope (positive + negative)', () => {
  it('accepts a fully-declared scope and freezes it', () => {
    const scope = toExpertDomainScope(valid());
    expect(isExpertDomainScope(scope)).toBe(true);
    expect(scope.scopeVersion).toBe(EXPERT_DOMAIN_SCOPE_VERSION);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.domains)).toBe(true);
    expect(Object.isFrozen(scope.limitations)).toBe(true);
  });

  it('accepts EMPTY jurisdictions ("where appropriate", §8)', () => {
    const scope = toExpertDomainScope({ ...valid(), jurisdictions: [] });
    expect(scope.jurisdictions).toEqual([]);
  });

  it('rejects missing/empty domains and non-domain node kinds', () => {
    expect(() => toExpertDomainScope({ ...valid(), domains: [] })).toThrow(
      /at least one capability-graph domain node ref/,
    );
    expect(() =>
      toExpertDomainScope({
        ...valid(),
        domains: [{ kind: 'capability', id: 'x', version: '1.0.0', digest: DIGEST_B }],
      }),
    ).toThrow(/not allowed here/);
    expect(() =>
      toExpertDomainScope({
        ...valid(),
        domains: [
          { kind: 'domain', id: 'a', version: '1.0.0', digest: DIGEST_B },
          { kind: 'domain', id: 'a', version: '1.0.0', digest: DIGEST_B },
        ],
      }),
    ).toThrow(/duplicate domain node ref/);
  });

  it('rejects duplicate jurisdictions', () => {
    expect(() =>
      toExpertDomainScope({
        ...valid(),
        jurisdictions: [{ country: 'DE' }, { country: 'DE' }],
      }),
    ).toThrow(/duplicate jurisdiction/);
  });

  it('REQUIRES >= 1 explicit limitation (lock rule 23)', () => {
    expect(() => toExpertDomainScope({ ...valid(), limitations: [] })).toThrow(
      /at least one explicit professional limitation/,
    );
    expect(() =>
      toExpertDomainScope({
        ...valid(),
        limitations: [{ class: 'safety', statement: '' }],
      }),
    ).toThrow(ExpertRegistryError);
  });
});
