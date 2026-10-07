import type { Metadata } from 'next';

import { resolveDevelopersObservabilityExperience } from '../../../developers/index.js';

export const metadata: Metadata = {
  title: 'Escalation observability',
};

/**
 * /developers/observability — the per-client-app escalation observability
 * dashboard: lifecycle state, validation status, SLA deadlines and
 * cost/fee projections (Work Order C017). Fail closed.
 */
export default async function DevelopersObservabilityPage() {
  const experience = await resolveDevelopersObservabilityExperience();
  return experience.view;
}
