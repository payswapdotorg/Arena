/**
 * Shell slot placeholders — the five persistent regions of the workspace
 * shell (UXM1.0 §Shared shell). Each slot is a typed, non-interactive
 * placeholder with a documented contract; later work orders replace the
 * placeholder with the real control by passing `headerSlots` to
 * WorkspaceShell:
 *
 *   workspace  — B003 role/context model + B007 cockpit: receives
 *                `workspaces: readonly WorkspaceSummary[]`, `activeId`,
 *                selection handler. Switching workspace is a context
 *                change, never an authorization change.
 *   role       — B003/B007: receives the granted roles for the active
 *                identity and the active role context. Role context
 *                selects projection/emphasis only (UXM1.0 §Design rule);
 *                permission checks stay server-side.
 *   search     — B007: global search/command surface.
 *   jobs       — B014: job/activity indicator (jobs, notifications, SLO
 *                signals).
 *   profile    — B004: identity/session surface (profile, sign-out).
 *
 * Placeholders are deliberately inert (spans, not dead buttons): an
 * interactive control that does nothing would be a worse accessibility
 * contract than an honest labelled placeholder.
 */

import { cx } from '../shared.js';

export const SHELL_SLOT_KINDS = [
  'workspace',
  'role',
  'search',
  'jobs',
  'profile',
] as const;

export type ShellSlotKind = (typeof SHELL_SLOT_KINDS)[number];

/** Common props of every slot placeholder. */
export interface ShellSlotBaseProps {
  /** Override the visible slot label. */
  readonly label?: string;
  readonly className?: string;
}

interface ShellSlotInternalProps {
  readonly kind: ShellSlotKind;
  readonly label: string;
  readonly note: string;
  readonly className?: string | undefined;
}

function ShellSlot({ kind, label, note, className }: ShellSlotInternalProps) {
  return (
    <span
      className={cx('arena-slot', `arena-slot--${kind}`, className)}
      data-arena-slot={kind}
      title={note}
    >
      <span className="arena-slot__marker" aria-hidden="true" />
      <span className="arena-slot__label">{label}</span>
    </span>
  );
}

/** Workspace selector region (contract: B003/B007 fill). */
export function WorkspaceSelectorSlot({
  label = 'Workspace',
  className,
}: ShellSlotBaseProps) {
  return (
    <ShellSlot
      kind="workspace"
      label={label}
      note="Workspace selector — filled by the role/context model (B003) and cockpit (B007)."
      className={className}
    />
  );
}

/** Active role switcher region (contract: B003/B007 fill). */
export function RoleSwitcherSlot({
  label = 'Role',
  className,
}: ShellSlotBaseProps) {
  return (
    <ShellSlot
      kind="role"
      label={label}
      note="Active role switcher — filled by the role/context model (B003) and cockpit (B007). Role is a UI context, never authority."
      className={className}
    />
  );
}

/** Global search / command region (contract: B007 fills). */
export function GlobalSearchSlot({
  label = 'Search',
  className,
}: ShellSlotBaseProps) {
  return (
    <ShellSlot
      kind="search"
      label={label}
      note="Global search and command surface — filled by the cockpit (B007)."
      className={className}
    />
  );
}

/** Jobs and notifications region (contract: B014 fills). */
export function JobsNotificationsSlot({
  label = 'Jobs',
  className,
}: ShellSlotBaseProps) {
  return (
    <ShellSlot
      kind="jobs"
      label={label}
      note="Job and activity indicator — filled by operations UX (B014)."
      className={className}
    />
  );
}

/** Profile / identity region (contract: B004 fills). */
export function ProfileSlot({
  label = 'Profile',
  className,
}: ShellSlotBaseProps) {
  return (
    <ShellSlot
      kind="profile"
      label={label}
      note="Identity and session surface — filled by auth UX (B004)."
      className={className}
    />
  );
}
