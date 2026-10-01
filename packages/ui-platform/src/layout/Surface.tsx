/**
 * Surface — the base content panel of the Arena stage: a bordered,
 * optionally elevated card with generous padding. All depth in the product
 * goes through the elevation token scale.
 */

import type { ReactNode } from 'react';

import { ELEVATION } from '../tokens/tokens.js';
import { cx, type CommonProps, testIdProps } from '../shared.js';

export type SurfaceElevation = keyof typeof ELEVATION;

export interface SurfaceProps extends CommonProps {
  /** Elevation level (default "flat"). */
  readonly elevation?: SurfaceElevation;
  /** Suppress default padding for edge-to-edge content. */
  readonly flush?: boolean;
  readonly children: ReactNode;
}

export function Surface({
  elevation = 'flat',
  flush = false,
  children,
  className,
  testId,
}: SurfaceProps) {
  return (
    <div
      className={cx(
        'arena-surface',
        `arena-surface--${elevation}`,
        flush && 'arena-surface--flush',
        className,
      )}
      data-arena-elevation={elevation}
      {...testIdProps(testId)}
    >
      {children}
    </div>
  );
}
