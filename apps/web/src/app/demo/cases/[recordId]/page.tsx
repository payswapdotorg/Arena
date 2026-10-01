/**
 * `/demo/cases/[recordId]` — the demo-mode case detail (Work Order B008;
 * issue #80). Mount point, wiring only: fail-honest demo composition
 * (canonical reads through the demo read session; the guided path runs
 * for CANONICAL cases started in the demo tenant; the seeded narrative
 * corpus record renders as labelled narrative state with an honest note
 * that the guided flow starts a NEW canonical case instead).
 */

import { EmptyState, PageHeader } from '@arena/ui-platform';
import { CaseDetailView } from '../../../../capability/index.js';
import { FlowErrorNotice } from '../../../../capability/gate.js';
import { resolveDemoCaseDetail } from '../../../../capability/case-routes.js';

export interface DemoCaseDetailPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
  /** Explicit query state (`?role=` lens; `?flowError=` typed rejection). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

export default async function DemoCaseDetailPage({
  params,
  searchParams,
}: DemoCaseDetailPageProps) {
  const resolvedParams = params === undefined ? undefined : await params;
  const rawRecordId = firstValue(resolvedParams?.['recordId']);
  const recordId =
    rawRecordId !== undefined ? decodeURIComponent(rawRecordId) : undefined;
  const resolvedQuery = searchParams === undefined ? undefined : await searchParams;
  const requestedRole = firstValue(resolvedQuery?.['role']);
  const flowError = firstValue(resolvedQuery?.['flowError']);
  if (recordId === undefined || recordId.length === 0) {
    return (
      <div data-arena-route="case-detail" data-arena-mode="demo">
        <PageHeader title="Capability case (demo)" description="One case, end to end." />
        <EmptyState
          title="No case id in this address"
          hint="Nothing is fabricated to fill the space — open the demo case list and enter a case from there."
        />
      </div>
    );
  }
  const view = await resolveDemoCaseDetail(
    recordId,
    requestedRole !== undefined && requestedRole.length > 0 ? requestedRole : undefined,
  );
  if ('unreadable' in view) {
    return (
      <div data-arena-route="case-detail" data-arena-mode="demo" data-arena-case-unreadable="true">
        <PageHeader title="Capability case (demo)" description="One case, end to end." />
        <EmptyState
          title="This case could not be read"
          hint={`The canonical read failed (fail closed): ${view.message}`}
        />
      </div>
    );
  }
  return (
    <>
      <FlowErrorNotice code={flowError} />
      <CaseDetailView view={view} />
    </>
  );
}
