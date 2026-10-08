/**
 * Economics-policy tests (Work Order C016): versioned deterministic
 * policies; supersession by exactly-one version bumps — never a silent
 * restatement.
 */

import { describe, expect, it } from 'vitest';
import { CapabilityEconomicsError } from './errors.js';
import {
  ARENA_REFERENCE_ECONOMICS_POLICY,
  ECONOMICS_METRICS,
  isEconomicsPolicy,
  supersedeEconomicsPolicy,
  toEconomicsPolicy,
} from './policy.js';
import { referencePolicyFixture } from './test-support.js';

describe('EconomicsPolicy', () => {
  it('the reference policy is structurally valid and covers the closed metric vocabulary', () => {
    expect(isEconomicsPolicy(ARENA_REFERENCE_ECONOMICS_POLICY)).toBe(true);
    expect([...ARENA_REFERENCE_ECONOMICS_POLICY.metricAllowList]).toEqual([...ECONOMICS_METRICS]);
    expect(ARENA_REFERENCE_ECONOMICS_POLICY.smallSampleMinimum).toBeGreaterThanOrEqual(1);
  });

  it('toEconomicsPolicy validates and freezes (fail-closed on bad shapes)', () => {
    expect(() =>
      toEconomicsPolicy(referencePolicyFixture({ version: 0 })),
    ).toThrowError(CapabilityEconomicsError);
    expect(() =>
      toEconomicsPolicy(referencePolicyFixture({ smallSampleMinimum: 0 })),
    ).toThrowError(CapabilityEconomicsError);
    expect(() =>
      toEconomicsPolicy(referencePolicyFixture({ metricAllowList: ['roi-score'] as never })),
    ).toThrowError(CapabilityEconomicsError);
    expect(() =>
      toEconomicsPolicy(referencePolicyFixture({ disclosureNote: '' })),
    ).toThrowError(CapabilityEconomicsError);
  });

  it('supersession advances the version by exactly one and never mutates the current policy', () => {
    const current = referencePolicyFixture();
    const next = supersedeEconomicsPolicy(
      current,
      referencePolicyFixture({ version: 2, smallSampleMinimum: 50 }),
    );
    expect(next.version).toBe(2);
    expect(next.smallSampleMinimum).toBe(50);
    expect(current.version).toBe(1); // untouched
  });

  it('refuses same-version restatements (silent restatement is impossible)', () => {
    const current = referencePolicyFixture();
    expect(() =>
      supersedeEconomicsPolicy(current, referencePolicyFixture({ version: 1 })),
    ).toThrowError(CapabilityEconomicsError);
  });

  it('refuses version skips and identity changes (typed SUPERSESSION_VIOLATION)', () => {
    const current = referencePolicyFixture();
    expect(() =>
      supersedeEconomicsPolicy(current, referencePolicyFixture({ version: 3 })),
    ).toThrowError(CapabilityEconomicsError);
    expect(() =>
      supersedeEconomicsPolicy(
        current,
        referencePolicyFixture({ version: 2, policyId: 'other-policy' as never }),
      ),
    ).toThrowError(CapabilityEconomicsError);
  });

  it('rejects a smuggled collapsed-score field (no-score law)', () => {
    const smuggled = {
      ...referencePolicyFixture(),
      score: 0.5,
    } as unknown;
    expect(() => isEconomicsPolicy(smuggled)).toThrowError(CapabilityEconomicsError);
  });
});
