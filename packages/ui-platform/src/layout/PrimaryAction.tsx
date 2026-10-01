/**
 * PrimaryAction — THE one meaningful primary action of a surface (UX1.0:
 * "one primary action at a time"). Renders as an anchor when `href` is
 * given (navigation) and as a button otherwise (in-page action). A page
 * should not render two of these; the landing tests enforce that
 * discipline for the first-run experience.
 */

import type { ReactNode } from 'react';

import { cx, type CommonProps, testIdProps } from '../shared.js';

export interface PrimaryActionProps extends CommonProps {
  /** Destination; when present the action renders as an anchor. */
  readonly href?: string;
  readonly children: ReactNode;
}

export function PrimaryAction({
  href,
  children,
  className,
  testId,
}: PrimaryActionProps) {
  const classes = cx('arena-primary-action', className);
  if (href === undefined) {
    return (
      <button
        type="button"
        className={classes}
        data-arena-primary="true"
        {...testIdProps(testId)}
      >
        {children}
      </button>
    );
  }
  return (
    <a
      href={href}
      className={classes}
      data-arena-primary="true"
      {...testIdProps(testId)}
    >
      {children}
    </a>
  );
}
