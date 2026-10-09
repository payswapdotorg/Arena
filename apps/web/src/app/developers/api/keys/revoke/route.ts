/**
 * POST `/developers/api/keys/revoke` — revoke a key (terminal,
 * append-only, history retained; a revoked key's replay fails closed
 * with the typed KEY_REVOKED reason). P005/S-03, the R-028 disposition.
 * Wiring only: the shared composition in `../_lib/portal-writes.ts`
 * owns the posture.
 */

import { handlePortalWriteRequest } from '../../../_lib/portal-writes.js';

export async function POST(request: Request): Promise<Response> {
  return handlePortalWriteRequest(request, 'revoke-key');
}
