/**
 * Catalog candidate views (Work Order C015; issue #121) — the
 * routing-side VIEWS of one resource candidate per class. The SERVICE
 * layer (or a host) assembles these views from the merged read surfaces
 * through injected ports only (spec/service-boundaries.md — no direct
 * reads into another surface's state):
 *
 *   - ExpertCandidateView — C002 RoutingCandidate (delegated verbatim)
 *                         + the C005 performance-profile digest when
 *                           dimensional evidence is available;
 *   - BodyCandidateView   — C014 capability-body listings (state,
 *                         substrate compatibility, pricing, evidence);
 *   - ToolCandidateView   — C008 tool-gap / tool-specification records;
 *   - KnowledgeCandidateView — C008 knowledge-tier lattice records;
 *   - ArtifactCandidateView  — A032 marketplace offers (dataset /
 *                         evaluation-suite / environment) + entitlement
 *                         state.
 *
 * The view shapes are STRUCTURAL MIRRORS of those surfaces' public
 * record shapes (plain data; the constructors validate and freeze).
 * QUALIFICATION AND PERFORMANCE EVIDENCE ARE DATA, NEVER ACCESS GRANTS
 * (lock rules 9/35): every field here is INPUT to filtering and
 * ranking. Nothing grants, implies or records a permission.
 */

import { CAPABILITY_ROUTING_ERROR_CODES, CapabilityRoutingError } from './errors.js';
import type { RoutingCandidate } from '@arena/escalation-routing';
import { isRoutingCandidate } from '@arena/escalation-routing';
import { KNOWLEDGE_SCOPE_KINDS, KNOWLEDGE_TIERS, ARTIFACT_KINDS } from './demand.js';
import type {
  ArtifactKind,
  KnowledgeScopeKind,
  KnowledgeTier,
} from './demand.js';
import { isResourceClass } from './policy.js';

/** Wire version of every catalog candidate view shape. */
export const RESOURCE_CANDIDATE_VERSION = 1 as const;

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const TENANT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const LISTING_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const RECORD_ID_PATTERN = /^[a-z][a-z0-9-]{1,127}$/;
const OFFER_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const SUBSTRATE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

// ---------------------------------------------------------------------------
// Expert (C002 delegation + C005 performance evidence linkage)
// ---------------------------------------------------------------------------

/** The routing-side expert view: a validated C002 candidate + evidence linkage. */
export interface ExpertCandidateView {
  readonly candidateVersion: typeof RESOURCE_CANDIDATE_VERSION;
  readonly resourceClass: 'expert';
  /** The C002 routing candidate (consumed verbatim — compose, never fork). */
  readonly candidate: RoutingCandidate;
  /**
   * The C005 PerformanceProfile digest when dimensional performance
   * evidence is available (INPUT to ranking — never an access grant;
   * null means no profile was assembled for this expert).
   */
  readonly performanceProfileDigest: string | null;
}

export interface CreateExpertCandidateInput {
  readonly candidate: RoutingCandidate;
  readonly performanceProfileDigest?: string | null;
}

/** Create a validated, deep-frozen expert candidate view. */
export function createExpertCandidate(input: CreateExpertCandidateInput): ExpertCandidateView {
  if (typeof input !== 'object' || input === null) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'expert candidate input must be an object',
    });
  }
  if (!isRoutingCandidate(input.candidate)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'expert candidate requires a structurally valid C002 RoutingCandidate',
    });
  }
  const performanceDigest = input.performanceProfileDigest ?? null;
  if (
    performanceDigest !== null &&
    (typeof performanceDigest !== 'string' || !DIGEST_PATTERN.test(performanceDigest))
  ) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'expert candidate performanceProfileDigest must be a sha256 hex digest or null',
    });
  }
  return Object.freeze({
    candidateVersion: RESOURCE_CANDIDATE_VERSION,
    resourceClass: 'expert',
    candidate: input.candidate,
    performanceProfileDigest: performanceDigest,
  });
}

// ---------------------------------------------------------------------------
// Body (C014 capability-body listings)
// ---------------------------------------------------------------------------

/** The listing lifecycle states mirrored from C014 (closed vocabulary). */
export const BODY_LISTING_STATES = Object.freeze([
  'draft',
  'published',
  'suspended',
  'retired',
] as const);
export type BodyListingState = (typeof BODY_LISTING_STATES)[number];

