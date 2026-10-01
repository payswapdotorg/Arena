/**
 * /demo/bodies/:id — the demo-mode Body Studio detail mount (Work Order
 * B010; issue #82). A mount point, not logic: the composition lives in
 * apps/web/src/bodies (resolveDemoBodyDetailExperience). Rendering under
 * the /demo route segment inherits B006's always-on demo labelling
 * banner; every failure keeps its own honest shape (not-found /
 * wrong-kind — never a fabricated body).
 */

import {
  BodyDetailView,
  BodyNotFoundView,
  BodyWrongKindView,
  resolveDemoBodyDetailExperience,
} from '../../../../bodies/index.js';

export interface DemoBodyDetailPageProps {
  /** The dynamic route segment (`/demo/bodies/:id`). */
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
  /** Explicit query state (`?role=` selects the active studio lens). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DemoBodyDetailPage({ params, searchParams }: DemoBodyDetailPageProps) {
  const resolvedParams = params === undefined ? undefined : await params;
  const rawId = resolvedParams?.['id'];
  const recordId =
    typeof rawId === 'string'
      ? rawId
      : Array.isArray(rawId)
        ? rawId[0]
        : undefined;
  if (recordId === undefined || recordId.length === 0) {
    return <BodyNotFoundView recordId="(missing id)" />;
  }
  const resolvedQuery = searchParams === undefined ? undefined : await searchParams;
  const requested = resolvedQuery?.['role'];
  const requestedRole =
    typeof requested === 'string'
      ? requested
      : Array.isArray(requested)
        ? requested[0]
        : undefined;
  const outcome = await resolveDemoBodyDetailExperience(
    recordId,
    requestedRole !== undefined && requestedRole.length > 0 ? requestedRole : undefined,
  );
  if (outcome.status === 'body') {
    return <BodyDetailView view={outcome.view} />;
  }
  if (outcome.status === 'wrong-kind') {
    return <BodyWrongKindView recordId={outcome.recordId} kind={outcome.kind} />;
  }
  return <BodyNotFoundView recordId={outcome.recordId} />;
}
