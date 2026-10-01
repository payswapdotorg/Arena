/**
 * ShellBottomNav — the mobile bottom navigation of the workspace shell
 * (UXM1.0 §Responsive rule: "bottom navigation or compact rail"). Rendered
 * by the shell on narrow screens; hidden by CSS on tablet/desktop. Like
 * ContextualNavigation it never guesses the active route: hosts pass
 * `currentPath` when they know it.
 */

import { cx } from '../shared.js';

import type { NavItem } from './ContextualNavigation.js';

export interface ShellBottomNavProps {
  /** Bottom-nav items — keep to five for thumb reachability. */
  readonly items: readonly NavItem[];
  /** Current path for aria-current marking; omit when unknown. */
  readonly currentPath?: string;
  /** Accessible name of the nav landmark (default "Primary"). */
  readonly ariaLabel?: string;
  readonly className?: string;
}

export function ShellBottomNav({
  items,
  currentPath,
  ariaLabel = 'Primary',
  className,
}: ShellBottomNavProps) {
  return (
    <nav
      className={cx('arena-bottomnav', className)}
      aria-label={ariaLabel}
      data-arena-zone="bottom-nav"
    >
      <ul className="arena-bottomnav__list">
        {items.map((item) => {
          const isCurrent =
            currentPath !== undefined && currentPath === item.href;
          return (
            <li key={item.href} className="arena-bottomnav__item">
              <a
                href={item.href}
                className={cx(
                  'arena-bottomnav__link',
                  isCurrent && 'arena-bottomnav__link--current',
                )}
                {...(isCurrent ? { 'aria-current': 'page' as const } : {})}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
