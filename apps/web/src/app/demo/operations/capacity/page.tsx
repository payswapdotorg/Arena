import type { Metadata } from 'next';

import { CapacityPanelView, resolveDemoOperationsCapacity } from '../../../../operations/index.js';

export const metadata: Metadata = {
  title: 'Operations — capacity (demo)',
};

/**
 * /demo/operations/capacity — the deterministic demo capacity panel
 * (Work Order B014): all four closed FT2.0 postures with visible
 * ceilings and the fail-closed guarantee, visibly labelled per the B006
 * demo labelling contract.
 */
export default async function DemoOperationsCapacityPage() {
  const view = await resolveDemoOperationsCapacity();
  return <CapacityPanelView view={view} />;
}
