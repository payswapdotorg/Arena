/**
 * The RELEASE ADMISSION GATE (Work Order A024; README "Completion
 * target": Certification → RELEASE → Epoch consumption).
 *
 * The gate is the house discipline made REAL (validated references,
 * fail-closed, never a rubber stamp):
 *
 *   - a Body version may be registered FOR RELEASE only when it cites
 *     VALID certification statements (A023 CertificationRecords) and
 *     VALID compatibility verdicts (A022 CompatibilityRecords);
 *   - every citation must RESOLVE through an injected evidence store
 *     (digest-addressed) — an unresolvable citation rejects admission
 *     (fail-closed: a store that throws fails the gate with
 *     BODY_REGISTRY_EVIDENCE_UNRESOLVABLE, nothing is admitted);
 *   - every resolved record must be STRUCTURALLY valid (the REAL
 *     sibling guards: isBodyVersion / isCertificationRecord /
 *     isCompatibilityRecord / isForgeRecord) AND TAMPER-VERIFIED
 *     (digest recomputation — certification: canonical digest over the
 *     digest-free view; compatibility: the A022 record-digest schemes,
 *     both documented forms; body version + forge record: the REAL
 *     A003/A021 verify functions);
 *   - the certification must be ABOUT the exact body version being
 *     registered (the A023 subject's bodyVersionRef must equal the
 *     candidate's ref — tenant, name, version AND digest);
 *   - the certification must have VERDICT 'satisfied' and a GRANTED
 *     level (a failed or indeterminate run grants nothing — A023 law);
 *   - the compatibility verdict must be 'compatible' and address the
 *     same body version;
 *   - an optional forge-record citation (A021 provenance) is validated
 *     the same way when present — absent a forge evidence store, a
 *     present citation REJECTS (fail-closed);
 *   - the RELEASE CHANNEL closes the loop with the certification grant
 *     discipline (spec/quality-model.md levels): 'stable' requires a
 *     cited CERTIFIED grant, 'candidate' requires CANDIDATE or
 *     CERTIFIED, 'development' accepts any grant.
 *
 * The gate EVALUATES and RETURNS a structured verdict — admitted with
 * the frozen evidence snapshot, or rejected with a CLOSED-VOCABULARY
 * list of structured rejections (reason + source + implicated ref +
 * detail). It never throws on refusable inputs; it throws only when
 * evidence infrastructure itself fails (fail-closed).
 */

import {
  bodyVersionRefKey,
  isBodyVersion,
  verifyBodyVersion,
} from '@arena/agent-body';
import type { BodyVersion, BodyVersionRef } from '@arena/agent-body';
import { toBodyVersionRef } from '@arena/agent-body';
import {
  isCertificationRecord,
} from '@arena/certification';
import type { CertificationRecord } from '@arena/certification';
import {
  CERTIFICATION_GRANT_LEVELS,
} from '@arena/certification';
import type { CertificationGrantLevel } from '@arena/certification';
import { isCompatibilityRecord } from '@arena/compatibility';
import type { CompatibilityRecord } from '@arena/compatibility';
import { isForgeRecord, verifyForgeRecord } from '@arena/body-forge';
import type { ForgeRecord } from '@arena/body-forge';
import { digestCanonical, sha256Hex } from '@arena/protocol-core';
import { BODY_REGISTRY_ERROR_CODES, BodyRegistryError } from './errors.js';
import { isContentDigest, toContentDigest } from './shared.js';

// ---------------------------------------------------------------------------
// Release channels (closed vocabulary)
// ---------------------------------------------------------------------------

/** The closed release-channel vocabulary. */
export const RELEASE_CHANNELS = Object.freeze([
  'development',
  'candidate',
  'stable',
] as const);

export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

/** Structural (non-throwing) check for the channel vocabulary. */
export function isReleaseChannel(value: unknown): value is ReleaseChannel {
  return (
    typeof value === 'string' &&
    (RELEASE_CHANNELS as readonly string[]).includes(value)
  );
}

