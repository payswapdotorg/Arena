import type { Metadata } from 'next';

import { JobsListView, resolveDemoOperationsJobs } from '../../../../operations/index.js';

export const metadata: Metadata = {
  title: 'Operations — jobs (demo)',
};

/**
 * /demo/operations/jobs — the deterministic demo jobs list (Work Order
 * B014): five REAL A015 records across the lifecycle vocabulary, visibly
 * labelled per the B006 demo labelling contract.
 */
export default async function DemoOperationsJobsPage() {
  const view = await resolveDemoOperationsJobs();
  return <JobsListView view={view} />;
}
