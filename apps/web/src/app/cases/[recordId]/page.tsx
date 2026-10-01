/**
 * `/cases/[recordId]` — the case detail (Work Order B008; issue #80;
 * UXM1.0 §Core routes `/cases/:id`). Async session-aware server
 * component: fail-closed session probe → the role-lensed case detail
 * read THROUGH the B005 read-API boundary, with the guided
 * capability-development path (done/current/upcoming strictly from the
 * canonical lifecycle), the §5 requirement groups, the append-only
 * lifecycle history, and honest dead-ends. A typed guided-action
 * rejection (?flowError=) renders verbatim.
 */

import { EmptyState, PageHeader } from '@arena/ui-platform';
import { CaseDetailView } from '../../../capability/index.js';
import { CapabilitySignInGate, FlowErrorNotice } from '../../../capability/gate.js';
import { resolveSessionCaseDetail } from '../../../capability/case-routes.js';

export interface CaseDetailPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
  /** Explicit query state (`?role=` lens; `?flowError=` typed rejection). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

export default async function CaseDetailPage({ params, searchParams }: CaseDetailPageProps) {
  const resolvedParams = params === undefined ? undefined : await params;
  const rawRecordId = firstValue(resolvedParams?.['recordId']);
  const recordId =
    rawRecordId !== undefined ? decodeURIComponent(rawRecordId) : undefined;
  const resolvedQuery = searchParams === undefined ? undefined : await searchParams;
  const requestedRole = firstValue(resolvedQuery?.['role']);
  const flowError = firstValue(resolvedQuery?.['flowError']);
  if (recordId === undefined || recordId.length === 0) {
    return (
      <div data-arena-route="case-detail">
        <PageHeader title="Capability case" description="One case, end to end." />
        <EmptyState
          title="No case id in this address"
          hint="Nothing is fabricated to fill the space — open the case list and enter a case from there."
        />
      </div>
    );
  }
  const experience = await resolveSessionCaseDetail(
    recordId,
    requestedRole !== undefined && requestedRole.length > 0
      ? { requestedRoleId: requestedRole }
      : {},
  );
  if (experience.kind === 'gate') {
    return <CapabilitySignInGate code={experience.code} surface="case detail" />;
  }
  if (experience.kind === 'unreadable') {
    return (
      <div data-arena-route="case-detail" data-arena-case-unreadable="true">
        <PageHeader title="Capability case" description="One case, end to end." />
        <EmptyState
          title="This case could not be read"
          hint={`The canonical read failed (fail closed): ${experience.message}`}
        />
      </div>
    );
  }
  return (
    <>
      <FlowErrorNotice code={flowError} />
      <CaseDetailView view={experience.view} />
    </>
  );
}
