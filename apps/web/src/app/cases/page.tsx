import type { Metadata } from 'next';

import { RouteStub } from '../_lib/route-stub.js';

export const metadata: Metadata = {
  title: 'Capability cases',
};

/** Structural stub (B008 fills the workflow): shared shell + route header + standard empty state. */
export default function CasesPage() {
  return (
    <RouteStub
      route="cases"
      title="Capability cases"
      description="Cases define the outcome you need and drive the work that proves it."
      emptyTitle="No capability cases yet"
      emptyHint="When cases exist they appear here with their current stage, evidence and owners."
    />
  );
}
