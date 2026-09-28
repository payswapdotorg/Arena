/**
 * Expert public-view derivation (Work Order A006 gate 6 privacy half;
 * architecture-lock rule 23 "privacy is explicit metadata"; lock rule 11).
 *
 * `deriveExpertPublicView` is a PURE derivation: it takes an immutable
 * profile and produces a deep-frozen PUBLIC view honoring the profile's
 * explicit privacy policy. A content group marked 'tenant-internal' is
 * STRIPPED — the derived view has no field for it at all, so the group's
 * internals (task history, reliability measurements, evidence, declared
 * identity refs — whichever the policy marks private) cannot leak through
 * the derivation. A group marked 'public' is carried unchanged.
 *
 * Structurally NEVER public (not governable by policy): the tenant scope
 * (addressing metadata, not customer data), the neutral expert id, the
 * version/status/digest addressing tuple, the record version and the
 * derived-at timestamp. The lifecycle event log and the supersession refs
 * are registry-internal audit material and are likewise never derived.
 *
 * The derived view is data, not a profile: it carries no digest of its own
 * derivation inputs beyond the source profile's digest (`sourceDigest`),
 * and it cannot be re-registered or mutated.
 */

import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import type { ExpertCompetency } from './competencies.js';
import type { ExpertQualification } from './qualifications.js';
import type { ExpertDomainScope } from './domain-scope.js';
import type { ExpertAvailability } from './availability.js';
import type { IdentityRefView } from './identity.js';
import type { ExpertProfile } from './profile.js';
import { isExpertProfile } from './profile.js';
import type { PublicViewFieldGroup } from './privacy-policy.js';
import { PUBLIC_VIEW_FIELD_GROUPS } from './privacy-policy.js';
import { deepFreeze } from './shared.js';
import { toExpertRegistryTimestamp } from './timestamp.js';

/** Wire version of the derived public view shape. */
export const EXPERT_PUBLIC_VIEW_VERSION = 1 as const;

/**
 * The derived public view of an expert profile. Every tenant-internal-
 * marked group is ABSENT (never null, never empty-but-present); every
 * public-marked group is carried unchanged. Addressing fields are always
 * present.
 */
export interface ExpertPublicView {
  readonly viewVersion: typeof EXPERT_PUBLIC_VIEW_VERSION;
  readonly tenant: string;
  readonly expertId: string;
  readonly version: string;
  readonly status: string;
  /** The source state's content digest — the view is reproducible from it. */
  readonly sourceDigest: string;
  readonly identityRefs?: readonly IdentityRefView[];
  readonly competencies?: readonly ExpertCompetency[];
  readonly qualifications?: readonly ExpertQualification[];
  readonly availability?: ExpertAvailability;
  readonly domainScope?: ExpertDomainScope;
  /** When the view was derived (injected — derivation never reads clocks). */
  readonly derivedAt: string;
}

export function isExpertPublicView(value: unknown): value is ExpertPublicView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['viewVersion'] === EXPERT_PUBLIC_VIEW_VERSION &&
    typeof candidate['tenant'] === 'string' &&
    typeof candidate['expertId'] === 'string' &&
    typeof candidate['version'] === 'string' &&
    typeof candidate['status'] === 'string' &&
    typeof candidate['sourceDigest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['sourceDigest']) &&
    typeof candidate['derivedAt'] === 'string'
  );
}

/**
 * Derive the public view of a profile at an injected derivation time.
 * Throws INVALID_PUBLIC_VIEW if the input is not a structurally valid
 * profile. The result is DEEP-FROZEN: a leaked public view cannot be
 * mutated into carrying tenant-internal data.
 */
export function deriveExpertPublicView(
  profile: ExpertProfile,
  context: { derivedAt: string },
): ExpertPublicView {
  if (!isExpertProfile(profile)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PUBLIC_VIEW, {
      message: 'a public view can only be derived from a structurally valid expert profile',
    });
  }
  const derivedAt = toExpertRegistryTimestamp(context.derivedAt);
  const visibility = profile.privacyPolicy.visibility;
  const include = (group: PublicViewFieldGroup): boolean =>
    visibility[group] === 'public';
  const view: ExpertPublicView = deepFreeze({
    viewVersion: EXPERT_PUBLIC_VIEW_VERSION,
    tenant: profile.identity.tenant,
    expertId: profile.identity.expertId,
    version: profile.version,
    status: profile.status,
    sourceDigest: profile.digest,
    ...(include('identityRefs') ? { identityRefs: profile.identityRefs } : {}),
    ...(include('competencies') ? { competencies: profile.competencies } : {}),
    ...(include('qualifications')
      ? { qualifications: profile.qualifications }
      : {}),
    ...(include('availability') ? { availability: profile.availability } : {}),
    ...(include('domainScope') ? { domainScope: profile.domainScope } : {}),
    derivedAt,
  });
  return view;
}

/**
 * Assert that a derived public view leaks NONE of the groups its source
 * profile's policy marks tenant-internal (the auditor tripwire for gate
 * 6): every private group must be ABSENT from the view, and the view must
 * not carry the source profile's evidence, task history, reliability
 * ledger or lifecycle log unless the policy explicitly marks them public.
 * Throws INVALID_PUBLIC_VIEW on any leak.
 */
export function assertPublicViewLeaksNothing(
  view: ExpertPublicView,
  profile: ExpertProfile,
): void {
  const visibility = profile.privacyPolicy.visibility;
  const leaks: string[] = [];
  if (visibility.identityRefs === 'tenant-internal' && view.identityRefs !== undefined) {
    leaks.push('identityRefs');
  }
  if (visibility.competencies === 'tenant-internal' && view.competencies !== undefined) {
    leaks.push('competencies');
  }
  if (
    visibility.qualifications === 'tenant-internal' &&
    view.qualifications !== undefined
  ) {
    leaks.push('qualifications');
  }
  if (visibility.availability === 'tenant-internal' && view.availability !== undefined) {
    leaks.push('availability');
  }
  if (visibility.domainScope === 'tenant-internal' && view.domainScope !== undefined) {
    leaks.push('domainScope');
  }
  if (leaks.length > 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PUBLIC_VIEW, {
      message: `public view leaks tenant-internal groups: ${leaks.join(', ')} (lock rule 11 / rule 23 — the derivation strips private groups)`,
      details: { leaked: leaks },
    });
  }
  // Structurally never public: evidence, taskHistory, reliability, lifecycle.
  const record = view as unknown as Record<string, unknown>;
  const structural: string[] = [];
  for (const field of ['evidence', 'taskHistory', 'reliability', 'lifecycle'] as const) {
    if (record[field] !== undefined) structural.push(field);
  }
  if (structural.length > 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PUBLIC_VIEW, {
      message: `public view carries structurally non-public groups: ${structural.join(', ')} (measurement and audit internals are never public-view material)`,
      details: { carried: structural },
    });
  }
  if (
    !PUBLIC_VIEW_FIELD_GROUPS.every(
      (group) => visibility[group] === 'public' || record[group] === undefined,
    )
  ) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PUBLIC_VIEW, {
      message: 'public view/public-policy inconsistency detected',
    });
  }
}
