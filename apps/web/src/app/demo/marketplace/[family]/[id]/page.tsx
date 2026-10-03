/**
 * /demo/marketplace/[family]/[id] — the demo-mode listing detail mount
 * (Work Order B013). A mount point, not logic: the composition lives in
 * apps/web/src/marketplace (resolveDemoMarketplaceDetailOutcome) over the
 * deterministic demo corpus. Demo mode renders the full provenance chain,
 * licence terms, verification evidence, entitlement history, certification
 * presence and the purchase panel in its demo (not purchasable) posture —
 * visibly labelled, never customer state.
 */

import { MarketplaceDetailView, resolveDemoMarketplaceDetailOutcome } from '../../../../../marketplace/index.js';

export interface DemoMarketplaceDetailPageProps {
  readonly params: Promise<{ readonly family: string; readonly id: string }>;
}

export default async function DemoMarketplaceDetailPage({
  params,
}: DemoMarketplaceDetailPageProps) {
  const resolved = await params;
  const family = decodeURIComponent(resolved.family);
  const listingId = decodeURIComponent(resolved.id);
  const outcome = await resolveDemoMarketplaceDetailOutcome(family, listingId);
  return <MarketplaceDetailView outcome={outcome} />;
}
