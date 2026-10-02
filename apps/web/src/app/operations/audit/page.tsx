import type { Metadata } from 'next';

import {
  AuditStreamScreenView,
  OperationsAuthRequiredView,
  resolveOperationsAuditExperience,
} from '../../../operations/index.js';

export const metadata: Metadata = {
  title: 'Operations — audit',
};

/**
 * /operations/audit — the audit stream mount (Work Order B014). A mount
 * point, not logic: the composition lives in apps/web/src/operations
 * (resolveOperationsAuditExperience). Fail closed without a session; the
 * stream renders the append-only evidence the record store actually
 * holds — never edited, never re-sorted, never a fabricated trail.
 */
export default async function OperationsAuditPage() {
  const experience = await resolveOperationsAuditExperience();
  if (experience.kind === 'auth-required') {
    return <OperationsAuthRequiredView />;
  }
  return <AuditStreamScreenView view={experience.view} />;
}
