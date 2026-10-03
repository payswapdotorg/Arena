/**
 * Purchase / entitlement action view models (Work Order B013; issue #88;
 * packages/marketplace-ui).
 *
 * Product truth 1 (fail-closed posture): a purchase view model states what
 * a purchase GRANTS (access under the listing licence terms; an
 * append-only entitlement grant in the grant ledger) and what it DOES NOT
 * grant — CERTIFICATION, first among them — as frozen data no view can
 * render away. Prices render only from records: an absent price renders as
 * unknown, never fabricated. Demo mode renders the action as demo-labelled
 * and NOT purchasable (no real pricing, no real purchase).
 */

import {
  asRecord,
  DEMO_MARKETPLACE_NOTE,
  deepFreezeView,
  MARKETPLACE_UI_VIEW_VERSION,
  PURCHASE_NOT_CERTIFICATION_NOTE,
  readString,
} from './shared.js';
import { buildRightsPosture } from './rights.js';

/** The closed availability vocabulary. */
export type PurchaseAvailabilityKind = 'offered' | 'demo' | 'unavailable';

/** What a purchase explicitly does NOT grant (frozen; certification first). */
export const PURCHASE_DOES_NOT_GRANT: readonly string[] = Object.freeze([
  'Certification — a purchase never certifies anything; certification renders only where a certification record exists, scoped to its composition tuple (Body Version × Substrate × Environment × Runtime × Suite).',
  'Verification — verification outcomes come from verification records, never from a purchase.',
  'Rights beyond the licence terms — the listing licence governs; ownership never broadens it.',
  'Fitness for any particular purpose — marketplace admission evidence implies no warranty.',
] as const);

/** The purchase action view model. */
export interface PurchaseActionView {
  readonly viewVersion: typeof MARKETPLACE_UI_VIEW_VERSION;
  readonly family: 'artifact' | 'expert-service';
  /** The composition posture the action renders under (session | demo). */
  readonly mode: 'session' | 'demo';
  readonly availability: PurchaseAvailabilityKind;
  readonly availabilityLabel: string;
  /** What a purchase grants (from the licence / engagement terms). */
  readonly grants: readonly string[];
  /** What a purchase does NOT grant (frozen; certification first). */
  readonly doesNotGrant: readonly string[];
  /** The recorded price terms, when the record carries them (never fabricated). */
  readonly price:
    | { readonly currency: string; readonly amountMinor: number; readonly unit: string; readonly display: string }
    | undefined;
  readonly priceNote: string | undefined;
  readonly demoNote: string | undefined;
  readonly truthNote: string;
  readonly unknownFields: readonly string[];
}

const AVAILABILITY_LABELS: Readonly<Record<PurchaseAvailabilityKind, string>> = Object.freeze({
  offered: 'Available',
  demo: 'Demo — not purchasable',
  unavailable: 'Not available',
} as const);

const NO_PRICE_NOTE =
  'No price is recorded on this listing record — rendered as unknown, never fabricated.';

/** Read one offer's price terms honestly. */
function readPrice(offers: readonly unknown[]): PurchaseActionView['price'] {
  for (const entry of offers) {
    const data = asRecord(entry);
    const rate = asRecord(data['rate']);
    const currency = readString(rate, 'currency') ?? readString(data, 'currency');
    const amountRaw = rate['amountMinor'] ?? data['amountMinor'];
    const amountMinor =
      typeof amountRaw === 'number' && Number.isInteger(amountRaw) && amountRaw >= 0
        ? amountRaw
        : undefined;
    const unit = readString(rate, 'unit') ?? readString(data, 'unit');
    if (currency !== undefined && amountMinor !== undefined) {
      const whole = Math.floor(amountMinor / 100);
      const cents = amountMinor % 100;
      return Object.freeze({
        currency,
        amountMinor,
        unit: unit ?? 'unit unknown',
        display: `${currency} ${String(whole)}.${String(cents).padStart(2, '0')} ${unit ?? ''}`.trim(),
      });
    }
  }
  return undefined;
}

/**
 * Build the purchase action view model from a composition input
 * (`{ family, mode, state?, offers?, rights? }`).
 *
 * Fail closed: an unregistered/retired listing is unavailable; unreadable
 * offers never fabricate a price; demo mode renders not-purchasable with the
 * demo note; the does-not-grant list always carries certification first.
 */
export function buildPurchaseActionView(input: unknown): PurchaseActionView {
  const data = asRecord(input);
  const unknownFields: string[] = [];

  const familyValue = readString(data, 'family');
  const family: PurchaseActionView['family'] =
    familyValue === 'expert-service' ? 'expert-service' : 'artifact';
  const mode: PurchaseActionView['mode'] = readString(data, 'mode') === 'demo' ? 'demo' : 'session';
  if (familyValue === undefined) unknownFields.push('family');

  const state = readString(data, 'state');
  const offersValue = data['offers'];
  const offers = Array.isArray(offersValue) ? offersValue : [];
  if (!Array.isArray(offersValue)) unknownFields.push('offers');

  const rights = buildRightsPosture(data['rights']);
  const price = family === 'expert-service' ? readPrice(offers) : undefined;

  let availability: PurchaseAvailabilityKind;
  if (mode === 'demo') {
    availability = 'demo';
  } else if (family === 'expert-service') {
    availability = offers.length > 0 ? 'offered' : 'unavailable';
  } else {
    availability = state === 'registered' ? 'offered' : 'unavailable';
  }

  const grants: string[] =
    family === 'expert-service'
      ? [
          'One engagement session under the offered commercial terms (scheduled, accepted and completed through the engagement ledger).',
        ]
      : [
          `Access under the licence terms (${
            rights.license ?? 'license unknown'
          }) — the rights posture renders the exact terms; ownership never broadens them.`,
        ];
  grants.push(
    'An append-only entitlement grant recorded in the grant ledger, with its explicit state (granted / revoked / expired / pending) rendered on the listing.',
  );

  const priceNote =
    family === 'artifact' || (price === undefined && offers.length > 0)
      ? NO_PRICE_NOTE
      : undefined;
  const demoNote = mode === 'demo' ? DEMO_MARKETPLACE_NOTE : undefined;

  return deepFreezeView({
    viewVersion: MARKETPLACE_UI_VIEW_VERSION,
    family,
    mode,
    availability,
    availabilityLabel: AVAILABILITY_LABELS[availability],
    grants: Object.freeze(grants),
    doesNotGrant: PURCHASE_DOES_NOT_GRANT,
    price,
    priceNote,
    demoNote,
    truthNote: PURCHASE_NOT_CERTIFICATION_NOTE,
    unknownFields: Object.freeze(unknownFields),
  } satisfies PurchaseActionView);
}
