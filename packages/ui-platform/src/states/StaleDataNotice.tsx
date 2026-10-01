/**
 * StaleDataNotice — the standard stale-data treatment (UX1.0 §UX quality
 * gates, "stale-data states where applicable"). A quiet status
 * announcement: data is presented, but the view says how old it is so a
 * user never unknowingly acts on a stale projection.
 */

import { cx, type CommonProps, testIdProps } from '../shared.js';

export interface StaleDataNoticeProps extends CommonProps {
  /** When the data was last refreshed (pre-formatted by the caller). */
  readonly asOf?: string;
  /** Extra context, e.g. why a refresh is pending. */
  readonly note?: string;
}

export function StaleDataNotice({
  asOf,
  note,
  className,
  testId,
}: StaleDataNoticeProps) {
  return (
    <div
      className={cx('arena-state', 'arena-state--stale', className)}
      role="status"
      data-arena-state="stale"
      {...testIdProps(testId)}
    >
      <p className="arena-state__detail">
        {asOf === undefined
          ? 'This view may be out of date.'
          : `This view may be out of date — last refreshed ${asOf}.`}
        {note === undefined ? null : ` ${note}`}
      </p>
    </div>
  );
}
