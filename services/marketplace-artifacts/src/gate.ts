/**
 * Listing admission gate (Work Order A032): marketplace listing
 * publication is GATED on provenance and verification evidence.
 *
 * The gate is modeled on the A024 release-admission gate discipline:
 *
 *   - every citation must RESOLVE through injected digest-addressed
 *     evidence stores (the marketplace never reaches into another
 *     service's storage);
 *   - every resolved record must be structurally valid (the owning
 *     packages' is* guards — A002 provenance, A013 verification);
 *   - every resolved record must be tamper-verified (digest
 *     recomputation against the cited digest);
 *   - every record must be ABOUT the exact subject being listed
 *     (subject match on the artifact digest);
 *   - at least one PASSING A013 verification statement
 *     (outcome === 'pass', the DERIVED verdict) must cover the subject.
 *
 * The gate returns structured verdicts — it NEVER throws on refusable
 * input (fail-closed values, not exceptions); it throws only when the
 * caller hands it structurally invalid gate input (not evidence).
 */

import { isProvenanceRecord, provenanceRecordDigest } from '@arena/provenance';
import type { ProvenanceRecord } from '@arena/provenance';
import {
  recomputeVerificationRecordDigest,
  isVerificationRecord,
} from '@arena/verification';
import type { VerificationRecord } from '@arena/verification';
import type { ArtifactRef } from '@arena/artifact-protocol';
import { MARKETPLACE_ERROR_CODES, MarketplaceError } from './errors.js';
import {
  deepFreeze,
  expectDigest,
  expectEnumMember,
  isPlainObject,
} from './shared.js';

/** Evidence citation kinds the marketplace gate understands (closed). */
export const MARKETPLACE_EVIDENCE_KINDS = Object.freeze(['provenance', 'verification'] as const);
export type MarketplaceEvidenceKind = (typeof MARKETPLACE_EVIDENCE_KINDS)[number];

/** One evidence citation: kind + the digest of the cited record. */
export interface MarketplaceEvidenceRef {
  readonly kind: MarketplaceEvidenceKind;
  readonly digest: string;
}

/** Closed rejection-reason vocabulary (fail-closed gate verdicts). */
export const MARKETPLACE_GATE_REJECTION_REASONS = Object.freeze([
  'evidence-missing',
  'evidence-kind-unknown',
  'evidence-unresolvable',
  'evidence-structurally-invalid',
  'evidence-digest-mismatch',
  'provenance-missing',
  'provenance-subject-mismatch',
  'verification-missing',
  'verification-subject-mismatch',
  'verification-outcome-not-pass',
] as const);
export type MarketplaceGateRejectionReason =
  (typeof MARKETPLACE_GATE_REJECTION_REASONS)[number];

/** One structured gate rejection (never a thrown error). */
export interface MarketplaceGateRejection {
  readonly reason: MarketplaceGateRejectionReason;
  readonly source: MarketplaceEvidenceKind | 'gate';
  readonly ref: string | null;
  readonly detail: string;
}

/** The gate verdict: admitted only with ZERO rejections (fail closed). */
export interface MarketplaceGateVerdict {
  readonly admitted: boolean;
  readonly rejections: readonly MarketplaceGateRejection[];
}

/** Digest-addressed evidence lookup (injected; returns null when absent). */
export type MarketplaceEvidenceLookup = (
  digest: string,
) => unknown | null | Promise<unknown | null>;

/** The injected evidence stores backing the gate. */
export interface MarketplaceEvidenceStores {
  readonly provenance: MarketplaceEvidenceLookup;
  readonly verification: MarketplaceEvidenceLookup;
}

/** Validate one evidence citation (closed kinds, 64-hex digests). */
export function toMarketplaceEvidenceRef(value: unknown): MarketplaceEvidenceRef {
  if (!isPlainObject(value)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_EVIDENCE, {
      message: 'evidence citation must be a plain object {kind, digest}',
    });
  }
  const kind = expectEnumMember(
    (value as Record<string, unknown>)['kind'],
    MARKETPLACE_EVIDENCE_KINDS,
    MARKETPLACE_ERROR_CODES.INVALID_EVIDENCE,
    'evidence citation kind',
  );
  const digest = expectDigest(
    (value as Record<string, unknown>)['digest'],
    MARKETPLACE_ERROR_CODES.INVALID_EVIDENCE,
    'evidence citation digest',
  );
  return deepFreeze({ kind, digest });
}

