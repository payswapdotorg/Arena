/**
 * /demo — the Demo landing route (Work Order B006; issue #73).
 *
 * A deterministic async server component: it composes the zero-credential
 * demo runtime (apps/web/src/demo), resolves the requested role lens
 * from EXPLICIT query state (`?role=owner|agent-builder|expert`; default
 * owner — never implicit time or randomness), reads every referenced
 * record through the B005 canonical read path, and renders the
 * presentational DemoLandingView. Two loads with the same query produce
 * byte-identical markup.
 */

import { buildDemoLandingView, resolveVariantId } from '../../demo/narrative-view.js';
import { DemoLandingView } from '../../demo/demo-landing-view.js';
import { getDemoRuntime } from '../../demo/runtime.js';

export interface DemoPageProps {
  /** Explicit query-driven state (the ONLY variant selector). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DemoPage({ searchParams }: DemoPageProps) {
  const resolved = searchParams === undefined ? undefined : await searchParams;
  const requested = resolved?.['role'];
  const variantId = resolveVariantId(
    typeof requested === 'string' ? requested : Array.isArray(requested) ? requested[0] : undefined,
  );
  const runtime = await getDemoRuntime();
  const view = await buildDemoLandingView({
    variantId,
    read: (recordId) => runtime.reads.read(recordId),
    inventory: () => runtime.reads.inventory(),
    corpusHash: runtime.corpusHash,
  });
  return <DemoLandingView view={view} />;
}
