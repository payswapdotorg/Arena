/**
 * POST /demo/reset — the demo reset control (Work Order B006; issue #73).
 *
 * Deterministic reset: drops the demo corpus and reseeds it (the store
 * returns to the identical corpus hash), then redirects back to the
 * demo landing. The reset ALWAYS lands the visitor on labelled demo
 * state — there is no path from here into customer state.
 */

import { NextResponse } from 'next/server';

import { getDemoRuntime } from '../../../demo/runtime.js';

export async function POST(request: Request): Promise<Response> {
  const runtime = await getDemoRuntime();
  await runtime.store.reset();
  return NextResponse.redirect(new URL('/demo', request.url), 303);
}
