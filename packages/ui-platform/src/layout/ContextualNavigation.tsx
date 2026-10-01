/**
 * ContextualNavigation — the rail navigation of the workspace shell
 * (UXM1.0 §Shared shell: "contextual navigation"). Server-rendered and
 * path-agnostic: the host passes `currentPath` when it knows it (client
 * hosts derive it from usePathname in later work orders); without it no
 * item is marked current — the UI never guesses the active route.
 */

import { cx } from '../shared.js';

export interface NavItem {
  readonly href: string;
  readonly label: string;
}

export interface ContextualNavigationProps {
  /** Ordered nav items (usually the route matrix's core routes). */
  readonly items: readonly NavItem[];
  /** Current path for aria-current marking; omit when unknown. */
  readonly currentPath?: string;
  /** Accessible name of the nav landmark (default "Context navigation"). */
  readonly ariaLabel?: string;
  readonly className?: string;
}

export function ContextualNavigation({
  items,
  currentPath,
  ariaLabel = 'Context navigation',
  className,
}: ContextualNavigationProps) {
  return (
    <nav
      className={cx('arena-context-nav', className)}
      aria-label={ariaLabel}
      data-arena-zone="context-nav"
    >
      <ul className="arena-context-nav__list">
        {items.map((item) => {
          const isCurrent =
            currentPath !== undefined && currentPath === item.href;
          return (
            <li key={item.href} className="arena-context-nav__item">
              <a
                href={item.href}
                className={cx(
                  'arena-context-nav__link',
                  isCurrent && 'arena-context-nav__link--current',
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
