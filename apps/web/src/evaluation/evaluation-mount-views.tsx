/**
 * The honest non-surface renders for the evaluation route mounts (Work
 * Order B012; issue #87; apps/web/src/evaluation): the auth-required
 * notice (fail closed — never an anonymous surface) and the honest
 * not-found detail states (never a fabricated record). SYNC
 * presentational components.
 */

import { DeniedState, EmptyState, PageHeader } from '@arena/ui-platform';

/** `/evaluation/**` without an authenticated session: fail closed, honestly. */
export function EvaluationAuthRequiredView() {
  return (
    <div
      className="evaluation-surface evaluation-surface--auth-required"
      data-arena-route="evaluation"
      data-arena-surface-auth="required"
    >
      <PageHeader
        title="Evaluation, verification & certification"
        description="Evaluation scores runs against explicit criteria; verification establishes evidence support; certification claims a tested composition."
      />
      <DeniedState
        message="The evaluation surface requires an authenticated workspace session. Sessions are validated server-side (fail closed) — there is no anonymous evaluation view."
        requiredAuthority="authenticated session (B004 session boundary)"
      />
      <p className="evaluation-surface__auth-hint">
        <a href="/">Go to the Arena home surface</a> to sign in, or explore the{' '}
        <a href="/demo/evaluation">deterministic demo evaluation surface</a> (visibly labelled demo
        state).
      </p>
    </div>
  );
}

/** A detail route whose record does not exist — an honest empty state. */
export function EvaluationNotFoundView(props: {
  readonly title: string;
  readonly recordId: string;
  readonly hint: string;
}) {
  return (
    <div
      className="evaluation-surface evaluation-surface--not-found"
      data-arena-route="evaluation-detail"
      data-arena-detail-status="not-found"
    >
      <PageHeader title={props.title} description={`No record exists for ${props.recordId}.`} />
      <EmptyState title="Nothing to render" hint={props.hint} />
      <p className="evaluation-surface__failure-hint">
        <a href="/evaluation">Back to the evaluation surface</a>
      </p>
    </div>
  );
}
