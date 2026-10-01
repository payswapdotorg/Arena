/**
 * SkipLink — the first focusable element of every Arena page. Jumps to the
 * main content landmark (id defaults to "main-content", matching
 * WorkspaceShell's main stage). Keyboard users must reach the work surface
 * without tabbing through the whole shell.
 */

import { cx, type CommonProps, testIdProps } from '../shared.js';

export interface SkipLinkProps extends CommonProps {
  /** Selector or id of the skip target (default "#main-content"). */
  readonly target?: string;
  /** Visible link text (default "Skip to main content"). */
  readonly label?: string;
}

export function SkipLink({
  target = '#main-content',
  label = 'Skip to main content',
  className,
  testId,
}: SkipLinkProps) {
  return (
    <a
      href={target}
      className={cx('arena-skip-link', className)}
      {...testIdProps(testId)}
    >
      {label}
    </a>
  );
}
