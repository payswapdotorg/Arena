import { describe, expect, it } from 'vitest';
import {
  aggregateReadiness,
  capacityStatusToComponentState,
  isRuntimeComponentState,
  RUNTIME_HOST_COMPONENTS,
  RUNTIME_COMPONENT_STATES,
  type RuntimeComponentHealth,
} from './health.js';
import type { RuntimeHostState } from './lifecycle.js';

function component(
  component: RuntimeComponentHealth['component'],
  state: RuntimeComponentHealth['state'],
): RuntimeComponentHealth {
  return { component, state, reasons: [], checkedAt: 0 };
}

describe('host health & readiness (ADR-P001-07 §7)', () => {
  it('maps every FT2.0 capacity status onto the component vocabulary', () => {
    expect(capacityStatusToComponentState('AVAILABLE')).toBe('ready');
    expect(capacityStatusToComponentState('DISABLED')).toBe('disabled');
    expect(capacityStatusToComponentState('DEGRADED')).toBe('degraded');
    expect(capacityStatusToComponentState('EXHAUSTED')).toBe('failed');
  });

  it('has the closed component vocabulary (ADR-P001-07 responsibilities)', () => {
    expect(RUNTIME_HOST_COMPONENTS).toEqual(['persistence', 'job-runner', 'escalation-lifecycle']);
    expect(RUNTIME_COMPONENT_STATES).toEqual(['ready', 'disabled', 'degraded', 'failed']);
    expect(isRuntimeComponentState('ready')).toBe(true);
    expect(isRuntimeComponentState('available')).toBe(false);
  });

  it('is ready only when started, all components ready AND capacity AVAILABLE', () => {
    const ready = [
      component('persistence', 'ready'),
      component('job-runner', 'ready'),
      component('escalation-lifecycle', 'ready'),
    ];
    expect(aggregateReadiness('started', ready, 'AVAILABLE')).toBe(true);
    // Not started.
    expect(aggregateReadiness('constructed', ready, 'AVAILABLE')).toBe(false);
    expect(aggregateReadiness('stopping', ready, 'AVAILABLE')).toBe(false);
    // Any component not ready.
    expect(
      aggregateReadiness('started', [...ready.slice(0, 2), component('escalation-lifecycle', 'degraded')], 'AVAILABLE'),
    ).toBe(false);
    expect(
      aggregateReadiness('started', [component('persistence', 'disabled'), ...ready.slice(1)], 'AVAILABLE'),
    ).toBe(false);
    // Capacity not AVAILABLE.
    expect(aggregateReadiness('started', ready, 'DISABLED')).toBe(false);
    expect(aggregateReadiness('started', ready, 'DEGRADED')).toBe(false);
    expect(aggregateReadiness('started', ready, 'EXHAUSTED')).toBe(false);
  });

  it('aggregates readiness purely for every lifecycle state', () => {
    const states: RuntimeHostState[] = ['constructed', 'starting', 'started', 'stopping', 'stopped', 'failed'];
    const ready = [
      component('persistence', 'ready'),
      component('job-runner', 'ready'),
      component('escalation-lifecycle', 'ready'),
    ];
    for (const state of states) {
      const verdict = aggregateReadiness(state, ready, 'AVAILABLE');
      expect(verdict).toBe(state === 'started');
    }
  });
});