/** The minimum certification grant each channel requires (rank-ordered). */
export const CHANNEL_GRANT_REQUIREMENTS = Object.freeze({
  development: Object.freeze([...CERTIFICATION_GRANT_LEVELS]),
  candidate: Object.freeze(['CANDIDATE', 'CERTIFIED'] as const),
  stable: Object.freeze(['CERTIFIED'] as const),
}) as Readonly<Record<ReleaseChannel, readonly CertificationGrantLevel[]>>;

// ---------------------------------------------------------------------------
// Gate reason vocabulary (closed)
// ---------------------------------------------------------------------------

/** The closed rejection-reason vocabulary. */
export const RELEASE_GATE_REASONS = Object.freeze([
  // candidate shape
  'invalid-body-version-ref',
  'invalid-channel',
  'invalid-citation-digest',
  'duplicate-citation',
  'certification-required',
  'compatibility-required',
  // body-version evidence
  'body-version-unresolved',
  'body-version-invalid',
  'body-version-tampered',
  'body-version-ref-mismatch',
  // certification evidence
  'certification-unresolved',
  'certification-invalid',
  'certification-tampered',
  'certification-not-a-run',
  'certification-unsatisfied',
  'certification-granted-nothing',
  'certification-scope-mismatch',
  'certification-insufficient-for-channel',
  // compatibility evidence
  'compatibility-unresolved',
  'compatibility-invalid',
  'compatibility-tampered',
  'compatibility-incompatible',
  'compatibility-scope-mismatch',
  // forge provenance citation
  'forge-unresolved',
  'forge-invalid',
  'forge-tampered',
  'forge-scope-mismatch',
] as const);

export type ReleaseGateReason = (typeof RELEASE_GATE_REASONS)[number];

/** Structural (non-throwing) check for the reason vocabulary. */
export function isReleaseGateReason(value: unknown): value is ReleaseGateReason {
  return (
    typeof value === 'string' &&
    (RELEASE_GATE_REASONS as readonly string[]).includes(value)
  );
}

/** The closed evidence-source vocabulary. */
export const RELEASE_GATE_SOURCES = Object.freeze([
  'candidate',
  'body-version',
  'certification',
  'compatibility',
  'forge',
] as const);

export type ReleaseGateSource = (typeof RELEASE_GATE_SOURCES)[number];

// ---------------------------------------------------------------------------
// Evidence stores (injected — pure reference fabric discipline)
// ---------------------------------------------------------------------------

/** A digest-addressed evidence lookup (may be sync or async; null = not found). */
export type ReleaseEvidenceLookup<T> = (
  digest: string,
) => T | null | undefined | Promise<T | null | undefined>;

/** The injected evidence stores the gate resolves citations against. */
export interface ReleaseEvidenceStores {
  /** Resolves BodyVersions by content digest (A003). */
  readonly bodyVersions: ReleaseEvidenceLookup<BodyVersion>;
  /** Resolves CertificationRecords by content digest (A023). */
  readonly certificationRecords: ReleaseEvidenceLookup<CertificationRecord>;
  /** Resolves CompatibilityRecords by record digest (A022). */
  readonly compatibilityRecords: ReleaseEvidenceLookup<CompatibilityRecord>;
  /**
   * Resolves ForgeRecords by digest (A021). OPTIONAL: a candidate citing
   * forge provenance without a resolvable store is REJECTED
   * (fail-closed), so services that accept forge citations must inject
   * this store.
   */
  readonly forgeRecords?: ReleaseEvidenceLookup<ForgeRecord>;
}

// ---------------------------------------------------------------------------
// Verdict / rejection / evidence snapshot
// ---------------------------------------------------------------------------

/** One structured gate rejection (wire-safe; closed reason vocabulary). */
export interface ReleaseGateRejection {
  readonly reason: ReleaseGateReason;
  readonly source: ReleaseGateSource;
  /** The implicated citation digest / ref key, when one exists. */
  readonly ref: string | null;
  readonly detail: string;
}

