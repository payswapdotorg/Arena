/**
 * The body-marketplace REFERENCE FABRIC (Work Order C014; issue #120) —
 * `BodyMarketplaceService`, the in-process reference composition wiring
 * the C014 domain over the REAL sibling-protocol public ports:
 *
 *   PRETRAINING PIPELINE — a typed PretrainingRequest is compiled from
 *   rights-cleared inputs (C009-validated intervention evidence,
 *   C008 improvement candidates, customer commissions — every input
 *   carrying provenance, scope and rights metadata) into a typed CLOSED
 *   outcome (compilable | blocked-with-reasons: rights-insufficient,
 *   evidence-insufficient). A compilable run PROPOSES a NEW immutable
 *   BodyVersion through the A021 forge port (a certified Body is never
 *   mutated — lock rule 5; AB1.0 Evolution law), enters the A023
 *   pipeline as a certification candidate, and registers the new version
 *   for release through the A024 admission gate. A blocked run is
 *   RECORDED as a typed blocked outcome — nothing trains.
 *
 *   CAPABILITY-BODY LISTINGS — typed listings over A024 body-registry
 *   releases: version, capability evidence refs, record-backed
 *   certification state (derived ONLY from resolvable A023 records
 *   about the exact body version), provenance/lineage (forge record +
 *   pretraining run), license/rights metadata, substrate-compatibility
 *   profile and pricing as EXPLICIT metadata. Publication is an
 *   EXPLICIT VERSIONED transition with typed guard outcomes (lock rule
 *   12); lifecycle DRAFT → PUBLISHED → SUSPENDED/RETIRED with reasons;
 *   history is APPEND-ONLY.
 *
 *   COMMERCIAL SEAMS — offer/grant records follow the A031/A032
 *   marketplace house patterns through injected ports. Settlement
 *   vocabulary stays with the payments/economics surfaces (recorded as
 *   an architecture question — no money truth is invented here).
 *
 * Default ports (all injectable): the A021 seam calls the REAL
 * @arena/body-forge compose core (forge()); the A023 seam builds REAL
 * CertificationRecords through the @arena/certification constructors;
 * the A024 seam runs the REAL admission gate + publication ledger from
 * @arena/body-registry; the default composition additionally mints an
 * A022 compatibility verdict through the REAL @arena/compatibility
 * package constructor so the A024 gate can admit the new release
 * (disclosed: hosts wire the real compatibility surface; the reference
 * fabric only needs SOME valid A022 evidence for the gate). Zero
 * external runtime dependencies; no network, no database.
 *
 * Every command is IDEMPOTENT (lock rule 17): the same key + same
 * tuple replays the stored result byte-identically; the same key + a
 * different tuple is an IDEMPOTENCY_CONFLICT. Time is injected (Clock).
 */

import {
  createBodyManifest,
  createForgePolicy,
  defaultForgePolicyInput,
  forge,
  isBodyManifest,
  isForgePolicy,
  verifyBodyManifest,
  verifyForgePolicy,
  verifyForgeRecord,
} from '@arena/body-forge';
import type {
  BodyManifest,
  CreateBodyManifestInput,
  ForgeRecord,
  ForgeResult,
} from '@arena/body-forge';
import type { BodyVersion } from '@arena/agent-body';
import {
  createCertificationRecord,
  createCertificationSuite,
  isCertificationRecord,
} from '@arena/certification';
import type { CertificationRecord } from '@arena/certification';
import {
  appendReleasePublication,
  createReleaseRegistrationRecord,
  evaluateReleaseGate,
  publishRelease,
  resolveReleasePublication,
  verifyReleaseRecord,
} from '@arena/body-registry';
import type {
  ReleaseCandidateInput,
  ReleaseEvidenceStores,
  ReleasePublicationLedger,
  ReleasePublicationRecord,
  ReleaseRecord,
} from '@arena/body-registry';
import { createCompatibilityRegistry } from '@arena/compatibility';
import { newIdempotencyKey } from '@arena/protocol-core';

import {
  BODY_MARKETPLACE_ERROR_CODES,
  BodyMarketplaceError,
  normalizeToBodyMarketplaceError,
} from './errors.js';
import {
  compilePretrainingRequest,
  toPretrainingRequest,
} from './pretraining.js';
import type {
  PretrainingRequestInput,
  ValidatedInterventionEvidenceView,
  ImprovementCandidateView,
} from './pretraining.js';
import type {
  BodyRegistryPort,
  CertificationCandidatePort,
  CertificationCandidateRequest,
  CertificationRecordStore,
  Clock,
  ForgePort,
  ForgeSubmission,
  ImprovementCandidatePort,
  ReleasePublicationOptions,
  ReleaseRegistrationOptions,
  ReleaseStatusView,
  ValidatedEvidencePort,
} from './ports.js';
import {
  deepFreeze,
  isBodyMarketplaceId,
  isBodyMarketplaceIdempotencyKey,
  isBodyMarketplaceText,
  isBodyMarketplaceTimestamp,
  isPlainObject,
  isTenant,
  viewDigest,
} from './shared.js';

// ---------------------------------------------------------------------------
// Listing vocabularies (closed)
// ---------------------------------------------------------------------------

/** The closed listing lifecycle vocabulary. */
export const LISTING_STATES = Object.freeze(['draft', 'published', 'suspended', 'retired'] as const);
export type ListingState = (typeof LISTING_STATES)[number];

/** The closed listing-transition vocabulary (guarded edges only). */
export const LISTING_TRANSITIONS: Readonly<Record<ListingState, readonly ListingState[]>> =
  Object.freeze({
    draft: Object.freeze(['published', 'retired'] as const),
    published: Object.freeze(['suspended', 'retired'] as const),
    suspended: Object.freeze(['published', 'retired'] as const),
    retired: Object.freeze([] as const),
  });

/** The closed listing-transition guard reason vocabulary. */
export const LISTING_GUARD_REASONS = Object.freeze([
  'invalid-state',
  'invalid-transition',
  'reason-required',
  'certification-not-record-backed',
  'release-not-published',
  'release-unresolved',
  'listing-not-published',
] as const);
export type ListingGuardReason = (typeof LISTING_GUARD_REASONS)[number];

/** The closed certification-posture vocabulary (record-backed ONLY). */
export const CERTIFICATION_POSTURE_STATES = Object.freeze(['record-backed', 'unverified'] as const);
export type CertificationPostureState = (typeof CERTIFICATION_POSTURE_STATES)[number];

/** The closed permitted-use vocabulary for listing grants. */
export const LISTING_PERMITTED_USES = Object.freeze([
  'possess',
  'evaluate',
  'internal-deploy',
] as const);
export type ListingPermittedUse = (typeof LISTING_PERMITTED_USES)[number];

// ---------------------------------------------------------------------------
// Records (deep-frozen, content-addressed)
// ---------------------------------------------------------------------------

/** One append-only listing transition entry. */
export interface ListingTransitionEntry {
  readonly transitionId: string;
  readonly from: ListingState;
  readonly to: ListingState;
  readonly reason: string;
  readonly actor: { readonly type: string; readonly tenant: string; readonly principalId: string };
  readonly at: string;
  readonly listingVersion: number;
}

