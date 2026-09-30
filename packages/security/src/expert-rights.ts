/**
 * Expert rights records (Work Order A034; spec/security.md S1.0 "Expert
 * rights"; requirements R31, R32; AGENTS.md Provenance).
 *
 * Expert work records retain the five S1.0 rights fields — contributor
 * identity, compensation terms, attribution policy, rights to derived
 * artifacts, withdrawal/deletion policy — as ONE frozen record type with
 * CLOSED vocabularies. Withdrawal is an append-only status transition
 * with policy hooks:
 *
 *   - applyExpertWithdrawal returns a NEW frozen record (the original is
 *     never mutated — historical expert work remains auditable);
 *   - the withdrawal policy declares what happens to derived artifacts
 *     (retain-anonymized | remove-identity | retain-with-consent);
 *   - deletion applicability is an explicit boolean contract hook
 *     (deletion is only offered where "contractually and technically
 *     applicable" — certification evidence references immutable
 *     artifacts, so records that are already referenced by certification
 *     evidence are NOT deletable, by design);
 *   - attribution derivation is pure: the derived attribution view
 *     honors the expert's attribution policy exactly (named → carries
 *     the contributor identity; pseudonymous → carries the stable
 *     pseudonym ONLY; anonymous → carries neither).
 */

import { SECURITY_ERROR_CODES, SecurityError } from './errors.js';
import { deepFreeze, expectEnumMember, expectFields, isEnumMember } from './shared.js';
import { toNeutralId, toPrincipalId, toTenantId } from './shared.js';
import type { NeutralId, NeutralText, PrincipalId, TenantId } from './shared.js';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** The closed attribution-policy vocabulary. */
export const ATTRIBUTION_POLICIES = Object.freeze([
  'named',
  'pseudonymous',
  'anonymous',
] as const);
export type AttributionPolicy = (typeof ATTRIBUTION_POLICIES)[number];

/** The closed derived-artifact-rights vocabulary. */
export const DERIVED_ARTIFACT_RIGHTS = Object.freeze([
  'none',
  'attribution-required',
  'license-required',
  'full-derivative-rights',
] as const);
export type DerivedArtifactRight = (typeof DERIVED_ARTIFACT_RIGHTS)[number];

/** The closed derived-artifact treatment on withdrawal. */
export const WITHDRAWAL_TREATMENTS = Object.freeze([
  'retain-anonymized',
  'remove-identity',
  'retain-with-consent',
] as const);
export type WithdrawalTreatment = (typeof WITHDRAWAL_TREATMENTS)[number];

/** The closed compensation-status vocabulary. */
export const COMPENSATION_STATUSES = Object.freeze([
  'agreed',
  'pending',
  'withdrawn',
] as const);
export type CompensationStatus = (typeof COMPENSATION_STATUSES)[number];

/** The closed expert-rights status vocabulary (append-only transitions). */
export const EXPERT_RIGHTS_STATUSES = Object.freeze(['active', 'withdrawn'] as const);
export type ExpertRightsStatus = (typeof EXPERT_RIGHTS_STATUSES)[number];

export function isAttributionPolicy(value: unknown): value is AttributionPolicy {
  return isEnumMember(value, ATTRIBUTION_POLICIES);
}

// ---------------------------------------------------------------------------
// The expert rights record
// ---------------------------------------------------------------------------

/** Wire version of the expert rights record shape. */
export const EXPERT_RIGHTS_VERSION = 1 as const;

/**
 * The five S1.0 expert-rights fields as one frozen record:
 *
 *   - contributorIdentity: the principal id of the contributor plus the
 *     tenant the expert record lives in;
 *   - compensationTerms: contract reference + closed status;
 *   - attributionPolicy: named | pseudonymous | anonymous;
 *   - derivedArtifactRights: the closed rights vocabulary;
 *   - withdrawalPolicy: notice period, deletion applicability, derived
 *     artifact treatment.
 */
export interface ExpertRightsRecord {
  readonly recordVersion: typeof EXPERT_RIGHTS_VERSION;
  readonly rightsId: NeutralId;
  readonly tenantId: TenantId;
  readonly contributorIdentity: PrincipalId;
  readonly pseudonym: NeutralId;
  readonly compensationTerms: {
    readonly contractRef: NeutralText;
    readonly status: CompensationStatus;
  };
  readonly attributionPolicy: AttributionPolicy;
  readonly derivedArtifactRights: DerivedArtifactRight;
  readonly withdrawalPolicy: {
    readonly noticePeriodDays: number;
    readonly deletionApplicable: boolean;
    readonly derivedArtifactTreatment: WithdrawalTreatment;
  };
  readonly status: ExpertRightsStatus;
  readonly withdrawnAt: string | null;
}