/** Stable field list for a gate rejection (tests mirror it). */
export const RELEASE_GATE_REJECTION_FIELDS = Object.freeze([
  'reason',
  'source',
  'ref',
  'detail',
] as const) as readonly string[];

/** Structural (non-throwing) check for a gate rejection. */
export function isReleaseGateRejection(value: unknown): value is ReleaseGateRejection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isReleaseGateReason(candidate['reason']) &&
    typeof candidate['source'] === 'string' &&
    (RELEASE_GATE_SOURCES as readonly string[]).includes(candidate['source']) &&
    (candidate['ref'] === null || typeof candidate['ref'] === 'string') &&
    typeof candidate['detail'] === 'string' &&
    candidate['detail'].length > 0
  );
}

/**
 * The frozen evidence snapshot of an ADMITTED candidate — what the
 * ReleaseRecord commits to as its admission provenance (A002 lineage
 * discipline: enough to reproduce or audit the gate decision).
 */
export interface ReleaseGateEvidence {
  /** The exact body version admitted for release (content-addressed). */
  readonly bodyVersionRef: BodyVersionRef;
  /** The release channel the evidence was admitted under. */
  readonly channel: ReleaseChannel;
  /** Digests of the cited A023 CertificationRecords (canonicalized order). */
  readonly certificationRefs: readonly string[];
  /** Digests of the cited A022 CompatibilityRecords (canonicalized order). */
  readonly compatibilityRefs: readonly string[];
  /** Digest of the cited A021 ForgeRecord (provenance; null when none). */
  readonly forgeRecordDigest: string | null;
  /** The strongest certification grant among the cited records (derived). */
  readonly strongestGrant: CertificationGrantLevel | null;
}

/** Stable field list for the evidence snapshot (tests mirror it). */
export const RELEASE_GATE_EVIDENCE_FIELDS = Object.freeze([
  'bodyVersionRef',
  'channel',
  'certificationRefs',
  'compatibilityRefs',
  'forgeRecordDigest',
  'strongestGrant',
] as const) as readonly string[];

/** Structural (non-throwing) check for the evidence snapshot. */
export function isReleaseGateEvidence(value: unknown): value is ReleaseGateEvidence {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const ref = candidate['bodyVersionRef'];
  if (
    typeof ref !== 'object' ||
    ref === null ||
    typeof (ref as Record<string, unknown>)['tenant'] !== 'string' ||
    typeof (ref as Record<string, unknown>)['name'] !== 'string' ||
    typeof (ref as Record<string, unknown>)['version'] !== 'string' ||
    !isContentDigest((ref as Record<string, unknown>)['digest'])
  ) {
    return false;
  }
  if (!isReleaseChannel(candidate['channel'])) return false;
  const certRefs = candidate['certificationRefs'];
  if (!Array.isArray(certRefs) || certRefs.length === 0) return false;
  if (!(certRefs as unknown[]).every((entry) => isContentDigest(entry))) return false;
  const compatRefs = candidate['compatibilityRefs'];
  if (!Array.isArray(compatRefs) || compatRefs.length === 0) return false;
  if (!(compatRefs as unknown[]).every((entry) => isContentDigest(entry))) return false;
  const forge = candidate['forgeRecordDigest'];
  if (!(forge === null || isContentDigest(forge))) return false;
  const grant = candidate['strongestGrant'];
  return grant === null || typeof grant === 'string';
}

/** The outcome of one gate evaluation. */
export interface ReleaseGateVerdict {
  /** True iff the candidate is admitted (zero rejections). */
  readonly admitted: boolean;
  /** Every structured rejection (empty iff admitted). */
  readonly rejections: readonly ReleaseGateRejection[];
  /** The frozen evidence snapshot (present iff admitted). */
  readonly evidence: ReleaseGateEvidence | null;
}

