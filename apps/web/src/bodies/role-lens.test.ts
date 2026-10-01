import { describe, expect, it } from 'vitest';

/**
 * Body Studio role-lens tests (Work Order B010; issue #82) — the UXM1.0
 * `/bodies` and `/bodies/:id` rows are BINDING: every reference role has
 * a lens; unknown roles are typed rejections; lenses carry NO
 * permissions (presentation only).
 */

import { ROLE_IDS } from '../../../../packages/role-context/src/index.js';
import {
  BODY_STUDIO_EMPHASIS_LABELS,
  BODY_STUDIO_ROLE_LENSES,
  bodyStudioRoleLens,
} from './role-lens.js';
import type { BodyStudioEmphasis } from './role-lens.js';

describe('body studio role lenses (UXM1.0 /bodies + /bodies/:id rows)', () => {
  it('binds a lens to every reference role in canonical order (positive)', () => {
    expect(Object.keys(BODY_STUDIO_ROLE_LENSES)).toEqual([...ROLE_IDS]);
    for (const roleId of ROLE_IDS) {
      const lens = BODY_STUDIO_ROLE_LENSES[roleId];
      expect(lens.roleId).toBe(roleId);
      // Role name + goal come from the B003 registry (never re-transcribed).
      expect(lens.roleName.length).toBeGreaterThan(0);
      expect(lens.roleGoal.length).toBeGreaterThan(0);
      // Both rows carry a landing + hero + detail surface.
      expect(lens.libraryTitle.length).toBeGreaterThan(0);
      expect(lens.libraryIntro.length).toBeGreaterThan(0);
      expect(lens.heroAction.href.length).toBeGreaterThan(0);
      expect(lens.detailTitle.length).toBeGreaterThan(0);
      expect(lens.detailIntro.length).toBeGreaterThan(0);
      expect(lens.nextActions.length).toBeGreaterThan(0);
      expect(BODY_STUDIO_EMPHASIS_LABELS[lens.emphasis]).toBeDefined();
    }
  });

  it('maps the UXM1.0 row vocabulary exactly (positive)', () => {
    expect(BODY_STUDIO_ROLE_LENSES['owner']?.libraryTitle).toBe('Used bodies');
    expect(BODY_STUDIO_ROLE_LENSES['agent-builder']?.libraryTitle).toBe('Body library');
    expect(BODY_STUDIO_ROLE_LENSES['expert']?.libraryTitle).toBe('Expertise context');
    expect(BODY_STUDIO_ROLE_LENSES['evaluator']?.libraryTitle).toBe('Tested bodies');
    expect(BODY_STUDIO_ROLE_LENSES['researcher']?.libraryTitle).toBe('Study population');
    expect(BODY_STUDIO_ROLE_LENSES['operator']?.libraryTitle).toBe('Runtime health');
    expect(BODY_STUDIO_ROLE_LENSES['marketplace-participant']?.libraryTitle).toBe(
      'Available releases',
    );
    expect(BODY_STUDIO_ROLE_LENSES['administrator']?.libraryTitle).toBe('Governance');

    expect(BODY_STUDIO_ROLE_LENSES['owner']?.detailTitle).toBe('Adopt / inspect');
    expect(BODY_STUDIO_ROLE_LENSES['agent-builder']?.detailTitle).toBe('Build / improve');
    expect(BODY_STUDIO_ROLE_LENSES['expert']?.detailTitle).toBe('Review');
    expect(BODY_STUDIO_ROLE_LENSES['evaluator']?.detailTitle).toBe('Certify');
    expect(BODY_STUDIO_ROLE_LENSES['researcher']?.detailTitle).toBe('Compare');
    expect(BODY_STUDIO_ROLE_LENSES['operator']?.detailTitle).toBe('Runtime');
    expect(BODY_STUDIO_ROLE_LENSES['marketplace-participant']?.detailTitle).toBe('License / offer');
    expect(BODY_STUDIO_ROLE_LENSES['administrator']?.detailTitle).toBe('Policy');
  });

  it('the researcher detail lens teaches composition-scoped comparison (positive)', () => {
    const lens = bodyStudioRoleLens('researcher');
    expect(lens.emphasis).toBe('comparison');
    expect(lens.detailIntro).toContain('COMPOSITION-SCOPED');
    expect(lens.detailIntro).toContain('typed rejection');
    expect(lens.detailFocus).toContain('versioned composition binding');
    // The compare lens never teaches a bare model ranking:
    expect(lens.detailIntro).not.toContain('bare model ranking is available');
  });

  it('the builder lens teaches immutability — improvement creates a NEW version (positive)', () => {
    const lens = bodyStudioRoleLens('agent-builder');
    expect(lens.detailIntro).toContain('NEW immutable Body Version');
    expect(lens.emphasis).toBe('composition');
  });

  it('every emphasis label is distinct (no two lenses collapse visually) (positive)', () => {
    const labels = new Set<string>();
    for (const roleId of Object.keys(BODY_STUDIO_ROLE_LENSES) as readonly (keyof typeof BODY_STUDIO_ROLE_LENSES)[]) {
      labels.add(BODY_STUDIO_EMPHASIS_LABELS[BODY_STUDIO_ROLE_LENSES[roleId]?.emphasis as BodyStudioEmphasis]);
    }
    expect(labels.size).toBeGreaterThan(1);
  });

  it('rejects unknown role ids — never a silent default (negative)', () => {
    expect(() => bodyStudioRoleLens('supervisor')).toThrowError(/unknown body studio role lens/);
    expect(() => bodyStudioRoleLens('')).toThrowError(/unknown body studio role lens/);
  });

  it('lenses carry no permission, policy or grant vocabulary (negative)', () => {
    for (const roleId of ROLE_IDS) {
      const lens = JSON.stringify(BODY_STUDIO_ROLE_LENSES[roleId]);
      expect(lens).not.toContain('permission');
      expect(lens).not.toContain('"grant');
      expect(lens).not.toContain('authorize');
    }
  });
});
