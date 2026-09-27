/**
 * Capability-case content digest helpers (Work Order A005).
 *
 * The sha256 digest of a case is computed over the canonical JSON
 * serialization of its digest-free view, REUSING @arena/protocol-core's
 * digestCanonical (never reimplemented here). This module exists so that
 * case.ts (construction) and lifecycle.ts (transitions) share ONE digest
 * implementation without importing each other's runtime surface.
 *
 * Type-only imports from case.ts are erased at compile time, so this module
 * has no runtime dependency on case.ts — no import cycle.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { CapabilityCase, CapabilityCaseContentView } from './case.js';
import { toContentDigest } from './shared.js';
import type { ContentDigest } from './shared.js';

/**
 * Compute the sha256 content digest over the canonical serialization of a
 * case's digest-free view (same content ⇒ same digest; any field, status,
 * evidence or history change ⇒ different digest).
 */
export async function computeCapabilityCaseDigest(
  view: CapabilityCaseContentView,
): Promise<ContentDigest> {
  return toContentDigest(await digestCanonical(view));
}

/** The digest-free view of a case (exactly what the digest commits to). */
export function capabilityCaseContentView(
  caseRecord: CapabilityCase,
): CapabilityCaseContentView {
  const { digest: _digest, ...view } = caseRecord;
  return view;
}
