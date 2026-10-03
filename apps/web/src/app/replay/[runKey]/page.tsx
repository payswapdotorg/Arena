import type { Metadata } from 'next';

import {
  ReplayAuthRequiredView,
  ReplayRunNotFoundView,
  ReplayRunView,
  resolveReplayRun,
} from '../../../replay/index.js';

export const metadata: Metadata = {
  title: 'Run replay (run detail)',
};

/**
 * `/replay/[runKey]` — the replay run detail (Work Order B011; issue
 * #86). An async session-aware server component: the session is probed
 * FIRST (fail closed — never an anonymous surface), then the run is
 * addressed by its tenant-local run key. In the local session posture
 * no runs are recorded, so an authenticated session resolves the honest
 * not-found outcome — never a fabricated run. Explicit `?role=` and
 * `?step=` query state select the lens and the inspected step.
 */

export interface ReplayRunPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
  /** Explicit query state (`?role=` lens, `?step=` inspected step). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReplayRunPage({ params, searchParams }: ReplayRunPageProps) {
  const resolvedParams = params === undefined ? undefined : await params;
  const raw = resolvedParams?.['runKey'];
  const runKey = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (runKey === undefined || runKey.length === 0) {
    return <ReplayRunNotFoundView runKey="(missing run key)" />;
  }
  const resolvedQuery = searchParams === undefined ? undefined : await searchParams;
  const requestedRole = firstQueryValue(resolvedQuery?.['role']);
  const requestedStep = firstQueryValue(resolvedQuery?.['step']);
  const step =
    requestedStep !== undefined && /^\d+$/.test(requestedStep)
      ? Number.parseInt(requestedStep, 10)
      : null;
  const experience = await resolveReplayRun({
    runKey,
    ...(requestedRole !== undefined ? { requestedRoleId: requestedRole } : {}),
    requestedSequence: step,
  });
  switch (experience.kind) {
    case 'auth-required':
      return <ReplayAuthRequiredView />;
    case 'not-found':
      return <ReplayRunNotFoundView runKey={runKey} />;
    case 'run':
      return <ReplayRunView view={experience.view} />;
  }
}

/** First value of a query param (string or string[] forms). */
function firstQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' && first.length > 0 ? first : undefined;
  }
  return undefined;
}
