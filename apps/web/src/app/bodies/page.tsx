import type { Metadata } from 'next';

import { RouteStub } from '../_lib/route-stub.js';

export const metadata: Metadata = {
  title: 'Agent Bodies',
};

/** Structural stub (B010 fills the studio): shared shell + route header + standard empty state. */
export default function BodiesPage() {
  return (
    <RouteStub
      route="bodies"
      title="Agent Bodies"
      description="Bodies compose skills, knowledge, tools and policies around a mission. A body is never just a model."
      emptyTitle="No Agent Bodies yet"
      emptyHint="Body versions, possessions and certifications will appear here once the registry is wired in."
    />
  );
}
