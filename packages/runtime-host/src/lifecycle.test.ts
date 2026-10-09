import { describe, expect, it } from 'vitest';
import {
  assertStarted,
  isLegalTransition,
  isRuntimeHostState,
  LIFECYCLE_ERROR_CODES,
  RUNTIME_HOST_STATES,
  RuntimeHostLifecycleError,
  transitionRuntimeHost,
} from './lifecycle.js';

describe('host lifecycle', () => {
  it('has the closed state vocabulary', () => {
    expect(RUNTIME_HOST_STATES).toEqual([
      'constructed',
      'starting',
      'started',
      'stopping',
      'stopped',
      'failed',
    ]);
  });

  it('permits only the legal forward transitions', () => {
    expect(isLegalTransition('constructed', 'starting')).toBe(true);
    expect(isLegalTransition('starting', 'started')).toBe(true);
    expect(isLegalTransition('starting', 'failed')).toBe(true);
    expect(isLegalTransition('started', 'stopping')).toBe(true);
    expect(isLegalTransition('stopping', 'stopped')).toBe(true);
    // Illegal: skips, backwards, terminal exits.
    expect(isLegalTransition('constructed', 'started')).toBe(false);
    expect(isLegalTransition('started', 'starting')).toBe(false);
    expect(isLegalTransition('stopped', 'starting')).toBe(false);
    expect(isLegalTransition('failed', 'starting')).toBe(false);
    expect(isLegalTransition('started', 'constructed')).toBe(false);
  });

  it('applies legal transitions purely and fails closed on illegal ones', () => {
    expect(transitionRuntimeHost('constructed', 'starting')).toBe('starting');
    expect(transitionRuntimeHost('starting', 'started')).toBe('started');
    expect(() => transitionRuntimeHost('started', 'starting')).toThrow(
      RuntimeHostLifecycleError,
    );
    try {
      transitionRuntimeHost('started', 'starting');
      expect.unreachable('transitionRuntimeHost must throw');
    } catch (error) {
      expect(error instanceof RuntimeHostLifecycleError).toBe(true);
      expect((error as RuntimeHostLifecycleError).code).toBe(
        LIFECYCLE_ERROR_CODES.INVALID_TRANSITION,
      );
    }
  });

  it('requires a non-empty failure reason for a failed host (fail-closed diagnosis)', () => {
    expect(() => transitionRuntimeHost('starting', 'failed')).toThrow(
      RuntimeHostLifecycleError,
    );
    expect(() => transitionRuntimeHost('starting', 'failed', '   ')).toThrow(
      RuntimeHostLifecycleError,
    );
    expect(transitionRuntimeHost('starting', 'failed', 'persistence-unavailable')).toBe('failed');
  });

  it('gates the served surface on the started state only', () => {
    expect(() => assertStarted('started')).not.toThrow();
    for (const state of RUNTIME_HOST_STATES) {
      if (state === 'started') continue;
      expect(() => assertStarted(state)).toThrow(RuntimeHostLifecycleError);
    }
  });

  it('validates the closed vocabulary (type guard)', () => {
    expect(isRuntimeHostState('started')).toBe(true);
    expect(isRuntimeHostState('restarting')).toBe(false);
    expect(isRuntimeHostState(null)).toBe(false);
  });
});
