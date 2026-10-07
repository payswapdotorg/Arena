/**
 * RoutingCandidate — the routing-side VIEW of one expert (Work Order
 * C002; ES1.0 Routing inputs). The service layer assembles candidates
 * from the merged read surfaces (A006 expert registry profiles + A007
 * qualification records); this package consumes them as DATA.
 *
 * QUALIFICATION IS DATA, NEVER AN ACCESS GRANT (architecture-lock rule 9 —
 * the critical gate): a candidate's qualification entries are INPUT to
 * filtering and ranking. Nothing here grants, implies or records a
 * permission, a role or system authority — a fully-qualified candidate
 * that fails conflict-of-interest or privacy-clearance rules is BLOCKED,
 * never best-effort routed.
 *
 * The view deliberately carries NO aggregate quality score and NO
 * reputation input (spec/quality-model.md): demonstrated performance is
 * the recomputed reliability counters, historical task fit is the prior
 * engagement domain refs, and qualification evidence stays per-capability.
 */

import { ESCALATION_ROUTING_ERROR_CODES, EscalationRoutingError } from './errors.js';
import type {
  AvailabilityWindowView,
  CapabilityNodeRefView,
  JurisdictionView,
  ProficiencyLevel,
} from '@arena/expert-qualification';
import {
  isAvailabilityWindowView,
  isJurisdictionView,
  isNeutralExpertId,
  isProficiencyLevel,
  isTenantScope,
  toAvailabilityWindowView,
  toCapabilityNodeRefView,
  toJurisdictionView,
  toNeutralExpertId,
  toTenantScope,
} from '@arena/expert-qualification';
import { isCapabilityNodeKind } from '@arena/capability-graph';

/** Wire version of the routing-candidate view shape. */
export const ROUTING_CANDIDATE_VERSION = 1 as const;

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const TENANT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const CLIENT_APP_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/** One qualification entry: capability ref + proficiency + the evidence digests. */
export interface QualifiedCapabilityEntry {
  readonly capability: CapabilityNodeRefView;
  readonly proficiency: ProficiencyLevel;
  /** The A007 competency-claim digest backing this qualification. */
  readonly claimDigest: string;
  /** The A007 qualification-record digest in force. */
  readonly recordDigest: string;
  /** The qualifying evidence digests (A007 record). */
  readonly evidenceDigests: readonly string[];
}

/** Recomputed reliability counters (A006 ledger view — demonstrated performance). */
export interface ReliabilityView {
  readonly completed: number;
  readonly failed: number;
  readonly noResponse: number;
}

/**
 * Privacy clearance (DATA, never an access grant): the classification the
 * expert is cleared to see and the strictest PII handling mode they
 * operate under.
 */
export interface PrivacyClearanceView {
  readonly maxDataClassification: 'public' | 'internal' | 'confidential';
  readonly piiHandling: 'forbid' | 'redact' | 'allow';
}

/** The expert's declared engagement rate (budget feasibility input). */
export interface RateCardView {
  readonly engagementRateMinorUnits: number;
  readonly currency: string;
}

/**
 * Conflict-of-interest rules (explicit, machine-readable): the tenants and
 * client applications this expert has a declared conflict with.
 */
export interface ConflictOfInterestView {
  readonly blockedTenantIds: readonly string[];
  readonly blockedClientAppIds: readonly string[];
}

/** The digest-free candidate view. */
export interface RoutingCandidateView {
  readonly candidateVersion: typeof ROUTING_CANDIDATE_VERSION;
  readonly expertId: string;
  readonly tenant: string;
  readonly locale: string;
  readonly jurisdictions: readonly JurisdictionView[];
  readonly availability: readonly AvailabilityWindowView[];
  readonly qualifiedCapabilities: readonly QualifiedCapabilityEntry[];
  readonly domainRefs: readonly CapabilityNodeRefView[];
  readonly supportedToolRefs: readonly CapabilityNodeRefView[];
  readonly reliability: ReliabilityView;
  readonly privacyClearance: PrivacyClearanceView;
  readonly rateCard: RateCardView;
  readonly coi: ConflictOfInterestView;
  /** Domains of prior engagements (historical task fit input). */
  readonly historicalTaskDomainRefs: readonly CapabilityNodeRefView[];
}

/** A frozen routing candidate (input DATA to the engine — not content-addressed). */
export type RoutingCandidate = RoutingCandidateView;