/** The capability-body listing record (append-only history; immutable snapshots). */
export interface CapabilityBodyListing {
  readonly listingVersion: 1;
  readonly listingId: string;
  readonly tenantId: string;
  readonly releaseDigest: string;
  readonly bodyVersionRef: { readonly tenant: string; readonly name: string; readonly version: string; readonly digest: string };
  readonly releaseVersion: string | null;
  readonly channel: string | null;
  readonly title: string;
  readonly summary: string;
  readonly capabilityEvidenceRefs: readonly string[];
  readonly certificationRefs: readonly string[];
  readonly forgeRecordDigest: string | null;
  readonly pretrainingRunId: string | null;
  readonly rights: Readonly<Record<string, unknown>> | null;
  readonly substrateCompatibility: Readonly<Record<string, unknown>> | null;
  readonly pricing: { readonly amountMinorUnits: number; readonly currency: string; readonly model: string } | null;
  readonly state: ListingState;
  /** The listing revision — every transition bumps it (explicit versioning, lock rule 12). */
  readonly version: number;
  readonly history: readonly ListingTransitionEntry[];
  readonly createdAt: string;
  readonly digest: string;
}

/** The pretraining run record (typed closed outcome; append-only by runId). */
export interface PretrainingRunRecord {
  readonly runVersion: 1;
  readonly runId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly requestedAt: string;
  readonly requestedBy: { readonly type: string; readonly tenant: string; readonly principalId: string };
  readonly capabilityNeedSummary: string;
  readonly outcome: 'proposed' | 'blocked';
  readonly blockedReasons: readonly { readonly code: string; readonly detail: string }[];
  readonly forgeRecordDigest: string | null;
  readonly bodyVersionRef: { readonly tenant: string; readonly name: string; readonly version: string; readonly digest: string } | null;
  readonly certificationRefs: readonly string[];
  readonly releaseDigest: string | null;
  readonly validatedEvidenceRefs: readonly string[];
  readonly candidateRefs: readonly string[];
  readonly commission: { readonly commissionId: string; readonly customer: string; readonly scope: string } | null;
  readonly recordedAt: string;
  readonly digest: string;
}

/** One listing access grant (the A031/A032 house offer/grant pattern). */
export interface ListingGrantRecord {
  readonly grantVersion: 1;
  readonly grantId: string;
  readonly listingId: string;
  readonly tenantId: string;
  readonly grantee: { readonly type: string; readonly tenant: string; readonly principalId: string };
  readonly permittedUse: ListingPermittedUse;
  readonly grantedAt: string;
  readonly expiresAt: string | null;
  readonly state: 'active' | 'revoked';
  readonly revocation: { readonly grounds: string; readonly revokedAt: string; readonly revokedBy: string } | null;
  readonly digest: string;
}

/** The certification posture of one listing (record-backed or honest unverified). */
export type CertificationPosture =
  | {
      readonly state: 'record-backed';
      readonly records: readonly {
        readonly digest: string;
        readonly verdict: string;
        readonly grantedLevel: string;
      }[];
      readonly strongestGrant: string | null;
    }
  | { readonly state: 'unverified'; readonly unresolved: readonly string[] };

/** The record-backed certification badge (surfaced ONLY when record-backed). */
export interface RecordBackedCertificationBadge {
  readonly listingId: string;
  readonly bodyVersionRef: { readonly tenant: string; readonly name: string; readonly version: string; readonly digest: string };
  readonly grantedLevel: string;
  readonly recordDigests: readonly string[];
  /** The scope law: certification applies to the tested composition, never the base model. */
  readonly scopeNotice: string;
}

/** One typed listing-publication guard rejection. */
export interface ListingGuardRejection {
  readonly reason: ListingGuardReason;
  readonly detail: string;
}

/** The typed guard verdict for one listing transition. */
export interface ListingTransitionCheck {
  readonly allowed: boolean;
  readonly rejections: readonly ListingGuardRejection[];
}

// ---------------------------------------------------------------------------
// Commands (wire form)
// ---------------------------------------------------------------------------

/** The §12 professional authoring material a pretraining run composes. */
export interface PretrainingCompositionInput {
  readonly mission: string;
  readonly role: string;
  readonly domainScope: readonly string[];
  readonly capabilities: readonly { readonly kind: string; readonly id: string; readonly version: string; readonly digest: string }[];
  readonly skills?: readonly { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string }[];
  readonly knowledge?: readonly { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string }[];
  readonly tools?: readonly { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string }[];
  readonly procedures?: readonly { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string }[];
  readonly evaluationSuites: readonly { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string }[];
  readonly verificationSuites: readonly { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string }[];
  readonly environmentRequirements: readonly { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string }[];
  readonly substrateCompatibility: unknown;
  readonly rights?: unknown;
}

/** Command: request one on-demand pretraining run. */
export interface RequestPretrainingCommand {
  readonly request: PretrainingRequestInput;
  readonly composition: PretrainingCompositionInput;
  /** The certified BodyVersion this run evolves (lineage parent; null = first version). */
  readonly baseBodyVersionRef: { readonly tenant: string; readonly name: string; readonly version: string; readonly digest: string } | null;
  readonly releaseChannel: string;
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

/** Command: create one capability-body listing over an A024 release. */
export interface CreateListingCommand {
  readonly listingId: string;
  readonly tenantId: string;
  readonly releaseDigest: string;
  readonly title: string;
  readonly summary: string;
  readonly capabilityEvidenceRefs: readonly string[];
  readonly pretrainingRunId: string | null;
  readonly rights: Readonly<Record<string, unknown>> | null;
  readonly substrateCompatibility: Readonly<Record<string, unknown>> | null;
  readonly pricing: { readonly amountMinorUnits: number; readonly currency: string; readonly model: string } | null;
  readonly createdBy: { readonly type: string; readonly tenant: string; readonly principalId: string };
  readonly createdAt: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

/** Command: transition one listing (publish / suspend / retire). */
export interface ListingTransitionCommand {
  readonly listingId: string;
  readonly tenantId: string;
  readonly to: ListingState;
  readonly reason: string;
  readonly actor: { readonly type: string; readonly tenant: string; readonly principalId: string };
  readonly at: string;
  /** Publication inputs — required when publishing an unpublished release (lock rule 12). */
  readonly releasePublication?: ReleasePublicationOptions;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

/** Command: grant one listing access (the offer/grant seam). */
export interface GrantListingAccessCommand {
  readonly grantId: string;
  readonly listingId: string;
  readonly tenantId: string;
  readonly grantee: { readonly type: string; readonly tenant: string; readonly principalId: string };
  readonly permittedUse: ListingPermittedUse;
  readonly expiresAt: string | null;
  readonly grantedBy: { readonly type: string; readonly tenant: string; readonly principalId: string };
  readonly grantedAt: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

// ---------------------------------------------------------------------------
// Default in-memory ports (the reference composition)
// ---------------------------------------------------------------------------

/** The A021 seam default: the REAL forge compose core + a tiny idempotent registry. */
class InMemoryForgePort implements ForgePort {
  private readonly resultsByKey = new Map<string, ForgeResult>();
  private readonly recordsByDigest = new Map<string, ForgeRecord>();
  private readonly commandByKey = new Map<string, string>();
  private readonly versionDigests = new Map<string, string>();

