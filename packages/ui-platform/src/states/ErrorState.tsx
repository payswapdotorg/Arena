/**
 * ErrorState — the standard failure treatment for every major route
 * (UX1.0 §UX quality gates). Loud (role="alert") but calm in tone; an
 * optional `action` renders the retry/escape route.
 */

import type { ReactNode } from 'react';

import { cx, type CommonProps, testIdProps } from '../shared.js';

export interface ErrorStateProps extends CommonProps {
  /** Failure heading (default "Something went wrong"). */
  readonly title?: string;
  /** What happened, in plain language; shown under the title. */
  readonly detail?: string;
  /** Escape/retry affordance (e.g. a Try again button). */
  readonly action?: ReactNode;
}

export function ErrorState({
  title = 'Something went wrong',
  detail,
  action,
  className,
  testId,
}: ErrorStateProps) {
  return (
    <div
      className={cx('arena-state', 'arena-state--error', className)}
      role="alert"
      data-arena-state="error"
      {...testIdProps(testId)}
    >
      <p className="arena-state__title">{title}</p>
      {detail === undefined ? null : (
        <p className="arena-state__detail">{detail}</p>
      )}
      {action === undefined ? null : (
        <div className="arena-state__action">{action}</div>
      )}
    </div>
  );
}