const RIGHTS_CONTEXT = 'ExpertRightsRecord';

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isExpertRightsRecord(value: unknown): value is ExpertRightsRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== EXPERT_RIGHTS_VERSION) return false;
  if (typeof record['rightsId'] !== 'string') return false;
  if (typeof record['tenantId'] !== 'string') return false;
  if (typeof record['contributorIdentity'] !== 'string') return false;
  if (typeof record['pseudonym'] !== 'string') return false;
  if (!isEnumMember(record['attributionPolicy'], ATTRIBUTION_POLICIES)) return false;
  if (!isEnumMember(record['derivedArtifactRights'], DERIVED_ARTIFACT_RIGHTS)) return false;
  if (!isEnumMember(record['status'], EXPERT_RIGHTS_STATUSES)) return false;
  return true;
}

export function toExpertRightsRecord(value: unknown): ExpertRightsRecord {
  const record = expectFields(
    value,
    [
      'recordVersion',
      'rightsId',
      'tenantId',
      'contributorIdentity',
      'pseudonym',
      'compensationTerms',
      'attributionPolicy',
      'derivedArtifactRights',
      'withdrawalPolicy',
      'status',
      'withdrawnAt',
    ],
    [],
    SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS,
    RIGHTS_CONTEXT,
  );
  if (record['recordVersion'] !== EXPERT_RIGHTS_VERSION) {
    throw new SecurityError(SECURITY_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `${RIGHTS_CONTEXT}: unsupported recordVersion: ${String(record['recordVersion'])}`,
    });
  }
  const rightsId = toNeutralId(String(record['rightsId']), `${RIGHTS_CONTEXT}.rightsId`);
  const tenantId = toTenantId(String(record['tenantId']), `${RIGHTS_CONTEXT}.tenantId`);
  const contributorIdentity = toPrincipalId(
    String(record['contributorIdentity']),
    `${RIGHTS_CONTEXT}.contributorIdentity`,
  );
  const pseudonym = toNeutralId(String(record['pseudonym']), `${RIGHTS_CONTEXT}.pseudonym`);

  const rawCompensation = record['compensationTerms'];
  if (typeof rawCompensation !== 'object' || rawCompensation === null) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS, {
      message: `${RIGHTS_CONTEXT}.compensationTerms: must be an object`,
    });
  }
  const compensationRecord = expectFields(
    rawCompensation,
    ['contractRef', 'status'],
    [],
    SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS,
    `${RIGHTS_CONTEXT}.compensationTerms`,
  );
  const contractRef = String(compensationRecord['contractRef']);
  if (contractRef.length === 0 || contractRef.length > 4096) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS, {
      message: `${RIGHTS_CONTEXT}.compensationTerms.contractRef: must be 1..4096 characters`,
    });
  }
  const compensationStatus = expectEnumMember(
    compensationRecord['status'],
    COMPENSATION_STATUSES,
    'status',
    SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS,
    `${RIGHTS_CONTEXT}.compensationTerms`,
  );

  const attributionPolicy = expectEnumMember(
    record['attributionPolicy'],
    ATTRIBUTION_POLICIES,
    'attributionPolicy',
    SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS,
    RIGHTS_CONTEXT,
  );
  const derivedArtifactRights = expectEnumMember(
    record['derivedArtifactRights'],
    DERIVED_ARTIFACT_RIGHTS,
    'derivedArtifactRights',
    SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS,
    RIGHTS_CONTEXT,
  );

  const rawWithdrawal = record['withdrawalPolicy'];
  if (typeof rawWithdrawal !== 'object' || rawWithdrawal === null) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS, {
      message: `${RIGHTS_CONTEXT}.withdrawalPolicy: must be an object`,
    });
  }
  const withdrawalRecord = expectFields(
    rawWithdrawal,
    ['noticePeriodDays', 'deletionApplicable', 'derivedArtifactTreatment'],
    [],
    SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS,
    `${RIGHTS_CONTEXT}.withdrawalPolicy`,
  );
  const noticePeriodDays = Number(withdrawalRecord['noticePeriodDays']);
  if (!Number.isInteger(noticePeriodDays) || noticePeriodDays < 0 || noticePeriodDays > 3650) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS, {
      message: `${RIGHTS_CONTEXT}.withdrawalPolicy.noticePeriodDays: must be an integer 0..3650`,
    });
  }
  if (typeof withdrawalRecord['deletionApplicable'] !== 'boolean') {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS, {
      message: `${RIGHTS_CONTEXT}.withdrawalPolicy.deletionApplicable: must be an explicit boolean (no silent defaults)`,
    });
  }
  const derivedArtifactTreatment = expectEnumMember(
    withdrawalRecord['derivedArtifactTreatment'],
    WITHDRAWAL_TREATMENTS,
    'derivedArtifactTreatment',
    SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS,
    `${RIGHTS_CONTEXT}.withdrawalPolicy`,
  );

  const status = expectEnumMember(
    record['status'],
    EXPERT_RIGHTS_STATUSES,
    'status',
    SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS,
    RIGHTS_CONTEXT,
  );
  let withdrawnAt: string | null = null;
  if (record['withdrawnAt'] !== null && record['withdrawnAt'] !== undefined) {
    withdrawnAt = String(record['withdrawnAt']);
    if (!TIMESTAMP_PATTERN.test(withdrawnAt)) {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_TIMESTAMP, {
        message: `${RIGHTS_CONTEXT}.withdrawnAt: must be ms-precision UTC RFC 3339`,
      });
    }
  }
  if (status === 'active' && withdrawnAt !== null) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS, {
      message: `${RIGHTS_CONTEXT}: an active record must carry withdrawnAt=null`,
    });
  }
  if (status === 'withdrawn' && withdrawnAt === null) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS, {
      message: `${RIGHTS_CONTEXT}: a withdrawn record must carry an explicit withdrawnAt`,
    });
  }

  return deepFreeze({
    recordVersion: EXPERT_RIGHTS_VERSION,
    rightsId,
    tenantId,
    contributorIdentity,
    pseudonym,
    compensationTerms: Object.freeze({
      contractRef: contractRef as NeutralText,
      status: compensationStatus,
    }),
    attributionPolicy,
    derivedArtifactRights,
    withdrawalPolicy: Object.freeze({
      noticePeriodDays,
      deletionApplicable: withdrawalRecord['deletionApplicable'] as boolean,
      derivedArtifactTreatment,
    }),
    status,
    withdrawnAt,
  });
}

