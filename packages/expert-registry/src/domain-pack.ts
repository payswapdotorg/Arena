/**
 * Expert domain packs (Work Order A006 gate 8; requirement R37: "Support
 * domain packs without duplicating core lifecycle authority";
 * architecture-lock rule 21: "New domains extend skills/environments/
 * evaluators/packs; they do not fork the Arena lifecycle").
 *
 * An ExpertDomainPack is a content-addressed DESCRIPTOR that ADDS
 * domain-specific competency types and metadata fields for one domain
 * (e.g. a structural-engineering pack declaring competency type
 * `structural.load-analysis` with metadata field `stampEligibility`).
 * A pack CAN express exactly two extensions:
 *
 *   1. domain competency TYPES (dotted slugs referenced by competencies'
 *      `domainType`);
 *   2. domain METADATA FIELDS (typed `string|number|boolean`, optional or
 *      required, referenced by competencies' `domainMetadata` keys).
 *
 * A pack CANNOT (machine-enforced negative surface):
 *   - alter lifecycle semantics — the input key set is closed and any
 *     `lifecycle`/`statuses`/`transitions`/`statusSet` input key is
 *     REJECTED with EXPERT_INVALID_DOMAIN_PACK (there is no field for
 *     lifecycle data and none can be smuggled in);
 *   - inject authority or PII — every declared name (type ids, metadata
 *     field names) passes the separation-of-concerns and PII screens
 *     (lock rule 9, §8 identity): a pack declaring `adminOf` or `email`
 *     is REJECTED with EXPERT_AUTHORITY_FIELD_REJECTED /
 *     EXPERT_PII_FIELD_REJECTED;
 *   - redefine core profile structure — packs add typed names, never
 *     schema-shape overrides.
 *
 * `assertProfileConformsToDomainPacks` binds profiles to packs: every
 * domain-typed competency must use a pack-declared type, every metadata
 * key must be declared with a matching value type, and required fields
 * must be present. The screen re-runs on declared names — defense in
 * depth against packs built by older/other tooling.
 */

import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import { assertScreenedDeclaredName, assertScreenedInput } from './authority-screen.js';
import {
  isDomainCompetencyTypeId,
  DOMAIN_COMPETENCY_TYPE_PATTERN_SOURCE,
} from './competencies.js';
import type { DomainMetadataValueType } from './competencies.js';
import { DOMAIN_METADATA_VALUE_TYPES } from './competencies.js';
import { digestCanonical } from '@arena/protocol-core';
import {
  deepFreeze,
  isContentDigest,
  toContentDigest,
} from './shared.js';
import type { ContentDigest } from './shared.js';
import type { ExpertProfile } from './profile.js';

/** Wire version of the domain pack descriptor shape. */
export const EXPERT_DOMAIN_PACK_VERSION = 1 as const;

/** Pack id pattern (namespace-style slugs, e.g. `structural-engineering`). */
export const DOMAIN_PACK_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';

const DOMAIN_PACK_ID_PATTERN = new RegExp(DOMAIN_PACK_ID_PATTERN_SOURCE);

export function isDomainPackId(value: unknown): value is string {
  return typeof value === 'string' && DOMAIN_PACK_ID_PATTERN.test(value);
}

/** The closed input key set of the pack descriptor (extras are rejected). */
const PACK_INPUT_KEYS = [
  'id',
  'version',
  'description',
  'competencyTypes',
  'metadataFields',
] as const;

/**
 * One pack-declared domain competency type: a dotted slug plus a
 * human-readable description.
 */
export interface DomainCompetencyTypeDef {
  readonly type: string;
  readonly description: string;
}

export function isDomainCompetencyTypeDef(
  value: unknown,
): value is DomainCompetencyTypeDef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isDomainCompetencyTypeId(candidate['type']) &&
    typeof candidate['description'] === 'string' &&
    candidate['description'].length > 0
  );
}

/**
 * One pack-declared domain metadata field: the field name, its value
 * type, whether profile competencies MUST set it, and a description.
 * NOTE: the field's name key is `field` — never `name` (the PII screen
 * would reject a `name` key, and declared names are screened anyway).
 */
export interface DomainMetadataFieldDef {
  readonly field: string;
  readonly valueType: DomainMetadataValueType;
  readonly required: boolean;
  readonly description: string;
}

export function isDomainMetadataFieldDef(
  value: unknown,
): value is DomainMetadataFieldDef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['field'] === 'string' &&
    candidate['field'].length > 0 &&
    (DOMAIN_METADATA_VALUE_TYPES as readonly string[]).includes(
      candidate['valueType'] as string,
    ) &&
    typeof candidate['required'] === 'boolean' &&
    typeof candidate['description'] === 'string' &&
    candidate['description'].length > 0
  );
}

/**
 * The domain pack descriptor: id + semver version + description + the two
 * extension lists (competency types, metadata fields), content-addressed
 * by its own sha256 digest.
 */