/** Validate a citation list (non-empty, unique). */
export function toMarketplaceEvidenceRefs(
  values: readonly unknown[],
): readonly MarketplaceEvidenceRef[] {
  if (values.length === 0) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_EVIDENCE, {
      message: 'listing publication requires at least one evidence citation',
    });
  }
  const refs = values.map((value) => toMarketplaceEvidenceRef(value));
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.digest}`;
    if (seen.has(key)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_EVIDENCE, {
        message: `duplicate evidence citation ${JSON.stringify(key)}`,
        details: { kind: ref.kind, digest: ref.digest },
      });
    }
    seen.add(key);
  }
  return deepFreeze([...refs]);
}

function rejection(
  reason: MarketplaceGateRejectionReason,
  source: MarketplaceEvidenceKind | 'gate',
  ref: string | null,
  detail: string,
): MarketplaceGateRejection {
  return { reason, source, ref, detail };
}

/** Does this verification record cite the subject artifact digest? */
function verificationCoversSubject(
  record: VerificationRecord,
  subjectDigest: string,
): boolean {
  return record.evidence.some((reference) => reference.artifact.digest === subjectDigest);
}

/**
 * Evaluate the listing admission gate. Refusable evidence produces
 * structured rejections (fail-closed VALUES); the gate throws only on
 * structurally invalid gate input (subject/evidence shapes).
 */
export async function evaluateListingGate(
  subject: ArtifactRef,
  evidence: readonly MarketplaceEvidenceRef[],
  stores: MarketplaceEvidenceStores,
): Promise<MarketplaceGateVerdict> {
  const rejections: MarketplaceGateRejection[] = [];
  if (evidence.length === 0) {
    return deepFreeze({
      admitted: false,
      rejections: [rejection('evidence-missing', 'gate', null, 'no evidence citations were provided')],
    });
  }

  let provenanceAboutSubject = false;
  let validProvenanceCount = 0;
  let verificationPassAboutSubject = false;
  let validVerificationCount = 0;

  for (const citation of evidence) {
    const store =
      citation.kind === 'provenance' ? stores.provenance : stores.verification;

    let record: unknown;
    try {
      record = await store(citation.digest);
    } catch (error) {
      rejections.push(
        rejection(
          'evidence-unresolvable',
          citation.kind,
          citation.digest,
          `evidence store threw: ${error instanceof Error ? error.message : 'unknown error'}`,
        ),
      );
      continue;
    }
    if (record === null || record === undefined) {
      rejections.push(
        rejection(
          'evidence-unresolvable',
          citation.kind,
          citation.digest,
          'evidence store resolved no record for the cited digest',
        ),
      );
      continue;
    }

    if (citation.kind === 'provenance') {
      if (!isProvenanceRecord(record)) {
        rejections.push(
          rejection(
            'evidence-structurally-invalid',
            'provenance',
            citation.digest,
            'cited record is not a structurally valid A002 provenance record',
          ),
        );
        continue;
      }
      const recomputed = await provenanceRecordDigest(record);
      if (recomputed !== citation.digest) {
        rejections.push(
          rejection(
            'evidence-digest-mismatch',
            'provenance',
            citation.digest,
            'provenance record digest does not match its content (tamper)',
          ),
        );
        continue;
      }
      validProvenanceCount += 1;
      if (record.artifact.digest === subject.digest) {
        provenanceAboutSubject = true;
      }
      continue;
    }

    // citation.kind === 'verification'
    if (!isVerificationRecord(record)) {
      rejections.push(
        rejection(
          'evidence-structurally-invalid',
          'verification',
          citation.digest,
          'cited record is not a structurally valid A013 verification record',
        ),
      );
      continue;
    }
    let digestOk = true;
    try {
      await recomputeVerificationRecordDigest(record, citation.digest);
    } catch {
      digestOk = false;
    }
    if (!digestOk) {
      rejections.push(
        rejection(
          'evidence-digest-mismatch',
          'verification',
          citation.digest,
          'verification record digest does not match its content (tamper)',
        ),
      );
      continue;
    }
    validVerificationCount += 1;
    if (verificationCoversSubject(record, subject.digest)) {
      if (record.outcome === 'pass') {
        verificationPassAboutSubject = true;
      } else {
        rejections.push(
          rejection(
            'verification-outcome-not-pass',
            'verification',
            citation.digest,
            `verification statement about the subject has outcome ${JSON.stringify(record.outcome)} — only pass statements admit listings`,
          ),
        );
      }
    }
  }

  // Provenance requirement (A002 lineage must exist for the subject).
  if (validProvenanceCount === 0 && !rejections.some((r) => r.source === 'provenance')) {
    rejections.push(
      rejection('provenance-missing', 'gate', null, 'no provenance citation was provided'),
    );
  } else if (validProvenanceCount > 0 && !provenanceAboutSubject) {
    rejections.push(
      rejection(
        'provenance-subject-mismatch',
        'gate',
        null,
        'cited provenance records do not address the listed artifact digest',
      ),
    );
  }

  // Verification requirement (A013 pass statement must cover the subject).
  if (validVerificationCount === 0 && !rejections.some((r) => r.source === 'verification')) {
    rejections.push(
      rejection('verification-missing', 'gate', null, 'no verification citation was provided'),
    );
  } else if (validVerificationCount > 0 && !verificationPassAboutSubject) {
    const hasSubjectMismatch = validVerificationCount > 0 && !verificationPassAboutSubject;
    if (hasSubjectMismatch) {
      // Distinguish "about something else" from "about the subject but not
      // passing" (the latter already recorded above).
      const notPassing = rejections.some((r) => r.reason === 'verification-outcome-not-pass');
      if (!notPassing) {
        rejections.push(
          rejection(
            'verification-subject-mismatch',
            'gate',
            null,
            'cited verification records do not cover the listed artifact digest',
          ),
        );
      }
    }
  }

  return deepFreeze({ admitted: rejections.length === 0, rejections: [...rejections] });
}

/** Snapshot of gate evidence recorded with an admitted listing. */
export interface MarketplaceGateEvidence {
  readonly provenanceRefs: readonly string[];
  readonly verificationRefs: readonly string[];
  readonly subjectDigest: string;
}

/** Project the admitted evidence citation set into a frozen snapshot. */
export function gateEvidenceOf(
  subject: ArtifactRef,
  evidence: readonly MarketplaceEvidenceRef[],
): MarketplaceGateEvidence {
  return deepFreeze({
    provenanceRefs: evidence.filter((e) => e.kind === 'provenance').map((e) => e.digest),
    verificationRefs: evidence.filter((e) => e.kind === 'verification').map((e) => e.digest),
    subjectDigest: subject.digest,
  });
}

export type { ProvenanceRecord, VerificationRecord };
