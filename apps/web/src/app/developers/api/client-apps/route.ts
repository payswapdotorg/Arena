/**
 * POST `/developers/api/client-apps` — register a client application
 * (P005/S-03, the R-028 disposition: the developer-portal interactive
 * write actions). Route-handler mount, wiring only: the fail-closed
 * session probe (an unauthenticated POST is a typed 401 and never
 * writes), the demo read-only denial, the CSRF origin check and the
 * C001-style idempotency law all live in the shared composition
 * (`../_lib/portal-writes.ts`). The tenant comes from the VALIDATED
 * session, never the request body.
 */

import { handlePortalWriteRequest } from '../../_lib/portal-writes.js';

export async function POST(request: Request): Promise<Response> {
  return handlePortalWriteRequest(request, 'register-client-app');
}
