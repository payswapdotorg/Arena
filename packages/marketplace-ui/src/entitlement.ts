/**
 * Entitlement state view models (Work Order B013; issue #88;
 * packages/marketplace-ui).
 *
 * The entitlement state machine renders EXPLICITLY: granted, revoked,
 * expired or pending — derived from the append-only grant record lineage
 * (A033 `EntitlementGrant` grants, or A032 marketplace grant records), and
 * NEVER implied by listing ownership, visibility, or a purchase. Resolved
 * record-backed states render as verified facts; not-yet-active grants
 * render as pending; an absent or unreadable grant renders as unknown.
 *
 * State-machine discipline (mirrors the A033 resolution precedence):
 *   revoked  >  expired  >  pending (not yet active)  >  granted
 * A revoked grant is TERMINAL — it never re-activates silently; without an
 * evaluation time the state fails closed to unknown (time-dependent states
 * are never guessed).
 */

import {
  asRecord,
  deepFreezeView,
  ENTITLEMENT_STATE_NOTE,
  MARKETPLACE_UI_VIEW_VERSION,
  parseTimestamp,
  readCount,
  readString,
} from './shared.js';

/** The closed entitlement state vocabulary (explicit, never implied). */
export type EntitlementStateKind = 'granted' | 'revoked' | 'expired' | 'pending' | 'unknown';

/** One append-only lineage event of an entitlement grant. */
export interface EntitlementLineageEventView {
  readonly sequence: number | undefined;
  readonly kind: 'granted' | 'amended' | 'revoked' | 'unknown';
  readonly occurredAt: string | undefined;
  readonly note: string | undefined;
}

/** The entitlement state view every listing carries. */
export interface EntitlementStateView {
  readonly viewVersion: typeof MARKETPLACE_UI_VIEW_VERSION;
  readonly state: EntitlementStateKind;
  readonly stateLabel: string;
  /** Resolved record-backed states are verified facts; pending/unknown are their own classes. */
  readonly truthClass: 'verified-fact' | 'pending' | 'unknown';
  readonly grantId: string | undefined;
  readonly offerId: string | undefined;
  readonly featureKey: string | undefined;
  readonly granteeTenant: string | undefined;
  readonly permittedUse: string | undefined;
  readonly grantedAt: string | undefined;
  readonly validFrom: string | undefined;
  readonly expiresAt: string | undefined;
  readonly revokedAt: string | undefined;
  readonly grounds: string | undefined;
  readonly lineage: readonly EntitlementLineageEventView[];
  readonly scopeNote: string;
  readonly unknownFields: readonly string[];
}

const ENTITLEMENT_STATE_LABELS: Readonly<Record<EntitlementStateKind, string>> =
  Object.freeze({
    granted: 'Granted',
    revoked: 'Revoked',
    expired: 'Expired',
    pending: 'Pending (not yet active)',
    unknown: 'Entitlement unknown',
  } as const);

function stateView(input: {
  readonly state: EntitlementStateKind;
  readonly grantId: string | undefined;
  readonly offerId: string | undefined;
  readonly featureKey: string | undefined;
  readonly granteeTenant: string | undefined;
  readonly permittedUse: string | undefined;
  readonly grantedAt: string | undefined;
  readonly validFrom: string | undefined;
  readonly expiresAt: string | undefined;
  readonly revokedAt: string | undefined;
  readonly grounds: string | undefined;
  readonly lineage: readonly EntitlementLineageEventView[];
  readonly unknownFields: readonly string[];
}): EntitlementStateView {
  const state = input.state;
  const truthClass: 'verified-fact' | 'pending' | 'unknown' =
    state === 'pending' ? 'pending' : state === 'unknown' ? 'unknown' : 'verified-fact';
  return deepFreezeView({
    viewVersion: MARKETPLACE_UI_VIEW_VERSION,
    state,
    stateLabel: ENTITLEMENT_STATE_LABELS[state],
    truthClass,
    grantId: input.grantId,
    offerId: input.offerId,
    featureKey: input.featureKey,
    granteeTenant: input.granteeTenant,
    permittedUse: input.permittedUse,
    grantedAt: input.grantedAt,
    validFrom: input.validFrom,
    expiresAt: input.expiresAt,
    revokedAt: input.revokedAt,
    grounds: input.grounds,
    lineage: Object.freeze([...input.lineage]),
    scopeNote: ENTITLEMENT_STATE_NOTE,
    unknownFields: Object.freeze([...input.unknownFields]),
  } satisfies EntitlementStateView);
}

