import type { Metadata } from 'next';

import {
  ReplayAuthRequiredView,
  ReplayRunNotFoundView,
  ReplayRunView,
  resolveDemoReplayRun,
} from '../../../../replay/index.js';

export const metadata: Metadata = {
  title: 'Run replay (demo run detail)',
};

/**
 * /demo/replay/[runKey] — the deterministic demo run detail (Work Order
 * B011; issue #86). A mount point, not logic: the composition lives in
 * apps/web/src/replay (resolveDemoReplayRun) over the shared B006 demo
 * runtime plus the deterministic B011 replay corpus. Unknown run keys
 * resolve the honest not-found outcome — never a fabricated run.
 * Explicit `?role=` and `?step=` query state select the lens and the
 * inspected step (interactive run inspection via hypermedia).
 */

export interface DemoReplayRunPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
  /** Explicit query state (`?role=` lens, `?step=` inspected step). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DemoReplayRunPage({ params, searchParams }: DemoReplayRunPageProps) {
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
  const experience = await resolveDemoReplayRun({
    runKey,
    ...(requestedRole !== undefined ? { requestedRoleId: requestedRole } : {}),
    requestedSequence: step,
  });
  switch (experience.kind) {
    case 'auth-required':
      // Unreachable in the demo posture (zero credentials), kept for
      // the typed union — fail closed, never an anonymous surface.
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