export interface CreateRoutingCandidateInput {
  readonly expertId: string;
  readonly tenant: string;
  readonly locale: string;
  readonly jurisdictions?: readonly { readonly country: string; readonly region?: string }[];
  readonly availability?: readonly {
    readonly recurrence: string;
    readonly dayOfWeek?: number;
    readonly startUtc: string;
    readonly endUtc: string;
    readonly date?: string;
  }[];
  readonly qualifiedCapabilities?: readonly {
    readonly capability: {
      readonly kind: string;
      readonly id: string;
      readonly version: string;
      readonly digest: string;
    };
    readonly proficiency: string;
    readonly claimDigest: string;
    readonly recordDigest: string;
    readonly evidenceDigests?: readonly string[];
  }[];
  readonly domainRefs?: readonly {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  }[];
  readonly supportedToolRefs?: readonly {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  }[];
  readonly reliability?: { readonly completed: number; readonly failed: number; readonly noResponse: number };
  readonly privacyClearance?: { readonly maxDataClassification: string; readonly piiHandling: string };
  readonly rateCard?: { readonly engagementRateMinorUnits: number; readonly currency: string };
  readonly coi?: { readonly blockedTenantIds?: readonly string[]; readonly blockedClientAppIds?: readonly string[] };
  readonly historicalTaskDomainRefs?: readonly {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  }[];
}

function toQualifiedCapabilityEntry(value: unknown): QualifiedCapabilityEntry {
  if (typeof value !== 'object' || value === null) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'a qualified capability entry must be an object',
    });
  }
  const record = value as Record<string, unknown>;
  const capability = record['capability'];
  if (typeof capability !== 'object' || capability === null) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'a qualified capability entry requires a capability node ref',
    });
  }
  const proficiency = record['proficiency'];
  if (typeof proficiency !== 'string' || !isProficiencyLevel(proficiency)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `qualified capability proficiency is invalid: ${JSON.stringify(proficiency)}`,
    });
  }
  const claimDigest = record['claimDigest'];
  const recordDigest = record['recordDigest'];
  if (
    typeof claimDigest !== 'string' ||
    !DIGEST_PATTERN.test(claimDigest) ||
    typeof recordDigest !== 'string' ||
    !DIGEST_PATTERN.test(recordDigest)
  ) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'a qualified capability entry requires sha256 claim/record digests',
    });
  }
  const evidence = record['evidenceDigests'];
  if (!Array.isArray(evidence) || !evidence.every((digest) => typeof digest === 'string' && DIGEST_PATTERN.test(digest))) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'qualified capability evidenceDigests must be sha256 hex digests',
    });
  }
  return Object.freeze({
    capability: toCapabilityNodeRefView(
      capability as { kind: string; id: string; version: string; digest: string },
    ),
    proficiency,
    claimDigest,
    recordDigest,
    evidenceDigests: Object.freeze([...evidence]) as readonly string[],
  });
}

function toCounter(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `reliability ${field} must be a non-negative integer`,
    });
  }
  return value;
}

function toPrivacyClearance(value: unknown): PrivacyClearanceView {
  if (typeof value !== 'object' || value === null) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'privacyClearance must be an object',
    });
  }
  const record = value as Record<string, unknown>;
  const classification = record['maxDataClassification'];
  const piiHandling = record['piiHandling'];
  if (
    typeof classification !== 'string' ||
    !['public', 'internal', 'confidential'].includes(classification) ||
    typeof piiHandling !== 'string' ||
    !['forbid', 'redact', 'allow'].includes(piiHandling)
  ) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `privacyClearance is invalid: ${JSON.stringify(value)}`,
    });
  }
  return Object.freeze({
    maxDataClassification: classification as PrivacyClearanceView['maxDataClassification'],
    piiHandling: piiHandling as PrivacyClearanceView['piiHandling'],
  });
}

function toRateCard(value: unknown): RateCardView {
  if (typeof value !== 'object' || value === null) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'rateCard must be an object',
    });
  }
  const record = value as Record<string, unknown>;
  const rate = record['engagementRateMinorUnits'];
  const currency = record['currency'];
  if (
    typeof rate !== 'number' ||
    !Number.isInteger(rate) ||
    rate < 0 ||
    rate > Number.MAX_SAFE_INTEGER ||
    typeof currency !== 'string' ||
    !CURRENCY_PATTERN.test(currency)
  ) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `rateCard is invalid: ${JSON.stringify(value)}`,
    });
  }
  return Object.freeze({ engagementRateMinorUnits: rate, currency });
}

function toStringArray(value: unknown, field: string, pattern: RegExp): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && pattern.test(entry))) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `coi.${field} must be a list of ${pattern.source}-shaped identifiers`,
    });
  }
  return Object.freeze([...(value as readonly string[])]);
}

/** A node-version-shaped string (A004 semver, no build metadata). */
const NODE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

/**
 * Validate and freeze an A004 graph node ref view for a SPECIFIC allowed
 * kind set (A007's toCapabilityNodeRefView covers the competency subset;
 * tool/domain refs validate here against the full A004 kind vocabulary).
 */
