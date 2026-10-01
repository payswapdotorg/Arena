/**
 * EmptyState — the standard "no data yet" treatment for every major route
 * (UX1.0 §UX quality gates). An empty state is NOT an error: it explains
 * what will appear here and, when useful, offers the one primary action
 * that fills the emptiness.
 */

import type { ReactNode } from 'react';

import { cx, type CommonProps, testIdProps } from '../shared.js';

export interface EmptyStateProps extends CommonProps {
  /** What is empty, e.g. "No capability cases yet". */
  readonly title: string;
  /** What will appear here once data exists. */
  readonly hint?: string;
  /** The single primary action that fills this emptiness, if any. */
  readonly action?: ReactNode;
}

export function EmptyState({
  title,
  hint,
  action,
  className,
  testId,
}: EmptyStateProps) {
  return (
    <div
      className={cx('arena-state', 'arena-state--empty', className)}
      data-arena-state="empty"
      {...testIdProps(testId)}
    >
      <span className="arena-state__well" aria-hidden="true" />
      <p className="arena-state__title">{title}</p>
      {hint === undefined ? null : (
        <p className="arena-state__detail">{hint}</p>
      )}
      {action === undefined ? null : (
        <div className="arena-state__action">{action}</div>
      )}
    </div>
  );
}
