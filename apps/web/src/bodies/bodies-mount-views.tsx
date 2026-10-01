/**
 * The honest non-studio renders for the bodies route mounts (Work Order
 * B010; issue #82; apps/web/src/bodies): the auth-required notice (fail
 * closed — never an anonymous studio) and the honest detail failure
 * states (not-found / wrong-kind / unreadable — never a fabricated body).
 * SYNC presentational components.
 */

import { DeniedState, EmptyState, PageHeader } from '@arena/ui-platform';

/** `/bodies` + `/bodies/:id` without an authenticated session: fail closed, honestly. */
export function BodiesAuthRequiredView() {
  return (
    <div className="body-studio body-studio--auth-required" data-arena-route="bodies" data-arena-studio-auth="required">
      <PageHeader
        title="Agent Bodies"
        description="The Body Studio composes skills, knowledge, tools and policies around a mission — a body is never just a model."
      />
      <DeniedState
        message="The Body Studio requires an authenticated workspace session. Sessions are validated server-side (fail closed) — there is no anonymous studio."
        requiredAuthority="authenticated session (B004 session boundary)"
      />
      <p className="body-studio__auth-hint">
        <a href="/">Go to the Arena home surface</a> to sign in, or explore the{' '}
        <a href="/demo/bodies">deterministic demo Body Studio</a> (visibly labelled demo state).
      </p>
    </div>
  );
}

/** `/bodies/:id` when the record is not found — an honest empty state. */
export function BodyNotFoundView(props: { readonly recordId: string }) {
  return (
    <div className="body-studio body-studio--not-found" data-arena-route="bodies-detail" data-arena-detail-status="not-found">
      <PageHeader
        title="Agent Body not found"
        description={`No canonical agent-body record exists for ${props.recordId} in this workspace.`}
      />
      <EmptyState
        title="No such body"
        hint="The canonical read path returned a typed not-found outcome. Nothing is fabricated to fill the space."
      />
      <p className="body-studio__failure-hint">
        <a href="/bodies">Back to the body library</a>
      </p>
    </div>
  );
}

/** `/bodies/:id` when the record exists but is not a body — honest wrong-kind state. */
export function BodyWrongKindView(props: { readonly recordId: string; readonly kind: string }) {
  return (
    <div className="body-studio body-studio--wrong-kind" data-arena-route="bodies-detail" data-arena-detail-status="wrong-kind">
      <PageHeader
        title="Not an Agent Body"
        description={`Record ${props.recordId} is a ${props.kind} record, not an agent-body record — the studio never coerces one kind into another.`}
      />
      <DeniedState
        message={`This record is of kind ${props.kind}. The Body Studio renders agent-body records only (typed kind mismatch).`}
        requiredAuthority="canonical read of kind agent-body"
      />
      <p className="body-studio__failure-hint">
        <a href="/bodies">Back to the body library</a>
      </p>
    </div>
  );
}

/** `/bodies/:id` when the read failed — the honest error state (fail closed). */
export function BodyUnreadableView(props: { readonly recordId: string; readonly message: string }) {
  return (
    <div className="body-studio body-studio--unreadable" data-arena-route="bodies-detail" data-arena-detail-status="unreadable">
      <PageHeader
        title="Agent Body unreadable"
        description="The canonical read path failed closed while reading this record."
      />
      <div className="arena-state arena-state--error" role="alert" data-arena-state="error">
        <p className="arena-state__title">{props.message}</p>
        <p className="arena-state__detail">
          <span className="arena-state__fact-label">Record</span>
          <code className="arena-state__fact-value">{props.recordId}</code>
        </p>
      </div>
      <p className="body-studio__failure-hint">
        <a href="/bodies">Back to the body library</a> — reloading re-reads through the canonical
        read path; no cached copy is trusted.
      </p>
    </div>
  );
}
