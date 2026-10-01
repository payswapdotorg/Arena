/**
 * FocusBoundary — the presentational half of focus trapping. Renders a
 * dialog-role region with labelled start/end focus sentinels; the pure
 * tab-order logic lives in ./focus.ts and the interactive wiring (event
 * handlers) lands with the client runtime (Work Order B018). The boundary
 * semantics (role="dialog", aria-modal, sentinels) are stable now so
 * sheet/inspector surfaces can adopt them without markup churn.
 */

import type { ReactNode } from 'react';

import { cx, type CommonProps, testIdProps } from '../shared.js';

export interface FocusBoundaryProps extends CommonProps {
  /** Accessible name of the bounded region. */
  readonly label: string;
  /** Whether the region is modal for assistive tech (default true). */
  readonly modal?: boolean;
  readonly children: ReactNode;
}

export function FocusBoundary({
  label,
  modal = true,
  children,
  className,
  testId,
}: FocusBoundaryProps) {
  return (
    <div
      className={cx('arena-focus-boundary', className)}
      role="dialog"
      aria-modal={modal}
      aria-label={label}
      data-arena-focus-boundary="true"
      {...testIdProps(testId)}
    >
      <span
        className="arena-focus-boundary__sentinel"
        data-arena-focus-sentinel="start"
        tabIndex={-1}
        aria-hidden="true"
      />
      {children}
      <span
        className="arena-focus-boundary__sentinel"
        data-arena-focus-sentinel="end"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