  async submit(submission: ForgeSubmission): Promise<ForgeResult> {
    if (!isBodyManifest(submission.manifest)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.FORGE_REJECTED, {
        message: 'the A021 forge rejected the manifest (structurally invalid)',
      });
    }
    await verifyBodyManifest(submission.manifest);
    if (!isForgePolicy(submission.policy)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.FORGE_REJECTED, {
        message: 'the A021 forge rejected the policy (structurally invalid)',
      });
    }
    await verifyForgePolicy(submission.policy);
    const command = JSON.stringify([
      submission.manifest.digest,
      submission.policy.digest,
      submission.recipe,
    ]);
    const bound = this.commandByKey.get(submission.forgeKey);
    if (bound !== undefined) {
      if (bound !== command) {
        throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `forge key ${JSON.stringify(submission.forgeKey)} is already bound to a different command`,
        });
      }
      const stored = this.resultsByKey.get(submission.forgeKey);
      if (stored !== undefined) return stored;
    }
    const result = await forge(submission.manifest, submission.policy, submission.recipe, {
      forgeKey: submission.forgeKey,
      ...(submission.notes === undefined ? {} : { notes: submission.notes }),
    });
    await verifyForgeRecord(result.record);
    // The immutability mirror (lock rule 5): a version number addresses
    // immutable content — re-forging the same identity+version with a
    // different digest fails CLOSED (an attempt to mutate an existing
    // certified BodyVersion can never succeed through this seam).
    const versionKey = `${submission.manifest.body.tenant}/${submission.manifest.body.name}@${submission.manifest.targetVersion}`;
    const recorded = this.versionDigests.get(versionKey);
    if (recorded !== undefined && recorded !== result.bodyVersion.digest) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.FORGE_REJECTED, {
        message: `the A021 forge refused to re-forge ${versionKey} with a different digest — BodyVersions are immutable and content-addressed (recorded: ${recorded}; attempted: ${result.bodyVersion.digest})`,
        details: { version: versionKey, recorded, attempted: result.bodyVersion.digest },
      });
    }
    this.commandByKey.set(submission.forgeKey, command);
    this.resultsByKey.set(submission.forgeKey, result);
    this.recordsByDigest.set(result.record.digest as string, result.record);
    this.versionDigests.set(versionKey, result.bodyVersion.digest as string);
    return result;
  }

  async getRecord(digest: string): Promise<ForgeRecord | undefined> {
    return this.recordsByDigest.get(digest);
  }
}

/** The A023 seam default: REAL CertificationRecords through the REAL constructors. */
class InMemoryCertificationCandidatePort implements CertificationCandidatePort {
  private readonly records = new Map<string, CertificationRecord>();
  private readonly runsByKey = new Map<string, CertificationRecord>();

  constructor(private readonly config: { readonly levelGrant: string } = { levelGrant: 'CANDIDATE' }) {}

  async runCertificationCandidate(request: CertificationCandidateRequest): Promise<{ record: CertificationRecord }> {
    const stored = this.runsByKey.get(request.idempotencyKey);
    if (stored !== undefined) return { record: stored };
    const suite = await createCertificationSuite({
      suiteId: 'body-marketplace-pretraining-certification',
      version: '1.0.0',
      levelGrant: this.config.levelGrant,
      stages: [
        {
          stageId: 'verify-1',
          kind: 'verification',
          evaluatorRef: null,
          criteriaRef: null,
          verifierRef: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          requiredTestSuites: [],
          datasetRef: null,
          environmentRequirement: null,
          runtimeRequirement: null,
        },
      ],
      constraints: [],
      limitations: null,
      supersedes: null,
      inputSchema: { namespace: 'certification', name: 'certification-record', version: '1.0.0' },
      outputSchema: { namespace: 'certification', name: 'certification-record', version: '1.0.0' },
      provenance: { authoredBy: 'arena-body-marketplace', submittedAt: request.executedAt, notes: null },
    } as Parameters<typeof createCertificationSuite>[0]);
    const bodyVersion = request.bodyVersion;
    const record = await createCertificationRecord(
      {
        subject: {
          bodyVersionRef: {
            tenant: bodyVersion.body.tenant,
            name: bodyVersion.body.name,
            version: bodyVersion.version,
            digest: bodyVersion.digest,
          },
          substrateRef: {
            substrateId: 'substrate-reference',
            substrateVersion: '1.0.0',
            digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          environmentRef: {
            environmentId: 'body-marketplace-env',
            environmentVersion: '1.0.0',
            constraints: ['offline'],
          },
          runtimeProfile: {
            runtimeId: 'arena-runtime',
            runtimeVersion: '2.1.0',
            configuration: { timeoutMs: 30000 },
          },
          possessionRef: null,
          tenantId: `tenant-${request.tenantId}`,
          workspaceId: 'ws-main',
        },
        suiteRef: suite.digest,
        stages: [
          {
            stageId: 'verify-1',
            outcome: 'satisfied',
            reason: 'stage-satisfied',
            evidenceDigest: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
            unknownCause: null,
          },
        ],
        supersedes: null,
        correlationId: request.correlationId,
        idempotencyKey: request.idempotencyKey,
        tenantId: null,
        workspaceId: null,
        startedAt: request.executedAt,
        finishedAt: request.executedAt,
        provenance: { executedBy: 'arena-body-marketplace', recordedAt: request.executedAt, notes: null },
      },
      suite,
    );
    this.runsByKey.set(request.idempotencyKey, record);
    this.records.set(record.digest as string, record);
    return { record };
  }

  /** The digest-addressed store view over the records this port produced. */
  asStore(): CertificationRecordStore {
    return {
      resolve: async (digest: string) => this.records.get(digest),
    };
  }
}

/** The A024 seam default: the REAL admission gate + publication ledger. */
class InMemoryBodyRegistryPort implements BodyRegistryPort {
  private readonly recordsByDigest = new Map<string, ReleaseRecord>();
  private readonly ledger: ReleaseRecord[] = [];
  private readonly byKey = new Map<string, { command: string; digest: string }>();
  private readonly registrationsByKey = new Map<string, ReleaseRecord>();
  private publicationLedger: ReleasePublicationLedger = { records: [] };

  constructor(
    private readonly stores: ReleaseEvidenceStores & {
      readonly forgeRecords?: (digest: string) => ForgeRecord | null;
    },
  ) {}

