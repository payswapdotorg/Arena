/**
 * The honest non-surface renders for the replay route mounts (Work
 * Order B011; issue #86; apps/web/src/replay): the auth-required notice
 * (fail closed — never an anonymous surface), the honest not-found run
 * state (never a fabricated run) and the honest invalid-continuation
 * notice (never a silently reset page). SYNC presentational components.
 */

import { DeniedState, EmptyState, ErrorState, PageHeader } from '@arena/ui-platform';

/** `/replay/**` without an authenticated session: fail closed, honestly. */
export function ReplayAuthRequiredView() {
  return (
    <div
      className="replay-surface replay-surface--auth-required"
      data-arena-route="replay"
      data-arena-surface-auth="required"
    >
      <PageHeader
        title="Run replay"
        description="Replay recorded environment/trajectory runs step by step — observational only, never a live-world mutation."
      />
      <DeniedState
        message="The replay viewer requires an authenticated workspace session. Sessions are validated server-side (fail closed) — there is no anonymous replay view."
        requiredAuthority="authenticated session (B004 session boundary)"
      />
      <p className="replay-surface__auth-hint">
        <a href="/">Go to the Arena home surface</a> to sign in, or explore the{' '}
        <a href="/demo/replay">deterministic demo replay viewer</a> (visibly labelled demo
        state).
      </p>
    </div>
  );
}

/** A run detail whose run does not exist — an honest empty state. */
export function ReplayRunNotFoundView(props: { readonly runKey: string }) {
  return (
    <div
      className="replay-surface replay-surface--not-found"
      data-arena-route="replay-run"
      data-arena-detail-status="not-found"
    >
      <PageHeader title="Run replay" description={`No run exists for ${props.runKey}.`} />
      <EmptyState
        title="Nothing to replay"
        hint="Runs are addressed by their tenant-local run key. No run with this key is recorded in this posture — nothing is fabricated to fill the space."
      />
      <p className="replay-surface__failure-hint">
        <a href="/replay">Back to the replay run list</a> or{' '}
        <a href="/demo/replay">open the deterministic demo replay</a>.
      </p>
    </div>
  );
}

/** A run-list scroll whose continuation token was rejected — the honest fail-closed notice. */
export function ReplayInvalidContinuationView(props: {
  readonly code: string;
  readonly message: string;
  readonly mode: 'session' | 'demo';
}) {
  const backHref = props.mode === 'demo' ? '/demo/replay' : '/replay';
  return (
    <div
      className="replay-surface replay-surface--invalid-continuation"
      data-arena-route="replay"
      data-arena-detail-status="invalid-continuation"
      data-arena-error-code={props.code}
    >
      <PageHeader
        title="Run replay"
        description="The run list refused the supplied continuation token — fail closed, never a silently reset page."
      />
      <ErrorState
        title="The continuation token was rejected"
        detail={`${props.message} (code: ${props.code})`}
        action={
          <a href={backHref}>Back to the first page</a>
        }
      />
      <p className="replay-surface__failure-hint">
        Continuation tokens are addresses into the deterministic run ordering; a malformed,
        stale or foreign token is rejected rather than guessed.{' '}
        <a href={backHref}>Return to the first page</a>.
      </p>
    </div>
  );
}
