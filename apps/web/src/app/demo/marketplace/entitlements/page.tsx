/**
 * /demo/marketplace/entitlements — the demo-mode entitlement mount (Work
 * Order B013). A mount point, not logic: the composition lives in
 * apps/web/src/marketplace (resolveDemoMarketplaceEntitlementsView) over
 * the deterministic demo corpus. Every entitlement state renders
 * explicitly (granted / revoked / expired / pending) with lineage and
 * grounds — demo-labelled, never customer state.
 */

import {
  MarketplaceEntitlementsView,
  resolveDemoMarketplaceEntitlementsView,
} from '../../../../marketplace/index.js';

export default async function DemoMarketplaceEntitlementsPage() {
  const view = await resolveDemoMarketplaceEntitlementsView();
  return <MarketplaceEntitlementsView view={view} />;
}