/** Substrate/environment compatibility data mirrored from C014 listings. */
export interface BodySubstrateCompatibility {
  /** The cognitive substrate the Body Version was tested on. */
  readonly substrateId: string;
  /** Environment identifiers the composition supports. */
  readonly environmentIds: readonly string[];
}

/** The routing-side Agent-Body view (from C014 CapabilityBodyListing). */
export interface BodyCandidateView {
  readonly candidateVersion: typeof RESOURCE_CANDIDATE_VERSION;
  readonly resourceClass: 'body';
  readonly listingId: string;
  readonly tenantId: string;
  /** The Body Version this listing publishes (A003/A021 composition). */
  readonly bodyVersionRef: {
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  /** Capability-evidence digest references (INPUT to ranking). */
  readonly capabilityEvidenceRefs: readonly string[];
  /** Certification record digests (INPUT to ranking — never a claim). */
  readonly certificationRecordDigests: readonly string[];
  readonly substrateCompatibility: BodySubstrateCompatibility | null;
  readonly pricing: { readonly amountMinorUnits: number; readonly currency: string } | null;
  readonly state: BodyListingState;
}

export interface CreateBodyCandidateInput {
  readonly listingId: string;
  readonly tenantId: string;
  readonly bodyVersionRef: {
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly capabilityEvidenceRefs?: readonly string[];
  readonly certificationRecordDigests?: readonly string[];
  readonly substrateCompatibility?: {
    readonly substrateId: string;
    readonly environmentIds?: readonly string[];
  } | null;
  readonly pricing?: { readonly amountMinorUnits: number; readonly currency: string } | null;
  readonly state: string;
}

/** Validate and freeze one Agent-Body candidate view. */
export function createBodyCandidate(input: CreateBodyCandidateInput): BodyCandidateView {
  if (typeof input !== 'object' || input === null) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'body candidate input must be an object',
    });
  }
  if (typeof input.listingId !== 'string' || !LISTING_ID_PATTERN.test(input.listingId)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `body candidate listingId is invalid: ${JSON.stringify(input.listingId)}`,
    });
  }
  if (typeof input.tenantId !== 'string' || !TENANT_ID_PATTERN.test(input.tenantId)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `body candidate tenantId is invalid: ${JSON.stringify(input.tenantId)}`,
    });
  }
  const ref = input.bodyVersionRef;
  if (
    typeof ref !== 'object' ||
    ref === null ||
    typeof ref.name !== 'string' ||
    !LISTING_ID_PATTERN.test(ref.name) ||
    typeof ref.version !== 'string' ||
    !SEMVER_PATTERN.test(ref.version) ||
    typeof ref.digest !== 'string' ||
    !DIGEST_PATTERN.test(ref.digest)
  ) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'body candidate bodyVersionRef requires name/semver-version/sha256-digest',
    });
  }
  if (!(BODY_LISTING_STATES as readonly string[]).includes(input.state)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `body candidate state is invalid: ${JSON.stringify(input.state)}`,
    });
  }
  const evidence = input.capabilityEvidenceRefs ?? [];
  const certifications = input.certificationRecordDigests ?? [];
  if (
    !Array.isArray(evidence) ||
    !evidence.every((entry) => typeof entry === 'string' && DIGEST_PATTERN.test(entry)) ||
    !Array.isArray(certifications) ||
    !certifications.every((entry) => typeof entry === 'string' && DIGEST_PATTERN.test(entry))
  ) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'body candidate evidence/certification refs must be sha256 hex digests',
    });
  }
  let substrateCompatibility: BodySubstrateCompatibility | null = null;
  if (input.substrateCompatibility != null) {
    const substrate = input.substrateCompatibility;
    if (
      typeof substrate.substrateId !== 'string' ||
      !SUBSTRATE_PATTERN.test(substrate.substrateId)
    ) {
      throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
        message: `body candidate substrateId is invalid: ${JSON.stringify(substrate.substrateId)}`,
      });
    }
    const environments = substrate.environmentIds ?? [];
    if (
      !Array.isArray(environments) ||
      !environments.every((entry) => typeof entry === 'string' && SUBSTRATE_PATTERN.test(entry))
    ) {
      throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
        message: 'body candidate environmentIds must be substrate-shaped identifiers',
      });
    }
    substrateCompatibility = Object.freeze({
      substrateId: substrate.substrateId,
      environmentIds: Object.freeze([...environments]),
    });
  }
  let pricing: BodyCandidateView['pricing'] = null;
  if (input.pricing != null) {
    const price = input.pricing;
    if (
      typeof price.amountMinorUnits !== 'number' ||
      !Number.isInteger(price.amountMinorUnits) ||
      price.amountMinorUnits < 0 ||
      price.amountMinorUnits > Number.MAX_SAFE_INTEGER ||
      typeof price.currency !== 'string' ||
      !CURRENCY_PATTERN.test(price.currency)
    ) {
      throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
        message: `body candidate pricing is invalid: ${JSON.stringify(input.pricing)}`,
      });
    }
    pricing = Object.freeze({
      amountMinorUnits: price.amountMinorUnits,
      currency: price.currency,
    });
  }
  return Object.freeze({
    candidateVersion: RESOURCE_CANDIDATE_VERSION,
    resourceClass: 'body',
    listingId: input.listingId,
    tenantId: input.tenantId,
    bodyVersionRef: Object.freeze({
      name: ref.name,
      version: ref.version,
      digest: ref.digest,
    }),
    capabilityEvidenceRefs: Object.freeze([...evidence]),
    certificationRecordDigests: Object.freeze([...certifications]),
    substrateCompatibility,
    pricing,
    state: input.state as BodyListingState,
  });
}

