import type { Metadata } from 'next';

import { RouteStub } from '../_lib/route-stub.js';

export const metadata: Metadata = {
  title: 'Settings',
};

/** Structural stub (identity/policy UX arrives with B004+): shared shell + route header + standard empty state. */
export default function SettingsPage() {
  return (
    <RouteStub
      route="settings"
      title="Settings"
      description="Profile, integrations, members and policy for this workspace."
      emptyTitle="Settings are not wired in yet"
      emptyHint="Identity, session and tenant settings arrive with the auth boundary work."
    />
  );
}
