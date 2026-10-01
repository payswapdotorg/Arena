/**
 * POST `/cases/start/submit` — the guided START action (Work Order B008;
 * issue #80). Route-handler mount, wiring only: the fail-closed session
 * probe (an unauthenticated POST never writes — 403), then
 * `handleGuidedFormPost` (origin-check → product-flows runtime over the
 * LOCAL control-plane posture → honest redirect with the typed code).
 */

import { resolveSessionCapability } from '../../../../capability/runtime.js';
import { sessionActor, handleGuidedFormPost } from '../../../../capability/case-routes.js';

export async function POST(request: Request): Promise<Response> {
  const outcome = await resolveSessionCapability();
  if (outcome.status === 'unauthenticated') {
    return new Response(
      `sign-in required (${outcome.code}) — the guided flow never writes anonymously`,
      { status: 403, headers: { 'cache-control': 'no-store' } },
    );
  }
  return handleGuidedFormPost(
    request,
    {
      tenantId: outcome.facts.tenantId,
      actor: sessionActor(outcome.facts),
      flow: outcome.flow,
    },
    {
      success: (recordId) => `/cases/${encodeURIComponent(recordId)}`,
      failure: '/cases/start',
    },
  );
}
