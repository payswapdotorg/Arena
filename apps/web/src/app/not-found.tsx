import { EmptyState } from '@arena/ui-platform';

/** Unknown routes fall into the standard empty state, not a stack trace. */
export default function NotFound() {
  return (
    <div className="route-stub" data-arena-route="not-found">
      <EmptyState
        title="Page not found"
        hint="This route is not part of the Arena workspace. Use the navigation to get back."
      />
    </div>
  );
}
