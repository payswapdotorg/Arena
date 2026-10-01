/**
 * POST `/demo/cases/start/submit` — the demo-mode guided START action
 * (Work Order B008; issue #80). Route-handler mount, wiring only: the
 * demo context (always available, zero credentials) + the honest
 * redirect contract. Writes go through the DEMO store's own B002
 * repository port under the reserved demo tenant — labelled demo state,
 * never customer state; the customer-hosted write boundary is out of
 * B-series scope.
 */

import {
  getDemoCapabilityContext,
} from '../../../../../capability/runtime.js';
import { demoActor, handleGuidedFormPost } from '../../../../../capability/case-routes.js';

export async function POST(request: Request): Promise<Response> {
  const context = await getDemoCapabilityContext();
  return handleGuidedFormPost(
    request,
    {
      tenantId: context.facts.tenantId,
      actor: await demoActor(),
      flow: context.flow,
    },
    {
      success: (recordId) => `/demo/cases/${encodeURIComponent(recordId)}`,
      failure: '/demo/cases/start',
    },
  );
}