function toGraphRefView(
  value: { readonly kind: string; readonly id: string; readonly version: string; readonly digest: string },
  allowedKinds: readonly string[],
  field: string,
): CapabilityNodeRefView {
  if (
    !isCapabilityNodeKind(value.kind) ||
    !allowedKinds.includes(value.kind) ||
    typeof value.id !== 'string' ||
    !/^[a-z][a-z0-9-]{0,127}$/.test(value.id) ||
    typeof value.version !== 'string' ||
    !NODE_VERSION_PATTERN.test(value.version) ||
    typeof value.digest !== 'string' ||
    !DIGEST_PATTERN.test(value.digest)
  ) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `${field} must be a content-addressed capability-graph node ref of kind ${allowedKinds.join('|')}: ${JSON.stringify(value)}`,
    });
  }
  return Object.freeze({ kind: value.kind, id: value.id, version: value.version, digest: value.digest });
}

function toRefViewList(
  value: unknown,
  field: string,
  allowedKinds: readonly string[],
): readonly CapabilityNodeRefView[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `${field} must be a list of capability node refs`,
    });
  }
  return Object.freeze(
    (value as { kind: string; id: string; version: string; digest: string }[]).map((ref) =>
      toGraphRefView(ref, allowedKinds, field),
    ),
  );
}

/**
 * Create a validated, deep-frozen routing candidate (the plain-string
 * input shape is the house convention; typed errors throughout).
 */
export function createRoutingCandidate(input: CreateRoutingCandidateInput): RoutingCandidate {
  if (typeof input !== 'object' || input === null) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'routing candidate input must be an object',
    });
  }
  const expertId = toNeutralExpertId(input.expertId, 'routing candidate expertId');
  const tenant = toTenantScope(input.tenant, 'routing candidate tenant');
  if (typeof input.locale !== 'string' || !LOCALE_PATTERN.test(input.locale)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `routing candidate locale is invalid: ${JSON.stringify(input.locale)}`,
    });
  }
  const jurisdictions = Object.freeze(
    (input.jurisdictions ?? []).map((entry) => toJurisdictionView(entry)),
  );
  if (!jurisdictions.every((entry) => isJurisdictionView(entry))) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'routing candidate jurisdictions failed validation',
    });
  }
  const availability = Object.freeze(
    (input.availability ?? []).map((window) => toAvailabilityWindowView(window)),
  );
  if (!availability.every((window) => isAvailabilityWindowView(window))) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'routing candidate availability windows failed validation',
    });
  }
  const qualifiedCapabilities = Object.freeze(
    (input.qualifiedCapabilities ?? []).map((entry) => toQualifiedCapabilityEntry(entry)),
  );
  const reliabilityInput = input.reliability ?? { completed: 0, failed: 0, noResponse: 0 };
  const reliability = Object.freeze({
    completed: toCounter(reliabilityInput.completed, 'completed'),
    failed: toCounter(reliabilityInput.failed, 'failed'),
    noResponse: toCounter(reliabilityInput.noResponse, 'noResponse'),
  });
  const privacyClearance = toPrivacyClearance(
    input.privacyClearance ?? { maxDataClassification: 'public', piiHandling: 'forbid' },
  );
  const rateCard = toRateCard(input.rateCard ?? { engagementRateMinorUnits: 0, currency: 'USD' });

  const coiInput = input.coi ?? {};
  const coi = Object.freeze({
    blockedTenantIds: toStringArray(coiInput.blockedTenantIds, 'blockedTenantIds', TENANT_ID_PATTERN),
    blockedClientAppIds: toStringArray(coiInput.blockedClientAppIds, 'blockedClientAppIds', CLIENT_APP_ID_PATTERN),
  });

  const candidate: RoutingCandidate = Object.freeze({
    candidateVersion: ROUTING_CANDIDATE_VERSION,
    expertId,
    tenant,
    locale: input.locale,
    jurisdictions,
    availability,
    qualifiedCapabilities,
    domainRefs: toRefViewList(input.domainRefs, 'domainRefs', ['domain']),
    supportedToolRefs: toRefViewList(input.supportedToolRefs, 'supportedToolRefs', ['tool']),
    reliability,
    privacyClearance,
    rateCard,
    coi,
    historicalTaskDomainRefs: toRefViewList(input.historicalTaskDomainRefs, 'historicalTaskDomainRefs', ['domain']),
  });
  return candidate;
}

/** Structural (non-throwing) guard for a routing candidate. */
export function isRoutingCandidate(value: unknown): value is RoutingCandidate {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['candidateVersion'] === ROUTING_CANDIDATE_VERSION &&
    typeof candidate['expertId'] === 'string' &&
    isNeutralExpertId(candidate['expertId']) &&
    typeof candidate['tenant'] === 'string' &&
    isTenantScope(candidate['tenant']) &&
    typeof candidate['locale'] === 'string' &&
    Array.isArray(candidate['jurisdictions']) &&
    Array.isArray(candidate['availability']) &&
    Array.isArray(candidate['qualifiedCapabilities'])
  );
}
