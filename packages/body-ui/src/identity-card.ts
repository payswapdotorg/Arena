/**
 * Body Version identity card (Work Order B010; issue #82; packages/body-ui).
 *
 * The identity card is the BODY-half of the studio: WHO the body is and
 * WHICH VERSION is current — with versioning EXPLICIT and immutability
 * unmistakable (architecture-lock rules 1, 5). The card projects the
 * canonical `agent-body` read payload HONESTLY: every field the payload
 * does not carry is `undefined` and listed in `unknownFields` (rendered as
 * unknown, never guessed). The substrate NEVER appears on this card — the
 * substrate belongs to a possession, and a possession is not the body
 * (lock rules 2, 3).
 */

import type { CanonicalRead } from '@arena/read-model';

import { assertReadKind } from './errors.js';
import {
  asRecord,
  BODY_UI_VIEW_VERSION,
  BODY_VERSION_IMMUTABILITY_NOTE,
  deepFreezeView,
  readString,
} from './shared.js';

/** The Body Version identity card view model (pure projection). */
export interface BodyVersionIdentityCard {
  readonly viewVersion: typeof BODY_UI_VIEW_VERSION;
  /** The canonical record id (content-addressed record identity). */
  readonly recordId: string;
  /** The stable body id (`bodyId` payload field), when the payload carries one. */
  readonly bodyId: string | undefined;
  /** Human display name, when carried. */
  readonly displayName: string | undefined;
  /** EXPLICIT versioning: the current version + lineage, as stored. */
  readonly versioning: {
    readonly explicit: true;
    readonly currentVersion: string | undefined;
    readonly initialVersion: string | undefined;
    readonly evolution: string | undefined;
  };
  /** The content digest of the current version, when the payload carries one. */
  readonly digest: string | undefined;
  /** Payload fields the read did not carry — rendered as unknown, never guessed. */
  readonly unknownFields: readonly string[];
  /** The immutability truth (lock rule 5), carried as data so the UI cannot drop it. */
  readonly immutabilityNote: string;
}

/**
 * Build the Body Version identity card from one canonical `agent-body`
 * read. TYPED REJECTION (`BODY_UI_KIND_MISMATCH`) for any other kind — a
 * certification or case read is never coerced into a body card.
 */
export function buildBodyVersionIdentityCard(read: CanonicalRead): BodyVersionIdentityCard {
  assertReadKind(read.kind, 'agent-body', read.recordId);
  const data = asRecord(read.data);
  const lineage = asRecord(data['lineage']);

  const unknownFields: string[] = [];
  const bodyId = readString(data, 'bodyId');
  if (bodyId === undefined) unknownFields.push('bodyId');
  const displayName = readString(data, 'displayName');
  if (displayName === undefined) unknownFields.push('displayName');
  const currentVersion = readString(lineage, 'currentVersion');
  if (currentVersion === undefined) unknownFields.push('lineage.currentVersion');
  const initialVersion = readString(lineage, 'initialVersion');
  if (initialVersion === undefined) unknownFields.push('lineage.initialVersion');
  const evolution = readString(lineage, 'evolution');
  const digest = readString(data, 'digest');
  if (digest === undefined) unknownFields.push('digest');

  return deepFreezeView({
    viewVersion: BODY_UI_VIEW_VERSION,
    recordId: read.recordId,
    bodyId,
    displayName,
    versioning: Object.freeze({
      explicit: true as const,
      currentVersion,
      initialVersion,
      evolution,
    }),
    digest,
    unknownFields: Object.freeze(unknownFields),
    immutabilityNote: BODY_VERSION_IMMUTABILITY_NOTE,
  } satisfies BodyVersionIdentityCard);
}

/**
 * The one-line identity label of a card: `displayName (bodyId@version)` —
 * deterministic, and NEVER a substrate name (the substrate is not the body).
 */
export function bodyIdentityLabel(card: BodyVersionIdentityCard): string {
  const who =
    card.displayName !== undefined ? card.displayName : card.bodyId !== undefined ? card.bodyId : card.recordId;
  const version = card.versioning.currentVersion;
  const bodyId = card.bodyId;
  if (bodyId !== undefined && version !== undefined) {
    return `${who} (${bodyId}@${version})`;
  }
  if (version !== undefined) {
    return `${who} (version ${version})`;
  }
  return who;
}
