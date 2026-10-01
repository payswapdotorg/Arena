import type { Metadata } from 'next';

import { RouteStub } from '../_lib/route-stub.js';

export const metadata: Metadata = {
  title: 'Operations',
};

/** Structural stub (B014 fills operations UX): shared shell + route header + standard empty state. */
export default function OperationsPage() {
  return (
    <RouteStub
      route="operations"
      title="Operations"
      description="Jobs, environments, SLOs, quotas and audit — the operational health of the workspace."
      emptyTitle="No operations data yet"
      emptyHint="Job health, capacity and audit views will appear here once the read model is wired in."
    />
  );
}
