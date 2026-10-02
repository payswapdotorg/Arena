import type { Metadata } from 'next';

import {
  JobsListView,
  OperationsAuthRequiredView,
  resolveOperationsJobsExperience,
} from '../../../operations/index.js';

export const metadata: Metadata = {
  title: 'Operations — jobs',
};

/**
 * /operations/jobs — the jobs list mount (Work Order B014). A mount
 * point, not logic: the composition lives in apps/web/src/operations
 * (resolveOperationsJobsExperience). Fail closed without a session; the
 * list renders the job records the store actually holds — never an
 * optimistic completion, never a fabricated row.
 */
export default async function OperationsJobsPage() {
  const experience = await resolveOperationsJobsExperience();
  if (experience.kind === 'auth-required') {
    return <OperationsAuthRequiredView />;
  }
  return <JobsListView view={experience.view} />;
}
