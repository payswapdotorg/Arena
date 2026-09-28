/**
 * Expert qualifications (Work Order A006; docs/architecture.md §8
 * "qualifications"; architecture-lock rule 9).
 *
 * A qualification is a TYPED DATA record: a credential reference, the
 * evidence digests backing it, a closed status vocabulary, optional
 * validity window and optional jurisdiction. This is qualification DATA —
 * it is NOT an authorization grant and NOT a system authority claim:
 * `verified` means "evidence has been attached and attested", never "may
 * act". The qualification ENGINE that adjudicates statuses is A007; the
 * matching engine is A007; this module only provides the typed data
 * contracts they consume.
 */

import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import { isJurisdictionView, toJurisdictionView } from './domain-scope.js';
import type { JurisdictionView } from './domain-scope.js';
import {
  deepFreeze,
  isContentDigest,
  isNeutralLocator,
  toContentDigest,
  toNeutralLocator,
} from './shared.js';
import type { ContentDigest } from './shared.js';
import { isExpertRegistryTimestamp, toExpertRegistryTimestamp } from './timestamp.js';

/** Wire version of the qualification record shape. */
export const EXPERT_QUALIFICATION_VERSION = 1 as const;

/** Closed credential reference kinds (professional credentials, not provider credentials). */
export const CREDENTIAL_KINDS = [
  'professional-license',
  'certification',
  'degree',
  'training-certificate',
  'credential-attestation',
  'external-credential',
] as const;

export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export function isCredentialKind(value: unknown): value is CredentialKind {
  return (
    typeof value === 'string' &&
    (CREDENTIAL_KINDS as readonly string[]).includes(value)
  );
}

/**
 * A credential reference: the credential's kind, a neutral opaque reference
 * (registry number, cert id — charset excludes email/phone shapes by
 * construction), and the OPTIONAL issuing body (an organization, never a
 * person).
 */
export interface CredentialRefView {
  readonly kind: CredentialKind;
  readonly reference: string;
  readonly issuer?: string;
}

export function isCredentialRefView(value: unknown): value is CredentialRefView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isCredentialKind(candidate['kind']) &&
    isNeutralLocator(candidate['reference']) &&
    (candidate['issuer'] === undefined || typeof candidate['issuer'] === 'string')
  );
}

/** Validate and freeze a credential reference; throws INVALID_CREDENTIAL_REF otherwise. */
export function toCredentialRefView(value: {
  kind: string;
  reference: string;
  issuer?: string;
}): CredentialRefView {
  if (!isCredentialKind(value.kind)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_CREDENTIAL_REF, {
      message: `unknown credential kind: ${JSON.stringify(value.kind)} (known: ${CREDENTIAL_KINDS.join(', ')})`,
      details: { known: [...CREDENTIAL_KINDS] },
    });
  }
  toNeutralLocator(value.reference, 'credential reference');
  if (value.issuer !== undefined) {
    if (typeof value.issuer !== 'string' || value.issuer.length === 0) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_CREDENTIAL_REF, {
        message: `credential issuer, when present, must be a non-empty organization string: ${JSON.stringify(value.issuer)}`,
      });
    }
    if (value.issuer.length > 255) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_CREDENTIAL_REF, {
        message: 'credential issuer must be at most 255 characters',
      });
    }
  }
  return Object.freeze({
    kind: value.kind,
    reference: value.reference,
    ...(value.issuer !== undefined ? { issuer: value.issuer } : {}),
  });
}

/**
 * Closed qualification status vocabulary. Statuses are DATA about the
 * evidence lifecycle of a credential claim; they grant nothing (lock
 * rule 9 — qualification is distinct from authorization).
 */
export const QUALIFICATION_STATUSES = [
  'claimed',
  'attested',
  'verified',
  'expired',
  'revoked',
  'disputed',
] as const;

export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number];

