import type { Metadata } from 'next';

import { RouteStub } from '../_lib/route-stub.js';

export const metadata: Metadata = {
  title: 'Marketplace',
};

/** Structural stub (B013 fills marketplace UX): shared shell + route header + standard empty state. */
export default function MarketplacePage() {
  return (
    <RouteStub
      route="marketplace"
      title="Marketplace"
      description="Discover artifacts, expertise and datasets — with verification, provenance, rights and compatibility in the open."
      emptyTitle="No marketplace listings yet"
      emptyHint="Artifact and expert listings will appear here, clearly separated from your operational state."
    />
  );
}
