/**
 * DemoDataBadge — the always-on label for demo-sourced data. Demo state
 * must be visibly labeled and can never be mistaken for
 * customer-authoritative state (AGENTS.md "Replay / demo", UX1.0
 * §Demo mode). Rendered from the neutral "demo" truth treatment so it
 * reads as non-authoritative next to real product-truth badges.
 */

import { stateKindConfig } from '../tokens/tokens.js';
import { cx, type CommonProps, testIdProps } from '../shared.js';

export interface DemoDataBadgeProps extends CommonProps {
  /** Extra note appended to the label, e.g. "deterministic seed". */
  readonly note?: string;
}

export function DemoDataBadge({ note, className, testId }: DemoDataBadgeProps) {
  const config = stateKindConfig('demo');
  return (
    <span
      className={cx('arena-truth', 'arena-truth--demo', className)}
      data-arena-state="demo"
      data-arena-truth="demo"
      title={config.meaning}
      {...testIdProps(testId)}
    >
      <span className="arena-truth__marker arena-truth__marker--tag" aria-hidden="true" />
      <span className="arena-truth__label">Demo data</span>
      {note === undefined ? null : (
        <span className="arena-truth__note">{note}</span>
      )}
    </span>
  );
}
