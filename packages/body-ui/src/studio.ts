/**
 * Body Studio card assembly (Work Order B010; issue #82; packages/body-ui).
 *
 * `buildBodyStudioCard` assembles the three body-half projections of ONE
 * canonical `agent-body` read — identity card (explicit versioning,
 * immutable), composition listing (inspectable skills/knowledge/tools),
 * possession matrix (versioned composition bindings) — into the single
 * card the studio renders per body. Pure + deterministic: same read ⇒
 * byte-identical card; every projection is honest about what the payload
 * does not carry.
 */

import type { CanonicalRead } from '@arena/read-model';

import { buildCompositionListing } from './composition.js';
import type { CompositionListing } from './composition.js';
import { buildBodyVersionIdentityCard } from './identity-card.js';
import type { BodyVersionIdentityCard } from './identity-card.js';
import { buildPossessionMatrix } from './possession-matrix.js';
import type { PossessionMatrix } from './possession-matrix.js';
import { BODY_UI_VIEW_VERSION } from './shared.js';

/** The assembled body studio card: the body half + its possession matrix. */
export interface BodyStudioCard {
  readonly viewVersion: typeof BODY_UI_VIEW_VERSION;
  readonly recordId: string;
  readonly sourceVersion: number;
  readonly sourceRevision: number;
  readonly readAt: number;
  readonly identity: BodyVersionIdentityCard;
  readonly composition: CompositionListing;
  readonly possessionMatrix: PossessionMatrix;
}

/**
 * Assemble the body studio card from one canonical `agent-body` read.
 * TYPED REJECTION (`BODY_UI_KIND_MISMATCH`) for any other kind.
 */
export function buildBodyStudioCard(read: CanonicalRead): BodyStudioCard {
  // Each projection asserts the kind itself (fail closed, same vocabulary).
  const identity = buildBodyVersionIdentityCard(read);
  const composition = buildCompositionListing(read);
  const possessionMatrix = buildPossessionMatrix(read);
  return Object.freeze({
    viewVersion: BODY_UI_VIEW_VERSION,
    recordId: read.recordId,
    sourceVersion: read.sourceVersion,
    sourceRevision: read.sourceRevision,
    readAt: read.readAt,
    identity,
    composition,
    possessionMatrix,
  } satisfies BodyStudioCard);
}