// ---------------------------------------------------------------------------
// Tool (C008 tool-gap / tool-specification records)
// ---------------------------------------------------------------------------

/** The routing-side tool view (from C008 tool-gap / tool specifications). */
export interface ToolCandidateView {
  readonly candidateVersion: typeof RESOURCE_CANDIDATE_VERSION;
  readonly resourceClass: 'tool';
  readonly toolId: string;
  readonly tenantId: string;
  /** The operations this tool performs (machine-readable capability). */
  readonly operations: readonly string[];
  /** Availability state (fail-closed: only 'available' survives). */
  readonly availability: 'available' | 'unavailable';
  /** The C008 tool-gap signal this candidate was proposed from, when known. */
  readonly sourceToolGapSignalId: string | null;
}

export interface CreateToolCandidateInput {
  readonly toolId: string;
  readonly tenantId: string;
  readonly operations?: readonly string[];
  readonly availability?: string;
  readonly sourceToolGapSignalId?: string | null;
}

/** Validate and freeze one tool candidate view. */
export function createToolCandidate(input: CreateToolCandidateInput): ToolCandidateView {
  if (typeof input !== 'object' || input === null) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'tool candidate input must be an object',
    });
  }
  if (typeof input.toolId !== 'string' || !RECORD_ID_PATTERN.test(input.toolId)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `tool candidate toolId is invalid: ${JSON.stringify(input.toolId)}`,
    });
  }
  if (typeof input.tenantId !== 'string' || !TENANT_ID_PATTERN.test(input.tenantId)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `tool candidate tenantId is invalid: ${JSON.stringify(input.tenantId)}`,
    });
  }
  const availability = input.availability ?? 'available';
  if (!['available', 'unavailable'].includes(availability)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `tool candidate availability is invalid: ${JSON.stringify(availability)}`,
    });
  }
  const operations = input.operations ?? [];
  if (
    !Array.isArray(operations) ||
    !operations.every((entry) => typeof entry === 'string' && SUBSTRATE_PATTERN.test(entry))
  ) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'tool candidate operations must be kebab-shaped identifiers',
    });
  }
  const source = input.sourceToolGapSignalId ?? null;
  if (source !== null && (typeof source !== 'string' || !RECORD_ID_PATTERN.test(source))) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `tool candidate sourceToolGapSignalId is invalid: ${JSON.stringify(source)}`,
    });
  }
  return Object.freeze({
    candidateVersion: RESOURCE_CANDIDATE_VERSION,
    resourceClass: 'tool',
    toolId: input.toolId,
    tenantId: input.tenantId,
    operations: Object.freeze([...operations]),
    availability: availability as ToolCandidateView['availability'],
    sourceToolGapSignalId: source,
  });
}

// ---------------------------------------------------------------------------
// Knowledge (C008 knowledge-tier lattice records)
// ---------------------------------------------------------------------------

