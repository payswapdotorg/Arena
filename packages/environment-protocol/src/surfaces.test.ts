/**
 * Surfaces tests: action/tool surface and observation surface (declare
 * fields 5 and 6) — closed sets, non-empty, duplicate-free, strict shape.
 */

import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import {
  isActionSurface,
  isObservationSurface,
  toActionSurface,
  toObservationSurface,
} from './surfaces.js';

describe('action/tool surface (declare field 5)', () => {
  it('validates actions and tools, freezing both lists', () => {
    const surface = toActionSurface({
      actions: [
        { actionId: 'run-step', description: 'Execute one declared procedure step.' },
        { actionId: 'submit-result', description: null },
      ],
      tools: [{ toolId: 'file-tool', description: null }],
    });
    expect(isActionSurface(surface)).toBe(true);
    expect(surface.actions).toHaveLength(2);
    expect(surface.tools).toHaveLength(1);
    expect(Object.isFrozen(surface)).toBe(true);
    expect(Object.isFrozen(surface.actions)).toBe(true);
    expect(Object.isFrozen(surface.actions[0])).toBe(true);
  });

  it('tools may be omitted (empty tool list is legal)', () => {
    const surface = toActionSurface({ actions: [{ actionId: 'run-step' }] });
    expect(surface.tools).toEqual([]);
  });

  it('an empty action list is rejected (a world the agent cannot act in)', () => {
    expect(() => toActionSurface({ actions: [], tools: [] })).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_ACTION_SURFACE }),
    );
    expect(() => toActionSurface({} as unknown as Parameters<typeof toActionSurface>[0])).toThrowError(
      EnvironmentError,
    );
  });

  it('duplicate action ids and tool ids are rejected (closed set)', () => {
    expect(() =>
      toActionSurface({ actions: [{ actionId: 'run-step' }, { actionId: 'run-step' }] }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_ACTION_SURFACE }),
    );
    expect(() =>
      toActionSurface({
        actions: [{ actionId: 'run-step' }],
        tools: [{ toolId: 'run-step' }],
      }),
    ).toThrowError(EnvironmentError);
  });

  it('malformed descriptors and unknown fields are rejected', () => {
    expect(() => toActionSurface({ actions: [{ actionId: 'BAD ID' }] })).toThrowError(EnvironmentError);
    expect(() =>
      toActionSurface({ actions: [{ actionId: 'ok', binding: 'x' } as unknown as { actionId: string }] }),
    ).toThrowError(EnvironmentError);
    expect(isActionSurface({ actions: [{ actionId: 'ok', description: 'fine' }], tools: [] })).toBe(true);
    expect(isActionSurface({ actions: [] })).toBe(false);
  });
});

describe('observation surface (declare field 6)', () => {
  it('validates the closed channel set, freezing the list', () => {
    const surface = toObservationSurface({
      observations: [
        { observationId: 'obs-stdout', channel: 'stdout', description: null },
        { observationId: 'obs-events', channel: 'events' },
      ],
    });
    expect(isObservationSurface(surface)).toBe(true);
    expect(surface.observations[1]?.description).toBeNull();
    expect(Object.isFrozen(surface)).toBe(true);
    expect(Object.isFrozen(surface.observations)).toBe(true);
  });

  it('an empty observation list is rejected', () => {
    expect(() => toObservationSurface({ observations: [] })).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_OBSERVATION_SURFACE }),
    );
  });

  it('unknown channels are rejected (typed enum)', () => {
    expect(() =>
      toObservationSurface({ observations: [{ observationId: 'obs-x', channel: 'telepathy' }] }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_OBSERVATION_SURFACE }),
    );
  });

  it('duplicate observation ids are rejected', () => {
    expect(() =>
      toObservationSurface({
        observations: [
          { observationId: 'obs-stdout', channel: 'stdout' },
          { observationId: 'obs-stdout', channel: 'stderr' },
        ],
      }),
    ).toThrowError(EnvironmentError);
  });

  it('malformed descriptors are rejected', () => {
    expect(() =>
      toObservationSurface({ observations: [{ observationId: 'BAD', channel: 'stdout' }] }),
    ).toThrowError(EnvironmentError);
    expect(isObservationSurface({ observations: [{ observationId: 'ok', channel: 'metrics' }] })).toBe(true);
    expect(isObservationSurface({ observations: [{ observationId: 'ok', channel: 'nope' }] })).toBe(false);
  });
});
