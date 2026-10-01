import type { Metadata } from 'next';

import '@arena/ui-platform/tokens.css';
import '@arena/ui-platform/components.css';
import './globals.css';

import {
  ContextualNavigation,
  ShellBottomNav,
  WorkspaceShell,
} from '@arena/ui-platform';

import { CORE_NAV_ITEMS, MOBILE_NAV_ITEMS } from './_lib/nav.js';

export const metadata: Metadata = {
  title: {
    default: 'Arena — professional AI capability, kept inspectable',
    template: '%s — Arena',
  },
  description:
    'Arena turns desired outcomes into certified agent capability: cases, agent bodies, environments, evaluation, verification and certification — with the evidence always in reach.',
};

/**
 * The product shell (UX1.0 Level 1): Arena mark/name, the five persistent
 * shell regions (workspace selector, role switcher, global search,
 * jobs/notifications, profile — typed placeholder slots until B003-B014),
 * contextual navigation, and the responsive workspace layout around the
 * main stage.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <WorkspaceShell
          rail={<ContextualNavigation items={CORE_NAV_ITEMS} />}
          bottomNav={<ShellBottomNav items={MOBILE_NAV_ITEMS} />}
        >
          {children}
        </WorkspaceShell>
      </body>
    </html>
  );
}
