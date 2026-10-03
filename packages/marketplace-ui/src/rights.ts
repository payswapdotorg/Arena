/**
 * Rights posture view models (Work Order B013; issue #88;
 * packages/marketplace-ui).
 *
 * The rights posture projects A002 `RightsMetadata` (licence, commercial
 * use, redistribution, customer-data policies — plus professional
 * limitations where a surface carries them) into the "what you may do with
 * this listing" view. Rights metadata renders under the EVIDENCE truth
 * class: a licence record is auditable evidence, never a verified claim.
 *
 * Honest: an unreadable rights block yields posture `unknown` — the view
 * renders "rights unknown", never a fabricated open licence.
 */

import {
  asRecord,
  deepFreezeView,
  MARKETPLACE_UI_VIEW_VERSION,
  RIGHTS_TRUTH_CLASS,
  readString,
} from './shared.js';

/** The closed rights-posture vocabulary. */
export type RightsPostureKind = 'open' | 'licence-required' | 'restricted' | 'unknown';

/** The rights posture every listing view model carries. */
export interface RightsPosture {
  readonly viewVersion: typeof MARKETPLACE_UI_VIEW_VERSION;
  /** Rights metadata renders under the evidence truth class. */
  readonly truthClass: typeof RIGHTS_TRUTH_CLASS;
  readonly license: string | undefined;
  readonly commercialUse: string | undefined;
  readonly redistribution: string | undefined;
  readonly customerData: string | undefined;
  readonly professionalLimitations: readonly string[];
  readonly posture: RightsPostureKind;
  readonly postureLabel: string;
  readonly scopeNote: string;
  readonly unknownFields: readonly string[];
}

/** The one-line posture labels (closed vocabulary, no collapse). */
const RIGHTS_POSTURE_LABELS: Readonly<Record<RightsPostureKind, string>> = Object.freeze({
  open: 'Open licence',
  'licence-required': 'Licence required',
  restricted: 'Restricted',
  unknown: 'Rights unknown',
} as const);

/** The rights truth carried as data (a licence record is evidence). */
const RIGHTS_SCOPE_NOTE =
  'Rights metadata renders under the evidence truth class: the licence terms are an auditable record. The posture summarizes the terms — it never broadens them, and ownership never implies them.';

/**
 * Read professional limitations honestly: plain strings (A002 rights) or
 * `{ class, statement }` records (expert domain scope) both project to their
 * statement text; malformed entries are skipped and recorded.
 */
function readLimitations(
  data: Readonly<Record<string, unknown>>,
  unknownFields: string[],
): readonly string[] {
  const value = data['professionalLimitations'];
  if (!Array.isArray(value)) return Object.freeze([]);
  const statements: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry === 'string' && entry.length > 0) {
      statements.push(entry);
      return;
    }
    const entryData = asRecord(entry);
    const statement = readString(entryData, 'statement');
    if (statement !== undefined) {
      statements.push(statement);
      return;
    }
    unknownFields.push(`professionalLimitations[${String(index)}] (malformed)`);
  });
  return Object.freeze(statements);
}

/** Derive the posture kind from the honest policy reads (closed rules). */
function derivePosture(
  license: string | undefined,
  commercialUse: string | undefined,
  redistribution: string | undefined,
  customerData: string | undefined,
): RightsPostureKind {
  if (
    license === undefined &&
    commercialUse === undefined &&
    redistribution === undefined &&
    customerData === undefined
  ) {
    return 'unknown';
  }
  if (
    commercialUse === 'prohibited' ||
    redistribution === 'prohibited' ||
    redistribution === 'tenant-only' ||
    customerData === 'contains'
  ) {
    return 'restricted';
  }
  if (commercialUse === 'requires-license') return 'licence-required';
  if (commercialUse === 'allowed' && redistribution === 'allowed') return 'open';
  return 'unknown';
}

/**
 * Build the rights posture from an A002 `RightsMetadata`-shaped payload.
 * Honest: absent/foreign-typed fields degrade to unknown (listed); an empty
 * rights block renders posture `unknown`, never an implied open licence.
 */
export function buildRightsPosture(rights: unknown): RightsPosture {
  const data = asRecord(rights);
  const unknownFields: string[] = [];

  const license = readString(data, 'license');
  if (license === undefined) unknownFields.push('license');
  const commercialUse = readString(data, 'commercialUse');
  if (commercialUse === undefined) unknownFields.push('commercialUse');
  const redistribution = readString(data, 'redistribution');
  if (redistribution === undefined) unknownFields.push('redistribution');
  const customerData = readString(data, 'customerData');
  if (customerData === undefined) unknownFields.push('customerData');
  const professionalLimitations = readLimitations(data, unknownFields);

  const posture = derivePosture(license, commercialUse, redistribution, customerData);

  return deepFreezeView({
    viewVersion: MARKETPLACE_UI_VIEW_VERSION,
    truthClass: RIGHTS_TRUTH_CLASS,
    license,
    commercialUse,
    redistribution,
    customerData,
    professionalLimitations,
    posture,
    postureLabel: RIGHTS_POSTURE_LABELS[posture],
    scopeNote: RIGHTS_SCOPE_NOTE,
    unknownFields: Object.freeze(unknownFields),
  } satisfies RightsPosture);
}

/** The closed posture label for a posture kind (rendering helper). */
export function rightsPostureLabel(posture: RightsPostureKind): string {
  return RIGHTS_POSTURE_LABELS[posture];
}
