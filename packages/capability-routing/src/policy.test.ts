/**
 * Resolution-policy tests (Work Order C015): closure across all eight
 * escalation modes, the no-silent-coercion law, and typed failures for
 * unknown modes.
 */

import { describe, expect, it } from 'vitest';
import {
  ESCALATION_MODES,
  RESOLUTION_POLICY,
  RESOLUTION_POLICY_VERSION,
  RESOURCE_CLASSES,
  allowedResourceClasses,
  isClassAllowedForModes,
  isEscalationMode,
  isResourceClass,
} from './policy.js';

describe('resolution policy', () => {
  it('is total and closed over the eight escalation modes', () => {
    expect(ESCALATION_MODES).toHaveLength(8);
    for (const mode of ESCALATION_MODES) {
      expect(Array.isArray(RESOLUTION_POLICY[mode])).toBe(true);
      expect(RESOLUTION_POLICY[mode].length).toBeGreaterThan(0);
      for (const resourceClass of RESOLUTION_POLICY[mode]) {
        expect(isResourceClass(resourceClass)).toBe(true);
      }
    }
  });

  it('maps the C015 work-items semantics', () => {
    // TOOL_GAP → tool/marketplace-artifact candidates.
    expect(allowedResourceClasses(['TOOL_GAP'])).toEqual(['tool', 'artifact']);
    // KNOWLEDGE → knowledge-tier candidates.
    expect(allowedResourceClasses(['KNOWLEDGE'])).toEqual(['knowledge']);
    // SOLVE/CORRECT/UNBLOCK/REVIEW/TEACH → experts and/or Bodies.
    for (const mode of ['SOLVE', 'CORRECT', 'UNBLOCK', 'REVIEW', 'TEACH'] as const) {
      expect(allowedResourceClasses([mode])).toEqual(['expert', 'body']);
    }
    // EVALUATE → artifacts + experts (derived; architecture question in the PR).
    expect(allowedResourceClasses(['EVALUATE'])).toEqual(['expert', 'artifact']);
  });

  it('unions classes across modes in canonical class order', () => {
    expect(allowedResourceClasses(['SOLVE', 'KNOWLEDGE', 'TOOL_GAP'])).toEqual([
      'expert',
      'body',
      'tool',
      'knowledge',
      'artifact',
    ]);
  });

  it('never coerces: a class no mode allows is simply not allowed', () => {
    expect(isClassAllowedForModes('expert', ['KNOWLEDGE'])).toBe(false);
    expect(isClassAllowedForModes('knowledge', ['KNOWLEDGE'])).toBe(true);
    expect(isClassAllowedForModes('artifact', ['SOLVE'])).toBe(false);
    expect(isClassAllowedForModes('body', ['SOLVE'])).toBe(true);
  });

  it('throws typed INVALID_POLICY for unknown or empty mode lists', () => {
    expect(() => allowedResourceClasses(['NOT_A_MODE'])).toThrowError(/unknown escalation mode/);
    expect(() => allowedResourceClasses([])).toThrowError(/non-empty escalation-mode list/);
  });

  it('guards the closed vocabularies structurally', () => {
    expect(isEscalationMode('SOLVE')).toBe(true);
    expect(isEscalationMode('solve')).toBe(false);
    expect(isResourceClass('expert')).toBe(true);
    expect(isResourceClass('human')).toBe(false);
    expect(RESOURCE_CLASSES).toHaveLength(5);
    expect(RESOLUTION_POLICY_VERSION).toBe(1);
  });
});
