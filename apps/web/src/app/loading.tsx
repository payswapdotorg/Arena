import { LoadingState } from '@arena/ui-platform';

/**
 * Real loading state for every route (UX1.0 §UX quality gates) — rendered
 * by the App Router while a route segment streams in.
 */
export default function Loading() {
  return <LoadingState label="Loading…" />;
}
