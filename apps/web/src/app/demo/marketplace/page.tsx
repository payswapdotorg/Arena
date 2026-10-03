/**
 * /demo/marketplace — the demo-mode marketplace browse mount (Work Order
 * B013; issue #88). A mount point, not logic: the composition lives in
 * apps/web/src/marketplace (resolveDemoMarketplaceHomeView). Rendering
 * under the /demo route segment inherits B006's always-on demo labelling
 * banner (apps/web/src/app/demo/layout.tsx), and the marketplace view adds
 * its own demo banner + per-datum DemoDataBadge — demo state is visibly
 * labelled and never mistaken for customer state, with no real pricing and
 * no real purchase. Two loads are byte-identical.
 */

import { MarketplaceHomeView, resolveDemoMarketplaceHomeView } from '../../../marketplace/index.js';

export default async function DemoMarketplacePage() {
  const view = await resolveDemoMarketplaceHomeView();
  return <MarketplaceHomeView view={view} />;
}
