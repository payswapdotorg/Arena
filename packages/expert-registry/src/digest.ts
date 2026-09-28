/**
 * Expert-profile content digest helpers (Work Order A006).
 *
 * The sha256 digest of a profile is computed over the canonical JSON
 * serialization of its digest-free view, REUSING @arena/protocol-core's
 * digestCanonical (never reimplemented here). This module exists so that
 * profile.ts (construction) and lifecycle.ts (transitions) share ONE
 * digest implementation without importing each other's runtime surface.
 *
 * Type-only imports from profile.ts are erased at compile time, so this
 * module has no runtime dependency on profile.ts — no import cycle.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { ExpertProfile, ExpertProfileContentView } from './profile.js';
import { toContentDigest } from './shared.js';
import type { ContentDigest } from './shared.js';

/**
 * Compute the sha256 content digest over the canonical serialization of a
 * profile's digest-free view (same content ⇒ same digest; any field,
 * status, ledger entry or history change ⇒ different digest).
 */
export async function computeExpertProfileDigest(
  view: ExpertProfileContentView,
): Promise<ContentDigest> {
  return toContentDigest(await digestCanonical(view));
}

/** The digest-free view of a profile (exactly what the digest commits to). */
export function expertProfileContentView(
  profile: ExpertProfile,
): ExpertProfileContentView {
  const { digest: _digest, ...view } = profile;
  return view;
}
