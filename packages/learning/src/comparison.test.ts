/**
 * Comparison computation tests - pure metric comparison per declared
 * direction, protected-capability checks (measured/unmeasured),
 * uncertainty report, and the closed-set discipline negatives.
 */

import { describe, expect, it } from 'vitest';
import type { OutcomeMetricDeclaration, ProtectedCapabilityDeclaration } from './descriptor.js';
import {
  checkProtectedCapabilities,
  compareOutcomeMetrics,
  computeUncertaintyReport,
} from './comparison.js';
import { createExperimentDescriptor } from './descriptor.js';
import { makeExperimentInput, PROTECTED_CAPABILITY } from './test-support.js';

const DECLARATIONS = [
  { metricId: 'reconciliation-accuracy', description: 'fraction correct', direction: 'higher-is-better' as const },
  { metricId: 'cycle-time', description: 'seconds per close', direction: 'lower-is-better' as const },
] as unknown as readonly OutcomeMetricDeclaration[];

const BASELINE = [
  { metricId: 'reconciliation-accuracy', value: 0.8, variance: 0.01 },
  { metricId: 'cycle-time', value: 120, variance: 4 },
];

const INTERVENTION = [
  { metricId: 'reconciliation-accuracy', value: 0.9, variance: 0.01 },
  { metricId: 'cycle-time', value: 100, variance: 4 },
];

describe('compareOutcomeMetrics - positive', () => {
  it('computes deltas and improvement per declared direction', () => {
    const comparison = compareOutcomeMetrics(DECLARATIONS, BASELINE, INTERVENTION);
    expect(comparison).toHaveLength(2);
    const accuracy = comparison[0];
    const cycle = comparison[1];
    expect(accuracy?.delta).toBeCloseTo(0.1);
    expect(accuracy?.improved).toBe(true);
    expect(accuracy?.regressed).toBe(false);
    // lower-is-better: a NEGATIVE delta is an improvement.
    expect(cycle?.delta).toBe(-20);
    expect(cycle?.improved).toBe(true);
    expect(cycle?.regressed).toBe(false);
  });

  it('flags regression per direction', () => {
    const comparison = compareOutcomeMetrics(DECLARATIONS, INTERVENTION, BASELINE);
    expect(comparison[0]?.regressed).toBe(true);
    expect(comparison[1]?.regressed).toBe(true);
    expect(comparison.every((entry) => !entry.improved)).toBe(true);
  });

  it('ties are neither improvement nor regression', () => {
    const comparison = compareOutcomeMetrics(DECLARATIONS, BASELINE, BASELINE);
    expect(comparison.every((entry) => !entry.improved && !entry.regressed)).toBe(true);
    expect(comparison[0]?.delta).toBe(0);
  });

  it('is deterministic (property)', () => {
    const a = compareOutcomeMetrics(DECLARATIONS, BASELINE, INTERVENTION);
    const b = compareOutcomeMetrics(DECLARATIONS, BASELINE, INTERVENTION);
    expect(a).toEqual(b);
  });
});

