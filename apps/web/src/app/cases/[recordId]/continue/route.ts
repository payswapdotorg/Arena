/**
 * POST `/cases/[recordId]/continue` — the guided CONTINUE action (Work
 * Order B008; issue #80). Route-handler mount, wiring only: the
 * fail-closed session probe (an unauthenticated POST never writes —
 * 403), then `handleGuidedFormPost` (origin-check → product-flows
 * runtime → canonical lifecycle transition or typed rejection). The
 * record id in the path identifies the surface the visitor acted from;
 * the form's stepId + caseId identify the step (the canonical runtime
 * is the authority). Success lands on the record that actually moved.
 */

import { resolveSessionCapability } from '../../../../capability/runtime.js';
import { sessionActor, handleGuidedFormPost } from '../../../../capability/case-routes.js';

export interface ContinueRouteContext {
  readonly params: Promise<{ readonly recordId: string | string[] }>;
}

export async function POST(
  request: Request,
  context: ContinueRouteContext,
): Promise<Response> {
  const outcome = await resolveSessionCapability();
  if (outcome.status === 'unauthenticated') {
    return new Response(
      `sign-in required (${outcome.code}) — the guided flow never writes anonymously`,
      { status: 403, headers: { 'cache-control': 'no-store' } },
    );
  }
  const raw = (await context.params)['recordId'];
  const surfaceRecordId = Array.isArray(raw) ? raw[0] : raw;
  return handleGuidedFormPost(
    request,
    {
      tenantId: outcome.facts.tenantId,
      actor: sessionActor(outcome.facts),
      flow: outcome.flow,
    },
    {
      success: (recordId) => `/cases/${encodeURIComponent(recordId)}`,
      failure:
        surfaceRecordId !== undefined
          ? `/cases/${encodeURIComponent(surfaceRecordId)}`
          : '/cases',
    },
  );
}