// ---------------------------------------------------------------------------
// Withdrawal / deletion policy hooks
// ---------------------------------------------------------------------------

/**
 * Append-only withdrawal transition: returns a NEW frozen record with
 * status 'withdrawn' and compensation status 'withdrawn'. The original
 * record is NEVER mutated — historical expert work remains auditable
 * (the audit trail keeps the lineage; the derived-artifact treatment is
 * declared by policy, applied downstream).
 */
export function applyExpertWithdrawal(
  record: ExpertRightsRecord,
  withdrawnAt: string,
): ExpertRightsRecord {
  if (!TIMESTAMP_PATTERN.test(withdrawnAt)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: 'applyExpertWithdrawal: withdrawnAt must be ms-precision UTC RFC 3339',
      details: { received: withdrawnAt },
    });
  }
  if (record.status === 'withdrawn') {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_EXPERT_RIGHTS, {
      message: `expert rights ${String(record.rightsId)} is already withdrawn (append-only: no double withdrawal, no un-withdrawal)`,
    });
  }
  return deepFreeze({
    ...record,
    compensationTerms: Object.freeze({
      ...record.compensationTerms,
      status: 'withdrawn',
    }),
    status: 'withdrawn',
    withdrawnAt,
  });
}

/**
 * Deletion applicability check — the deletion policy hook. Deletion is
 * applicable ONLY where the contract says so AND the record is not
 * referenced by immutable certification evidence (a boolean input from
 * the caller — the evidence store knows its references). Fail closed:
 * both must hold.
 */
export function canDeleteExpertRecord(
  record: ExpertRightsRecord,
  options: { referencedByCertificationEvidence?: boolean } = {},
): boolean {
  if (!record.withdrawalPolicy.deletionApplicable) return false;
  if (options.referencedByCertificationEvidence ?? false) return false;
  return record.status === 'withdrawn';
}

/**
 * Pure attribution derivation: the public attribution view honors the
 * expert's attribution policy EXACTLY.
 *   - named         → { kind: 'named', contributorIdentity }
 *   - pseudonymous  → { kind: 'pseudonymous', pseudonym } (identity NEVER leaks)
 *   - anonymous     → { kind: 'anonymous' } (neither ever leaks)
 */
export type DerivedAttribution =
  | { readonly kind: 'named'; readonly contributorIdentity: PrincipalId }
  | { readonly kind: 'pseudonymous'; readonly pseudonym: NeutralId }
  | { readonly kind: 'anonymous' };

export function deriveAttribution(record: ExpertRightsRecord): DerivedAttribution {
  switch (record.attributionPolicy) {
    case 'named':
      return Object.freeze({ kind: 'named', contributorIdentity: record.contributorIdentity });
    case 'pseudonymous':
      return Object.freeze({ kind: 'pseudonymous', pseudonym: record.pseudonym });
    case 'anonymous':
      return Object.freeze({ kind: 'anonymous' });
  }
}

/**
 * Withdrawal-derived artifact policy: what happens to derived artifacts
 * after withdrawal, per the declared treatment. 'remove-identity'
 * means downstream attribution must switch to 'anonymous'.
 */
export function derivedArtifactPolicyAfterWithdrawal(
  record: ExpertRightsRecord,
): { treatment: WithdrawalTreatment; attribution: DerivedAttribution } {
  const attribution =
    record.withdrawalPolicy.derivedArtifactTreatment === 'remove-identity'
      ? deriveAttribution({
          ...record,
          attributionPolicy: 'anonymous',
        })
      : deriveAttribution(record);
  return deepFreeze({
    treatment: record.withdrawalPolicy.derivedArtifactTreatment,
    attribution,
  });
}
