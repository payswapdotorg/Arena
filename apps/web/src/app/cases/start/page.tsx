/**
 * `/cases/start` — the guided START form (Work Order B008; issue #80).
 * Async session-aware server component: fail-closed session probe → the
 * start form pre-filled with the DISCLOSED reference framing (every
 * pre-fill visible and editable — never silently fabricated). The form
 * POSTs (plain HTML, no client JavaScript) to `/cases/start/submit`,
 * which executes the start through the product-flows runtime.
 */

import type { Metadata } from 'next';

import { StartCaseFormView } from '../../../capability/start-view.js';
import { CapabilitySignInGate, FlowErrorNotice } from '../../../capability/gate.js';
import { resolveSessionCapability } from '../../../capability/runtime.js';
import { referenceFraming } from '../../../capability/flow-actions.js';

export const metadata: Metadata = {
  title: 'Start a capability case',
};

export interface CaseStartPageProps {
  /** Explicit query state (`?flowError=` typed rejection from the submit). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

export default async function CaseStartPage({ searchParams }: CaseStartPageProps) {
  const resolved = searchParams === undefined ? undefined : await searchParams;
  const flowError = firstValue(resolved?.['flowError']);
  const outcome = await resolveSessionCapability();
  if (outcome.status === 'unauthenticated') {
    return <CapabilitySignInGate code={outcome.code} surface="case start" />;
  }
  return (
    <>
      <FlowErrorNotice code={flowError} />
      <StartCaseFormView
        mode="session"
        framing={referenceFraming(outcome.facts.tenantId)}
      />
    </>
  );
}