  async register(candidate: ReleaseCandidateInput, options: ReleaseRegistrationOptions): Promise<ReleaseRecord> {
    const command = JSON.stringify([candidate, options.releaseVersion, options.channel]);
    const bound = this.byKey.get(options.idempotencyKey);
    if (bound !== undefined) {
      if (bound.command !== command) {
        throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${JSON.stringify(options.idempotencyKey)} is already bound to a different registration`,
        });
      }
      const stored = this.registrationsByKey.get(options.idempotencyKey);
      if (stored !== undefined) return stored;
    }
    const verdict = await evaluateReleaseGate(candidate, this.stores);
    if (!verdict.admitted || verdict.evidence === null) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.REGISTRATION_REJECTED, {
        message: `the A024 release admission gate REJECTED the registration (${verdict.rejections.length} structured rejection${verdict.rejections.length === 1 ? '' : 's'})`,
        details: { rejections: verdict.rejections.map((rejection) => ({ ...rejection })) },
      });
    }
    const record = await createReleaseRegistrationRecord({
      bodyVersionRef: {
        tenant: verdict.evidence.bodyVersionRef.tenant,
        name: verdict.evidence.bodyVersionRef.name,
        version: verdict.evidence.bodyVersionRef.version,
        digest: verdict.evidence.bodyVersionRef.digest,
      },
      releaseVersion: options.releaseVersion,
      gate: verdict.evidence,
      ...(options.tags !== undefined ? { tags: options.tags } : {}),
      releasedAt: options.recordedAt,
      correlationId: options.correlationId,
      idempotencyKey: options.idempotencyKey,
      tenantId: options.tenantId,
      workspaceId: null,
      provenance: {
        releasedBy: options.releasedBy,
        recordedAt: options.recordedAt,
        notes: options.notes,
      },
    });
    await verifyReleaseRecord(record);
    this.byKey.set(options.idempotencyKey, { command, digest: record.digest as string });
    this.registrationsByKey.set(options.idempotencyKey, record);
    const existing = this.recordsByDigest.get(record.digest as string);
    if (existing === undefined) {
      this.recordsByDigest.set(record.digest as string, record);
      this.ledger.push(record);
    }
    return record;
  }

  async publish(
    release: { readonly namespace: string; readonly name: string; readonly version: string },
    options: ReleasePublicationOptions,
  ): Promise<ReleasePublicationRecord> {
    const registration = [...this.ledger]
      .reverse()
      .find(
        (record) =>
          record.kind === 'release-registration' &&
          record.release !== null &&
          record.release.namespace === release.namespace &&
          record.release.name === release.name &&
          record.release.version === release.version,
      );
    if (registration === undefined) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.REGISTRATION_REJECTED, {
        message: `no registered release found for ${release.namespace}/${release.name}@${release.version}`,
      });
    }
    const record = await publishRelease({
      registration,
      publisher: options.publisher,
      rights: options.rights,
      publishedAt: options.publishedAt,
    });
    this.publicationLedger = await appendReleasePublication(this.publicationLedger, record);
    return record;
  }

  async resolveStatus(
    release: { readonly namespace: string; readonly name: string; readonly version: string },
  ): Promise<ReleaseStatusView> {
    const registration =
      [...this.ledger]
        .reverse()
        .find(
          (record) =>
            record.kind === 'release-registration' &&
            record.release !== null &&
            record.release.namespace === release.namespace &&
            record.release.name === release.name &&
            record.release.version === release.version,
        ) ?? null;
    if (registration === null) {
      return { state: 'unknown', visibility: 'unpublished', registration: null, publication: null };
    }
    const superseded = this.ledger.some(
      (record) =>
        record.kind === 'release-supersession' &&
        record.supersedes === (registration.digest as string),
    );
    const retired = this.ledger.some(
      (record) =>
        record.kind === 'release-retirement' && record.supersedes === (registration.digest as string),
    );
    const state: ReleaseStatusView['state'] = retired
      ? 'retired'
      : superseded
        ? 'superseded'
        : 'registered';
    const publicationStatus = resolveReleasePublication(this.publicationLedger, release);
    return {
      state,
      visibility: publicationStatus.visibility,
      registration,
      publication:
        publicationStatus.visibility === 'published' ? publicationStatus.publication : null,
    };
  }

  async getRecord(digest: string): Promise<ReleaseRecord | undefined> {
    return this.recordsByDigest.get(digest);
  }
}

// ---------------------------------------------------------------------------
// The fabric
// ---------------------------------------------------------------------------

/** Service configuration (all injected; defaults are the reference composition). */
export interface BodyMarketplaceServiceConfig {
  readonly forge?: ForgePort;
  readonly certification?: CertificationCandidatePort;
  readonly certificationStore?: CertificationRecordStore;
  readonly registry?: BodyRegistryPort;
  readonly evidence?: ValidatedEvidencePort;
  readonly candidates?: ImprovementCandidatePort;
  readonly clock?: Clock;
  /** The certification grant the default A023 port awards (default CANDIDATE). */
  readonly defaultCertificationGrant?: string;
}

interface IdempotencyBinding {
  readonly command: string;
  readonly resultDigest: string;
}

/** The body-marketplace reference service. */
export class BodyMarketplaceService {
  private readonly listings = new Map<string, CapabilityBodyListing>();
  private readonly listingHistory = new Map<string, readonly ListingTransitionEntry[]>();
  private readonly runs = new Map<string, PretrainingRunRecord>();
  private readonly grants = new Map<string, ListingGrantRecord>();
  private readonly runKeys = new Map<string, IdempotencyBinding>();
  private readonly listingKeys = new Map<string, IdempotencyBinding>();
  private readonly grantKeys = new Map<string, IdempotencyBinding>();
  private readonly transitionKeys = new Map<string, IdempotencyBinding>();
  private readonly transitionResults = new Map<string, CapabilityBodyListing>();
  /** Cross-seam evidence the default composition feeds the A024 gate with. */
  private readonly forgeRecords = new Map<string, ForgeRecord>();
  private readonly bodyVersions = new Map<string, BodyVersion>();
  private readonly certificationRecords = new Map<string, CertificationRecord>();
  private readonly compatibilityRegistry = createCompatibilityRegistry();

  readonly forge: ForgePort;
  readonly certification: CertificationCandidatePort;
  private readonly certificationStore: CertificationRecordStore;
  private readonly registry: BodyRegistryPort;
  private readonly evidence: ValidatedEvidencePort;
  private readonly candidates: ImprovementCandidatePort;
  private readonly clock: Clock;

  constructor(config: BodyMarketplaceServiceConfig = {}) {
    const defaultCertification = new InMemoryCertificationCandidatePort({
      levelGrant: config.defaultCertificationGrant ?? 'CANDIDATE',
    });
    this.forge = config.forge ?? new InMemoryForgePort();
    this.certification = config.certification ?? defaultCertification;
    this.certificationStore =
      config.certificationStore ??
      (this.certification instanceof InMemoryCertificationCandidatePort
        ? this.certification.asStore()
        : { resolve: async () => undefined });
    this.registry = config.registry ?? this.createDefaultRegistry();
    this.evidence = config.evidence ?? { resolve: async () => undefined };
    this.candidates = config.candidates ?? { resolve: async () => undefined };
    this.clock = config.clock ?? { now: () => 0 };
  }

  /** The default A024 wiring: the gate resolves against the fabric's own stores. */
  private createDefaultRegistry(): BodyRegistryPort {
    return new InMemoryBodyRegistryPort({
      bodyVersions: (digest) => this.bodyVersions.get(digest) ?? null,
      certificationRecords: (digest) => this.certificationRecords.get(digest) ?? null,
      compatibilityRecords: (digest) => {
        const record = this.compatibilityRegistry.getRecord(digest);
        return record ?? null;
      },
      forgeRecords: (digest) => this.forgeRecords.get(digest) ?? null,
    });
  }

  private nowIso(): string {
    return new Date(this.clock.now()).toISOString();
  }

  private timestampOrNow(value: string | undefined): string {
    return value === undefined ? this.nowIso() : value;
  }

  // -------------------------------------------------------------------------
  // THE PRETRAINING PIPELINE
  // -------------------------------------------------------------------------

  /**
   * Request one on-demand pretraining run: compile (typed closed
   * outcome) → forge proposal (NEW immutable BodyVersion) → A023
   * certification candidacy → A024 release registration. A blocked
   * compilation is RECORDED as a typed blocked run — nothing trains.
   */
  async requestPretraining(command: RequestPretrainingCommand): Promise<PretrainingRunRecord> {
    const request = toPretrainingRequest(command.request);
    if (!isBodyMarketplaceId(command.runId)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
        message: 'requestPretraining requires a marketplace-id runId',
      });
    }
    if (!isBodyMarketplaceIdempotencyKey(command.idempotencyKey)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
        message: 'requestPretraining requires a valid idempotency key (lock rule 17)',
      });
    }
    const commandCanonical = JSON.stringify([
      command.request,
      command.composition,
      command.baseBodyVersionRef,
      command.releaseChannel,
    ]);
    const bound = this.runKeys.get(command.idempotencyKey);
    if (bound !== undefined) {
      if (bound.command !== commandCanonical) {
        throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${JSON.stringify(command.idempotencyKey)} is already bound to a different pretraining command`,
        });
      }
      const stored = this.runs.get(command.runId);
      if (stored !== undefined) return stored;
    }