/** Read an A033 lineage array honestly (append-only event views). */
function readLineage(value: unknown): readonly EntitlementLineageEventView[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const events: EntitlementLineageEventView[] = [];
  for (const entry of value) {
    const data = asRecord(entry);
    const kindValue = readString(data, 'kind');
    const kind: EntitlementLineageEventView['kind'] =
      kindValue === 'granted' || kindValue === 'amended' || kindValue === 'revoked'
        ? kindValue
        : 'unknown';
    events.push(
      Object.freeze({
        sequence: readCount(data, 'sequence'),
        kind,
        occurredAt: readString(data, 'occurredAt'),
        note: readString(data, 'note'),
      }),
    );
  }
  return Object.freeze(events);
}

/**
 * Derive the entitlement state from an A033 `EntitlementGrant`-shaped record
 * at an evaluation time. Precedence: revoked > expired > pending > granted.
 * FAIL CLOSED: without `at` (or with unparseable times) time-dependent
 * states resolve to unknown — only the lineage-decidable revoked state
 * survives; a grant without its lineage fails closed to unknown.
 */
export function entitlementStateFromGrantRecord(
  grant: unknown,
  at: string | undefined,
): EntitlementStateView {
  const data = asRecord(grant);
  const unknownFields: string[] = [];

  const grantId = readString(data, 'grantId');
  if (grantId === undefined) unknownFields.push('grantId');
  const featureKey = readString(data, 'featureKey');
  if (featureKey === undefined) unknownFields.push('featureKey');
  const granteeTenant = readString(data, 'tenantId');
  const validFrom = readString(data, 'validFrom');
  const expiresAt = readString(data, 'expiresAt');
  const lineage = readLineage(data['lineage']);
  if (lineage.length === 0) unknownFields.push('lineage');

  const lastEvent = lineage.length > 0 ? lineage[lineage.length - 1] : undefined;
  const revokedByLineage = lastEvent !== undefined && lastEvent.kind === 'revoked';

  const atMs = parseTimestamp(at);
  const expiresMs = parseTimestamp(expiresAt);
  const validMs = parseTimestamp(validFrom);
  if (at !== undefined && atMs === undefined) unknownFields.push('at (unparseable)');
  if (expiresAt !== undefined && expiresMs === undefined) {
    unknownFields.push('expiresAt (unparseable)');
  }
  if (validFrom !== undefined && validMs === undefined) unknownFields.push('validFrom (unparseable)');

  let state: EntitlementStateKind;
  if (revokedByLineage) {
    state = 'revoked';
  } else if (lineage.length === 0) {
    state = 'unknown';
  } else if (atMs === undefined) {
    state = 'unknown';
  } else if (expiresAt !== undefined && expiresMs === undefined) {
    state = 'unknown';
  } else if (validFrom !== undefined && validMs === undefined) {
    state = 'unknown';
  } else if (expiresMs !== undefined && atMs >= expiresMs) {
    state = 'expired';
  } else if (validMs !== undefined && atMs < validMs) {
    state = 'pending';
  } else {
    state = 'granted';
  }

  return stateView({
    state,
    grantId,
    offerId: undefined,
    featureKey,
    granteeTenant,
    permittedUse: undefined,
    grantedAt: readString(data, 'issuedAt'),
    validFrom,
    expiresAt,
    revokedAt: revokedByLineage ? lastEvent?.occurredAt : undefined,
    grounds: revokedByLineage ? lastEvent?.note : undefined,
    lineage,
    unknownFields,
  });
}

