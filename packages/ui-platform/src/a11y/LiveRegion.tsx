/**
 * LiveRegion — the standard async-status announcement container. Polite by
 * default (does not interrupt); assertive only for consequences that must
 * interrupt (e.g. a destructive action completing).
 */

import type { ReactNode } from 'react';

import { cx, type CommonProps, testIdProps } from '../shared.js';

export interface LiveRegionProps extends CommonProps {
  /** Announcement politeness; "assertive" maps to role="alert". */
  readonly politeness?: 'polite' | 'assertive';
  /** Whether re-announcements replace the whole region (default true). */
  readonly atomic?: boolean;
  readonly children?: ReactNode;
}

export function LiveRegion({
  politeness = 'polite',
  atomic = true,
  children,
  className,
  testId,
}: LiveRegionProps) {
  return (
    <div
      className={cx('arena-live-region', className)}
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      aria-atomic={atomic}
      data-arena-live={politeness}
      {...testIdProps(testId)}
    >
      {children}
    </div>
  );
}
