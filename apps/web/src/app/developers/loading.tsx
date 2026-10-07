import { DevelopersLoadingView } from '../../developers/index.js';

/**
 * The developers segment loading gate (UX quality gates: every route
 * owns a loading state) — the honest pending state while the portal
 * composition resolves server-side.
 */
export default function DevelopersLoading() {
  return <DevelopersLoadingView />;
}