export function isQualificationStatus(value: unknown): value is QualificationStatus {
  return (
    typeof value === 'string' &&
    (QUALIFICATION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * One expert qualification record: the credential, its evidence digests
 * (>= 1 — an evidence-free credential claim is structurally rejected), its
 * status, an optional validity window and an optional jurisdiction.
 */
export interface ExpertQualification {
  readonly qualificationVersion: typeof EXPERT_QUALIFICATION_VERSION;
  readonly credential: CredentialRefView;
  /** Digests of the artifacts backing the credential claim (>= 1). */
  readonly evidence: readonly ContentDigest[];
  readonly status: QualificationStatus;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly jurisdiction?: JurisdictionView;
  readonly note?: string;
}

export function isExpertQualification(value: unknown): value is ExpertQualification {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['qualificationVersion'] !== EXPERT_QUALIFICATION_VERSION ||
    !isCredentialRefView(candidate['credential']) ||
    !isQualificationStatus(candidate['status'])
  ) {
    return false;
  }
  const evidence = candidate['evidence'];
  if (
    !Array.isArray(evidence) ||
    evidence.length === 0 ||
    !evidence.every((digest) => isContentDigest(digest))
  ) {
    return false;
  }
  if (
    candidate['validFrom'] !== undefined &&
    !isExpertRegistryTimestamp(candidate['validFrom'])
  ) {
    return false;
  }
  if (
    candidate['validUntil'] !== undefined &&
    !isExpertRegistryTimestamp(candidate['validUntil'])
  ) {
    return false;
  }
  if (
    candidate['jurisdiction'] !== undefined &&
    !isJurisdictionView(candidate['jurisdiction'])
  ) {
    return false;
  }
  if (
    candidate['note'] !== undefined &&
    (typeof candidate['note'] !== 'string' || candidate['note'].length === 0)
  ) {
    return false;
  }
  return true;
}

/** Validate and freeze one qualification; throws INVALID_QUALIFICATION otherwise. */
export function toExpertQualification(value: {
  credential: {
    kind: string;
    reference: string;
    issuer?: string;
  };
  evidence: readonly string[];
  status: string;
  validFrom?: string;
  validUntil?: string;
  jurisdiction?: { country: string; region?: string };
  note?: string;
}): ExpertQualification {
  const credential = toCredentialRefView(value.credential);
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_QUALIFICATION, {
      message:
        'a qualification requires at least one evidence digest (an evidence-free credential claim is not a qualification — R7)',
      details: { field: 'evidence' },
    });
  }
  const evidence = Object.freeze(value.evidence.map((digest) => toContentDigest(digest)));
  const seen = new Set<string>();
  for (const digest of evidence) {
    if (seen.has(digest)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_QUALIFICATION, {
        message: `duplicate qualification evidence digest: ${digest}`,
        details: { digest },
      });
    }
    seen.add(digest);
  }
  if (!isQualificationStatus(value.status)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_QUALIFICATION, {
      message: `unknown qualification status: ${JSON.stringify(value.status)} (known: ${QUALIFICATION_STATUSES.join(', ')}) — statuses are data about evidence, never authorization`,
      details: { known: [...QUALIFICATION_STATUSES] },
    });
  }
  const validFrom =
    value.validFrom === undefined ? undefined : toExpertRegistryTimestamp(value.validFrom);
  const validUntil =
    value.validUntil === undefined ? undefined : toExpertRegistryTimestamp(value.validUntil);
  if (validFrom !== undefined && validUntil !== undefined && validUntil <= validFrom) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_QUALIFICATION, {
      message: `qualification validity window is empty: validUntil ${JSON.stringify(validUntil)} is not after validFrom ${JSON.stringify(validFrom)}`,
      details: { validFrom, validUntil },
    });
  }
  const jurisdiction =
    value.jurisdiction === undefined ? undefined : toJurisdictionView(value.jurisdiction);
  if (value.note !== undefined && value.note.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_QUALIFICATION, {
      message: 'qualification notes, when present, must be non-empty',
    });
  }
  return deepFreeze({
    qualificationVersion: EXPERT_QUALIFICATION_VERSION,
    credential,
    evidence,
    status: value.status,
    ...(validFrom !== undefined ? { validFrom } : {}),
    ...(validUntil !== undefined ? { validUntil } : {}),
    ...(jurisdiction !== undefined ? { jurisdiction } : {}),
    ...(value.note !== undefined ? { note: value.note } : {}),
  });
}

/**
 * Validate a qualification list. The list may be EMPTY (a draft expert may
 * have no credentials yet — the qualification engine, A007, adds and
 * re-statuses them later), but each present record is strictly validated.
 */
export function toExpertQualificationList(
  values: readonly Parameters<typeof toExpertQualification>[0][],
): readonly ExpertQualification[] {
  if (!Array.isArray(values)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_QUALIFICATION, {
      message: 'qualifications must be an array of typed records',
      details: { field: 'qualifications' },
    });
  }
  return Object.freeze(values.map((value) => toExpertQualification(value)));
}
