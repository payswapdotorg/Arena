/**
 * Expert competencies (Work Order A006; docs/architecture.md §8
 * "competencies"; requirement R7 registry side: "Qualify experts against
 * evidence-backed competencies").
 *
 * A competency is a capability/skill REFERENCE plus a typed proficiency
 * level, each backed by >= 1 digest-addressed proficiency evidence refs —
 * an unevidenced proficiency claim is structurally rejected. The
 * qualification ENGINE that adjudicates evidence quality is A007; this
 * module only provides the typed data contract it consumes.
 *
 * Domain-pack extension (R37): a competency MAY carry a pack-declared
 * `domainType` and `domainMetadata` entries. Domain packs ADD
 * domain-specific competency types/metadata; they can never alter
 * lifecycle semantics or the separation-of-concerns screen (see
 * domain-pack.ts). Authority-shaped and PII-shaped declared names are
 * rejected HERE as well — defense in depth, so a rogue pack or a rogue
 * input cannot smuggle an authority claim through the competency group.
 */

import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import { assertScreenedDeclaredName } from './authority-screen.js';
import {
  assertNoDuplicateEvidence,
  capabilityNodeRefViewKey,
  deepFreeze,
  isCapabilityNodeRefView,
  toCapabilityNodeRefView,
  toEvidenceRef,
} from './shared.js';
import type {
  CapabilityNodeKindView,
  CapabilityNodeRefView,
  EvidenceRef,
} from './shared.js';

/** Wire version of the competency record shape. */
export const EXPERT_COMPETENCY_VERSION = 1 as const;

/**
 * The node kinds a competency may reference: capabilities, sub-capabilities
 * and skills of the Capability Graph, plus the graph's dedicated
 * `expert-competency` node kind (docs/architecture.md §4).
 */
export const COMPETENCY_NODE_KINDS: readonly CapabilityNodeKindView[] = [
  'capability',
  'sub-capability',
  'skill',
  'expert-competency',
];

/** Typed proficiency levels (closed vocabulary, neutral wording). */
export const PROFICIENCY_LEVELS = [
  'introductory',
  'working',
  'proficient',
  'advanced',
  'distinguished',
] as const;

export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

export function isProficiencyLevel(value: unknown): value is ProficiencyLevel {
  return (
    typeof value === 'string' &&
    (PROFICIENCY_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * Domain-pack metadata value types (R37). Packs declare typed metadata
 * fields; a competency's domainMetadata values must match the declared
 * type when validated against the pack (assertProfileConformsToDomainPacks).
 */
export const DOMAIN_METADATA_VALUE_TYPES = ['string', 'number', 'boolean'] as const;

export type DomainMetadataValueType = (typeof DOMAIN_METADATA_VALUE_TYPES)[number];

/** A domainMetadata value: string, number or boolean (never objects — flat metadata). */
export type DomainMetadataValue = string | number | boolean;

/** Exact pattern source for pack-declared domain competency type ids. */
export const DOMAIN_COMPETENCY_TYPE_PATTERN_SOURCE =
  '^[a-z][a-z0-9-]{0,63}(\\.[a-z][a-z0-9-]{0,63})*$';

const DOMAIN_TYPE_PATTERN = new RegExp(DOMAIN_COMPETENCY_TYPE_PATTERN_SOURCE);

export function isDomainCompetencyTypeId(value: unknown): value is string {
  return typeof value === 'string' && DOMAIN_TYPE_PATTERN.test(value);
}

/**
 * One expert competency: a capability/skill node ref, a typed proficiency
 * level, the evidence backing the proficiency claim, and OPTIONAL
 * domain-pack extension data (domainType + domainMetadata).
 */
export interface ExpertCompetency {
  readonly competencyVersion: typeof EXPERT_COMPETENCY_VERSION;
  /** The referenced capability/sub-capability/skill/expert-competency node. */
  readonly capability: CapabilityNodeRefView;
  /** Typed proficiency level (data, not a certification claim). */
  readonly proficiency: ProficiencyLevel;
  /** Evidence backing the proficiency claim (>= 1, digest-addressed). */
  readonly proficiencyEvidence: readonly EvidenceRef[];
  /** OPTIONAL pack-declared domain competency type (R37). */
  readonly domainType?: string;
  /** OPTIONAL pack-declared domain metadata (flat typed entries, R37). */
  readonly domainMetadata?: Readonly<Record<string, DomainMetadataValue>>;
}

export function isExpertCompetency(value: unknown): value is ExpertCompetency {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['competencyVersion'] !== EXPERT_COMPETENCY_VERSION ||
    !isCapabilityNodeRefView(candidate['capability']) ||
    !isProficiencyLevel(candidate['proficiency'])
  ) {
    return false;
  }
  const evidence = candidate['proficiencyEvidence'];
  if (
    !Array.isArray(evidence) ||
    evidence.length === 0 ||
    !evidence.every((ref) => {
      if (typeof ref !== 'object' || ref === null) return false;
      const digest = (ref as Record<string, unknown>)['digest'];
      return typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest);
    })
  ) {
    return false;
  }
  if (
    candidate['domainType'] !== undefined &&
    !isDomainCompetencyTypeId(candidate['domainType'])
  ) {
    return false;
  }
  const metadata = candidate['domainMetadata'];
  if (metadata !== undefined) {
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
      return false;
    }
    for (const entry of Object.values(metadata as Record<string, unknown>)) {
      if (
        typeof entry !== 'string' &&
        typeof entry !== 'number' &&
        typeof entry !== 'boolean'
      ) {
        return false;
      }
    }
  }
  return true;
}

