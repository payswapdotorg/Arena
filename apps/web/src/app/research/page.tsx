import type { Metadata } from 'next';

import { RouteStub } from '../_lib/route-stub.js';

export const metadata: Metadata = {
  title: 'Research',
};

/** Structural stub (B012 fills evaluation/research UX): shared shell + route header + standard empty state. */
export default function ResearchPage() {
  return (
    <RouteStub
      route="research"
      title="Research"
      description="Benchmark bodies and substrates, study capability lift, and publish reusable research artifacts."
      emptyTitle="No research yet"
      emptyHint="Experiments, benchmark suites and datasets will appear here once the research queue is wired in."
    />
  );
}
