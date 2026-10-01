/**
 * `/demo/cases/start` — the demo-mode guided START form (Work Order
 * B008; issue #80). Mount point, wiring only: the form pre-fills the
 * DISCLOSED reference framing under the reserved demo tenant (every
 * pre-fill visible and editable) and POSTs to
 * `/demo/cases/start/submit`, which executes the start through the
 * product-flows runtime over the DEMO store's repository port —
 * labelled demo state, never customer state.
 */

import type { Metadata } from 'next';

import { StartCaseFormView } from '../../../../capability/start-view.js';
import { FlowErrorNotice } from '../../../../capability/gate.js';
import { resolveDemoCaseList } from '../../../../capability/case-routes.js';
import { referenceFraming } from '../../../../capability/flow-actions.js';

export const metadata: Metadata = {
  title: 'Start a capability case (demo)',
};

export interface DemoCaseStartPageProps {
  /** Explicit query state (`?flowError=` typed rejection from the submit). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

export default async function DemoCaseStartPage({
  searchParams,
}: DemoCaseStartPageProps) {
  const resolved = searchParams === undefined ? undefined : await searchParams;
  const flowError = firstValue(resolved?.['flowError']);
  // The demo tenant comes from the demo composition itself (never the client).
  const demoList = await resolveDemoCaseList();
  return (
    <>
      <FlowErrorNotice code={flowError} />
      <StartCaseFormView
        mode="demo"
        framing={referenceFraming(demoList.tenantId)}
      />
    </>
  );
}
