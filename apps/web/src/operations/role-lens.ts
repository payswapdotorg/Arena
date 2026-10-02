/**
 * Operations role lens (Work Order B014; apps/web/src/operations).
 * Pure projection layer — no React, no I/O.
 *
 * Role context is a LENS, not authorization (the B007 cockpit role-lens
 * pattern): the granted role ids of the VALIDATED session are FACTS the
 * surface renders to frame what the visitor is looking at — the operator
 * lens frames jobs/SLO/quota health, the administrator lens frames audit
 * scope — while every permission decision stays server-side and
 * policy-driven. The lens NEVER gates rendering and NEVER implies
 * authority.
 *
 * Administrator-only actions that do not exist yet render as ABSENT —
 * never as disabled buttons implying a feature (the B014 product truth).
 */

/** The role ids that carry an operations lens (the closed B003 registry subset). */
const OPERATIONS_LENS_ROLE_IDS = Object.freeze(['operator', 'administrator'] as const);

/** The note carried on every lens rendering: a lens frames, it never authorizes. */
export const OPERATIONS_LENS_NOTE =
  'Role context is a lens, not authorization: the granted roles below frame what this surface emphasizes (operators see job, SLO and quota health; administrators see audit scope). Authorization itself is decided server-side by the permission policy — never by this view.';

/** Administrator-only actions that do not exist yet render as absent, never as disabled controls. */
export const OPERATIONS_ABSENT_CAPABILITIES_NOTE =
  'Administrator-only operations (audit-policy editing, quota changes, provider rewiring) do not exist in the product yet — so they render as absent. Nothing here is disabled, because a disabled control would imply a feature that exists.';

/** The operations lens view: the granted-role facts + the lens framing. */
export interface OperationsRoleLensView {
  /** The granted role ids of the validated session (facts, sorted + deduped as granted). */
  readonly grantedRoleIds: readonly string[];
  readonly operatorLens: boolean;
  readonly administratorLens: boolean;
  readonly lensNote: string;
  readonly absentNote: string;
}

/**
 * Project granted role ids into the operations lens view. Pure and total:
 * any role set (including none) projects — an empty grant set renders the
 * lens section with no lenses, never a fabricated role and never a
 * blocked surface (the lens never gates rendering).
 */
export function toOperationsRoleLensView(grantedRoleIds: readonly string[]): OperationsRoleLensView {
  const granted = Object.freeze([...new Set(grantedRoleIds)]);
  return Object.freeze({
    grantedRoleIds: granted,
    operatorLens: granted.includes(OPERATIONS_LENS_ROLE_IDS[0] ?? 'operator'),
    administratorLens: granted.includes(OPERATIONS_LENS_ROLE_IDS[1] ?? 'administrator'),
    lensNote: OPERATIONS_LENS_NOTE,
    absentNote: OPERATIONS_ABSENT_CAPABILITIES_NOTE,
  } satisfies OperationsRoleLensView);
}
