import type { Metadata } from 'next';

import {
  BodiesAuthRequiredView,
  BodyDetailView,
  BodyNotFoundView,
  BodyUnreadableView,
  BodyWrongKindView,
  resolveBodyDetailExperience,
} from '../../../bodies/index.js';

export const metadata: Metadata = {
  title: 'Agent Body',
};

export interface BodyDetailPageProps {
  /** The dynamic route segment (`/bodies/:id`). */
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
  /** Explicit query state (`?role=` selects the active studio lens). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/bodies/:id` — the Body Studio detail surface (Work Order B010; issue
 * #82; UXM1.0 §Core routes): the Body Version identity card (explicit
 * versioning, immutable), the inspectable composition, the possession
 * matrix and the composition-scoped comparison. An async server
 * component: the session is probed FIRST (fail closed); every read
 * failure keeps its own honest shape (not-found / wrong-kind /
 * unreadable — never a fabricated body).
 */
export default async function BodyDetailPage({ params, searchParams }: BodyDetailPageProps) {
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
  const experience = await resolveBodyDetailExperience({
    recordId,
    ...(requestedRole !== undefined && requestedRole.length > 0
      ? { requestedRoleId: requestedRole }
      : {}),
  });
  switch (experience.kind) {
    case 'auth-required':
      return <BodiesAuthRequiredView />;
    case 'not-found':
      return <BodyNotFoundView recordId={experience.recordId} />;
    case 'wrong-kind':
      return <BodyWrongKindView recordId={experience.recordId} kind={experience.kindName} />;
    case 'unreadable':
      return <BodyUnreadableView recordId={experience.recordId} message={experience.message} />;
    case 'body':
      return <BodyDetailView view={experience.outcome.view} />;
  }
}