export interface ExpertDomainPack {
  readonly packVersion: typeof EXPERT_DOMAIN_PACK_VERSION;
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly competencyTypes: readonly DomainCompetencyTypeDef[];
  readonly metadataFields: readonly DomainMetadataFieldDef[];
  readonly digest: ContentDigest;
}

export function isExpertDomainPack(value: unknown): value is ExpertDomainPack {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['packVersion'] !== EXPERT_DOMAIN_PACK_VERSION ||
    !isDomainPackId(candidate['id']) ||
    typeof candidate['version'] !== 'string' ||
    typeof candidate['description'] !== 'string' ||
    candidate['description'].length === 0
  ) {
    return false;
  }
  const types = candidate['competencyTypes'];
  if (!Array.isArray(types) || !types.every((t) => isDomainCompetencyTypeDef(t))) {
    return false;
  }
  const fields = candidate['metadataFields'];
  if (!Array.isArray(fields) || !fields.every((f) => isDomainMetadataFieldDef(f))) {
    return false;
  }
  return isContentDigest(candidate['digest']);
}

export interface CreateExpertDomainPackInput {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly competencyTypes: readonly {
    type: string;
    description: string;
  }[];
  readonly metadataFields: readonly {
    field: string;
    valueType: string;
    required: boolean;
    description: string;
  }[];
}

/**
 * Create an immutable, content-addressed domain pack descriptor. The
 * input key set is CLOSED: a pack input carrying `lifecycle`, `statuses`,
 * `transitions` or any other extra key is REJECTED (packs cannot alter
 * lifecycle semantics — R37). Every declared name is screened against the
 * authority and PII vocabularies (a pack declaring `adminOf` or `email`
 * is REJECTED — lock rule 9 and §8 identity). The whole input is ALSO
 * deep-screened for authority/PII-shaped keys at any depth.
 */
export async function createExpertDomainPack(
  input: CreateExpertDomainPackInput,
): Promise<ExpertDomainPack> {
  if (typeof input !== 'object' || input === null) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
      message: 'a domain pack input must be a plain object',
    });
  }
  // The deep screen first (lock rule 9 + PII minimization, defense in depth).
  assertScreenedInput(input, 'domain pack input');

  const record = input as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(PACK_INPUT_KEYS as readonly string[]).includes(key)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
        message: `domain packs cannot declare ${JSON.stringify(key)}: the pack input key set is closed (id, version, description, competencyTypes, metadataFields) — packs ADD competency types/metadata and can never alter lifecycle semantics or core profile structure (R37, architecture-lock rule 21)`,
        details: { field: key, known: [...PACK_INPUT_KEYS] },
      });
    }
  }
  if (!isDomainPackId(input.id)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
      message: `invalid domain pack id: ${JSON.stringify(input.id)} (lowercase kebab)`,
      details: { pattern: DOMAIN_PACK_ID_PATTERN_SOURCE },
    });
  }
  if (
    typeof input.version !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(
      input.version,
    )
  ) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
      message: `invalid domain pack version: ${JSON.stringify(input.version)} (semver, no build metadata)`,
    });
  }
  if (typeof input.description !== 'string' || input.description.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
      message: 'a domain pack requires a non-empty description',
      details: { field: 'description' },
    });
  }
  if (!Array.isArray(input.competencyTypes) || input.competencyTypes.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
      message:
        'a domain pack must declare at least one domain competency type (a pack that adds nothing is not a pack — R37)',
      details: { field: 'competencyTypes' },
    });
  }
  const competencyTypes = input.competencyTypes.map((def) => {
    if (!isDomainCompetencyTypeId(def.type)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
        message: `invalid domain competency type: ${JSON.stringify(def.type)}`,
        details: { pattern: DOMAIN_COMPETENCY_TYPE_PATTERN_SOURCE },
      });
    }
    // Gate 8 negative surface: declared names pass the screens.
    assertScreenedDeclaredName(def.type, 'domain competency type');
    if (typeof def.description !== 'string' || def.description.length === 0) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
        message: `domain competency type ${JSON.stringify(def.type)} requires a non-empty description`,
      });
    }
    return Object.freeze({ type: def.type, description: def.description });
  });
  const seenTypes = new Set<string>();
  for (const def of competencyTypes) {
    if (seenTypes.has(def.type)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
        message: `duplicate domain competency type: ${def.type}`,
        details: { type: def.type },
      });
    }
    seenTypes.add(def.type);
  }
  if (!Array.isArray(input.metadataFields)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
      message: 'metadataFields must be an array (possibly empty)',
      details: { field: 'metadataFields' },
    });
  }
  const metadataFields = input.metadataFields.map((def) => {
    if (typeof def.field !== 'string' || def.field.length === 0) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
        message: `invalid domain metadata field name: ${JSON.stringify(def.field)}`,
      });
    }
    // Gate 8 negative surface: declared names pass the screens.
    assertScreenedDeclaredName(def.field, 'domain metadata field');
    if (
      !(DOMAIN_METADATA_VALUE_TYPES as readonly string[]).includes(def.valueType)
    ) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
        message: `unknown domain metadata value type: ${JSON.stringify(def.valueType)} (known: ${DOMAIN_METADATA_VALUE_TYPES.join(' | ')})`,
        details: { known: [...DOMAIN_METADATA_VALUE_TYPES] },
      });
    }
    if (typeof def.required !== 'boolean') {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
        message: `domain metadata field ${JSON.stringify(def.field)} requires an explicit required flag`,
      });
    }
    if (typeof def.description !== 'string' || def.description.length === 0) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
        message: `domain metadata field ${JSON.stringify(def.field)} requires a non-empty description`,
      });
    }
    return Object.freeze({
      field: def.field,
      valueType: def.valueType as DomainMetadataValueType,
      required: def.required,
      description: def.description,
    });
  });
  const seenFields = new Set<string>();
  for (const def of metadataFields) {
    if (seenFields.has(def.field)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
        message: `duplicate domain metadata field: ${def.field}`,
        details: { field: def.field },
      });
    }
    seenFields.add(def.field);
  }
  const pack: Omit<ExpertDomainPack, 'digest'> = {
    packVersion: EXPERT_DOMAIN_PACK_VERSION,
    id: input.id,
    version: input.version,
    description: input.description,
    competencyTypes: Object.freeze(competencyTypes),
    metadataFields: Object.freeze(metadataFields),
  };
  const digest = toContentDigest(await digestCanonical(pack));
  return deepFreeze({ ...pack, digest });
}

