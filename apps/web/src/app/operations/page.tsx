import type { Metadata } from 'next';

import {
  OperationsAuthRequiredView,
  OperationsHomeView,
  resolveOperationsExperience,
} from '../../operations/index.js';

export const metadata: Metadata = {
  title: 'Operations',
};

/**
 * /operations — the session-aware operations surface mount (Work Order
 * B014). A mount point, not logic: the composition lives in
 * apps/web/src/operations (resolveOperationsExperience). Fail closed —
 * an unauthenticated visitor gets the auth-required notice, never an
 * anonymous surface. Jobs, SLOs, capacity and audit render their honest
 * states: recorded lifecycle facts, measured verdicts with windows,
 * fail-closed quotas with no billable fallback, and append-only
 * evidence.
 */
export default async function OperationsPage() {
  const experience = await resolveOperationsExperience();
  if (experience.kind === 'auth-required') {
    return <OperationsAuthRequiredView />;
  }
  return <OperationsHomeView view={experience.view} />;
}