/** Validate and freeze one competency; throws INVALID_COMPETENCY otherwise. */
export function toExpertCompetency(value: {
  capability: {
    kind: string;
    id: string;
    version: string;
    digest: string;
  };
  proficiency: string;
  proficiencyEvidence: readonly { digest: string; description: string }[];
  domainType?: string;
  domainMetadata?: Readonly<Record<string, string | number | boolean>>;
}): ExpertCompetency {
  const capability = toCapabilityNodeRefView(value.capability, COMPETENCY_NODE_KINDS);
  if (!isProficiencyLevel(value.proficiency)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_COMPETENCY, {
      message: `unknown proficiency level: ${JSON.stringify(value.proficiency)} (known: ${PROFICIENCY_LEVELS.join(', ')})`,
      details: { known: [...PROFICIENCY_LEVELS] },
    });
  }
  if (!Array.isArray(value.proficiencyEvidence) || value.proficiencyEvidence.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_COMPETENCY, {
      message:
        'a competency requires at least one digest-addressed proficiency evidence ref (an unevidenced proficiency claim is not a competency — R7)',
      details: { field: 'proficiencyEvidence' },
    });
  }
  const proficiencyEvidence = Object.freeze(
    value.proficiencyEvidence.map((ref) => toEvidenceRef(ref)),
  );
  assertNoDuplicateEvidence(proficiencyEvidence);

  if (value.domainType !== undefined) {
    // The separation-of-concerns and PII screens run BEFORE the format
    // check: an authority-shaped declared name is rejected AS authority,
    // not as a malformed slug (lock rule 9 reporting precision).
    assertScreenedDeclaredName(value.domainType, 'domain competency type');
    if (!isDomainCompetencyTypeId(value.domainType)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_COMPETENCY, {
        message: `invalid domain competency type: ${JSON.stringify(value.domainType)} (dotted lowercase slugs, pack-declared)`,
        details: { pattern: DOMAIN_COMPETENCY_TYPE_PATTERN_SOURCE },
      });
    }
  }

  let domainMetadata: Readonly<Record<string, DomainMetadataValue>> | undefined;
  if (value.domainMetadata !== undefined) {
    if (
      typeof value.domainMetadata !== 'object' ||
      value.domainMetadata === null ||
      Array.isArray(value.domainMetadata)
    ) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_COMPETENCY, {
        message: 'domainMetadata must be a flat object of typed entries',
        details: { field: 'domainMetadata' },
      });
    }
    if (Object.keys(value.domainMetadata).length === 0) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_COMPETENCY, {
        message: 'domainMetadata, when present, must declare at least one entry',
        details: { field: 'domainMetadata' },
      });
    }
    for (const [key, entry] of Object.entries(value.domainMetadata)) {
      if (
        typeof entry !== 'string' &&
        typeof entry !== 'number' &&
        typeof entry !== 'boolean'
      ) {
        throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_COMPETENCY, {
          message: `domainMetadata entries must be string/number/boolean: ${JSON.stringify(key)}`,
          details: { field: 'domainMetadata', key },
        });
      }
      assertScreenedDeclaredName(key, 'domainMetadata key');
    }
    domainMetadata = deepFreeze({ ...value.domainMetadata });
  }

  return deepFreeze({
    competencyVersion: EXPERT_COMPETENCY_VERSION,
    capability,
    proficiency: value.proficiency,
    proficiencyEvidence,
    ...(value.domainType !== undefined ? { domainType: value.domainType } : {}),
    ...(domainMetadata !== undefined ? { domainMetadata } : {}),
  });
}

/** Stable key of a competency: the capability ref key + proficiency. */
export function competencyKey(competency: ExpertCompetency): string {
  return `${capabilityNodeRefViewKey(competency.capability)}::${competency.proficiency}`;
}

/** The capability ref key alone (duplicate detection across proficiencies). */
export function competencyCapabilityKey(competency: ExpertCompetency): string {
  return capabilityNodeRefViewKey(competency.capability);
}

/** Validate a competency list (>= 1, no duplicate capability refs); freeze each. */
export function toExpertCompetencyList(
  values: readonly Parameters<typeof toExpertCompetency>[0][],
): readonly ExpertCompetency[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_COMPETENCY, {
      message:
        'an expert profile requires at least one competency (§8: experts are capability providers — a competency-less expert is not an expert)',
      details: { field: 'competencies' },
    });
  }
  const competencies = values.map((value) => toExpertCompetency(value));
  const seen = new Set<string>();
  for (const competency of competencies) {
    const key = competencyCapabilityKey(competency);
    if (seen.has(key)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_COMPETENCY, {
        message: `duplicate competency for the same capability node: ${key} (a profile lists each capability once, at its current proficiency)`,
        details: { capability: key },
      });
    }
    seen.add(key);
  }
  return Object.freeze(competencies);
}