/**
 * Derive the entitlement state from an A032 marketplace grant record view
 * (`grant-issuance` / `grant-revocation`, append-only). A revocation record
 * is terminal; an issuance expires at its `expiresAt` when an evaluation
 * time is supplied; without an evaluation time only the record kind decides
 * (fail closed — time-dependent states never guess).
 */
export function entitlementStateFromMarketplaceGrant(
  grantView: unknown,
  at: string | undefined,
): EntitlementStateView {
  const data = asRecord(grantView);
  const unknownFields: string[] = [];

  const kind = readString(data, 'kind');
  if (kind === undefined) unknownFields.push('kind');
  const grantId = readString(data, 'grantId');
  if (grantId === undefined) unknownFields.push('grantId');
  const offerData = asRecord(data['offer']);
  const offerId = readString(offerData, 'offerId');
  const granteeTenant = readString(data, 'granteeTenant');
  const permittedUse = readString(data, 'permittedUse');
  const grantedAt = readString(data, 'grantedAt');
  const expiresAt = readString(data, 'expiresAt');
  const revokes = readString(data, 'revokes');
  const grounds = readString(data, 'grounds');
  const provenanceData = asRecord(data['provenance']);
  const recordedAt = readString(provenanceData, 'recordedAt');

  const atMs = parseTimestamp(at);
  const expiresMs = parseTimestamp(expiresAt);

  let state: EntitlementStateKind;
  if (kind === 'grant-revocation') {
    state = 'revoked';
  } else if (atMs !== undefined && expiresMs !== undefined && atMs >= expiresMs) {
    state = 'expired';
  } else if (atMs !== undefined && grantedAt !== undefined) {
    const grantedMs = parseTimestamp(grantedAt);
    state = grantedMs !== undefined && atMs < grantedMs ? 'pending' : 'granted';
  } else if (kind === 'grant-issuance') {
    state = 'granted';
  } else {
    state = 'unknown';
  }

  return stateView({
    state,
    grantId,
    offerId,
    featureKey: undefined,
    granteeTenant,
    permittedUse,
    grantedAt,
    validFrom: grantedAt,
    expiresAt,
    revokedAt: kind === 'grant-revocation' ? recordedAt : undefined,
    grounds,
    lineage:
      kind === 'grant-revocation'
        ? Object.freeze([
            Object.freeze({
              sequence: 1,
              kind: 'revoked',
              occurredAt: recordedAt,
              note: grounds ?? revokes,
            }),
          ])
        : Object.freeze([]),
    unknownFields,
  });
}

/**
 * The explicit no-grant entitlement: when no grant record exists the state
 * renders as unknown with the visibility note — entitlement is NEVER
 * implied by listing ownership or purchase intent.
 */
export function noGrantEntitlement(): EntitlementStateView {
  return stateView({
    state: 'unknown',
    grantId: undefined,
    offerId: undefined,
    featureKey: undefined,
    granteeTenant: undefined,
    permittedUse: undefined,
    grantedAt: undefined,
    validFrom: undefined,
    expiresAt: undefined,
    revokedAt: undefined,
    grounds: undefined,
    lineage: Object.freeze([]),
    unknownFields: Object.freeze(['grant record (absent)']),
  });
}

/**
 * The entitlement history of an A033 grant: its append-only lineage events,
 * honestly read (the detail screens render the full history, newest last).
 */
export function buildEntitlementHistory(
  grant: unknown,
): readonly EntitlementLineageEventView[] {
  return readLineage(asRecord(grant)['lineage']);
}

/** The closed state label (rendering helper). */
export function entitlementStateLabel(state: EntitlementStateKind): string {
  return ENTITLEMENT_STATE_LABELS[state];
}
