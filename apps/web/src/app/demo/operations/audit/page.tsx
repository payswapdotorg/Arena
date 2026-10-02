import type { Metadata } from 'next';

import { AuditStreamScreenView, resolveDemoOperationsAudit } from '../../../../operations/index.js';

export const metadata: Metadata = {
  title: 'Operations — audit (demo)',
};

/**
 * /demo/operations/audit — the deterministic demo audit stream (Work
 * Order B014): a REAL A034 chain, verified, visibly labelled per the
 * B006 demo labelling contract.
 */
export default async function DemoOperationsAuditPage() {
  const view = await resolveDemoOperationsAudit();
  return <AuditStreamScreenView view={view} />;
}
