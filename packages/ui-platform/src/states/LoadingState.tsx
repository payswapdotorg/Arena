/**
 * LoadingState — the standard async/loading treatment for every major
 * route (UX1.0 §UX quality gates). Announces politely via a live status
 * role; its pulse animation is disabled under prefers-reduced-motion
 * (see src/styles/components.css).
 */

import { cx, type CommonProps, testIdProps } from '../shared.js';

export interface LoadingStateProps extends CommonProps {
  /** Visible announcement (default "Loading…"). */
  readonly label?: string;
}

export function LoadingState({
  label = 'Loading…',
  className,
  testId,
}: LoadingStateProps) {
  return (
    <div
      className={cx('arena-state', 'arena-state--loading', className)}
      role="status"
      aria-live="polite"
      data-arena-state="loading"
      {...testIdProps(testId)}
    >
      <span className="arena-state__pulse" aria-hidden="true" />
      <span className="arena-state__label">{label}</span>
    </div>
  );
}
