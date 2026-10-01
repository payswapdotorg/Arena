/**
 * CapabilitySignInGate + FlowErrorNotice (Work Order B008; issue #80;
 * apps/web/src/capability). SYNC presentational components.
 *
 * The gate is the FAIL-CLOSED posture rendered: when the B004 session
 * boundary closes the door (typed AUTH_* outcome), the capability surfaces
 * render this honest notice — never an anonymous case/task surface, never
 * guessed data. The notice surfaces a TYPED guided-flow rejection code
 * (?flowError=…) verbatim: canonical CAPABILITY_CASE_* / PRODUCT_FLOW_* /
 * PERSISTENCE_* codes render truthfully; nothing is swallowed or re-coded
 * into a fake success.
 */

import { EmptyState, PageHeader, PrimaryAction } from '@arena/ui-platform';

/** The fail-closed sign-in gate for the session-mode capability surfaces. */
export function CapabilitySignInGate(props: {
  /** The typed AUTH_* code that closed the door (observability, never customer data). */
  readonly code: string;
  /** What surface was requested (rendered in plain language). */
  readonly surface: string;
}) {
  const { code, surface } = props;
  return (
    <div
      className="capability-gate"
      data-arena-route="capability-gate"
      data-arena-auth-code={code}
    >
      <PageHeader
        title="Sign in to continue"
        description={`Capability ${surface} reads are session-scoped: they require a validated workspace session, and the boundary closed with the typed outcome ${code} (fail closed — never an anonymous surface).`}
      />
      <EmptyState
        title="No authenticated session"
        hint="Sessions are issued by your workspace sign-in. Until one exists, the guided demo workspace needs no credentials — visibly labelled as demo state, never customer state."
        action={
          <PrimaryAction href="/demo" testId="gate-demo-cta">
            Open the guided demo
          </PrimaryAction>
        }
      />
      <p className="capability-gate__alt">
        <a href="/">Back to the overview</a>
      </p>
    </div>
  );
}

/**
 * The honest typed-rejection notice: a guided start/continue action was
 * rejected by the canonical lifecycle (or its boundaries) and the code is
 * surfaced verbatim — no fake success, no silent retry.
 */
export function FlowErrorNotice(props: { readonly code?: string | undefined }) {
  const { code } = props;
  if (code === undefined || code.length === 0) return null;
  return (
    <section
      className="capability-flow-error"
      role="alert"
      data-arena-flow-error={code}
      aria-label="Guided flow rejection"
    >
      <p>
        <strong>The guided action was rejected.</strong> The typed outcome was{' '}
        <code>{code}</code>. The case state was not changed — canonical
        lifecycle transitions are accepted or rejected, never bent. Adjust the
        step input (or the step order) and try again.
      </p>
    </section>
  );
}
