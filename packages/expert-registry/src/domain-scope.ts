/**
 * Expert domain scope, jurisdiction and professional limitations (Work
 * Order A006; docs/architecture.md §8 "domain/jurisdiction";
 * architecture-lock rule 23: "Safety, privacy, licensing and professional
 * limitations are explicit metadata").
 *
 * The domain scope records WHERE the expert's declared competencies apply:
 *   - `domains` — >= 1 capability-graph domain node refs;
 *   - `jurisdictions` — OPTIONAL (0+) typed ISO 3166 jurisdiction views
 *     ("where appropriate", §8);
 *   - `limitations` — >= 1 explicit professional-limitation records over a
 *     closed class vocabulary that includes safety, privacy and licensing.
 *
 * The limitations are load-bearing honesty metadata: an expert record
 * without an explicit limitation statement would silently overstate what
 * the expert is professionally able to do — exactly what lock rule 23
 * forbids (see also R39: structural-engineering capability with explicit
 * professional limitations).
 */

import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import {
  deepFreeze,
  isCapabilityNodeRefView,
  toCapabilityNodeRefView,
} from './shared.js';
import type { CapabilityNodeRefView } from './shared.js';
import { isExpertRegistryTimestamp, toExpertRegistryTimestamp } from './timestamp.js';

// ---------------------------------------------------------------------------
// Jurisdiction (typed, ISO 3166)
// ---------------------------------------------------------------------------

/** Wire version of the jurisdiction record shape. */
export const JURISDICTION_VERSION = 1 as const;

/** ISO 3166-1 alpha-2 country code (uppercase). */
export const COUNTRY_CODE_PATTERN_SOURCE = '^[A-Z]{2}$';

/** ISO 3166-2 subdivision code after the country prefix (e.g. `CA` of `US-CA`). */
export const REGION_CODE_PATTERN_SOURCE = '^[A-Z0-9]{1,3}$';

const COUNTRY_CODE_PATTERN = new RegExp(COUNTRY_CODE_PATTERN_SOURCE);
const REGION_CODE_PATTERN = new RegExp(REGION_CODE_PATTERN_SOURCE);

/**
 * A typed jurisdiction: an ISO 3166-1 alpha-2 country plus an OPTIONAL
 * ISO 3166-2 subdivision. Jurisdictions are professional-scope metadata,
 * not personal location data (§8: "domain/jurisdiction where appropriate").
 */
export interface JurisdictionView {
  readonly jurisdictionVersion: typeof JURISDICTION_VERSION;
  readonly country: string;
  readonly region?: string;
}

export function isJurisdictionView(value: unknown): value is JurisdictionView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['jurisdictionVersion'] === JURISDICTION_VERSION &&
    typeof candidate['country'] === 'string' &&
    COUNTRY_CODE_PATTERN.test(candidate['country']) &&
    (candidate['region'] === undefined ||
      (typeof candidate['region'] === 'string' && REGION_CODE_PATTERN.test(candidate['region'])))
  );
}

/** Validate and freeze a jurisdiction; throws INVALID_JURISDICTION otherwise. */
export function toJurisdictionView(value: {
  country: string;
  region?: string;
}): JurisdictionView {
  if (typeof value.country !== 'string' || !COUNTRY_CODE_PATTERN.test(value.country)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_JURISDICTION, {
      message: `invalid jurisdiction country: ${JSON.stringify(value.country)} (ISO 3166-1 alpha-2, uppercase)`,
      details: { pattern: COUNTRY_CODE_PATTERN_SOURCE },
    });
  }
  if (value.region !== undefined && !REGION_CODE_PATTERN.test(value.region)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_JURISDICTION, {
      message: `invalid jurisdiction region: ${JSON.stringify(value.region)} (ISO 3166-2 subdivision code)`,
      details: { pattern: REGION_CODE_PATTERN_SOURCE },
    });
  }
  return Object.freeze({
    jurisdictionVersion: JURISDICTION_VERSION,
    country: value.country,
    ...(value.region !== undefined ? { region: value.region } : {}),
  });
}