/** The routing-side scoped-knowledge view (from C008 lattice records). */
export interface KnowledgeCandidateView {
  readonly candidateVersion: typeof RESOURCE_CANDIDATE_VERSION;
  readonly resourceClass: 'knowledge';
  readonly recordId: string;
  readonly tenantId: string;
  readonly tier: KnowledgeTier;
  readonly scopeKind: KnowledgeScopeKind;
  readonly validationState: 'unvalidated' | 'validated';
  /** Rights/consent statement present (required for reusable tiers). */
  readonly rightsPresent: boolean;
  /** Evidence digest references backing the statement (INPUT to ranking). */
  readonly evidenceRefs: readonly string[];
}

export interface CreateKnowledgeCandidateInput {
  readonly recordId: string;
  readonly tenantId: string;
  readonly tier: string;
  readonly scopeKind: string;
  readonly validationState?: string;
  readonly rightsPresent?: boolean;
  readonly evidenceRefs?: readonly string[];
}

/** Validate and freeze one knowledge candidate view. */
export function createKnowledgeCandidate(
  input: CreateKnowledgeCandidateInput,
): KnowledgeCandidateView {
  if (typeof input !== 'object' || input === null) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'knowledge candidate input must be an object',
    });
  }
  if (typeof input.recordId !== 'string' || !RECORD_ID_PATTERN.test(input.recordId)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `knowledge candidate recordId is invalid: ${JSON.stringify(input.recordId)}`,
    });
  }
  if (typeof input.tenantId !== 'string' || !TENANT_ID_PATTERN.test(input.tenantId)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `knowledge candidate tenantId is invalid: ${JSON.stringify(input.tenantId)}`,
    });
  }
  if (!(KNOWLEDGE_TIERS as readonly string[]).includes(input.tier)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `knowledge candidate tier is invalid: ${JSON.stringify(input.tier)}`,
    });
  }
  if (!(KNOWLEDGE_SCOPE_KINDS as readonly string[]).includes(input.scopeKind)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `knowledge candidate scopeKind is invalid: ${JSON.stringify(input.scopeKind)}`,
    });
  }
  const validationState = input.validationState ?? 'unvalidated';
  if (!['unvalidated', 'validated'].includes(validationState)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `knowledge candidate validationState is invalid: ${JSON.stringify(validationState)}`,
    });
  }
  const evidence = input.evidenceRefs ?? [];
  if (
    !Array.isArray(evidence) ||
    !evidence.every((entry) => typeof entry === 'string' && DIGEST_PATTERN.test(entry))
  ) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'knowledge candidate evidenceRefs must be sha256 hex digests',
    });
  }
  return Object.freeze({
    candidateVersion: RESOURCE_CANDIDATE_VERSION,
    resourceClass: 'knowledge',
    recordId: input.recordId,
    tenantId: input.tenantId,
    tier: input.tier as KnowledgeTier,
    scopeKind: input.scopeKind as KnowledgeScopeKind,
    validationState: validationState as KnowledgeCandidateView['validationState'],
    rightsPresent: input.rightsPresent === true,
    evidenceRefs: Object.freeze([...evidence]),
  });
}

// ---------------------------------------------------------------------------
// Artifact (A032 marketplace offers + entitlement state)
// ---------------------------------------------------------------------------

/** The offer lifecycle states mirrored from A032 (closed vocabulary). */
export const ARTIFACT_OFFER_STATES = Object.freeze([
  'registered',
  'superseded',
  'retired',
  'unknown',
] as const);
export type ArtifactOfferState = (typeof ARTIFACT_OFFER_STATES)[number];

/** The visibility states mirrored from A032 (closed vocabulary). */
export const ARTIFACT_VISIBILITIES = Object.freeze(['public', 'tenant-internal'] as const);
export type ArtifactVisibility = (typeof ARTIFACT_VISIBILITIES)[number];

/** The entitlement (grant) states mirrored from A032 (closed vocabulary). */
export const ARTIFACT_ENTITLEMENT_STATES = Object.freeze([
  'active',
  'revoked',
  'expired',
  'none',
] as const);
export type ArtifactEntitlementState = (typeof ARTIFACT_ENTITLEMENT_STATES)[number];