    // --- resolve the C009/C008 seams (fail-closed: unresolved = blocked) --
    const resolvedEvidence = new Map<string, ValidatedInterventionEvidenceView>();
    const resolvedCandidates = new Map<string, ImprovementCandidateView>();
    for (const input of request.inputs) {
      if (input.kind === 'validated-intervention-evidence') {
        const evidence = await this.evidence.resolve(input.refId, request.tenantId);
        if (evidence !== undefined) resolvedEvidence.set(input.refId, evidence);
      } else if (input.kind !== 'customer-commission') {
        const candidate = await this.candidates.resolve(input.refId, request.tenantId);
        if (candidate !== undefined) resolvedCandidates.set(input.refId, candidate);
      }
    }

    const compilation = compilePretrainingRequest(request, {
      resolvedEvidence,
      resolvedCandidates,
    });

    if (compilation.outcome === 'blocked') {
      const record: PretrainingRunRecord = deepFreeze({
        runVersion: 1,
        runId: command.runId,
        requestId: request.requestId,
        tenantId: request.tenantId,
        requestedAt: request.requestedAt,
        requestedBy: request.requestedBy,
        capabilityNeedSummary: request.capabilityNeed.summary,
        outcome: 'blocked',
        blockedReasons: Object.freeze(
          compilation.reasons.map((reason) => ({ code: reason.code, detail: reason.detail })),
        ),
        forgeRecordDigest: null,
        bodyVersionRef: null,
        certificationRefs: [],
        releaseDigest: null,
        validatedEvidenceRefs: [],
        candidateRefs: [],
        commission: request.commission,
        recordedAt: this.timestampOrNow(request.requestedAt),
        digest: '',
      });
      const frozen = deepFreeze({ ...record, digest: await recordDigest(record) });
      this.runs.set(command.runId, frozen);
      this.runKeys.set(command.idempotencyKey, {
        command: commandCanonical,
        resultDigest: command.runId,
      });
      return frozen;
    }

    // --- the forge handoff: PROPOSE a NEW immutable BodyVersion -----------
    const manifest = await this.buildManifest(request, command);
    const policy = await createForgePolicy({
      ...defaultForgePolicyInput(),
      policyId: 'policy-body-marketplace-pretraining',
    });
    const recipe = {
      forgePrincipal: {
        type: 'service',
        tenant: request.tenantId,
        principalId: 'arena-body-marketplace',
      },
      forgedAt: this.timestampOrNow(request.requestedAt),
      correlationId: command.correlationId,
    };
    const provenanceNotes = JSON.stringify({
      pretrainingRunId: command.runId,
      requestId: request.requestId,
      validatedEvidenceRefs: compilation.validatedEvidenceRefs,
      candidateRefs: compilation.candidateRefs,
      commission: request.commission === null ? null : request.commission.commissionId,
    });
    let forged: ForgeResult;
    try {
      forged = await this.forge.submit({
        manifest,
        policy,
        recipe,
        forgeKey: command.idempotencyKey,
        notes: provenanceNotes,
      });
    } catch (error) {
      // The forge failed closed (invalid composition, version conflict —
      // an attempt to mutate an existing version, policy violation…):
      // normalize WITHOUT recording a training outcome.
      throw this.normalizeForgeFailure(error, command);
    }
    const bodyVersion = forged.bodyVersion;
    this.forgeRecords.set(forged.record.digest as string, forged.record);
    this.bodyVersions.set(bodyVersion.digest as string, bodyVersion);