describe('compareOutcomeMetrics - closed-set negatives', () => {
  it('REJECTS undeclared metrics in an arm', () => {
    const extra = [...BASELINE, { metricId: 'rogue', value: 1, variance: null }];
    expect(() => compareOutcomeMetrics(DECLARATIONS, extra, INTERVENTION)).toThrow(
      /undeclared metric rogue/,
    );
  });

  it('REJECTS missing declared metrics in an arm', () => {
    expect(() =>
      compareOutcomeMetrics(DECLARATIONS, BASELINE, [INTERVENTION[0]!]),
    ).toThrow(/not measured in the intervention arm/);
    expect(() =>
      compareOutcomeMetrics(DECLARATIONS, [BASELINE[0]!], INTERVENTION),
    ).toThrow(/not measured in the baseline arm/);
  });

  it('REJECTS duplicate measurements per metric per arm', () => {
    const duplicate = [...BASELINE, { metricId: 'reconciliation-accuracy', value: 0.85, variance: 0.01 }];
    expect(() => compareOutcomeMetrics(DECLARATIONS, duplicate, INTERVENTION)).toThrow(
      /duplicate measurement/,
    );
  });

  it('REJECTS non-finite values and negative variance', () => {
    expect(() =>
      compareOutcomeMetrics(DECLARATIONS, [
        { metricId: 'reconciliation-accuracy', value: Number.NaN, variance: null },
        { metricId: 'cycle-time', value: 1, variance: 1 },
      ], INTERVENTION),
    ).toThrow(/finite/);
    expect(() =>
      compareOutcomeMetrics(DECLARATIONS, [
        { metricId: 'reconciliation-accuracy', value: 1, variance: -1 },
        { metricId: 'cycle-time', value: 1, variance: 1 },
      ], INTERVENTION),
    ).toThrow(/non-negative/);
  });
});

describe('checkProtectedCapabilities', () => {
  const descriptorDecls = [
    {
      ref: { ...PROTECTED_CAPABILITY },
      metricId: 'audit-trail-completeness',
      direction: 'higher-is-better' as const,
    },
  ] as unknown as readonly ProtectedCapabilityDeclaration[];

  it('measures regression per direction', () => {
    const checks = checkProtectedCapabilities(
      descriptorDecls,
      [{ capabilityRef: PROTECTED_CAPABILITY.digest, value: 0.9 }],
      [{ capabilityRef: PROTECTED_CAPABILITY.digest, value: 0.7 }],
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]?.measured).toBe(true);
    expect(checks[0]?.regressed).toBe(true);
    expect(checks[0]?.delta).toBeCloseTo(-0.2);
  });

  it('records unmeasured protected capabilities as measured=false (never silently skipped)', () => {
    const checks = checkProtectedCapabilities(
      descriptorDecls,
      [{ capabilityRef: PROTECTED_CAPABILITY.digest, value: 0.9 }],
      [],
    );
    expect(checks[0]?.measured).toBe(false);
    expect(checks[0]?.regressed).toBe(false);
    expect(checks[0]?.interventionValue).toBeNull();
    expect(checks[0]?.delta).toBeNull();
  });

  it('REJECTS measurements for UNDECLARED protected capability refs', () => {
    expect(() =>
      checkProtectedCapabilities(
        descriptorDecls,
        [{ capabilityRef: 'a'.repeat(64), value: 1 }],
        [],
      ),
    ).toThrow(/UNDECLARED protected capability/);
  });

  it('REJECTS duplicate measurements for the same ref', () => {
    expect(() =>
      checkProtectedCapabilities(
        descriptorDecls,
        [
          { capabilityRef: PROTECTED_CAPABILITY.digest, value: 1 },
          { capabilityRef: PROTECTED_CAPABILITY.digest, value: 2 },
        ],
        [],
      ),
    ).toThrow(/duplicate protected-capability measurement/);
  });
});

describe('computeUncertaintyReport', () => {
  it('carries the declared method and both arms\' variances', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const report = computeUncertaintyReport(
      descriptor.uncertainty,
      [{ metricId: 'reconciliation-accuracy', value: 0.8, variance: 0.01 }],
      [{ metricId: 'reconciliation-accuracy', value: 0.9, variance: 0.02 }],
    );
    expect(report.method).toBe('analytic-variance');
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.baselineVariance).toBe(0.01);
    expect(report.entries[0]?.interventionVariance).toBe(0.02);
  });

  it('records null when variance is unreported (fails closed)', () => {
    const report = computeUncertaintyReport(
      { method: 'none', notes: null },
      [{ metricId: 'm', value: 1, variance: null }],
      [{ metricId: 'm', value: 2, variance: null }],
    );
    expect(report.entries[0]?.baselineVariance).toBeNull();
    expect(report.entries[0]?.interventionVariance).toBeNull();
  });
});
