/**
 * PageHeader — the top of every work surface: h1 title, optional plain
 *-language description, and an actions row. Pages keep exactly ONE
 * primary action (see PrimaryAction); secondary actions sit beside it.
 */

import type { ReactNode } from 'react';

import { cx, type CommonProps, testIdProps } from '../shared.js';

export interface PageHeaderProps extends CommonProps {
  readonly title: string;
  /** One-sentence description of the surface. */
  readonly description?: string;
  /** Page-level actions (primary + secondary). */
  readonly actions?: ReactNode;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
  testId,
}: PageHeaderProps) {
  return (
    <header
      className={cx('arena-page-header', className)}
      {...testIdProps(testId)}
    >
      <h1 className="arena-page-header__title">{title}</h1>
      {description === undefined ? null : (
        <p className="arena-page-header__description">{description}</p>
      )}
      {actions === undefined ? null : (
        <div className="arena-page-header__actions">{actions}</div>
      )}
    </header>
  );
}