/** The routing-side marketplace-artifact view (from A032 offers + grants). */
export interface ArtifactCandidateView {
  readonly candidateVersion: typeof RESOURCE_CANDIDATE_VERSION;
  readonly resourceClass: 'artifact';
  readonly offerId: string;
  readonly tenantId: string;
  readonly artifactKind: ArtifactKind;
  readonly state: ArtifactOfferState;
  readonly visibility: ArtifactVisibility;
  readonly entitlementState: ArtifactEntitlementState;
  readonly price: { readonly amountMinorUnits: number; readonly currency: string } | null;
}

export interface CreateArtifactCandidateInput {
  readonly offerId: string;
  readonly tenantId: string;
  readonly artifactKind: string;
  readonly state?: string;
  readonly visibility?: string;
  readonly entitlementState?: string;
  readonly price?: { readonly amountMinorUnits: number; readonly currency: string } | null;
}

/** Validate and freeze one marketplace-artifact candidate view. */
export function createArtifactCandidate(
  input: CreateArtifactCandidateInput,
): ArtifactCandidateView {
  if (typeof input !== 'object' || input === null) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'artifact candidate input must be an object',
    });
  }
  if (typeof input.offerId !== 'string' || !OFFER_ID_PATTERN.test(input.offerId)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `artifact candidate offerId is invalid: ${JSON.stringify(input.offerId)}`,
    });
  }
  if (typeof input.tenantId !== 'string' || !TENANT_ID_PATTERN.test(input.tenantId)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `artifact candidate tenantId is invalid: ${JSON.stringify(input.tenantId)}`,
    });
  }
  if (!(ARTIFACT_KINDS as readonly string[]).includes(input.artifactKind)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `artifact candidate artifactKind is invalid: ${JSON.stringify(input.artifactKind)}`,
    });
  }
  const state = input.state ?? 'registered';
  if (!(ARTIFACT_OFFER_STATES as readonly string[]).includes(state)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `artifact candidate state is invalid: ${JSON.stringify(state)}`,
    });
  }
  const visibility = input.visibility ?? 'public';
  if (!(ARTIFACT_VISIBILITIES as readonly string[]).includes(visibility)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `artifact candidate visibility is invalid: ${JSON.stringify(visibility)}`,
    });
  }
  const entitlementState = input.entitlementState ?? 'none';
  if (!(ARTIFACT_ENTITLEMENT_STATES as readonly string[]).includes(entitlementState)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
      message: `artifact candidate entitlementState is invalid: ${JSON.stringify(entitlementState)}`,
    });
  }
  let price: ArtifactCandidateView['price'] = null;
  if (input.price != null) {
    const candidatePrice = input.price;
    if (
      typeof candidatePrice.amountMinorUnits !== 'number' ||
      !Number.isInteger(candidatePrice.amountMinorUnits) ||
      candidatePrice.amountMinorUnits < 0 ||
      candidatePrice.amountMinorUnits > Number.MAX_SAFE_INTEGER ||
      typeof candidatePrice.currency !== 'string' ||
      !CURRENCY_PATTERN.test(candidatePrice.currency)
    ) {
      throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_CANDIDATE, {
        message: `artifact candidate price is invalid: ${JSON.stringify(input.price)}`,
      });
    }
    price = Object.freeze({
      amountMinorUnits: candidatePrice.amountMinorUnits,
      currency: candidatePrice.currency,
    });
  }
  return Object.freeze({
    candidateVersion: RESOURCE_CANDIDATE_VERSION,
    resourceClass: 'artifact',
    offerId: input.offerId,
    tenantId: input.tenantId,
    artifactKind: input.artifactKind as ArtifactKind,
    state: state as ArtifactOfferState,
    visibility: visibility as ArtifactVisibility,
    entitlementState: entitlementState as ArtifactEntitlementState,
    price,
  });
}

// ---------------------------------------------------------------------------
// Structural guards
// ---------------------------------------------------------------------------

/** Structural (non-throwing) guard for any catalog candidate view. */
export function isResourceCandidate(value: unknown): value is
  | ExpertCandidateView
  | BodyCandidateView
  | ToolCandidateView
  | KnowledgeCandidateView
  | ArtifactCandidateView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['candidateVersion'] === RESOURCE_CANDIDATE_VERSION &&
    isResourceClass(candidate['resourceClass'])
  );
}
