/**
 * WorkspaceShell — the Arena workspace shell (UX1.0 §Shell Level 1/2,
 * UXM1.0 §Shared shell + §Responsive rule).
 *
 * Zone model:
 *   desktop (>= 1024px): context rail | main stage | inspector (3-zone grid)
 *   tablet  (768-1023px): collapsible rail above the stage, inspector as sheet
 *   mobile  (< 768px): top bar + stage, inspector as bottom sheet,
 *                      bottom navigation instead of the rail
 *
 * The shell is server-renderable and JavaScript-free: the tablet rail
 * collapses through a native <details> element (its summary is hidden on
 * desktop), and every zone switch is pure CSS. All five persistent shell
 * regions (workspace selector, role switcher, global search, jobs/
 * notifications, profile) render typed placeholder slots that later work
 * orders fill — the shell itself never invents workspace, role or
 * permission semantics (P1.0: role is a UI context, never authority).
 */

import type { ReactNode } from 'react';

import { SkipLink } from '../a11y/SkipLink.js';
import { cx } from '../shared.js';
import {
  GlobalSearchSlot,
  JobsNotificationsSlot,
  ProfileSlot,
  RoleSwitcherSlot,
  WorkspaceSelectorSlot,
} from '../shell/slots.js';

/** Overrides for the five persistent shell regions. */
export interface WorkspaceShellHeaderSlots {
  readonly workspace?: ReactNode;
  readonly role?: ReactNode;
  readonly search?: ReactNode;
  readonly jobs?: ReactNode;
  readonly profile?: ReactNode;
}

export interface WorkspaceShellProps {
  /** The main stage (page content). */
  readonly children: ReactNode;
  /** Context rail content (desktop) / collapsible panel (tablet); omitted on mobile. */
  readonly rail?: ReactNode;
  /** Inspector content: right column (desktop), sheet (tablet/mobile). */
  readonly inspector?: ReactNode;
  /** Mobile bottom navigation (e.g. <ShellBottomNav …/>); hidden on larger screens. */
  readonly bottomNav?: ReactNode;
  /** Overrides for the persistent shell regions; defaults are placeholder slots. */
  readonly headerSlots?: WorkspaceShellHeaderSlots;
  /** Id of the main landmark (default "main-content"; SkipLink targets it). */
  readonly mainId?: string;
  readonly className?: string;
}

function ArenaBrand(): ReactNode {
  return (
    <span className="arena-brand" data-arena-brand="true">
      <svg
        className="arena-brand__mark"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        aria-hidden="true"
        focusable="false"
      >
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" />
      </svg>
      <span className="arena-brand__name">Arena</span>
    </span>
  );
}

export function WorkspaceShell({
  children,
  rail,
  inspector,
  bottomNav,
  headerSlots,
  mainId = 'main-content',
  className,
}: WorkspaceShellProps) {
  const hasInspector = inspector !== undefined;
  return (
    <div className={cx('arena-shell', className)} data-arena-shell="true">
      <SkipLink target={`#${mainId}`} />
      <header className="arena-shell__topbar" data-arena-zone="topbar">
        <ArenaBrand />
        <div className="arena-shell__slots" data-arena-zone="shell-slots">
          <div className="arena-shell__slot" data-arena-slot-region="workspace">
            {headerSlots?.workspace ?? <WorkspaceSelectorSlot />}
          </div>
          <div className="arena-shell__slot" data-arena-slot-region="role">
            {headerSlots?.role ?? <RoleSwitcherSlot />}
          </div>
          <div className="arena-shell__slot" data-arena-slot-region="search">
            {headerSlots?.search ?? <GlobalSearchSlot />}
          </div>
          <div className="arena-shell__slot" data-arena-slot-region="jobs">
            {headerSlots?.jobs ?? <JobsNotificationsSlot />}
          </div>
          <div className="arena-shell__slot" data-arena-slot-region="profile">
            {headerSlots?.profile ?? <ProfileSlot />}
          </div>
        </div>
      </header>
      <div
        className="arena-shell__body"
        data-arena-rail={rail !== undefined ? 'true' : 'false'}
        data-arena-inspector={hasInspector ? 'true' : 'false'}
      >
        {rail === undefined ? null : (
          <aside
            className="arena-shell__rail"
            aria-label="Context rail"
            data-arena-zone="rail"
          >
            <details className="arena-shell__rail-details" open>
              <summary className="arena-shell__rail-summary">Context</summary>
              <div className="arena-shell__rail-content">{rail}</div>
            </details>
          </aside>
        )}
        <main
          id={mainId}
          className="arena-shell__main"
          tabIndex={-1}
          data-arena-zone="main"
        >
          {children}
        </main>
        {inspector === undefined ? null : (
          <section
            className="arena-shell__inspector"
            aria-label="Inspector"
            data-arena-zone="inspector"
          >
            {inspector}
          </section>
        )}
      </div>
      {bottomNav === undefined ? null : bottomNav}
    </div>
  );
}
