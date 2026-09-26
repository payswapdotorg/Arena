/**
 * RightsMetadata — explicit licensing and usage constraints for material
 * artifacts (architecture-lock rule 23: "Safety, privacy, licensing and
 * professional limitations are explicit metadata"; requirements R47, R48).
 *
 * Rights are REQUIRED on provenance records and on publication records — a
 * record without rights metadata is rejected (ARTIFACT_MISSING_RIGHTS), and
 * malformed rights are rejected (ARTIFACT_INVALID_RIGHTS).
 */

import { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.js';

export const COMMERCIAL_USE_POLICIES = [
  'allowed',
  'requires-license',
  'prohibited',
] as const;
export type CommercialUsePolicy = (typeof COMMERCIAL_USE_POLICIES)[number];

export const REDISTRIBUTION_POLICIES = [
  'allowed',
  'tenant-only',
  'prohibited',
] as const;
export type RedistributionPolicy = (typeof REDISTRIBUTION_POLICIES)[number];

/**
 * Customer-data exposure classification (requirement R47: export/import
 * artifacts without raw customer data leakage):
 *   - `none`     : the artifact contains no customer data;
 *   - `derived`  : the artifact is derived from customer data but contains no
 *                  raw customer records;
 *   - `contains` : the artifact contains raw customer data and must not be
 *                  exported out of the tenant scope.
 */
export const CUSTOMER_DATA_POLICIES = ['none', 'derived', 'contains'] as const;
export type CustomerDataPolicy = (typeof CUSTOMER_DATA_POLICIES)[number];

/**
 * Exact pattern source for license identifiers: SPDX-style identifiers and
 * short proprietary designators (`MIT`, `Apache-2.0`, `Proprietary`).
 */
export const LICENSE_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9 .+()\\-]{0,63}$';

const LICENSE_PATTERN = new RegExp(LICENSE_PATTERN_SOURCE);

export interface RightsMetadata {
  readonly license: string;
  readonly commercialUse: CommercialUsePolicy;
  readonly redistribution: RedistributionPolicy;
  readonly customerData: CustomerDataPolicy;
  readonly professionalLimitations?: readonly string[];
}

function isCommercialUsePolicy(value: unknown): value is CommercialUsePolicy {
  return (
    typeof value === 'string' &&
    (COMMERCIAL_USE_POLICIES as readonly string[]).includes(value)
  );
}

function isRedistributionPolicy(value: unknown): value is RedistributionPolicy {
  return (
    typeof value === 'string' &&
    (REDISTRIBUTION_POLICIES as readonly string[]).includes(value)
  );
}

function isCustomerDataPolicy(value: unknown): value is CustomerDataPolicy {
  return (
    typeof value === 'string' &&
    (CUSTOMER_DATA_POLICIES as readonly string[]).includes(value)
  );
}

export function isRightsMetadata(value: unknown): value is RightsMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate['license'] !== 'string' ||
    !LICENSE_PATTERN.test(candidate['license'])
  ) {
    return false;
  }
  if (!isCommercialUsePolicy(candidate['commercialUse'])) return false;
  if (!isRedistributionPolicy(candidate['redistribution'])) return false;
  if (!isCustomerDataPolicy(candidate['customerData'])) return false;
  const limitations = candidate['professionalLimitations'];
  if (limitations !== undefined) {
    if (!Array.isArray(limitations)) return false;
    if (!limitations.every((item) => typeof item === 'string' && item.length > 0)) {
      return false;
    }
  }
  return true;
}

/**
 * Validate and freeze rights metadata. `value` missing/not-an-object throws
 * ARTIFACT_MISSING_RIGHTS (rights are mandatory); structurally invalid rights
 * throw ARTIFACT_INVALID_RIGHTS.
 */
export function toRightsMetadata(value: unknown): RightsMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.MISSING_RIGHTS, {
      message: 'rights metadata is required on artifact records (architecture-lock rule 23)',
    });
  }
  const record = value as Record<string, unknown>;

  const license = record['license'];
  if (typeof license !== 'string' || !LICENSE_PATTERN.test(license)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_RIGHTS, {
      message: `invalid rights license: ${JSON.stringify(license)}`,
      details: { pattern: LICENSE_PATTERN_SOURCE },
    });
  }
  const commercialUse = record['commercialUse'];
  if (!isCommercialUsePolicy(commercialUse)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_RIGHTS, {
      message: `invalid commercialUse policy: ${JSON.stringify(commercialUse)} (known: ${COMMERCIAL_USE_POLICIES.join(', ')})`,
      details: { known: [...COMMERCIAL_USE_POLICIES] },
    });
  }
  const redistribution = record['redistribution'];
  if (!isRedistributionPolicy(redistribution)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_RIGHTS, {
      message: `invalid redistribution policy: ${JSON.stringify(redistribution)} (known: ${REDISTRIBUTION_POLICIES.join(', ')})`,
      details: { known: [...REDISTRIBUTION_POLICIES] },
    });
  }
  const customerData = record['customerData'];
  if (!isCustomerDataPolicy(customerData)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_RIGHTS, {
      message: `invalid customerData policy: ${JSON.stringify(customerData)} (known: ${CUSTOMER_DATA_POLICIES.join(', ')})`,
      details: { known: [...CUSTOMER_DATA_POLICIES] },
    });
  }
  const professionalLimitations = record['professionalLimitations'];
  if (professionalLimitations !== undefined) {
    if (
      !Array.isArray(professionalLimitations) ||
      !professionalLimitations.every(
        (item) => typeof item === 'string' && item.length > 0,
      )
    ) {
      throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_RIGHTS, {
        message: 'invalid professionalLimitations: expected an array of non-empty strings',
      });
    }
  }

  const rights: RightsMetadata = Object.freeze({
    license,
    commercialUse,
    redistribution,
    customerData,
    ...(professionalLimitations !== undefined
      ? { professionalLimitations: Object.freeze([...professionalLimitations]) }
      : {}),
  });
  return rights;
}
