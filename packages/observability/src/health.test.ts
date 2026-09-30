/**
 * Health aggregation tests (Work Order A035): positive + fail-closed.
 */

import { describe, expect, it } from 'vitest';
import {
  aggregateHealth,
  toComponentHealth,
  toHealthReport,
} from './health.js';
import { ObservabilityError } from './errors.js';
import { healthComponent } from './test-support.js';

const component = healthComponent;

describe('health vocabulary', () => {
  it('validates component records and freezes reports (positive)', () => {
    const record = toComponentHealth(component('healthy'));
    expect(record.status).toBe('healthy');
    const report = toHealthReport([component('healthy'), component('degraded', 'certification-fabric')], 2_000);
    expect(report.aggregate).toBe('degraded');
    expect(report.reportVersion).toBe(1);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.components)).toBe(true);
  });

  it('rejects unknown statuses and malformed records (adversarial)', () => {
    expect(() => toComponentHealth({ ...component('healthy'), status: 'fine' })).toThrow(ObservabilityError);
    expect(() => toComponentHealth({ ...component('healthy'), checkedAt: -5 })).toThrow(ObservabilityError);
    expect(() => toComponentHealth({ ...component('healthy'), detail: 42 })).toThrow(ObservabilityError);
    expect(() => toHealthReport([component('healthy')], -1)).toThrow(ObservabilityError);
  });

  it('aggregates worst-of with the closed ranking (positive)', () => {
    expect(aggregateHealth([component('healthy')])).toBe('healthy');
    expect(aggregateHealth([component('healthy'), component('degraded')])).toBe('degraded');
    expect(aggregateHealth([component('degraded'), component('unknown')])).toBe('unknown');
    expect(aggregateHealth([component('unknown'), component('unhealthy')])).toBe('unhealthy');
  });

  it('FAILS CLOSED: empty input aggregates to unknown (adversarial)', () => {
    expect(aggregateHealth([])).toBe('unknown');
  });

  it('FAILS CLOSED: malformed contributions aggregate as unknown, never healthy (adversarial)', () => {
    const malformed = { bad: true } as unknown as ReturnType<typeof component>;
    expect(aggregateHealth([component('healthy'), malformed])).toBe('unknown');
    // even when every valid contribution is healthy
    expect(aggregateHealth([component('healthy'), malformed, component('healthy')])).toBe('unknown');
  });
});
