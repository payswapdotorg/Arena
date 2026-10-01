/**
 * @arena/ui-platform — the Arena design system (Work Order B001).
 *
 * Presentation-only: this package imports NOTHING from @arena/* domain
 * packages (boundary layer rules hold — it sits as a domain-layer package
 * that only depends on react/react-dom). Canonical semantics stay in the
 * domain; this package projects them visually.
 *
 * Public surface:
 *   tokens     — design tokens + the 10-kind product-truth state vocabulary
 *   states     — Loading/Error/Empty/Denied/Demo/Stale states + TruthBadge
 *   a11y       — SkipLink, LiveRegion, FocusBoundary, focus/reduced-motion/
 *                aria helpers
 *   layout     — WorkspaceShell, Surface, PageHeader, PrimaryAction,
 *                ContextualNavigation, ShellBottomNav
 *   shell      — typed slot placeholders for the persistent shell regions
 *
 * Stylesheets (import from the host app):
 *   '@arena/ui-platform/tokens.css'      — generated CSS custom properties
 *   '@arena/ui-platform/components.css'  — component + responsive styles
 */

export * from './tokens/tokens.js';
export * from './states/LoadingState.js';
export * from './states/ErrorState.js';
export * from './states/EmptyState.js';
export * from './states/DeniedState.js';
export * from './states/DemoDataBadge.js';
export * from './states/StaleDataNotice.js';
export * from './states/TruthBadge.js';
export * from './a11y/SkipLink.js';
export * from './a11y/LiveRegion.js';
export * from './a11y/FocusBoundary.js';
export * from './a11y/focus.js';
export * from './a11y/reduced-motion.js';
export * from './a11y/aria.js';
export * from './layout/Surface.js';
export * from './layout/PageHeader.js';
export * from './layout/PrimaryAction.js';
export * from './layout/ContextualNavigation.js';
export * from './layout/ShellBottomNav.js';
export * from './layout/WorkspaceShell.js';
export * from './shell/slots.js';

import { TOKENS_VERSION } from './tokens/tokens.js';

/** Version of this package's token surface. */
export const UI_PLATFORM_VERSION = TOKENS_VERSION;
