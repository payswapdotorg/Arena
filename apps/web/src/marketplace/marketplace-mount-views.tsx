/**
 * Marketplace mount views — the honest failure states (Work Order B013;
 * issue #88; apps/web/src/marketplace).
 *
 * SYNC presentational components: the fail-closed denied state the session
 * routes render when the B004 boundary closes the door (never an anonymous
 * marketplace — the typed AUTH_* code is visible, never customer data).
 */

import { DeniedState } from '@arena/ui-platform';

/** The fail-closed denied state (typed AUTH_* code visible). */
export function MarketplaceAuthRequiredView({ code }: { readonly code: string }) {
  return (
    <div
      className="marketplace-denied"
      data-arena-route="marketplace"
      data-arena-state="denied"
      data-arena-auth-code={code}
    >
      <DeniedState
        message="Sign in to browse the marketplace. The marketplace never renders anonymously — every listing read is scoped to a validated session."
        requiredAuthority={`authenticated session (typed outcome: ${code})`}
      />
    </div>
  );
}
