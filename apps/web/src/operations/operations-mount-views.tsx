/**
 * The honest non-surface renders for the operations route mounts (Work
 * Order B014; apps/web/src/operations): the auth-required notice (fail
 * closed — never an anonymous surface) and the honest not-found detail
 * states (never a fabricated record). SYNC presentational components.
 */

import { DeniedState, EmptyState, PageHeader } from '@arena/ui-platform';

/** `/operations/**` without an authenticated session: fail closed, honestly. */
export function OperationsAuthRequiredView() {
  return (
    <div
      className="operations-surface operations-surface--auth-required"
      data-arena-route="operations"
      data-arena-surface-auth="required"
    >
      <PageHeader
        title="Operations"
        description="Jobs, SLOs, quotas and audit — the operational health of the workspace, for authenticated operators and administrators."
      />
      <DeniedState
        message="The operations surface requires an authenticated workspace session. Sessions are validated server-side (fail closed) — there is no anonymous operations view."
        requiredAuthority="authenticated session (B004 session boundary)"
      />
      <p className="operations-surface__auth-hint">
        <a href="/">Go to the Arena home surface</a> to sign in, or explore the{' '}
        <a href="/demo/operations">deterministic demo operations surface</a> (visibly labelled demo
        state).
      </p>
    </div>
  );
}

/** A detail route whose record does not exist — an honest empty state. */
export function OperationsNotFoundView(props: {
  readonly title: string;
  readonly recordId: string;
  readonly hint: string;
}) {
  return (
    <div
      className="operations-surface operations-surface--not-found"
      data-arena-route="operations-detail"
      data-arena-detail-status="not-found"
    >
      <PageHeader title={props.title} description={`No record exists for ${props.recordId}.`} />
      <EmptyState title="Nothing to render" hint={props.hint} />
      <p className="operations-surface__failure-hint">
        <a href="/operations">Back to the operations surface</a>
      </p>
    </div>
  );
}
