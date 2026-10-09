/**
 * POST `/developers/api/keys` — issue a scoped API key for a registered
 * client app (P005/S-03, the R-028 disposition). The secret is returned
 * EXACTLY ONCE in the typed response (the shown-once moment; it is
 * never stored, never logged, never retrievable again). Wiring only:
 * session/demo/CSRF/idempotency posture lives in `../_lib/portal-writes.ts`.
 */

import { handlePortalWriteRequest } from '../../_lib/portal-writes.js';

export async function POST(request: Request): Promise<Response> {
  return handlePortalWriteRequest(request, 'issue-key');
}