// ---------------------------------------------------------------------------
// Profile conformance (R37 binding)
// ---------------------------------------------------------------------------

/** A pack value: validated pack or its plain structural form. */
export type ExpertDomainPackLike =
  | ExpertDomainPack
  | CreateExpertDomainPackInput;

function packIndexOf(packs: readonly ExpertDomainPack[]): {
  types: Map<string, ExpertDomainPack>;
  fields: Map<string, DomainMetadataFieldDef>;
} {
  const types = new Map<string, ExpertDomainPack>();
  const fields = new Map<string, DomainMetadataFieldDef>();
  for (const pack of packs) {
    for (const def of pack.competencyTypes) types.set(def.type, pack);
    for (const def of pack.metadataFields) fields.set(def.field, def);
  }
  return { types, fields };
}

/**
 * Assert that a profile's domain-typed competencies conform to the given
 * packs: every `domainType` must be declared by some pack, every
 * `domainMetadata` key must be a declared field of the SAME pack that
 * declares the type, every value must match the declared value type, and
 * every required field of the declaring pack must be present. Re-runs the
 * authority/PII screens on declared names (defense in depth). Throws
 * UNKNOWN_DOMAIN_COMPETENCY_TYPE / INVALID_DOMAIN_METADATA otherwise.
 */
export function assertProfileConformsToDomainPacks(
  profile: ExpertProfile,
  packs: readonly ExpertDomainPack[],
): void {
  const index = packIndexOf(packs);
  for (const competency of profile.competencies) {
    if (competency.domainType === undefined) continue;
    // Defense in depth: re-screen the declared names.
    assertScreenedDeclaredName(competency.domainType, 'domain competency type');
    const pack = index.types.get(competency.domainType);
    if (pack === undefined) {
      throw new ExpertRegistryError(
        EXPERT_ERROR_CODES.UNKNOWN_DOMAIN_COMPETENCY_TYPE,
        {
          message: `competency references undeclared domain type ${JSON.stringify(competency.domainType)} (known pack types: ${[...index.types.keys()].sort().join(', ') || 'none'})`,
          details: {
            domainType: competency.domainType,
            known: [...index.types.keys()].sort(),
          },
        },
      );
    }
    const metadata = competency.domainMetadata ?? {};
    for (const [key, value] of Object.entries(metadata)) {
      assertScreenedDeclaredName(key, 'domainMetadata key');
      const def = index.fields.get(key);
      if (def === undefined) {
        throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_METADATA, {
          message: `domainMetadata key ${JSON.stringify(key)} is not declared by any provided pack (known fields: ${[...index.fields.keys()].sort().join(', ') || 'none'})`,
          details: { key, known: [...index.fields.keys()].sort() },
        });
      }
      const actualType = typeof value;
      if (actualType !== def.valueType) {
        throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_METADATA, {
          message: `domainMetadata key ${JSON.stringify(key)} must be ${def.valueType}, got ${actualType}`,
          details: { key, expected: def.valueType, actual: actualType },
        });
      }
    }
    for (const def of pack.metadataFields) {
      if (def.required && !(def.field in metadata)) {
        throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_METADATA, {
          message: `domain type ${JSON.stringify(competency.domainType)} requires metadata field ${JSON.stringify(def.field)} (declared required by pack ${pack.id})`,
          details: { domainType: competency.domainType, field: def.field, pack: pack.id },
        });
      }
    }
  }
}
