/**
 * Property tests (Work Order A035): determinism and aggregation laws.
 *
 * The evaluator and the alert engine are PURE: identical inputs must
 * produce identical outputs, forever. Worst-of health aggregation is
 * commutative and associative. SLO error budgets are bounded.
 */

import { describe, expect, it } from 'vitest';
import { aggregateHealth } from './health.js';
import type { ComponentHealth } from './health.js';
import { evaluateAlertRule, initialAlertRuleState } from './alerts.js';
import { evaluateSlo } from './slo.js';
import type { EvaluationWindow } from './slo.js';
import { alertRule, healthComponent, metricSignal, sloDefinition, windowOf } from './test-support.js';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('evaluateSlo determinism (property)', () => {
  it('identical inputs always produce identical evaluations (100 random windows)', () => {
    const random = seededRandom(20261001);
    for (let trial = 0; trial < 100; trial++) {
      const target = 0.5 + random() * 0.49;
      const definition = sloDefinition({
        targetRatio: target,
        minSampleCount: 1,
        windowMs: 60_000,
      });
      const window: EvaluationWindow = windowOf(60_000);
      const samples = [];
      const count = 1 + Math.floor(random() * 50);
      for (let i = 0; i < count; i++) {
        samples.push(
          metricSignal({
            sequence: i + 1,
            occurredAt: window.windowStart + i,
            value: random() < target ? 1 : 0,
          }),
        );
      }
      const input = { definition, window, samples };
      const first = evaluateSlo(input);
      const second = evaluateSlo(JSON.parse(JSON.stringify(input)) as typeof input);
      expect(second).toEqual(first);
      // budget invariants
      expect(first.errorBudget.consumedRatio).toBeGreaterThanOrEqual(0);
      expect(first.errorBudget.consumedRatio).toBeLessThanOrEqual(1);
      expect(first.errorBudget.remainingRatio).toBeGreaterThanOrEqual(0);
      expect(first.achievedRatio).toBeGreaterThanOrEqual(0);
      expect(first.achievedRatio).toBeLessThanOrEqual(1);
    }
  });
});

describe('evaluateAlertRule determinism (property)', () => {
  it('identical inputs always produce identical verdicts (100 random trials)', () => {
    const random = seededRandom(20261002);
    for (let trial = 0; trial < 100; trial++) {
      const rule = alertRule({
        condition: 'metric-above-threshold',
        threshold: random() * 10,
        forDurationMs: Math.floor(random() * 100),
        cooldownMs: Math.floor(random() * 100),
      });
      const input = {
        rule,
        priorState: initialAlertRuleState(rule.ruleId, 1_000),
        now: 1_000 + Math.floor(random() * 10_000),
        input: {
          sloEvaluation: null,
          healthStatus: null,
          metricValue: random() * 20,
          logErrorRatio: null,
        },
      };
      expect(evaluateAlertRule(input)).toEqual(evaluateAlertRule(input));
    }
  });
});

describe('aggregateHealth laws (property)', () => {
  it('worst-of aggregation is commutative under permutation', () => {
    const random = seededRandom(20261003);
    const statuses = ['healthy', 'degraded', 'unhealthy', 'unknown'] as const;
    for (let trial = 0; trial < 50; trial++) {
      const components: ComponentHealth[] = [];
      const count = 1 + Math.floor(random() * 8);
      for (let i = 0; i < count; i++) {
        const status = statuses[Math.floor(random() * statuses.length)] ?? 'unknown';
        components.push(healthComponent(status, `component-${i}`));
      }
      const base = aggregateHealth(components);
      const shuffled = [...components];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const tmp = shuffled[i] as ComponentHealth;
        shuffled[i] = shuffled[j] as ComponentHealth;
        shuffled[j] = tmp;
      }
      expect(aggregateHealth(shuffled)).toBe(base);
    }
  });

  it('worse components always dominate (associativity with singletons)', () => {
    const rank: Record<string, number> = { healthy: 0, degraded: 1, unknown: 2, unhealthy: 3 };
    const statuses = ['healthy', 'degraded', 'unhealthy', 'unknown'] as const;
    for (const a of statuses) {
      for (const b of statuses) {
        const combined = aggregateHealth([healthComponent(a, 'component-a'), healthComponent(b, 'component-b')]);
        expect(rank[combined]).toBe(Math.max(rank[a] ?? 0, rank[b] ?? 0));
      }
    }
  });
});
