/**
 * RouteStub — the shared shape of a B001 structural stub route: a route
 * header plus the design system's standard empty state. Content arrives
 * with the B008-B014 work orders; loading and error states are already
 * real (root loading.tsx / error.tsx render the design-system states).
 */

import { EmptyState, PageHeader } from '@arena/ui-platform';

export interface RouteStubProps {
  readonly title: string;
  readonly description: string;
  readonly emptyTitle: string;
  readonly emptyHint: string;
  /** Route slug used for stable test targeting. */
  readonly route: string;
}

export function RouteStub({
  title,
  description,
  emptyTitle,
  emptyHint,
  route,
}: RouteStubProps) {
  return (
    <div className="route-stub" data-arena-route={route}>
      <PageHeader title={title} description={description} />
      <EmptyState title={emptyTitle} hint={emptyHint} />
    </div>
  );
}
