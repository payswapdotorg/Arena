/**
 * The honest non-surface renders for the research route mounts (Work
 * Order B012; issue #87; apps/web/src/research): the auth-required
 * notice (fail closed — never an anonymous research surface). SYNC
 * presentational components.
 */

import { DeniedState, PageHeader } from '@arena/ui-platform';

/** `/research` without an authenticated session: fail closed, honestly. */
export function ResearchAuthRequiredView() {
  return (
    <div
      className="research-surface research-surface--auth-required"
      data-arena-route="research"
      data-arena-surface-auth="required"
    >
      <PageHeader
        title="Research"
        description="Benchmark bodies and substrates, study capability lift, and publish reusable research artifacts."
      />
      <DeniedState
        message="The research surface requires an authenticated workspace session. Sessions are validated server-side (fail closed) — there is no anonymous research view."
        requiredAuthority="authenticated session (B004 session boundary)"
      />
      <p className="research-surface__auth-hint">
        <a href="/">Go to the Arena home surface</a> to sign in, or explore the{' '}
        <a href="/demo/research">deterministic demo research surface</a> (visibly labelled demo
        state).
      </p>
    </div>
  );
}
