/**
 * DeniedState — the standard permission-denied treatment for every major
 * route (UX1.0 §UX quality gates). Deliberately distinct from ErrorState:
 * nothing failed; the active role context simply lacks authority. It names
 * the authority that would be required, because every consequential
 * boundary must expose its authority (UX1.0).
 */

import { cx, type CommonProps, testIdProps } from '../shared.js';

export interface DeniedStateProps extends CommonProps {
  /** Human explanation (default "You do not have access to this area."). */
  readonly message?: string;
  /**
   * The authority this surface requires, e.g. "permission: cases:read"
   * or "role: Operator". Rendered as a compact fact, never as a way to
   * infer authorization from role selection (P1.0).
   */
  readonly requiredAuthority?: string;
}

export function DeniedState({
  message = 'You do not have access to this area.',
  requiredAuthority,
  className,
  testId,
}: DeniedStateProps) {
  return (
    <div
      className={cx('arena-state', 'arena-state--denied', className)}
      role="alert"
      data-arena-state="denied"
      {...testIdProps(testId)}
    >
      <span className="arena-state__lock" aria-hidden="true" />
      <p className="arena-state__title">{message}</p>
      {requiredAuthority === undefined ? null : (
        <p className="arena-state__detail">
          <span className="arena-state__fact-label">Required authority</span>
          <code className="arena-state__fact-value">{requiredAuthority}</code>
        </p>
      )}
    </div>
  );
}
