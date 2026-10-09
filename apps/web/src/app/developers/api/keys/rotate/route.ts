/**
 * POST `/developers/api/keys/rotate` — rotate a key (the append-only
 * `active → rotated` transition; the successor secret is shown exactly
 * once; the old key's replay fails closed with the typed KEY_ROTATED
 * reason). P005/S-03, the R-028 disposition. Wiring only: the shared
 * composition in `../_lib/portal-writes.ts` owns the posture.
 */

import { handlePortalWriteRequest } from '../../../_lib/portal-writes.js';

export async function POST(request: Request): Promise<Response> {
  return handlePortalWriteRequest(request, 'rotate-key');
}
