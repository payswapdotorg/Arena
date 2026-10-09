/**
 * POST `/developers/api/sandbox/runs` — run a deterministic canned
 * sandbox escalation from the console (P005/S-03, the R-028
 * disposition). Authorizes with a PRESENTED KEY SECRET (the same
 * `sandbox:run` scope seam P003's public transport binds — a key can
 * never mint another key); the run is visibly sandbox truth, never
 * customer truth. Wiring only: the shared composition in
 * `../_lib/portal-writes.ts` owns the session/demo/CSRF/idempotency
 * posture.
 */

import { handlePortalWriteRequest } from '../../../_lib/portal-writes.js';

export async function POST(request: Request): Promise<Response> {
  return handlePortalWriteRequest(request, 'run-sandbox-escalation');
}