/** Stable key of a jurisdiction: `<country>` or `<country>-<region>`. */
export function jurisdictionKey(jurisdiction: JurisdictionView): string {
  return jurisdiction.region === undefined
    ? jurisdiction.country
    : `${jurisdiction.country}-${jurisdiction.region}`;
}

// ---------------------------------------------------------------------------
// Professional limitations (lock rule 23)
// ---------------------------------------------------------------------------

/** Wire version of the limitation record shape. */
export const LIMITATION_VERSION = 1 as const;

/**
 * Closed limitation-class vocabulary. Lock rule 23 requires safety,
 * privacy, licensing and professional limitations to be EXPLICIT metadata;
 * `jurisdictional` and `capacity` cover the remaining §8 limitation
 * families (where the expert will not practice; how much work they take).
 */
export const LIMITATION_CLASSES = [
  'safety',
  'privacy',
  'licensing',
  'professional-scope',
  'jurisdictional',
  'capacity',
] as const;

export type LimitationClass = (typeof LIMITATION_CLASSES)[number];

export function isLimitationClass(value: unknown): value is LimitationClass {
  return (
    typeof value === 'string' &&
    (LIMITATION_CLASSES as readonly string[]).includes(value)
  );
}

/**
 * One explicit professional limitation: its class, a non-empty statement,
 * an optional jurisdiction the limitation is scoped to, and an optional
 * expiry. Prose statements are allowed to mention anything — the screen
 * applies to FIELD NAMES, not prose (see authority-screen.ts).
 */
export interface ProfessionalLimitation {
  readonly limitationVersion: typeof LIMITATION_VERSION;
  readonly class: LimitationClass;
  readonly statement: string;
  readonly jurisdiction?: JurisdictionView;
  readonly appliesUntil?: string;
}

export function isProfessionalLimitation(
  value: unknown,
): value is ProfessionalLimitation {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['limitationVersion'] === LIMITATION_VERSION &&
    isLimitationClass(candidate['class']) &&
    typeof candidate['statement'] === 'string' &&
    candidate['statement'].length > 0 &&
    (candidate['jurisdiction'] === undefined ||
      isJurisdictionView(candidate['jurisdiction'])) &&
    (candidate['appliesUntil'] === undefined ||
      isExpertRegistryTimestamp(candidate['appliesUntil']))
  );
}

/** Validate and freeze one limitation; throws INVALID_LIMITATION otherwise. */
export function toProfessionalLimitation(value: {
  class: string;
  statement: string;
  jurisdiction?: { country: string; region?: string };
  appliesUntil?: string;
}): ProfessionalLimitation {
  if (!isLimitationClass(value.class)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIMITATION, {
      message: `unknown limitation class: ${JSON.stringify(value.class)} (known: ${LIMITATION_CLASSES.join(', ')})`,
      details: { known: [...LIMITATION_CLASSES] },
    });
  }
  if (typeof value.statement !== 'string' || value.statement.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIMITATION, {
      message: `a limitation requires a non-empty statement (lock rule 23: professional limitations are explicit metadata)`,
      details: { field: 'statement' },
    });
  }
  if (value.statement.length > 2000) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIMITATION, {
      message: 'limitation statements must be at most 2000 characters',
      details: { length: value.statement.length },
    });
  }
  const jurisdiction =
    value.jurisdiction === undefined ? undefined : toJurisdictionView(value.jurisdiction);
  const appliesUntil =
    value.appliesUntil === undefined
      ? undefined
      : toExpertRegistryTimestamp(value.appliesUntil);
  return deepFreeze({
    limitationVersion: LIMITATION_VERSION,
    class: value.class,
    statement: value.statement,
    ...(jurisdiction !== undefined ? { jurisdiction } : {}),
    ...(appliesUntil !== undefined ? { appliesUntil } : {}),
  });
}

// ---------------------------------------------------------------------------
// The domain scope (§8 "domain/jurisdiction")
// ---------------------------------------------------------------------------

