/**
 * Expert profile privacy policy (Work Order A006 gate 6;
 * architecture-lock rule 23: "Safety, privacy, licensing and professional
 * limitations are explicit metadata" — the privacy half).
 *
 * The policy is EXPLICIT, PER-FIELD-GROUP metadata carried on the profile
 * content (content-addressed with everything else): each §8 content group
 * is marked 'public' or 'tenant-internal'. The public-view derivation
 * (public-view.ts) honors the marking — a group marked 'tenant-internal'
 * is stripped from the derived public view and can never leak; a group
 * marked 'public' is included.
 *
 * Defaults (see defaultExpertProfilePolicy): competencies,
 * qualifications, availability and domainScope are public (the
 * marketplace-visible surface); evidence, taskHistory, reliability and
 * identityRefs are tenant-internal (measurement and identity internals).
 * Every visibility entry must be declared explicitly — an omitted group
 * is a validation error, not a silent default.
 */

import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import { deepFreeze } from './shared.js';

/** Wire version of the privacy policy record shape. */
export const EXPERT_PRIVACY_POLICY_VERSION = 1 as const;

/**
 * The §8 content groups the privacy policy governs. `identity` (the
 * neutral tenant + expertId) and the lifecycle/version/addressing fields
 * are NOT governable — they are the profile's addressing surface, always
 * present in any derived view.
 */
export const PUBLIC_VIEW_FIELD_GROUPS = [
  'identityRefs',
  'competencies',
  'qualifications',
  'evidence',
  'taskHistory',
  'reliability',
  'availability',
  'domainScope',
] as const;

export type PublicViewFieldGroup = (typeof PUBLIC_VIEW_FIELD_GROUPS)[number];

/** Closed visibility vocabulary. */
export const FIELD_VISIBILITIES = ['public', 'tenant-internal'] as const;

export type FieldVisibility = (typeof FIELD_VISIBILITIES)[number];

export function isFieldVisibility(value: unknown): value is FieldVisibility {
  return (
    typeof value === 'string' &&
    (FIELD_VISIBILITIES as readonly string[]).includes(value)
  );
}

/**
 * The explicit per-group privacy marking. Every group in
 * PUBLIC_VIEW_FIELD_GROUPS must be declared exactly once.
 */
export interface ExpertProfilePrivacyPolicy {
  readonly policyVersion: typeof EXPERT_PRIVACY_POLICY_VERSION;
  readonly visibility: Readonly<Record<PublicViewFieldGroup, FieldVisibility>>;
}

export function isExpertProfilePrivacyPolicy(
  value: unknown,
): value is ExpertProfilePrivacyPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['policyVersion'] !== EXPERT_PRIVACY_POLICY_VERSION) return false;
  const visibility = candidate['visibility'];
  if (typeof visibility !== 'object' || visibility === null) return false;
  const record = visibility as Record<string, unknown>;
  for (const group of PUBLIC_VIEW_FIELD_GROUPS) {
    if (!isFieldVisibility(record[group])) return false;
  }
  const keys = Object.keys(record);
  if (keys.length !== PUBLIC_VIEW_FIELD_GROUPS.length) return false;
  return true;
}

/** The documented default policy (see module doc). */
export function defaultExpertProfilePolicy(): ExpertProfilePrivacyPolicy {
  return deepFreeze({
    policyVersion: EXPERT_PRIVACY_POLICY_VERSION,
    visibility: {
      identityRefs: 'tenant-internal',
      competencies: 'public',
      qualifications: 'public',
      evidence: 'tenant-internal',
      taskHistory: 'tenant-internal',
      reliability: 'tenant-internal',
      availability: 'public',
      domainScope: 'public',
    },
  });
}

/**
 * Validate and freeze a privacy policy; throws INVALID_PRIVACY_POLICY
 * otherwise. Every group must be declared explicitly with a known
 * visibility — omissions and unknown groups are rejected.
 */
export function toExpertProfilePrivacyPolicy(value: {
  visibility: Readonly<Record<string, string>>;
}): ExpertProfilePrivacyPolicy {
  if (typeof value !== 'object' || value === null || typeof value.visibility !== 'object' || value.visibility === null) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PRIVACY_POLICY, {
      message: 'a privacy policy requires a visibility record (lock rule 23: privacy is explicit metadata)',
      details: { field: 'visibility' },
    });
  }
  const visibility: Partial<Record<PublicViewFieldGroup, FieldVisibility>> = {};
  const known = new Set<string>(PUBLIC_VIEW_FIELD_GROUPS);
  for (const [group, marking] of Object.entries(value.visibility)) {
    if (!known.has(group)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PRIVACY_POLICY, {
        message: `unknown privacy policy group: ${JSON.stringify(group)} (known: ${PUBLIC_VIEW_FIELD_GROUPS.join(', ')})`,
        details: { known: [...PUBLIC_VIEW_FIELD_GROUPS] },
      });
    }
    if (!isFieldVisibility(marking)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PRIVACY_POLICY, {
        message: `unknown visibility marking for group ${JSON.stringify(group)}: ${JSON.stringify(marking)} (known: ${FIELD_VISIBILITIES.join(', ')})`,
        details: { group, known: [...FIELD_VISIBILITIES] },
      });
    }
    visibility[group as PublicViewFieldGroup] = marking;
    known.delete(group);
  }
  if (known.size > 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PRIVACY_POLICY, {
      message: `privacy policy is missing explicit visibility for: ${[...known].join(', ')} (every content group must be marked — lock rule 23: privacy is explicit metadata)`,
      details: { missing: [...known] },
    });
  }
  return deepFreeze({
    policyVersion: EXPERT_PRIVACY_POLICY_VERSION,
    visibility: visibility as Readonly<Record<PublicViewFieldGroup, FieldVisibility>>,
  });
}
