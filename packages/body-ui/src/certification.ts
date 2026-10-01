/**
 * Certification claim cards (Work Order B010; issue #82; packages/body-ui).
 *
 * A certification claim asserts a statement about a TESTED COMPOSITION —
 * "Agent Body B, version V, ... satisfied Certification Suite S" — never
 * about the bare model (architecture-lock rule 4). The card projects the
 * canonical `certification` read payload honestly and carries the scope
 * note as frozen data so the UI cannot render a claim as if it covered
 * the model in isolation. Matching a claim to a body is EXACT: the
 * subject's bodyId@version must equal the body's identity — a claim over
 * v1.1.0 never attaches to v1.2.0.
 */

import type { CanonicalRead } from '@arena/read-model';

import { assertReadKind } from './errors.js';
import {
  asRecord,
  BODY_UI_VIEW_VERSION,
  CERTIFICATION_SCOPE_NOTE,
  deepFreezeView,
  readString,
} from './shared.js';

/** One certification claim card (a claim about the tested composition). */
export interface CertificationClaimCard {
  readonly viewVersion: typeof BODY_UI_VIEW_VERSION;
  readonly recordId: string;
  readonly certificationId: string | undefined;
  /** The TESTED COMPOSITION the claim is scoped to (subject bodyId@version), when carried. */
  readonly subject: { readonly bodyId: string; readonly version: string } | undefined;
  readonly verdict: string | undefined;
  readonly certificationKind: string | undefined;
  readonly basis: string | undefined;
  readonly certifiedAt: string | undefined;
  /** The scope truth (lock rule 4), carried as data. */
  readonly scopeNote: string;
  /** Payload fields the read did not carry — rendered as unknown. */
  readonly unknownFields: readonly string[];
}

/**
 * Build one certification claim card from a canonical `certification`
 * read. TYPED REJECTION (`BODY_UI_KIND_MISMATCH`) for any other kind.
 */
export function buildCertificationClaimCard(read: CanonicalRead): CertificationClaimCard {
  assertReadKind(read.kind, 'certification', read.recordId);
  const data = asRecord(read.data);

  const unknownFields: string[] = [];
  const certificationId = readString(data, 'certificationId');
  if (certificationId === undefined) unknownFields.push('certificationId');
  const subjectData = asRecord(data['subject']);
  const subjectBodyId = readString(subjectData, 'bodyId');
  const subjectVersion = readString(subjectData, 'bodyVersion');
  const subject =
    subjectBodyId !== undefined && subjectVersion !== undefined
      ? Object.freeze({ bodyId: subjectBodyId, version: subjectVersion })
      : undefined;
  if (subject === undefined) unknownFields.push('subject (bodyId@bodyVersion)');
  const verdict = readString(data, 'verdict');
  if (verdict === undefined) unknownFields.push('verdict');
  const certificationKind = readString(data, 'certificationKind');
  if (certificationKind === undefined) unknownFields.push('certificationKind');
  const basis = readString(data, 'basis');
  if (basis === undefined) unknownFields.push('basis');
  const certifiedAt = readString(data, 'certifiedAt');
  if (certifiedAt === undefined) unknownFields.push('certifiedAt');

  return deepFreezeView({
    viewVersion: BODY_UI_VIEW_VERSION,
    recordId: read.recordId,
    certificationId,
    subject,
    verdict,
    certificationKind,
    basis,
    certifiedAt,
    scopeNote: CERTIFICATION_SCOPE_NOTE,
    unknownFields: Object.freeze(unknownFields),
  } satisfies CertificationClaimCard);
}

/**
 * True iff the claim's subject is EXACTLY the given body version — a
 * certification over v1.1.0 never applies to any other version (and a
 * subject-less claim applies to nothing, rendered as unknown).
 */
export function certificationAppliesToBody(
  claim: CertificationClaimCard,
  body: { readonly bodyId: string | undefined; readonly version: string | undefined },
): boolean {
  if (claim.subject === undefined) return false;
  if (body.bodyId === undefined || body.version === undefined) return false;
  return claim.subject.bodyId === body.bodyId && claim.subject.version === body.version;
}

/**
 * The one-line scope label of a claim: `bodyId@version — tested composition`
 * (or `subject unknown`), so a rendered claim always names its scope.
 */
export function certificationScopeLabel(claim: CertificationClaimCard): string {
  if (claim.subject === undefined) {
    return 'subject unknown — the claim’s tested composition is not readable';
  }
  return `${claim.subject.bodyId}@${claim.subject.version} (tested composition)`;
}
