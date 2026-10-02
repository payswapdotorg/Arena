/**
 * Operations role-lens tests (Work Order B014).
 *
 * Positive: the lens projects the granted-role facts (operator /
 * administrator lenses). Adversarial: an empty or foreign grant set
 * projects no lenses — never a fabricated role, never a blocked surface
 * (the lens is a lens, never authorization), and the absent-capabilities
 * note always renders (admin-only actions do not exist yet).
 */

import { describe, expect, it } from 'vitest';

import { toOperationsRoleLensView } from './role-lens.js';

describe('operations role lens (positive)', () => {
  it('projects the operator lens from a granted operator role', () => {
    const lens = toOperationsRoleLensView(['operator']);
    expect(lens.operatorLens).toBe(true);
    expect(lens.administratorLens).toBe(false);
    expect(lens.grantedRoleIds).toEqual(['operator']);
    expect(lens.lensNote).toContain('lens, not authorization');
    expect(lens.absentNote).toContain('render as absent');
  });

  it('projects the administrator lens from a granted administrator role', () => {
    const lens = toOperationsRoleLensView(['administrator', 'expert']);
    expect(lens.administratorLens).toBe(true);
    expect(lens.operatorLens).toBe(false);
    expect(lens.grantedRoleIds).toEqual(['administrator', 'expert']);
  });

  it('dedupes the grant set (facts, never duplicated)', () => {
    const lens = toOperationsRoleLensView(['operator', 'operator', 'owner']);
    expect(lens.grantedRoleIds).toEqual(['operator', 'owner']);
    expect(lens.operatorLens).toBe(true);
  });
});

describe('operations role lens (adversarial — a lens, never authorization)', () => {
  it('an empty grant set projects no lenses — the surface still renders', () => {
    const lens = toOperationsRoleLensView([]);
    expect(lens.operatorLens).toBe(false);
    expect(lens.administratorLens).toBe(false);
    expect(lens.grantedRoleIds).toEqual([]);
    // The absent-capabilities note renders regardless of grants.
    expect(lens.absentNote.length).toBeGreaterThan(0);
  });

  it('foreign roles never fabricate a lens', () => {
    const lens = toOperationsRoleLensView(['marketplace-participant', 'researcher']);
    expect(lens.operatorLens).toBe(false);
    expect(lens.administratorLens).toBe(false);
    expect(lens.grantedRoleIds).toEqual(['marketplace-participant', 'researcher']);
  });

  it('the lens notes are stable, frozen data', () => {
    const first = toOperationsRoleLensView(['operator']);
    const second = toOperationsRoleLensView(['operator']);
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.grantedRoleIds)).toBe(true);
  });
});