/** Wire version of the domain-scope record shape. */
export const EXPERT_DOMAIN_SCOPE_VERSION = 1 as const;

/**
 * The expert's domain/jurisdiction scope: >= 1 capability-graph domain
 * node refs, 0+ typed jurisdictions, and >= 1 explicit professional
 * limitations (lock rule 23).
 */
export interface ExpertDomainScope {
  readonly scopeVersion: typeof EXPERT_DOMAIN_SCOPE_VERSION;
  readonly domains: readonly CapabilityNodeRefView[];
  readonly jurisdictions: readonly JurisdictionView[];
  readonly limitations: readonly ProfessionalLimitation[];
}

export function isExpertDomainScope(value: unknown): value is ExpertDomainScope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const domains = candidate['domains'];
  const jurisdictions = candidate['jurisdictions'];
  const limitations = candidate['limitations'];
  return (
    candidate['scopeVersion'] === EXPERT_DOMAIN_SCOPE_VERSION &&
    Array.isArray(domains) &&
    domains.length > 0 &&
    domains.every((ref) => isCapabilityNodeRefView(ref)) &&
    domains.every(
      (ref) =>
        (ref as { kind?: unknown }).kind === 'domain',
    ) &&
    Array.isArray(jurisdictions) &&
    jurisdictions.every((j) => isJurisdictionView(j)) &&
    Array.isArray(limitations) &&
    limitations.length > 0 &&
    limitations.every((l) => isProfessionalLimitation(l))
  );
}

/** Validate and freeze the domain scope; throws INVALID_DOMAIN_SCOPE otherwise. */
export function toExpertDomainScope(value: {
  domains: readonly {
    kind: string;
    id: string;
    version: string;
    digest: string;
  }[];
  jurisdictions: readonly { country: string; region?: string }[];
  limitations: readonly {
    class: string;
    statement: string;
    jurisdiction?: { country: string; region?: string };
    appliesUntil?: string;
  }[];
}): ExpertDomainScope {
  if (!Array.isArray(value.domains) || value.domains.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_SCOPE, {
      message:
        'the domain scope requires at least one capability-graph domain node ref (§8: domain/jurisdiction where appropriate — the domain list anchors the scope)',
      details: { field: 'domains' },
    });
  }
  const domains = Object.freeze(
    value.domains.map((ref) => toCapabilityNodeRefView(ref, ['domain'])),
  );
  const seenDomains = new Set<string>();
  for (const ref of domains) {
    const key = `${ref.id}@${ref.version}#${ref.digest}`;
    if (seenDomains.has(key)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_SCOPE, {
        message: `duplicate domain node ref: ${key}`,
        details: { domain: key },
      });
    }
    seenDomains.add(key);
  }
  if (!Array.isArray(value.jurisdictions)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_SCOPE, {
      message: 'jurisdictions must be an array (possibly empty — "where appropriate")',
      details: { field: 'jurisdictions' },
    });
  }
  const jurisdictions = Object.freeze(
    value.jurisdictions.map((j) => toJurisdictionView(j)),
  );
  const seenJurisdictions = new Set<string>();
  for (const j of jurisdictions) {
    const key = jurisdictionKey(j);
    if (seenJurisdictions.has(key)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_SCOPE, {
        message: `duplicate jurisdiction: ${key}`,
        details: { jurisdiction: key },
      });
    }
    seenJurisdictions.add(key);
  }
  if (!Array.isArray(value.limitations) || value.limitations.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_SCOPE, {
      message:
        'the domain scope requires at least one explicit professional limitation (architecture-lock rule 23: safety, privacy, licensing and professional limitations are explicit metadata — an unlimited expert record would silently overstate professional scope)',
      details: { field: 'limitations' },
    });
  }
  const limitations = Object.freeze(
    value.limitations.map((l) => toProfessionalLimitation(l)),
  );
  return deepFreeze({
    scopeVersion: EXPERT_DOMAIN_SCOPE_VERSION,
    domains,
    jurisdictions,
    limitations,
  });
}