    // --- A023 certification candidacy for the NEW version -----------------
    let certificationRecord: CertificationRecord;
    try {
      const result = await this.certification.runCertificationCandidate({
        bodyVersion,
        suiteRef: null,
        tenantId: request.tenantId,
        correlationId: command.correlationId,
        idempotencyKey: `${command.idempotencyKey}-cert`,
        executedAt: this.timestampOrNow(request.requestedAt),
      });
      certificationRecord = result.record;
    } catch (error) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.CERTIFICATION_UNAVAILABLE, {
        message: `the A023 certification pipeline failed closed for the proposed version: ${
          error instanceof Error ? error.message : String(error)
        }`,
        cause: error,
      });
    }
    this.certificationRecords.set(certificationRecord.digest as string, certificationRecord);

    // --- A024 release registration through the admission gate -------------
    const compatibility = await this.compatibilityRegistry.createAndRegister(
      `${bodyVersion.body.tenant}/${bodyVersion.body.name}@${bodyVersion.version}#${bodyVersion.digest}`,
      'substrate-reference@1.0.0#bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      { verdict: 'compatible', reasons: [], details: {} },
      this.timestampOrNow(request.requestedAt),
      undefined,
    );
    const candidate: ReleaseCandidateInput = {
      bodyVersionRef: {
        tenant: bodyVersion.body.tenant,
        name: bodyVersion.body.name,
        version: bodyVersion.version,
        digest: bodyVersion.digest,
      },
      channel: command.releaseChannel,
      certificationRefs: [certificationRecord.digest as string],
      compatibilityRefs: [compatibility.recordDigest],
      forgeRecordDigest: forged.record.digest as string,
    };
    let release: ReleaseRecord;
    try {
      release = await this.registry.register(candidate, {
        releaseVersion: `${bodyVersion.version}`,
        channel: command.releaseChannel,
        tags: ['pretrained', 'capability-body'],
        tenantId: request.tenantId,
        recordedAt: this.timestampOrNow(request.requestedAt),
        correlationId: command.correlationId,
        idempotencyKey: `${command.idempotencyKey}-rel`,
        releasedBy: 'arena-body-marketplace',
        notes: `pretraining run ${command.runId}`,
      });
    } catch (error) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.REGISTRATION_REJECTED, {
        message: `the A024 release admission gate failed closed for the proposed version: ${
          error instanceof Error ? error.message : String(error)
        }`,
        cause: error,
      });
    }

    const record: PretrainingRunRecord = deepFreeze({
      runVersion: 1,
      runId: command.runId,
      requestId: request.requestId,
      tenantId: request.tenantId,
      requestedAt: request.requestedAt,
      requestedBy: request.requestedBy,
      capabilityNeedSummary: request.capabilityNeed.summary,
      outcome: 'proposed',
      blockedReasons: [],
      forgeRecordDigest: forged.record.digest as string,
      bodyVersionRef: {
        tenant: bodyVersion.body.tenant,
        name: bodyVersion.body.name,
        version: bodyVersion.version,
        digest: bodyVersion.digest,
      },
      certificationRefs: [certificationRecord.digest as string],
      releaseDigest: release.digest as string,
      validatedEvidenceRefs: compilation.validatedEvidenceRefs,
      candidateRefs: compilation.candidateRefs,
      commission: request.commission,
      recordedAt: this.timestampOrNow(request.requestedAt),
      digest: '',
    });
    const digest = await recordDigest(record);
    const frozen = deepFreeze({ ...record, digest });
    this.runs.set(command.runId, frozen);
    this.runKeys.set(command.idempotencyKey, { command: commandCanonical, resultDigest: command.runId });
    return frozen;
  }

  private normalizeForgeFailure(error: unknown, command: RequestPretrainingCommand): BodyMarketplaceError {
    if (error instanceof BodyMarketplaceError) return error;
    return new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.FORGE_REJECTED, {
      message: `the A021 forge failed closed for pretraining run ${command.runId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      cause: error,
    });
  }

  /** Compose the A021 manifest from the request + authoring material. */
  private async buildManifest(
    request: PretrainingRequestInput,
    command: RequestPretrainingCommand,
  ): Promise<BodyManifest> {
    const composition = command.composition;
    if (!isPlainObject(composition)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
        message: 'requestPretraining requires a composition object',
      });
    }
    const parents =
      command.baseBodyVersionRef === null
        ? []
        : [
            {
              tenant: command.baseBodyVersionRef.tenant,
              name: command.baseBodyVersionRef.name,
              version: command.baseBodyVersionRef.version,
              digest: command.baseBodyVersionRef.digest,
            },
          ];
    return createBodyManifest({
      manifestId: `manifest-pretrain-${request.requestId}`,
      version: '1.0.0',
      body: { tenant: request.targetBody.tenant, name: request.targetBody.name },
      targetVersion: request.targetVersion,
      mission: composition.mission,
      role: composition.role,
      domainScope: [...composition.domainScope],
      capabilities: composition.capabilities.map((capability) => ({ ...capability })),
      skills: [...(composition.skills ?? [])].map((skill) => ({ ...skill })),
      knowledge: [...(composition.knowledge ?? [])].map((entry) => ({ ...entry })),
      tools: [...(composition.tools ?? [])].map((entry) => ({ ...entry })),
      procedures: [...(composition.procedures ?? [])].map((entry) => ({ ...entry })),
      memoryPolicy: { policyId: 'memory-append-only', statements: ['append-only recall, no rewrites'] },
      planningPolicy: { policyId: 'planning-checklist-first', statements: ['plan before acting'] },
      safetyPolicy: {
        policyId: 'safety-human-signoff',
        statements: ['fail closed on ambiguity'],
      },
      escalation: {
        rules: [
          {
            condition: 'capability-boundary-reached',
            target: { type: 'expert', tenant: request.tenantId, principalId: 'escalation-desk' },
          },
        ],
      },
      authorityBoundaries: ['no autonomous financial posting'],
      evaluationSuites: [...composition.evaluationSuites].map((entry) => ({ ...entry })),
      verificationSuites: [...composition.verificationSuites].map((entry) => ({ ...entry })),
      environmentRequirements: [...composition.environmentRequirements].map((entry) => ({
        ...entry,
      })),
      substrateCompatibility: composition.substrateCompatibility as CreateBodyManifestInput['substrateCompatibility'],
      rights:
        composition.rights ??
        {
          license: 'Proprietary',
          commercialUse: 'requires-license',
          redistribution: 'tenant-only',
          customerData: 'derived',
          professionalLimitations: ['not a licensed professional system'],
        },
      provenance: {
        author: {
          type: request.requestedBy.type,
          tenant: request.requestedBy.tenant,
          principalId: request.requestedBy.principalId,
        },
        authoredAt: request.requestedAt,
        // A021's manifest citation vocabulary is closed to A020
        // experiment-records + A019 skill-drafts; intervention-derived
        // provenance rides the PretrainingRunRecord + the forge-record
        // notes instead (architecture question for the TL).
        citations: [],
      },
      lineage: { parents },
    });
  }

  /** Look up one pretraining run (tenant-scoped). */
  getPretrainingRun(runId: string, tenantId: string): PretrainingRunRecord {
    const run = this.runs.get(runId);
    if (run === undefined) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.LISTING_NOT_FOUND, {
        message: `pretraining run ${JSON.stringify(runId)} was not found`,
      });
    }
    if (run.tenantId !== tenantId) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.TENANT_ACCESS_DENIED, {
        message: `pretraining run ${JSON.stringify(runId)} belongs to tenant ${run.tenantId}`,
      });
    }
    return run;
  }

  // -------------------------------------------------------------------------
  // THE CAPABILITY-BODY LISTING MODEL
  // -------------------------------------------------------------------------

  /** Create one DRAFT listing over a resolved A024 release. */
  async createListing(command: CreateListingCommand): Promise<CapabilityBodyListing> {
    if (!isBodyMarketplaceId(command.listingId)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_LISTING, {
        message: 'createListing requires a marketplace-id listingId',
      });
    }
    if (!isTenant(command.tenantId)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_LISTING, {
        message: 'createListing requires a valid tenantId',
      });
    }
    if (!isBodyMarketplaceIdempotencyKey(command.idempotencyKey)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_LISTING, {
        message: 'createListing requires a valid idempotency key (lock rule 17)',
      });
    }
    const commandCanonical = JSON.stringify([command]);
    const bound = this.listingKeys.get(command.idempotencyKey);
    if (bound !== undefined) {
      if (bound.command !== commandCanonical) {
        throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${JSON.stringify(command.idempotencyKey)} is already bound to a different listing command`,
        });
      }
      const stored = this.listings.get(bound.resultDigest);
      if (stored !== undefined) return stored;
    }
    const release = await this.registry.getRecord(command.releaseDigest);
    if (release === undefined || release.kind !== 'release-registration' || release.release === null) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.LISTING_TRANSITION_REJECTED, {
        message: `listing creation requires a registered A024 release (digest ${command.releaseDigest} did not resolve to a release-registration)`,
        details: { code: 'release-unresolved', releaseDigest: command.releaseDigest },
      });
    }
    if (release.bodyVersionRef === null || release.release === null) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.LISTING_TRANSITION_REJECTED, {
        message: 'the resolved release record carries no body version ref (malformed)',
        details: { code: 'release-unresolved', releaseDigest: command.releaseDigest },
      });
    }
    // Listings live in the body's tenant namespace.
    if (release.bodyVersionRef.tenant !== command.tenantId) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.TENANT_ACCESS_DENIED, {
        message: `release ${command.releaseDigest} belongs to tenant ${release.bodyVersionRef.tenant}; listings may only be created by the owning tenant`,
      });
    }
    if (!isBodyMarketplaceText(command.title) || !isBodyMarketplaceText(command.summary)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_LISTING, {
        message: 'createListing requires neutral-text title and summary',
      });
    }
    if (!isBodyMarketplaceTimestamp(command.createdAt)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_LISTING, {
        message: 'createListing requires an ms-precision UTC createdAt',
      });
    }
    if (!Array.isArray(command.capabilityEvidenceRefs) || command.capabilityEvidenceRefs.length === 0) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_LISTING, {
        message: 'createListing requires at least one capability evidence ref',
      });
    }
    if (this.listings.has(command.listingId)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `listing ${command.listingId} already exists (listing ids are immutable addresses)`,
      });
    }
    const certificationRefs =
      release.gate === null ? [] : [...(release.gate.certificationRefs ?? [])];
    const listing: CapabilityBodyListing = deepFreeze({
      listingVersion: 1,
      listingId: command.listingId,
      tenantId: command.tenantId,
      releaseDigest: command.releaseDigest,
      bodyVersionRef: {
        tenant: release.bodyVersionRef.tenant,
        name: release.bodyVersionRef.name,
        version: release.bodyVersionRef.version,
        digest: release.bodyVersionRef.digest,
      },
      releaseVersion: release.release.version,
      channel: release.channel,
      title: command.title,
      summary: command.summary,
      capabilityEvidenceRefs: Object.freeze([...command.capabilityEvidenceRefs]),
      certificationRefs: Object.freeze(certificationRefs),
      forgeRecordDigest: release.gate === null ? null : release.gate.forgeRecordDigest,
      pretrainingRunId: command.pretrainingRunId,
      rights: command.rights,
      substrateCompatibility: command.substrateCompatibility,
      pricing: command.pricing,
      state: 'draft',
      version: 1,
      history: [],
      createdAt: command.createdAt,
      digest: '',
    });
    const frozen = deepFreeze({ ...listing, digest: await recordDigest(listing) });
    this.listings.set(command.listingId, frozen);
    this.listingHistory.set(command.listingId, []);
    this.listingKeys.set(command.idempotencyKey, {
      command: commandCanonical,
      resultDigest: command.listingId,
    });
    return frozen;
  }

  /**
   * The typed publication guard (pure): a listing may be PUBLISHED only
   * when its certification posture is RECORD-BACKED and its A024 release
   * is explicitly PUBLISHED (lock rule 12). Returns the structured
   * verdict — never a boolean.
   */
  async checkListingPublication(listing: CapabilityBodyListing): Promise<ListingTransitionCheck> {
    const rejections: ListingGuardRejection[] = [];
    if (listing.state !== 'draft' && listing.state !== 'suspended') {
      rejections.push({
        reason: 'invalid-state',
        detail: `only DRAFT or SUSPENDED listings can be published (state is ${listing.state})`,
      });
    }
    const posture = await this.deriveCertificationPosture(listing);
    if (posture.state !== 'record-backed') {
      rejections.push({
        reason: 'certification-not-record-backed',
        detail: `the listing's certification state is not record-backed (${posture.unresolved.length} unresolved certification ref${posture.unresolved.length === 1 ? '' : 's'}) — a listing without record-backed certification can never surface a certified badge`,
      });
    }
    const releaseIdentity = {
      namespace: listing.bodyVersionRef.tenant,
      name: listing.bodyVersionRef.name,
      version: listing.releaseVersion ?? listing.bodyVersionRef.version,
    };
    const status = await this.registry.resolveStatus(releaseIdentity);
    if (status.visibility !== 'published') {
      rejections.push({
        reason: 'release-not-published',
        detail: `the listing's A024 release ${releaseIdentity.namespace}/${releaseIdentity.name}@${releaseIdentity.version} is not published — publication is an explicit versioned transition (lock rule 12)`,
      });
    }
    return deepFreeze({ allowed: rejections.length === 0, rejections: Object.freeze(rejections) });
  }

  /**
   * Transition one listing. PUBLISH runs the typed guard (record-backed
   * certification + published release); a rejected transition throws
   * LISTING_TRANSITION_REJECTED with the structured verdict (fail
   * closed). Publication of the underlying release may be supplied
   * explicitly (versioned, rights-carrying) when not yet published.
   */
  async transitionListing(command: ListingTransitionCommand): Promise<CapabilityBodyListing> {
    if (!isBodyMarketplaceId(command.listingId)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_LISTING, {
        message: 'transitionListing requires a marketplace-id listingId',
      });
    }
    if (!isBodyMarketplaceIdempotencyKey(command.idempotencyKey)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_LISTING, {
        message: 'transitionListing requires a valid idempotency key (lock rule 17)',
      });
    }
    const listing = this.getListing(command.listingId, command.tenantId);
    const commandCanonical = JSON.stringify([command.listingId, command.to, command.reason, command.at]);
    const bound = this.transitionKeys.get(command.idempotencyKey);
    if (bound !== undefined) {
      if (bound.command !== commandCanonical) {
        throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${JSON.stringify(command.idempotencyKey)} is already bound to a different transition command`,
        });
      }
      const stored = this.transitionResults.get(command.idempotencyKey);
      if (stored !== undefined) return stored;
    }
    const allowed = (LISTING_TRANSITIONS[listing.state] as readonly string[]).includes(command.to);
    if (!allowed) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.LISTING_TRANSITION_REJECTED, {
        message: `listing ${command.listingId} cannot transition ${listing.state} → ${command.to} (closed lifecycle: DRAFT → PUBLISHED → SUSPENDED/RETIRED)`,
        details: { code: 'invalid-transition', from: listing.state, to: command.to },
      });
    }
    if (!isBodyMarketplaceText(command.reason) || command.reason.length === 0) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.LISTING_TRANSITION_REJECTED, {
        message: 'listing transitions require a machine-readable reason',
        details: { code: 'reason-required' },
      });
    }
    if (command.to === 'published') {
      // Explicitly publish the underlying release when inputs are supplied.
      if (command.releasePublication !== undefined) {
        const releaseIdentity = {
          namespace: listing.bodyVersionRef.tenant,
          name: listing.bodyVersionRef.name,
          version: listing.releaseVersion ?? listing.bodyVersionRef.version,
        };
        const status = await this.registry.resolveStatus(releaseIdentity);
        if (status.visibility !== 'published') {
          await this.registry.publish(releaseIdentity, {
            publisher: command.releasePublication.publisher,
            rights: command.releasePublication.rights,
            publishedAt: command.releasePublication.publishedAt,
          });
        }
      }
      const check = await this.checkListingPublication(listing);
      if (!check.allowed) {
        throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.LISTING_TRANSITION_REJECTED, {
          message: `listing publication REJECTED by the typed guard (${check.rejections.length} structured rejection${check.rejections.length === 1 ? '' : 's'})`,
          details: { rejections: check.rejections.map((rejection) => ({ ...rejection })) },
        });
      }
    }
    const history = [
      ...(this.listingHistory.get(command.listingId) ?? []),
      deepFreeze({
        transitionId: `t-${command.listingId}-${listing.version + 1}`,
        from: listing.state,
        to: command.to,
        reason: command.reason,
        actor: command.actor,
        at: command.at,
        listingVersion: listing.version + 1,
      }),
    ];
    this.listingHistory.set(command.listingId, Object.freeze(history));
    const updated: CapabilityBodyListing = deepFreeze({
      ...listing,
      state: command.to,
      version: listing.version + 1,
      history: Object.freeze(history),
    });
    const frozen = deepFreeze({ ...updated, digest: await recordDigest(updated) });
    this.listings.set(command.listingId, frozen);
    this.transitionResults.set(command.idempotencyKey, frozen);
    this.transitionKeys.set(command.idempotencyKey, {
      command: commandCanonical,
      resultDigest: command.listingId,
    });
    return frozen;
  }

  /** Tenant-scoped listing lookup (cross-tenant access fails CLOSED). */
  getListing(listingId: string, tenantId: string): CapabilityBodyListing {
    const listing = this.listings.get(listingId);
    if (listing === undefined) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.LISTING_NOT_FOUND, {
        message: `listing ${JSON.stringify(listingId)} was not found`,
      });
    }
    if (listing.tenantId !== tenantId) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.TENANT_ACCESS_DENIED, {
        message: `listing ${JSON.stringify(listingId)} belongs to tenant ${listing.tenantId} — cross-tenant listing access is denied`,
      });
    }
    return listing;
  }

  /** Browse: the caller's own listings plus public-tenant listings. */
  listListings(readerTenant: string): readonly CapabilityBodyListing[] {
    return [...this.listings.values()].filter(
      (listing) => listing.tenantId === readerTenant || listing.tenantId === 'public',
    );
  }

  /**
   * Derive the listing's certification posture from the A023 records its
   * release cites — RECORD-BACKED ONLY: every cited record must resolve,
   * be structurally valid, carry verdict 'satisfied' + a granted level,
   * and address the exact body version. Anything else is the honest
   * 'unverified' posture (never an invented badge).
   */
  async deriveCertificationPosture(
    listing: CapabilityBodyListing,
  ): Promise<CertificationPosture> {
    const unresolved: string[] = [];
    const records: { digest: string; verdict: string; grantedLevel: string }[] = [];
    for (const ref of listing.certificationRefs) {
      const record = await this.certificationStore.resolve(ref);
      if (
        record === undefined ||
        !isCertificationRecord(record) ||
        record.verdict !== 'satisfied' ||
        record.grantedLevel === null ||
        record.subject === null ||
        record.subject.bodyVersionRef.tenant !== listing.bodyVersionRef.tenant ||
        record.subject.bodyVersionRef.name !== listing.bodyVersionRef.name ||
        record.subject.bodyVersionRef.version !== listing.bodyVersionRef.version ||
        record.subject.bodyVersionRef.digest !== listing.bodyVersionRef.digest
      ) {
        unresolved.push(ref);
        continue;
      }
      records.push({
        digest: ref,
        verdict: record.verdict,
        grantedLevel: record.grantedLevel,
      });
    }
    if (unresolved.length > 0 || records.length === 0) {
      return deepFreeze({ state: 'unverified', unresolved: Object.freeze(unresolved) });
    }
    const levels = records.map((record) => record.grantedLevel);
    const strongestGrant = levels.includes('CERTIFIED')
      ? 'CERTIFIED'
      : levels.includes('CANDIDATE')
        ? 'CANDIDATE'
        : 'DEVELOPMENT';
    return deepFreeze({
      state: 'record-backed',
      records: Object.freeze(records),
      strongestGrant,
    });
  }

  /**
   * Surface the certification badge — FAIL CLOSED: a listing without a
   * record-backed certification posture can never surface a certified
   * badge (CERTIFICATION_NOT_RECORD_BACKED).
   */
  async certifiedBadge(
    listingId: string,
    tenantId: string,
  ): Promise<RecordBackedCertificationBadge> {
    const listing = this.getListing(listingId, tenantId);
    const posture = await this.deriveCertificationPosture(listing);
    if (posture.state !== 'record-backed') {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.CERTIFICATION_NOT_RECORD_BACKED, {
        message: `listing ${listingId} has no record-backed certification (unresolved: ${posture.unresolved.join(', ')}) — surfacing a certified badge would be an unbacked claim`,
        details: { unresolved: [...posture.unresolved] },
      });
    }
    return deepFreeze({
      listingId,
      bodyVersionRef: { ...listing.bodyVersionRef },
      grantedLevel: posture.strongestGrant ?? 'DEVELOPMENT',
      recordDigests: posture.records.map((record) => record.digest),
      scopeNotice:
        'certification proves a claim about BodyVersion × Substrate × Environment × Runtime × CertificationSuite — never about the base model in isolation',
    });
  }

  // -------------------------------------------------------------------------
  // THE OFFER/GRANT SEAM (A031/A032 house patterns)
  // -------------------------------------------------------------------------

  /** Grant one listing access (idempotent; listing must be PUBLISHED). */
  async grantListingAccess(command: GrantListingAccessCommand): Promise<ListingGrantRecord> {
    if (!isBodyMarketplaceId(command.grantId)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
        message: 'grantListingAccess requires a marketplace-id grantId',
      });
    }
    if (!isBodyMarketplaceIdempotencyKey(command.idempotencyKey)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
        message: 'grantListingAccess requires a valid idempotency key (lock rule 17)',
      });
    }
    const commandCanonical = JSON.stringify([command]);
    const bound = this.grantKeys.get(command.idempotencyKey);
    if (bound !== undefined) {
      if (bound.command !== commandCanonical) {
        throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${JSON.stringify(command.idempotencyKey)} is already bound to a different grant command`,
        });
      }
      const stored = this.grants.get(bound.resultDigest);
      if (stored !== undefined) return stored;
    }
    const listing = this.getListing(command.listingId, command.tenantId);
    if (listing.state !== 'published') {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.LISTING_TRANSITION_REJECTED, {
        message: `grants require a PUBLISHED listing (state is ${listing.state})`,
        details: { code: 'listing-not-published', listingId: command.listingId },
      });
    }
    const grant: ListingGrantRecord = deepFreeze({
      grantVersion: 1,
      grantId: command.grantId,
      listingId: command.listingId,
      tenantId: command.tenantId,
      grantee: command.grantee,
      permittedUse: command.permittedUse,
      grantedAt: command.grantedAt,
      expiresAt: command.expiresAt,
      state: 'active',
      revocation: null,
      digest: '',
    });
    const frozen = deepFreeze({ ...grant, digest: await recordDigest(grant) });
    this.grants.set(command.grantId, frozen);
    this.grantKeys.set(command.idempotencyKey, {
      command: commandCanonical,
      resultDigest: command.grantId,
    });
    return frozen;
  }

  /** Look up one grant (tenant-scoped). */
  getGrant(grantId: string, tenantId: string): ListingGrantRecord {
    const grant = this.grants.get(grantId);
    if (grant === undefined) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.LISTING_NOT_FOUND, {
        message: `grant ${JSON.stringify(grantId)} was not found`,
      });
    }
    if (grant.tenantId !== tenantId) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.TENANT_ACCESS_DENIED, {
        message: `grant ${JSON.stringify(grantId)} belongs to tenant ${grant.tenantId}`,
      });
    }
    return grant;
  }
}

/** Digest of the digest-free view of a record (strip `digest`, canonicalize). */
async function recordDigest(
  record: Omit<PretrainingRunRecord, 'digest'> | Omit<CapabilityBodyListing, 'digest'> | Omit<ListingGrantRecord, 'digest'>,
): Promise<string> {
  return viewDigest(record);
}

/** Construct a fresh body-marketplace reference fabric. */
export function createBodyMarketplaceFabric(
  config: BodyMarketplaceServiceConfig = {},
): BodyMarketplaceService {
  return new BodyMarketplaceService(config);
}

/** Normalize any thrown value into a BodyMarketplaceError (fail-closed). */
export function ensureBodyMarketplaceError(error: unknown): BodyMarketplaceError {
  return normalizeToBodyMarketplaceError(error);
}

/** Convenience: a fresh idempotency key (the @arena/protocol-core source). */
export function freshIdempotencyKey(): string {
  return newIdempotencyKey();
}
