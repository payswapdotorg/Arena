'use client';

import { ErrorState } from '@arena/ui-platform';

/**
 * Real error state for every route (UX1.0 §UX quality gates). Client
 * boundary required by the App Router for `reset`; the presentation is
 * the design-system ErrorState.
 */
export default function ErrorPage({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  return (
    <ErrorState
      title="This view failed to load"
      detail={error.message}
      action={
        <button type="button" className="arena-primary-action" onClick={reset}>
          Try again
        </button>
      }
    />
  );
}
