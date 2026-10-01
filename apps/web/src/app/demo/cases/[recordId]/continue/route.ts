/**
 * POST `/demo/cases/[recordId]/continue` — the demo-mode guided CONTINUE
 * action (Work Order B008; issue #80). Route-handler mount, wiring
 * only: the demo context + the honest redirect contract (canonical
 * transitions or typed rejections over the demo store's repository
 * port; the seeded narrative corpus record is never transitioned — the
 * canonical runtime is the authority and rejects it honestly).
 */

import { getDemoCapabilityContext } from '../../../../../capability/runtime.js';
import { demoActor, handleGuidedFormPost } from '../../../../../capability/case-routes.js';

export interface DemoContinueRouteContext {
  readonly params: Promise<{ readonly recordId: string | string[] }>;
}

export async function POST(
  request: Request,
  context: DemoContinueRouteContext,
): Promise<Response> {
  const demo = await getDemoCapabilityContext();
  const raw = (await context.params)['recordId'];
  const surfaceRecordId = Array.isArray(raw) ? raw[0] : raw;
  return handleGuidedFormPost(
    request,
    {
      tenantId: demo.facts.tenantId,
      actor: await demoActor(),
      flow: demo.flow,
    },
    {
      success: (recordId) => `/demo/cases/${encodeURIComponent(recordId)}`,
      failure:
        surfaceRecordId !== undefined
          ? `/demo/cases/${encodeURIComponent(surfaceRecordId)}`
          : '/demo/cases',
    },
  );
}
