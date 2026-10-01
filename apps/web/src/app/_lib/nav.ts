/**
 * Core navigation items of the product shell (UXM1.0 §Core routes).
 * Presentation-only: these are shell routes, not domain contracts.
 */

import type { NavItem } from '@arena/ui-platform';

/** Context rail (desktop/tablet) items — the full core route matrix. */
export const CORE_NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/cases', label: 'Cases' },
  { href: '/bodies', label: 'Bodies' },
  { href: '/research', label: 'Research' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/operations', label: 'Operations' },
  { href: '/settings', label: 'Settings' },
];

/** Mobile bottom-nav items — five for thumb reachability (UXM1.0). */
export const MOBILE_NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/cases', label: 'Cases' },
  { href: '/bodies', label: 'Bodies' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/settings', label: 'Settings' },
];