/** Stable field list for the verdict (tests mirror it). */
export const RELEASE_GATE_VERDICT_FIELDS = Object.freeze([
  'admitted',
  'rejections',
  'evidence',
] as const) as readonly string[];

// ---------------------------------------------------------------------------
// Candidate input
// ---------------------------------------------------------------------------

/** The release candidate a registrar submits to the gate. */
export interface ReleaseCandidateInput {
  /** The body version to register for release (A003 content-addressed ref). */
  readonly bodyVersionRef: {
    readonly tenant: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  /** The requested release channel (closed vocabulary). */
  readonly channel: string;
  /** Digests of the A023 CertificationRecords citing satisfied claims. */
  readonly certificationRefs: readonly string[];
  /** Digests of the A022 CompatibilityRecords citing compatible verdicts. */
  readonly compatibilityRefs: readonly string[];
  /** Optional digest of the A021 ForgeRecord (provenance citation). */
  readonly forgeRecordDigest?: string | null;
}

// ---------------------------------------------------------------------------
// A022 compatibility-record integrity verification
// ---------------------------------------------------------------------------

/**
 * Verify a compatibility record's claimed digest. A022 ships two
 * documented digest schemes (both fail-closed here):
 *
 *   1. the PACKAGE form (packages/compatibility CompatibilityRegistry
 *      .createAndRegister): sha256 over the canonical JSON of the full
 *      view (recordVersion, bodyVersionRef, substrateRef, evaluatedAt,
 *      verdict, reasons, details, plus optional parentDigest/tenantId/
 *      workspaceId when present);
 *   2. the SERVICE form (services/compatibility engine): sha256 over
 *      plain JSON.stringify of the fixed key order {recordVersion,
 *      bodyVersionRef, substrateRef, verdict, reasons, evaluatedAt,
 *      parentDigest|null, tenantId|null, workspaceId|null} (details
 *      excluded, null-normalized).
 *
 * A record matching NEITHER scheme fails closed (tampered).
 */
export async function verifyCompatibilityRecordIntegrity(
  record: CompatibilityRecord,
): Promise<boolean> {
  // Scheme 1 — package form: canonical digest over the stored view.
  const view: Record<string, unknown> = {
    recordVersion: record.recordVersion,
    bodyVersionRef: record.bodyVersionRef,
    substrateRef: record.substrateRef,
    evaluatedAt: record.evaluatedAt,
    verdict: record.verdict,
    reasons: [...record.reasons],
    details: record.details,
  };
  if (record.parentDigest !== undefined) view['parentDigest'] = record.parentDigest;
  if (record.tenantId !== undefined) view['tenantId'] = record.tenantId;
  if (record.workspaceId !== undefined) view['workspaceId'] = record.workspaceId;
  const canonical = await digestCanonical(view);
  if (canonical === record.recordDigest) return true;

  // Scheme 2 — service form: fixed-key-order JSON, null-normalized.
  const serviceForm = await sha256Hex(
    JSON.stringify({
      recordVersion: record.recordVersion,
      bodyVersionRef: record.bodyVersionRef,
      substrateRef: record.substrateRef,
      verdict: record.verdict,
      reasons: [...record.reasons],
      evaluatedAt: record.evaluatedAt,
      parentDigest: record.parentDigest ?? null,
      tenantId: record.tenantId ?? null,
      workspaceId: record.workspaceId ?? null,
    }),
  );
  return serviceForm === record.recordDigest;
}

/**
 * Verify a certification record's claimed digest: sha256 over the
 * canonical JSON of the digest-free view (the A023 record constructor
 * discipline — strip `digest`, canonicalize, compare).
 */
export async function verifyCertificationRecordIntegrity(
  record: CertificationRecord,
): Promise<boolean> {
  const { digest: _claimed, ...view } = record as unknown as Record<string, unknown> & {
    digest: unknown;
  };
  const computed = await digestCanonical(view);
  return computed === record.digest;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** The strongest grant among levels (CERTIFIED > CANDIDATE > DEVELOPMENT). */
function strongestGrantOf(levels: readonly string[]): CertificationGrantLevel | null {
  if (levels.includes('CERTIFIED')) return 'CERTIFIED';
  if (levels.includes('CANDIDATE')) return 'CANDIDATE';
  if (levels.includes('DEVELOPMENT')) return 'DEVELOPMENT';
  return null;
}

/** True iff the A022 record's body-version address resolves to the exact ref. */
function compatibilityRecordAddressesBody(
  record: CompatibilityRecord,
  ref: BodyVersionRef,
): boolean {
  const key = bodyVersionRefKey(ref);
  const address = record.bodyVersionRef;
  return (
    address === key ||
    address === ref.digest ||
    address.endsWith(`#${ref.digest}`)
  );
}

function rejection(
  reason: ReleaseGateReason,
  source: ReleaseGateSource,
  detail: string,
  ref: string | null = null,
): ReleaseGateRejection {
  return Object.freeze({ reason, source, ref, detail });
}

async function resolveFrom<T>(
  lookup: ReleaseEvidenceLookup<T>,
  digest: string,
): Promise<T | null> {
  try {
    const resolved = await lookup(digest);
    return resolved === undefined ? null : resolved;
  } catch (cause) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.EVIDENCE_UNRESOLVABLE, {
      message: `evidence store failed while resolving ${JSON.stringify(digest)} (fail-closed: admission is denied)`,
      details: { digest },
      cause,
    });
  }
}

