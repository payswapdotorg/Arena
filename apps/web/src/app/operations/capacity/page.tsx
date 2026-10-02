import type { Metadata } from 'next';

import {
  CapacityPanelView,
  OperationsAuthRequiredView,
  resolveOperationsCapacityExperience,
} from '../../../operations/index.js';

export const metadata: Metadata = {
  title: 'Operations — capacity',
};

/**
 * /operations/capacity — the free-tier capacity panel mount (Work Order
 * B014). A mount point, not logic: the composition lives in
 * apps/web/src/operations (resolveOperationsCapacityExperience). Fail
 * closed without a session; capacity postures render explicitly with
 * visible ceilings and the no-billable-fallback guarantee — never a
 * silent degradation to unlimited.
 */
export default async function OperationsCapacityPage() {
  const experience = await resolveOperationsCapacityExperience();
  if (experience.kind === 'auth-required') {
    return <OperationsAuthRequiredView />;
  }
  return <CapacityPanelView view={experience.view} />;
}
