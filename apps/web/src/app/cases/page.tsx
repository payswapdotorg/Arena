import type { Metadata } from 'next';

import { CaseListView } from '../../capability/index.js';
import { CapabilitySignInGate } from '../../capability/gate.js';
import { resolveSessionCaseList } from '../../capability/case-routes.js';

export const metadata: Metadata = {
  title: 'Capability cases',
};

/**
 * `/cases` — the case list (Work Order B008; issue #80 route-matrix row:
 * UXM1.0 §Core routes). An async session-aware server component: the
 * browser session is probed FIRST through the B004 boundary (fail closed
 * — a typed AUTH_* outcome renders the sign-in gate, never an anonymous
 * case list); the authenticated visitor gets the role-lensed list of
 * canonical + narrative case cards, read THROUGH the B005 read-API
 * boundary. Explicit `?role=` query state selects the lens (a lens,
 * never an authorization).
 */

export interface CasesPageProps {
  /** Explicit query state (`?role=` selects the active role lens). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CasesPage({ searchParams }: CasesPageProps) {
  const resolved = searchParams === undefined ? undefined : await searchParams;
  const requested = resolved?.['role'];
  const requestedRole =
    typeof requested === 'string'
      ? requested
      : Array.isArray(requested)
        ? requested[0]
        : undefined;
  const experience = await resolveSessionCaseList(
    requestedRole !== undefined && requestedRole.length > 0
      ? { requestedRoleId: requestedRole }
      : {},
  );
  if (experience.kind === 'gate') {
    return <CapabilitySignInGate code={experience.code} surface="case list" />;
  }
  return <CaseListView view={experience.view} />;
}
