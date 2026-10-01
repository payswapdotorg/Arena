/**
 * TruthBadge — renders ONE product-truth state kind with its full
 * treatment: unique color, unique marker shape, always-visible label
 * (tokens.ts STATE_KIND_CONFIGS; UXM1.0 §State semantics). The ten kinds
 * are visually distinct on three independent channels so no two can ever
 * render as the same "AI result" badge. Unknown kinds throw (closed
 * vocabulary).
 */

import { stateKindConfig, type StateKind } from '../tokens/tokens.js';
import { cx, type CommonProps, testIdProps } from '../shared.js';

export interface TruthBadgeProps extends CommonProps {
  /** Which product-truth kind this badge asserts. */
  readonly kind: StateKind;
}

export function TruthBadge({ kind, className, testId }: TruthBadgeProps) {
  const config = stateKindConfig(kind);
  return (
    <span
      className={cx('arena-truth', `arena-truth--${kind}`, className)}
      data-arena-truth={kind}
      title={config.meaning}
      {...testIdProps(testId)}
    >
      <span
        className={cx('arena-truth__marker', `arena-truth__marker--${config.marker}`)}
        aria-hidden="true"
      />
      <span className="arena-truth__label">{config.label}</span>
    </span>
  );
}
