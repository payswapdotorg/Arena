/**
 * Demo route layout (Work Order B006; issue #73).
 *
 * Wraps every /demo route in the always-visible demo labelling banner
 * (from the @arena/demo labelling contract) so no demo page can render
 * without its "not customer state" notice.
 */

import type { ReactNode } from 'react';

import { DemoDataBadge } from '@arena/ui-platform';
import { DEMO_BADGE_NOTE, DEMO_LABELLING } from '@arena/demo';

export default function DemoLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="demo-route" data-arena-demo-route="true">
      <aside
        className="demo-route__banner"
        role="note"
        aria-label="Demo mode"
        data-arena-demo-banner="true"
      >
        <DemoDataBadge note={DEMO_BADGE_NOTE} />
        <span className="demo-route__banner-text">
          <strong>{DEMO_LABELLING.bannerTitle}:</strong> {DEMO_LABELLING.bannerText}
        </span>
      </aside>
      {children}
    </div>
  );
}