/** Deduplicate and canonically order citation digests. */
function canonicalCitations(
  values: readonly string[],
  kind: string,
  rejections: ReleaseGateRejection[],
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (!isContentDigest(value)) {
      rejections.push(
        rejection(
          'invalid-citation-digest',
          'candidate',
          `${kind} citation ${JSON.stringify(value)} is not a valid content digest`,
          typeof value === 'string' ? value : null,
        ),
      );
      continue;
    }
    if (seen.has(value)) {
      rejections.push(
        rejection(
          'duplicate-citation',
          'candidate',
          `${kind} citation ${value} appears more than once`,
          value,
        ),
      );
      continue;
    }
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}

function refsEqual(
  a: { tenant: string; name: string; version: string; digest: string },
  b: { tenant: string; name: string; version: string; digest: string },
): boolean {
  return (
    a.tenant === b.tenant && a.name === b.name && a.version === b.version && a.digest === b.digest
  );
}

/**
 * Evaluate one release candidate against the injected evidence stores.
 * Returns the structured verdict; throws ONLY on evidence-infrastructure
 * failure (a throwing store) — never to refuse a refusable candidate.
 */
export async function evaluateReleaseGate(
  candidate: ReleaseCandidateInput,
  stores: ReleaseEvidenceStores,
): Promise<ReleaseGateVerdict> {
  const rejections: ReleaseGateRejection[] = [];

  // --- candidate shape ---------------------------------------------------
  const bodyVersionRef: BodyVersionRef | null = (() => {
    try {
      return toBodyVersionRef({ ...candidate.bodyVersionRef });
    } catch {
      return null;
    }
  })();
  if (bodyVersionRef === null) {
    rejections.push(
      rejection(
        'invalid-body-version-ref',
        'candidate',
        `the candidate's bodyVersionRef is not a valid A003 body-version ref: ${JSON.stringify(candidate.bodyVersionRef)}`,
        null,
      ),
    );
    return Object.freeze({
      admitted: false,
      rejections: Object.freeze(rejections),
      evidence: null,
    });
  }

  if (!isReleaseChannel(candidate.channel)) {
    rejections.push(
      rejection(
        'invalid-channel',
        'candidate',
        `unknown release channel: ${JSON.stringify(candidate.channel)} (closed vocabulary: ${RELEASE_CHANNELS.join(' | ')})`,
        null,
      ),
    );
  }

  if (!Array.isArray(candidate.certificationRefs) || candidate.certificationRefs.length === 0) {
    rejections.push(
      rejection(
        'certification-required',
        'candidate',
        'at least one A023 certification citation is required to register a release (the gate is never a rubber stamp)',
        null,
      ),
    );
  }
  if (!Array.isArray(candidate.compatibilityRefs) || candidate.compatibilityRefs.length === 0) {
    rejections.push(
      rejection(
        'compatibility-required',
        'candidate',
        'at least one A022 compatibility citation is required to register a release (the gate is never a rubber stamp)',
        null,
      ),
    );
  }

  const certificationRefs = canonicalCitations(
    Array.isArray(candidate.certificationRefs) ? candidate.certificationRefs : [],
    'certification',
    rejections,
  );
  const compatibilityRefs = canonicalCitations(
    Array.isArray(candidate.compatibilityRefs) ? candidate.compatibilityRefs : [],
    'compatibility',
    rejections,
  );

  const forgeCitation =
    candidate.forgeRecordDigest === undefined || candidate.forgeRecordDigest === null
      ? null
      : candidate.forgeRecordDigest;
  if (forgeCitation !== null && !isContentDigest(forgeCitation)) {
    rejections.push(
      rejection(
        'invalid-citation-digest',
        'candidate',
        `forge citation ${JSON.stringify(forgeCitation)} is not a valid content digest`,
        typeof forgeCitation === 'string' ? forgeCitation : null,
      ),
    );
  }

  // --- body-version evidence ---------------------------------------------
  const bodyVersion = await resolveFrom(
    stores.bodyVersions,
    bodyVersionRef.digest,
  );
  if (bodyVersion === null) {
    rejections.push(
      rejection(
        'body-version-unresolved',
        'body-version',
        `the cited body version digest ${bodyVersionRef.digest} does not resolve in the body-version store`,
        bodyVersionRef.digest,
      ),
    );
  } else if (!isBodyVersion(bodyVersion)) {
    rejections.push(
      rejection(
        'body-version-invalid',
        'body-version',
        `the resolved body version ${bodyVersionRef.digest} is not structurally valid per the A003 guard`,
        bodyVersionRef.digest,
      ),
    );
  } else {
    try {
      await verifyBodyVersion(bodyVersion);
    } catch {
      rejections.push(
        rejection(
          'body-version-tampered',
          'body-version',
          `the resolved body version ${bodyVersionRef.digest} fails A003 tamper verification (claimed digest does not match content)`,
          bodyVersionRef.digest,
        ),
      );
    }
    if (
      !refsEqual(
        { tenant: bodyVersion.body.tenant, name: bodyVersion.body.name, version: bodyVersion.version, digest: bodyVersion.digest },
        bodyVersionRef,
      )
    ) {
      rejections.push(
        rejection(
          'body-version-ref-mismatch',
          'body-version',
          `the resolved body version is ${bodyVersion.body.tenant}/${bodyVersion.body.name}@${bodyVersion.version}#${bodyVersion.digest} but the candidate cites ${bodyVersionRefKey(bodyVersionRef)} (identity/digest must match exactly)`,
          bodyVersionRef.digest,
        ),
      );
    }
  }

  // --- certification evidence --------------------------------------------
  const grants: string[] = [];
  for (const digest of certificationRefs) {
    const record = await resolveFrom(stores.certificationRecords, digest);
    if (record === null) {
      rejections.push(
        rejection(
          'certification-unresolved',
          'certification',
          `cited certification record ${digest} does not resolve in the certification store`,
          digest,
        ),
      );
      continue;
    }
    if (!isCertificationRecord(record)) {
      rejections.push(
        rejection(
          'certification-invalid',
          'certification',
          `cited certification record ${digest} is not structurally valid per the A023 guard`,
          digest,
        ),
      );
      continue;
    }
    if (!(await verifyCertificationRecordIntegrity(record))) {
      rejections.push(
        rejection(
          'certification-tampered',
          'certification',
          `cited certification record ${digest} fails digest verification (claimed digest does not match canonical content)`,
          digest,
        ),
      );
      continue;
    }
    if (record.kind !== 'certification-run') {
      rejections.push(
        rejection(
          'certification-not-a-run',
          'certification',
          `cited certification record ${digest} is a ${record.kind} record — only certification-run records are release evidence (a revocation is not a certification)`,
          digest,
        ),
      );
      continue;
    }
    const subject = record.subject;
    if (
      subject === null ||
      !refsEqual(subject.bodyVersionRef, bodyVersionRef)
    ) {
      rejections.push(
        rejection(
          'certification-scope-mismatch',
          'certification',
          `cited certification record ${digest} certifies ${
            subject === null ? 'no subject' : bodyVersionRefKey(subject.bodyVersionRef)
          }, not the candidate's ${bodyVersionRefKey(bodyVersionRef)} (the statement must be scoped to the exact body version)`,
          digest,
        ),
      );
      continue;
    }
    if (record.verdict !== 'satisfied') {
      rejections.push(
        rejection(
          'certification-unsatisfied',
          'certification',
          `cited certification record ${digest} carries verdict ${JSON.stringify(record.verdict)} — only satisfied claims gate a release`,
          digest,
        ),
      );
      continue;
    }
    if (record.grantedLevel === null) {
      rejections.push(
        rejection(
          'certification-granted-nothing',
          'certification',
          `cited certification record ${digest} is satisfied but granted NOTHING (grantedLevel is null) — a failed or conditional-null grant gates nothing`,
          digest,
        ),
      );
      continue;
    }
    grants.push(record.grantedLevel);
  }

  // --- compatibility evidence --------------------------------------------
  for (const digest of compatibilityRefs) {
    const record = await resolveFrom(stores.compatibilityRecords, digest);
    if (record === null) {
      rejections.push(
        rejection(
          'compatibility-unresolved',
          'compatibility',
          `cited compatibility record ${digest} does not resolve in the compatibility store`,
          digest,
        ),
      );
      continue;
    }
    if (!isCompatibilityRecord(record)) {
      rejections.push(
        rejection(
          'compatibility-invalid',
          'compatibility',
          `cited compatibility record ${digest} is not structurally valid per the A022 guard`,
          digest,
        ),
      );
      continue;
    }
    if (!(await verifyCompatibilityRecordIntegrity(record))) {
      rejections.push(
        rejection(
          'compatibility-tampered',
          'compatibility',
          `cited compatibility record ${digest} fails digest verification (claimed recordDigest matches neither documented A022 scheme)`,
          digest,
        ),
      );
      continue;
    }
    if (!compatibilityRecordAddressesBody(record, bodyVersionRef)) {
      rejections.push(
        rejection(
          'compatibility-scope-mismatch',
          'compatibility',
          `cited compatibility record ${digest} addresses body version ${JSON.stringify(record.bodyVersionRef)}, not the candidate's ${bodyVersionRefKey(bodyVersionRef)}`,
          digest,
        ),
      );
      continue;
    }
    if (record.verdict !== 'compatible') {
      rejections.push(
        rejection(
          'compatibility-incompatible',
          'compatibility',
          `cited compatibility record ${digest} carries verdict ${JSON.stringify(record.verdict)} — only compatible verdicts gate a release`,
          digest,
        ),
      );
    }
  }

  // --- forge provenance citation (optional, validated when present) ------
  if (forgeCitation !== null && isContentDigest(forgeCitation)) {
    const store = stores.forgeRecords;
    if (store === undefined) {
      rejections.push(
        rejection(
          'forge-unresolved',
          'forge',
          `the candidate cites forge record ${forgeCitation} but no forge evidence store is injected (fail-closed: a citation without a resolvable store rejects admission)`,
          forgeCitation,
        ),
      );
    } else {
      const record = await resolveFrom(store, forgeCitation);
      if (record === null) {
        rejections.push(
          rejection(
            'forge-unresolved',
            'forge',
            `cited forge record ${forgeCitation} does not resolve in the forge store`,
            forgeCitation,
          ),
        );
      } else if (!isForgeRecord(record)) {
        rejections.push(
          rejection(
            'forge-invalid',
            'forge',
            `cited forge record ${forgeCitation} is not structurally valid per the A021 guard`,
            forgeCitation,
          ),
        );
      } else {
        try {
          await verifyForgeRecord(record);
        } catch {
          rejections.push(
            rejection(
              'forge-tampered',
              'forge',
              `cited forge record ${forgeCitation} fails A021 tamper verification`,
              forgeCitation,
            ),
          );
        }
        if (!refsEqual(record.bodyVersionRef, bodyVersionRef)) {
          rejections.push(
            rejection(
              'forge-scope-mismatch',
              'forge',
              `cited forge record ${forgeCitation} forged ${bodyVersionRefKey(record.bodyVersionRef)}, not the candidate's ${bodyVersionRefKey(bodyVersionRef)}`,
              forgeCitation,
            ),
          );
        }
      }
    }
  }

  // --- channel discipline -------------------------------------------------
  const channel: ReleaseChannel | null = isReleaseChannel(candidate.channel)
    ? candidate.channel
    : null;
  if (channel !== null && grants.length > 0) {
    const allowed = CHANNEL_GRANT_REQUIREMENTS[channel];
    const sufficient = grants.some((grant) => allowed.includes(grant as CertificationGrantLevel));
    if (!sufficient) {
      rejections.push(
        rejection(
          'certification-insufficient-for-channel',
          'certification',
          `channel '${channel}' requires a certification grant of ${allowed.join(' | ')}, but the cited grants are [${grants.join(', ')}] (spec/quality-model.md levels discipline)`,
          null,
        ),
      );
    }
  }

  if (rejections.length > 0 || channel === null) {
    if (channel === null) {
      // Unreachable: an unknown channel always pushes a rejection; kept
      // for type-totality of the admitted branch.
      rejections.push(
        rejection(
          'invalid-channel',
          'candidate',
          `internal invariant: admitted candidate must carry a known channel`,
          null,
        ),
      );
    }
    return Object.freeze({
      admitted: false,
      rejections: Object.freeze(rejections),
      evidence: null,
    });
  }

  const evidence: ReleaseGateEvidence = Object.freeze({
    bodyVersionRef,
    channel,
    certificationRefs: Object.freeze([...certificationRefs]),
    compatibilityRefs: Object.freeze([...compatibilityRefs]),
    forgeRecordDigest: forgeCitation,
    strongestGrant: strongestGrantOf(grants),
  });
  return Object.freeze({
    admitted: true,
    rejections: Object.freeze([]),
    evidence,
  });
}

/** Convenience constructor for in-memory evidence stores (tests + fabric). */
export function memoryStore<T>(entries: Iterable<[string, T]>): ReleaseEvidenceLookup<T> {
  const map = new Map<string, T>(entries);
  return (digest: string): T | null => map.get(digest) ?? null;
}

// ---------------------------------------------------------------------------
// Digest helpers for the evidence snapshot (record addressing)
// ---------------------------------------------------------------------------

/** sha256 over the canonical serialization of the evidence snapshot. */
export async function releaseGateEvidenceDigest(
  evidence: ReleaseGateEvidence,
): Promise<string> {
  return toContentDigest(
    await digestCanonical({
      bodyVersionRef: evidence.bodyVersionRef,
      channel: evidence.channel,
      certificationRefs: [...evidence.certificationRefs],
      compatibilityRefs: [...evidence.compatibilityRefs],
      forgeRecordDigest: evidence.forgeRecordDigest,
      strongestGrant: evidence.strongestGrant,
    }),
    'release gate evidence digest',
  );
}
