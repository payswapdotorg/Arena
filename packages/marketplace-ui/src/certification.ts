/**
 * Certification presence view models (Work Order B013; issue #88;
 * packages/marketplace-ui).
 *
 * Product truth 1: a marketplace purchase is NOT a certification. A
 * certification badge renders ONLY where a certification record backs it,
 * scoped to its composition tuple (Body Version × Substrate × Environment ×
 * Runtime × Suite). A listing without such a record renders "not certified"
 * — explicitly, never as a blank — and an unreadable record renders
 * "unknown", never a guessed badge.
 *
 * The builder accepts either canonical shape honestly: the read-model
 * `certification` payload (subject bodyId@bodyVersion, verdict, basis) or
 * the composition-scoped certification record (subject refs + suiteRef).
 */

import {
  asRecord,
  CERTIFICATION_COMPOSITION_SCOPE_NOTE,
  deepFreezeView,
  MARKETPLACE_UI_VIEW_VERSION,
  readString,
} from './shared.js';

/** The closed certification-presence vocabulary. */
export type CertificationPresenceKind = 'certified' | 'not-certified' | 'unknown';

/** The certification presence every listing view model carries. */
export interface CertificationPresence {
  readonly viewVersion: typeof MARKETPLACE_UI_VIEW_VERSION;
  /** A rendered badge carries the certification truth class; absence renders as unknown. */
  readonly truthClass: 'certification' | 'unknown';
  readonly status: CertificationPresenceKind;
  readonly statusLabel: string;
  readonly certificationId: string | undefined;
  readonly recordId: string | undefined;
  /** The composition tuple the record is scoped to (fields honestly unknown). */
  readonly subject:
    | {
        readonly bodyVersion: string | undefined;
        readonly substrate: string | undefined;
        readonly environment: string | undefined;
        readonly runtime: string | undefined;
        readonly suite: string | undefined;
      }
    | undefined;
  readonly verdict: string | undefined;
  readonly certifiedAt: string | undefined;
  readonly basis: string | undefined;
  readonly scopeNote: string;
  readonly unknownFields: readonly string[];
}

/** The explicit absence label — never a blank. */
export const NOT_CERTIFIED_LABEL = 'Not certified' as const;

const CERTIFIED_LABEL = 'Certified' as const;
const UNKNOWN_LABEL = 'Certification unknown' as const;

const NOT_CERTIFIED_NOTE = `${CERTIFICATION_COMPOSITION_SCOPE_NOTE} No certification record backs this listing — a marketplace purchase is never a certification.`;
const UNKNOWN_RECORD_NOTE =
  'A certification record was supplied but could not be read honestly — rendered as unknown, never as a guessed badge.';

/**
 * Build the certification presence from a certification record payload
 * (either the read-model shape or the composition-scoped record shape).
 *
 * - no record supplied → `not-certified` (rendered explicitly);
 * - a readable record → `certified` with its composition scope (missing
 *   fields listed as unknown — the scope never narrows silently);
 * - a supplied-but-unreadable record → `unknown` (fail honest).
 */
export function buildCertificationPresence(record: unknown): CertificationPresence {
  const wrapper = asRecord(record);
  // Accept the canonical read envelope ({ kind, recordId, data }) or the payload directly.
  const payload =
    readString(wrapper, 'kind') === 'certification' && wrapper['data'] !== undefined
      ? asRecord(wrapper['data'])
      : wrapper;

  const certificationId = readString(payload, 'certificationId');
  const recordId = readString(wrapper, 'recordId');
  const verdict = readString(payload, 'verdict');
  const certifiedAt = readString(payload, 'certifiedAt');
  const basis = readString(payload, 'basis');

  const subjectData = asRecord(payload['subject']);
  const bodyVersionRef = asRecord(subjectData['bodyVersionRef']);
  const substrateRef = asRecord(subjectData['substrateRef']);
  const environmentRef = asRecord(subjectData['environmentRef']);
  const runtimeProfile = asRecord(subjectData['runtimeProfile']);
  const suiteRef = readString(payload, 'suiteRef');

  const bodyVersion =
    readString(bodyVersionRef, 'version') ?? readString(subjectData, 'bodyVersion');
  const bodyName =
    readString(bodyVersionRef, 'name') ?? readString(subjectData, 'bodyId');
  const substrate = readString(substrateRef, 'substrateId');
  const environment = readString(environmentRef, 'environmentId');
  const runtime = readString(runtimeProfile, 'runtimeId');

  const unknownFields: string[] = [];
  const readable =
    certificationId !== undefined ||
    bodyName !== undefined ||
    bodyVersion !== undefined ||
    suiteRef !== undefined ||
    verdict !== undefined ||
    certifiedAt !== undefined;

  let subject: CertificationPresence['subject'] = undefined;
  if (bodyName !== undefined || bodyVersion !== undefined) {
    subject = Object.freeze({
      bodyVersion: bodyName !== undefined && bodyVersion !== undefined
        ? `${bodyName}@${bodyVersion}`
        : bodyVersion,
      substrate,
      environment,
      runtime,
      suite: suiteRef,
    });
  }

  let status: CertificationPresenceKind;
  let statusLabel: string;
  let scopeNote: string;
  if (!readable) {
    status = Object.keys(payload).length === 0 ? 'not-certified' : 'unknown';
    statusLabel = status === 'not-certified' ? NOT_CERTIFIED_LABEL : UNKNOWN_LABEL;
    scopeNote = status === 'not-certified' ? NOT_CERTIFIED_NOTE : UNKNOWN_RECORD_NOTE;
  } else {
    status = 'certified';
    statusLabel = CERTIFIED_LABEL;
    scopeNote = CERTIFICATION_COMPOSITION_SCOPE_NOTE;
    if (certificationId === undefined) unknownFields.push('certificationId');
    if (subject === undefined) unknownFields.push('subject (bodyId@bodyVersion)');
    if (substrate === undefined) unknownFields.push('subject.substrateRef');
    if (environment === undefined) unknownFields.push('subject.environmentRef');
    if (runtime === undefined) unknownFields.push('subject.runtimeProfile');
    if (suiteRef === undefined) unknownFields.push('suiteRef');
    if (verdict === undefined) unknownFields.push('verdict');
    if (certifiedAt === undefined) unknownFields.push('certifiedAt');
  }

  return deepFreezeView({
    viewVersion: MARKETPLACE_UI_VIEW_VERSION,
    truthClass: status === 'certified' ? 'certification' : 'unknown',
    status,
    statusLabel,
    certificationId,
    recordId,
    subject,
    verdict,
    certifiedAt,
    basis,
    scopeNote,
    unknownFields: Object.freeze(unknownFields),
  } satisfies CertificationPresence);
}
