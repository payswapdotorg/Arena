/**
 * MarketplaceArtifactsFabric — the reference fabric for the dataset /
 * evaluation-suite / environment marketplace (Work Order A032).
 *
 * Pure reference fabric, INJECTED evidence dependencies by design:
 *
 *   - ingest is GUARD-VALIDATED (the owning packages' is* guards —
 *     A002 provenance, A013 verification, A014 dataset manifests, A012
 *     evaluation criteria, A009 environment definitions) and
 *     IDEMPOTENT by content digest — the marketplace never reaches
 *     into another service's storage (cross-service rule of
 *     spec/service-boundaries.md);
 *   - listing publication is GATED (gate → idempotency → identity
 *     binding → append, the A024 four-step orchestration): no listing
 *     without resolvable, tamper-verified, subject-matching provenance
 *     AND a PASSING verification statement (A002 digests + A013
 *     statements);
 *   - access grants enforce the closed license rules + the A034
 *     data-rights engine (checkDataRightsForAction) — cross-tenant
 *     access fails closed;
 *   - reviews are gated on an ACTIVE access grant for the exact offer
 *     (closed rating/verdict vocabularies);
 *   - every ledger is append-only with supersession/retirement
 *     PROJECTIONS (records are never mutated);
 *   - every query dispatch is scope-checked FIRST (cross-tenant reads
 *     fail closed);
 *   - no network/HTTP layer, no filesystem, no process state — the
 *     A032 reference slice, like the A013/A023/A024/A025 fabrics.
 */

import { isDatasetManifest } from '@arena/datasets';
import type { DatasetManifest } from '@arena/datasets';
import { isEnvironmentDefinition } from '@arena/environment-protocol';
import type { EnvironmentDefinition } from '@arena/environment-protocol';
import { isEvaluationCriteria } from '@arena/evaluation';
import type { EvaluationCriteria } from '@arena/evaluation';
import { isProvenanceRecord, provenanceRecordDigest } from '@arena/provenance';
import type { ProvenanceRecord } from '@arena/provenance';
import { PERMITTED_USES } from '@arena/security';
import { isVerificationRecord } from '@arena/verification';
import type { VerificationRecord } from '@arena/verification';
import { MARKETPLACE_ERROR_CODES, MarketplaceError } from './errors.js';
import {
  createMarketplaceOfferRecord,
  offerSummaryOf,
  type MarketplaceVisibility,
  type MarketplaceOffer,
  type MarketplaceOfferStatus,
  type MarketplaceOfferSummary,
  type CreateMarketplaceOfferInput,
} from './offers.js';
import {
  createMarketplaceGrantRecord,
  dataRightsReadDecision,
  licenseDenial,
  type MarketplaceGrant,
  type MarketplaceGrantState,
} from './grants.js';
import {
  createMarketplaceReviewRecord,
  averageRatingOf,
  MARKETPLACE_REVIEW_VERDICTS,
  type MarketplaceReview,
} from './reviews.js';
import {
  evaluateListingGate,
  toMarketplaceEvidenceRefs,
  type MarketplaceEvidenceRef,
  type MarketplaceEvidenceStores,
  type MarketplaceGateVerdict,
} from './gate.js';
import {
  isMarketplaceQueryRequest,
  marketplaceQueryResponse,
  type MarketplaceQueryResultValue,
  normalizeSearchQuery,
  visibleToScope,
  isTenantAddressable,
  type MarketplaceQueryRequest,
  type MarketplaceQueryResponse,
  type MarketplaceReadScope,
  type MarketplaceGrantStatus,
  type MarketplaceOfferProfile,
} from './queries.js';
import { deepFreeze, expectEnumMember } from './shared.js';

// ---------------------------------------------------------------------------
// Fabric inputs (correlation/idempotency metadata ride the command
// envelope; the fabric receives them explicitly)
// ---------------------------------------------------------------------------

/** Offer candidate content (no correlation/idempotency — the envelope owns them). */
export type OfferCandidateInput = Omit<CreateMarketplaceOfferInput, 'correlationId' | 'idempotencyKey'>;

export interface RegisterOfferInput {
  readonly candidate: OfferCandidateInput;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly evidence: readonly MarketplaceEvidenceRef[];
}

export interface GrantAccessInput {
  readonly grantId: string;
  readonly offerId: string;
  readonly grantee: { type: string; tenant: string; principalId: string };
  readonly permittedUse: string;
  readonly asOf: string;
  readonly expiresAt?: string | null;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface RevokeGrantInput {
  readonly grantId: string;
  readonly grounds: string;
  readonly revoker: { type: string; tenant: string; principalId: string };
  readonly revokedAt: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface SubmitReviewInput {
  readonly reviewId: string;
  readonly offerId: string;
  readonly reviewer: { type: string; tenant: string; principalId: string };
  readonly rating: number;
  readonly verdict: string;
  readonly body: string;
  readonly submittedAt: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

// ---------------------------------------------------------------------------
// Command results
// ---------------------------------------------------------------------------

export interface OfferCommandResult {
  readonly record: MarketplaceOffer;
  readonly gate: MarketplaceGateVerdict | null;
  readonly idempotent: boolean;
}

export interface GrantCommandResult {
  readonly record: MarketplaceGrant;
  readonly idempotent: boolean;
  readonly dataRights: { readonly allowed: boolean; readonly reason: string };
}

export interface ReviewCommandResult {
  readonly record: MarketplaceReview;
  readonly idempotent: boolean;
}

export interface GrantRevocationResult {
  readonly record: MarketplaceGrant;
  readonly idempotent: boolean;
}

/** A download authorization (fail-closed: denials THROW, never return allowed). */
export interface DownloadAuthorization {
  readonly grant: MarketplaceGrant;
  readonly offer: MarketplaceOffer;
  readonly dataRights: { readonly allowed: true; readonly reason: 'permitted' };
}

// ---------------------------------------------------------------------------
// Fabric
// ---------------------------------------------------------------------------

/** The reference marketplace fabric. */
export class MarketplaceArtifactsFabric {
  // --- evidence read model (guard-validated, idempotent by digest) ---------
  private readonly provenanceRecords: ProvenanceRecord[] = [];
  private readonly provenanceByDigest = new Map<string, ProvenanceRecord>();
  private readonly verificationRecords: VerificationRecord[] = [];
  private readonly verificationByDigest = new Map<string, VerificationRecord>();
  private readonly datasetCatalog: DatasetManifest[] = [];
  private readonly datasetByDigest = new Map<string, DatasetManifest>();
  private readonly evaluationCatalog: EvaluationCriteria[] = [];
  private readonly evaluationByDigest = new Map<string, EvaluationCriteria>();
  private readonly environmentCatalog: EnvironmentDefinition[] = [];
  private readonly environmentByDigest = new Map<string, EnvironmentDefinition>();

  // --- append-only ledgers with lifecycle projections ----------------------
  private readonly offerLedger: MarketplaceOffer[] = [];
  private readonly offerByDigest = new Map<string, MarketplaceOffer>();
  private readonly activeOfferByOfferId = new Map<string, MarketplaceOffer>();
  private readonly supersededOffers = new Set<string>();
  private readonly retiredOffers = new Set<string>();
  private readonly offerIds = new Set<string>();

  private readonly grantLedger: MarketplaceGrant[] = [];
  private readonly grantByDigest = new Map<string, MarketplaceGrant>();
  private readonly grantIssuanceByGrantId = new Map<string, MarketplaceGrant>();
  private readonly revokedGrants = new Set<string>();

  private readonly reviewLedger: MarketplaceReview[] = [];
  private readonly reviewByDigest = new Map<string, MarketplaceReview>();
  private readonly reviewsByOfferId = new Map<string, MarketplaceReview[]>();
  private readonly reviewKeyToDigest = new Map<string, string>();

  // --- idempotent run keys (correlationId:idempotencyKey:command) ----------
  private readonly runKeys = new Map<string, string>();

  // -------------------------------------------------------------------------
  // Ingest — guard-validated, idempotent by digest, deep-frozen
  // -------------------------------------------------------------------------

  /** Ingest one authoritative A002 provenance record. Returns its digest. */
  async putProvenanceRecord(record: unknown): Promise<string> {
    if (!isProvenanceRecord(record)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_RECORD, {
        message: 'not a structurally valid A002 ProvenanceRecord',
      });
    }
    const digest = await provenanceRecordDigest(record);
    if (!this.provenanceByDigest.has(digest)) {
      deepFreeze(record);
      this.provenanceByDigest.set(digest, record);
      this.provenanceRecords.push(record);
    }
    return digest;
  }

  /** Ingest one authoritative A013 verification record. Returns its digest. */
  putVerificationRecord(record: unknown): string {
    if (!isVerificationRecord(record)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_RECORD, {
        message: 'not a structurally valid A013 VerificationRecord',
      });
    }
    deepFreeze(record);
    if (!this.verificationByDigest.has(record.digest)) {
      this.verificationByDigest.set(record.digest, record);
      this.verificationRecords.push(record);
    }
    return record.digest;
  }

  /** Ingest one authoritative A014 dataset manifest. Returns its digest. */
  putDatasetManifest(manifest: unknown): string {
    if (!isDatasetManifest(manifest)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_RECORD, {
        message: 'not a structurally valid A014 DatasetManifest',
      });
    }
    deepFreeze(manifest);
    if (!this.datasetByDigest.has(manifest.digest)) {
      this.datasetByDigest.set(manifest.digest, manifest);
      this.datasetCatalog.push(manifest);
    }
    return manifest.digest;
  }

  /** Ingest one authoritative A012 evaluation criteria suite. Returns its digest. */
  putEvaluationCriteria(criteria: unknown): string {
    if (!isEvaluationCriteria(criteria)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_RECORD, {
        message: 'not a structurally valid A012 EvaluationCriteria',
      });
    }
    deepFreeze(criteria);
    if (!this.evaluationByDigest.has(criteria.digest)) {
      this.evaluationByDigest.set(criteria.digest, criteria);
      this.evaluationCatalog.push(criteria);
    }
    return criteria.digest;
  }

  /** Ingest one authoritative A009 environment definition. Returns its digest. */
  putEnvironmentDefinition(definition: unknown): string {
    if (!isEnvironmentDefinition(definition)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_RECORD, {
        message: 'not a structurally valid A009 EnvironmentDefinition',
      });
    }
    deepFreeze(definition);
    if (!this.environmentByDigest.has(definition.digest)) {
      this.environmentByDigest.set(definition.digest, definition);
      this.environmentCatalog.push(definition);
    }
    return definition.digest;
  }

  /** Ingest counts (evidence of the read model's population). */
  counts(): Readonly<Record<string, number>> {
    return Object.freeze({
      provenanceRecords: this.provenanceRecords.length,
      verificationRecords: this.verificationRecords.length,
      datasets: this.datasetCatalog.length,
      evaluationCriteria: this.evaluationByDigest.size,
      environments: this.environmentCatalog.length,
      offers: this.offerLedger.length,
      grants: this.grantLedger.length,
      reviews: this.reviewLedger.length,
    });
  }

  /** The injected evidence stores (digest-addressed lookups for the gate). */
  readonly evidenceStores: MarketplaceEvidenceStores = {
    provenance: (digest: string) => this.provenanceByDigest.get(digest) ?? null,
    verification: (digest: string) => this.verificationByDigest.get(digest) ?? null,
  };

  // -------------------------------------------------------------------------
  // Offers — gate → idempotency → identity binding → append
  // -------------------------------------------------------------------------

  /** Register (or idempotently re-assert) a marketplace listing. */
  async registerOffer(input: RegisterOfferInput): Promise<OfferCommandResult> {
    const candidate: CreateMarketplaceOfferInput = {
      ...input.candidate,
      kind: 'offer-registration',
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
    };
    const record = await createMarketplaceOfferRecord(candidate);
    this.assertPublisherOwnsArtifact(record);

    // 1. GATE — publication requires provenance + passing verification.
    const evidence = toMarketplaceEvidenceRefs(input.evidence);
    if (record.artifact === null) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
        message: 'registration requires the offer content',
      });
    }
    const gate = await evaluateListingGate(record.artifact, evidence, this.evidenceStores);
    if (!gate.admitted) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.REGISTRATION_REJECTED, {
        message: 'listing publication rejected by the admission gate (fail closed)',
        details: { rejections: gate.rejections },
      });
    }

    // 2. IDEMPOTENCY — same run key + same canonical command replays.
    const runKey = `${input.correlationId}:${input.idempotencyKey}:register-offer`;
    const seen = this.runKeys.get(runKey);
    if (seen === record.digest) {
      return deepFreeze({ record, gate, idempotent: true });
    }
    if (seen !== undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: 'this correlation/idempotency pair already produced a different command',
        details: { runKey },
      });
    }

    // 3. IDENTITY BINDING — one active registration per offerId.
    const active = this.activeOfferByOfferId.get(record.offerId);
    if (active !== undefined) {
      if (active.digest === record.digest) {
        this.runKeys.set(runKey, record.digest);
        return deepFreeze({ record, gate, idempotent: true });
      }
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `offerId ${JSON.stringify(record.offerId)} already has an active registration — supersede it instead`,
        details: { offerId: record.offerId, activeDigest: active.digest },
      });
    }
    if (this.offerIds.has(record.offerId)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `offerId ${JSON.stringify(record.offerId)} is closed (superseded or retired) — offer ids are never re-opened`,
        details: { offerId: record.offerId },
      });
    }

    // 4. APPEND + project.
    this.runKeys.set(runKey, record.digest);
    this.offerLedger.push(record);
    this.offerByDigest.set(record.digest, record);
    this.activeOfferByOfferId.set(record.offerId, record);
    this.offerIds.add(record.offerId);
    return deepFreeze({ record, gate, idempotent: false });
  }

  /** Supersede the active registration of an offerId with new content. */
  async supersedeOffer(input: RegisterOfferInput): Promise<OfferCommandResult> {
    const candidate: CreateMarketplaceOfferInput = {
      ...input.candidate,
      kind: 'offer-supersession',
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
    };
    const record = await createMarketplaceOfferRecord(candidate);
    this.assertPublisherOwnsArtifact(record);

    const active = this.activeOfferByOfferId.get(record.offerId);
    if (active === undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.NOT_FOUND, {
        message: `no active registration to supersede for offerId ${JSON.stringify(record.offerId)}`,
      });
    }
    if (record.supersedes !== active.digest) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
        message: 'supersedes must cite the CURRENT active registration digest',
        details: { offerId: record.offerId, expected: active.digest },
      });
    }

    // Gate the new content exactly like a registration.
    const evidence = toMarketplaceEvidenceRefs(input.evidence);
    if (record.artifact === null) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
        message: 'supersession requires the new offer content',
      });
    }
    const gate = await evaluateListingGate(record.artifact, evidence, this.evidenceStores);
    if (!gate.admitted) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.REGISTRATION_REJECTED, {
        message: 'listing supersession rejected by the admission gate (fail closed)',
        details: { rejections: gate.rejections },
      });
    }

    const runKey = `${input.correlationId}:${input.idempotencyKey}:supersede-offer`;
    const seen = this.runKeys.get(runKey);
    if (seen === record.digest) {
      return deepFreeze({ record, gate, idempotent: true });
    }
    if (seen !== undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: 'this correlation/idempotency pair already produced a different command',
        details: { runKey },
      });
    }

    this.runKeys.set(runKey, record.digest);
    this.offerLedger.push(record);
    this.offerByDigest.set(record.digest, record);
    this.supersededOffers.add(active.digest);
    this.activeOfferByOfferId.set(record.offerId, record);
    return deepFreeze({ record, gate, idempotent: false });
  }

  /** Retire the active registration of an offerId (grounds required). */
  async retireOffer(input: {
    readonly offerId: string;
    readonly retires: string;
    readonly grounds: string;
    readonly provenance: { readonly offeredBy: string; readonly recordedAt: string; readonly notes: string | null };
    readonly correlationId: string;
    readonly idempotencyKey: string;
  }): Promise<OfferCommandResult> {
    const active = this.activeOfferByOfferId.get(input.offerId);
    if (active === undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.NOT_FOUND, {
        message: `no active registration to retire for offerId ${JSON.stringify(input.offerId)}`,
      });
    }
    const record = await createMarketplaceOfferRecord({
      kind: 'offer-retirement',
      offerId: input.offerId,
      artifactKind: active.artifactKind,
      retires: input.retires,
      grounds: input.grounds,
      provenance: input.provenance,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
    });
    if (record.retires !== active.digest) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
        message: 'retires must cite the CURRENT active registration digest',
        details: { offerId: record.offerId, expected: active.digest },
      });
    }

    const runKey = `${input.correlationId}:${input.idempotencyKey}:retire-offer`;
    const seen = this.runKeys.get(runKey);
    if (seen === record.digest) {
      return deepFreeze({ record, gate: null, idempotent: true });
    }
    if (seen !== undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: 'this correlation/idempotency pair already produced a different command',
        details: { runKey },
      });
    }

    this.runKeys.set(runKey, record.digest);
    this.offerLedger.push(record);
    this.offerByDigest.set(record.digest, record);
    this.retiredOffers.add(active.digest);
    this.activeOfferByOfferId.delete(record.offerId);
    return deepFreeze({ record, gate: null, idempotent: false });
  }

  // -------------------------------------------------------------------------
  // Grants — tenant boundary → license rules → data rights → append
  // -------------------------------------------------------------------------

  /** Grant download/access (data-rights enforced, A034). */
  async grantAccess(input: GrantAccessInput): Promise<GrantCommandResult> {
    const permittedUse = expectEnumMember(
      input.permittedUse,
      PERMITTED_USES,
      MARKETPLACE_ERROR_CODES.INVALID_GRANT,
      'grant permittedUse',
    );
    const offer = this.requireActiveOffer(input.offerId);

    // Tenant boundary (fail closed): tenant-internal offers never grant
    // cross-tenant.
    if (offer.visibility === 'tenant-internal' && input.grantee.tenant !== offer.tenant) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `offer ${JSON.stringify(input.offerId)} is tenant-internal — cross-tenant grants fail closed`,
        details: { offerId: input.offerId, granteeTenant: input.grantee.tenant },
      });
    }

    // Closed license rules (A002 RightsMetadata vocabulary).
    const denial = licenseDenial(offer, input.grantee.tenant, permittedUse);
    if (denial !== null) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.GRANT_FORBIDDEN, {
        message: `the offer license denies this grant (${JSON.stringify(denial)})`,
        details: { reason: denial },
      });
    }

    // A034 data-rights engine.
    const decision = dataRightsReadDecision(offer, input.asOf, input.grantee.tenant);
    if (!decision.allowed) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.GRANT_FORBIDDEN, {
        message: `data rights deny this grant (${JSON.stringify(decision.reason)})`,
        details: { reason: decision.reason },
      });
    }

    const record = await createMarketplaceGrantRecord({
      kind: 'grant-issuance',
      grantId: input.grantId,
      offer: { offerId: offer.offerId, offerDigest: offer.digest },
      grantee: input.grantee,
      permittedUse,
      grantedAt: input.asOf,
      expiresAt: input.expiresAt ?? null,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      provenance: {
        grantedBy: offer.publisher !== null ? offer.publisher.principalId : 'marketplace-fabric',
        recordedAt: input.asOf,
        notes: null,
      },
    });

    const runKey = `${input.correlationId}:${input.idempotencyKey}:grant-access`;
    const seen = this.runKeys.get(runKey);
    if (seen === record.digest) {
      return deepFreeze({ record, idempotent: true, dataRights: { allowed: decision.allowed, reason: decision.reason } });
    }
    if (seen !== undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: 'this correlation/idempotency pair already produced a different command',
        details: { runKey },
      });
    }

    // Grant id binding: same grantId + different digest is a conflict.
    const existing = this.grantIssuanceByGrantId.get(record.grantId);
    if (existing !== undefined) {
      if (existing.digest === record.digest) {
        this.runKeys.set(runKey, record.digest);
        return deepFreeze({ record, idempotent: true, dataRights: { allowed: decision.allowed, reason: decision.reason } });
      }
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `grantId ${JSON.stringify(record.grantId)} is already bound to a different issuance`,
        details: { grantId: record.grantId },
      });
    }

    this.runKeys.set(runKey, record.digest);
    this.grantLedger.push(record);
    this.grantByDigest.set(record.digest, record);
    this.grantIssuanceByGrantId.set(record.grantId, record);
    return deepFreeze({
      record,
      idempotent: false,
      dataRights: { allowed: decision.allowed, reason: decision.reason },
    });
  }

  /** Revoke a grant (append-only; owner-tenant action). */
  async revokeGrant(input: RevokeGrantInput): Promise<GrantRevocationResult> {
    const issuance = this.grantIssuanceByGrantId.get(input.grantId);
    if (issuance === undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.NOT_FOUND, {
        message: `no grant issuance found for grantId ${JSON.stringify(input.grantId)}`,
      });
    }
    if (this.revokedGrants.has(issuance.digest)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
        message: 'grant is already revoked (append-only — one revocation per grant)',
      });
    }
    const offer = this.offerByDigest.get(issuance.offer.offerDigest);
    if (offer === undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.NOT_FOUND, {
        message: 'the granted offer registration is no longer in the ledger',
      });
    }
    // Revocation is an owner (offer tenant) action.
    if (input.revoker.tenant !== offer.tenant) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.TENANT_FORBIDDEN, {
        message: 'only the offer-owning tenant may revoke grants',
        details: { offerTenant: offer.tenant, revokerTenant: input.revoker.tenant },
      });
    }

    const record = await createMarketplaceGrantRecord({
      kind: 'grant-revocation',
      grantId: input.grantId,
      offer: { offerId: issuance.offer.offerId, offerDigest: issuance.digest },
      grantee: { type: input.revoker.type, tenant: input.revoker.tenant, principalId: input.revoker.principalId },
      revokes: issuance.digest,
      grounds: input.grounds,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      provenance: {
        grantedBy: input.revoker.principalId,
        recordedAt: input.revokedAt,
        notes: null,
      },
    });

    const runKey = `${input.correlationId}:${input.idempotencyKey}:revoke-grant`;
    const seen = this.runKeys.get(runKey);
    if (seen === record.digest) {
      return deepFreeze({ record, gate: null, idempotent: true });
    }
    if (seen !== undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: 'this correlation/idempotency pair already produced a different command',
        details: { runKey },
      });
    }

    this.runKeys.set(runKey, record.digest);
    this.grantLedger.push(record);
    this.grantByDigest.set(record.digest, record);
    this.revokedGrants.add(issuance.digest);
    return deepFreeze({ record, gate: null, idempotent: false });
  }

  /** Authorize a download (fail closed: revocation/expiry/rights re-checked). */
  async authorizeDownload(grantId: string, asOf: string): Promise<DownloadAuthorization> {
    const issuance = this.grantIssuanceByGrantId.get(grantId);
    if (issuance === undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.NOT_FOUND, {
        message: `no grant issuance found for grantId ${JSON.stringify(grantId)}`,
      });
    }
    if (this.revokedGrants.has(issuance.digest)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.GRANT_NOT_ACTIVE, {
        message: 'grant is revoked — downloads fail closed',
      });
    }
    if (
      issuance.expiresAt !== null &&
      Date.parse(asOf) >= Date.parse(issuance.expiresAt)
    ) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.GRANT_NOT_ACTIVE, {
        message: 'grant has expired — downloads fail closed',
      });
    }
    const offer = this.requireOfferByDigest(issuance.offer.offerDigest);
    const decision = dataRightsReadDecision(offer, asOf, issuance.granteeTenant);
    if (!decision.allowed) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.GRANT_FORBIDDEN, {
        message: `data rights deny this download (${JSON.stringify(decision.reason)})`,
        details: { reason: decision.reason },
      });
    }
    return deepFreeze({
      grant: issuance,
      offer,
      dataRights: { allowed: true as const, reason: 'permitted' as const },
    });
  }

  // -------------------------------------------------------------------------
  // Reviews — grant-gated submission
  // -------------------------------------------------------------------------

  /** Submit a review (requires an ACTIVE grant for the exact offer). */
  async submitReview(input: SubmitReviewInput): Promise<ReviewCommandResult> {
    const verdict = expectEnumMember(
      input.verdict,
      MARKETPLACE_REVIEW_VERDICTS,
      MARKETPLACE_ERROR_CODES.INVALID_REVIEW,
      'review verdict',
    );
    const offer = this.requireActiveOffer(input.offerId);

    // Review gating: the reviewer must hold an active grant covering the
    // ACTIVE registration digest of this offer.
    const grant = [...this.grantIssuanceByGrantId.values()].find(
      (candidate) =>
        candidate.offer.offerDigest === offer.digest &&
        candidate.grantee.principalId === input.reviewer.principalId &&
        !this.revokedGrants.has(candidate.digest) &&
        (candidate.expiresAt === null || Date.parse(input.submittedAt) < Date.parse(candidate.expiresAt)),
    );
    if (grant === undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.REVIEW_UNAUTHORIZED, {
        message: 'reviews require an active access grant for the exact offer (fail closed)',
        details: { offerId: input.offerId, reviewer: input.reviewer.principalId },
      });
    }

    const record = await createMarketplaceReviewRecord({
      reviewId: input.reviewId,
      offer: { offerId: offer.offerId, offerDigest: offer.digest },
      reviewer: input.reviewer,
      rating: input.rating,
      verdict,
      body: input.body,
      submittedAt: input.submittedAt,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      provenance: {
        submittedBy: input.reviewer.principalId,
        recordedAt: input.submittedAt,
        notes: null,
      },
    });

    const runKey = `${input.correlationId}:${input.idempotencyKey}:submit-review`;
    const seen = this.runKeys.get(runKey);
    if (seen === record.digest) {
      return deepFreeze({ record, idempotent: true });
    }
    if (seen !== undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: 'this correlation/idempotency pair already produced a different command',
        details: { runKey },
      });
    }

    // One review per reviewer per offer (binding).
    const bindingKey = `${input.reviewer.tenant}:${input.reviewer.principalId}:${offer.offerId}`;
    const bound = this.reviewKeyToDigest.get(bindingKey);
    if (bound !== undefined) {
      if (bound === record.digest) {
        this.runKeys.set(runKey, record.digest);
        return deepFreeze({ record, idempotent: true });
      }
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.IDENTITY_CONFLICT, {
        message: 'this reviewer already reviewed this offer (reviews are single-shot, append-only)',
        details: { bindingKey },
      });
    }

    this.runKeys.set(runKey, record.digest);
    this.reviewKeyToDigest.set(bindingKey, record.digest);
    this.reviewLedger.push(record);
    this.reviewByDigest.set(record.digest, record);
    const existing = this.reviewsByOfferId.get(offer.offerId) ?? [];
    this.reviewsByOfferId.set(offer.offerId, [...existing, record]);
    return deepFreeze({ record, idempotent: false });
  }

  // -------------------------------------------------------------------------
  // Query dispatch (scope-checked first, fail closed)
  // -------------------------------------------------------------------------

  /** Dispatch one validated query payload (re-checked, scope-checked first). */
  async handleQueryRequest(payload: MarketplaceQueryRequest): Promise<MarketplaceQueryResponse> {
    if (!isMarketplaceQueryRequest(payload)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_QUERY, {
        message: 'marketplace query request payload is structurally invalid',
      });
    }
    const result = await this.dispatch(payload);
    return marketplaceQueryResponse(payload.kind, result);
  }

  private async dispatch(
    payload: MarketplaceQueryRequest,
  ): Promise<MarketplaceQueryResultValue> {
    const scope = payload.scope;
    switch (payload.kind) {
      case 'list-offers':
        return this.listOffers(payload.params as { artifactKind: string }, scope);
      case 'get-offer':
        return this.getOfferProfile(
          (payload.params as { offerId: string }).offerId,
          scope,
        );
      case 'resolve-offer-status':
        return this.resolveOfferStatus(
          (payload.params as { offerId: string }).offerId,
          scope,
        );
      case 'search-offers':
        return this.searchOffers(
          payload.params as { query: string; artifactKind: string },
          scope,
        );
      case 'list-reviews':
        return this.listReviews((payload.params as { offerId: string }).offerId, scope);
      case 'get-grant':
        return this.getGrantStatus((payload.params as { grantId: string }).grantId, scope);
      case 'list-grants':
        return this.listGrants((payload.params as { tenant: string }).tenant, scope);
    }
  }

  private listOffers(
    params: { artifactKind: string },
    scope: MarketplaceReadScope,
  ): readonly MarketplaceOfferSummary[] {
    return this.activeSummaries()
      .filter((summary) => params.artifactKind === 'all' || summary.artifactKind === params.artifactKind)
      .filter((summary) => visibleToScope(summary.tenant, summary.visibility, scope));
  }

  private searchOffers(
    params: { query: string; artifactKind: string },
    scope: MarketplaceReadScope,
  ): readonly MarketplaceOfferSummary[] {
    const needle = normalizeSearchQuery(params.query);
    return this.activeSummaries()
      .filter((summary) => params.artifactKind === 'all' || summary.artifactKind === params.artifactKind)
      .filter((summary) => visibleToScope(summary.tenant, summary.visibility, scope))
      .filter((summary) =>
        `${summary.title} ${summary.artifact.name}`.toLowerCase().includes(needle),
      );
  }

  private activeSummaries(): readonly MarketplaceOfferSummary[] {
    const summaries: MarketplaceOfferSummary[] = [];
    for (const record of this.offerLedger) {
      if (
        (record.kind === 'offer-registration' || record.kind === 'offer-supersession') &&
        !this.retiredOffers.has(record.digest) &&
        !this.supersededOffers.has(record.digest)
      ) {
        summaries.push(offerSummaryOf(record));
      }
    }
    return summaries;
  }

  private getOfferProfile(offerId: string, scope: MarketplaceReadScope): MarketplaceOfferProfile {
    const active = this.activeOfferByOfferId.get(offerId);
    if (active === undefined) {
      return deepFreeze({
        offerId,
        state: 'unknown' as const,
        offerDigest: null,
        registration: null,
        reviewCount: 0,
        averageRating: null,
      });
    }
    this.assertOfferVisible(active, scope);
    const reviews = this.reviewsByOfferId.get(offerId) ?? [];
    return deepFreeze({
      offerId,
      state: 'registered' as const,
      offerDigest: active.digest,
      registration: active,
      reviewCount: reviews.length,
      averageRating: averageRatingOf(reviews),
    });
  }

  private resolveOfferStatus(offerId: string, scope: MarketplaceReadScope): MarketplaceOfferStatus {
    const active = this.activeOfferByOfferId.get(offerId);
    if (active === undefined) {
      return deepFreeze({
        offerId,
        state: 'unknown' as const,
        visibility: 'unknown' as const,
        registration: null,
        offerDigest: null,
      });
    }
    this.assertOfferVisible(active, scope);
    return deepFreeze({
      offerId,
      state: 'registered' as const,
      visibility: active.visibility as MarketplaceVisibility,
      registration: active,
      offerDigest: active.digest,
    });
  }

  private listReviews(offerId: string, scope: MarketplaceReadScope): readonly MarketplaceReview[] {
    const active = this.activeOfferByOfferId.get(offerId);
    if (active === undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.NOT_FOUND, {
        message: `no active offer ${JSON.stringify(offerId)} to review-list`,
      });
    }
    this.assertOfferVisible(active, scope);
    return [...(this.reviewsByOfferId.get(offerId) ?? [])];
  }

  private getGrantStatus(grantId: string, scope: MarketplaceReadScope): MarketplaceGrantStatus {
    const issuance = this.grantIssuanceByGrantId.get(grantId);
    if (issuance === undefined) {
      return deepFreeze({ grantId, state: 'unknown' as const, grant: null });
    }
    const offer = this.offerByDigest.get(issuance.offer.offerDigest);
    const offerTenant = offer !== undefined ? offer.tenant : null;
    const readerOwns =
      issuance.granteeTenant === scope.tenant ||
      (offerTenant !== null && offerTenant === scope.tenant);
    if (!readerOwns) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `grant ${JSON.stringify(grantId)} belongs to another tenant — cross-tenant reads fail closed`,
        details: { grantId },
      });
    }
    const state: MarketplaceGrantState = this.revokedGrants.has(issuance.digest)
      ? 'revoked'
      : 'active';
    return deepFreeze({ grantId, state, grant: issuance });
  }

  private listGrants(tenant: string, scope: MarketplaceReadScope): readonly MarketplaceGrant[] {
    if (!isTenantAddressable(tenant, scope)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `grants of tenant ${JSON.stringify(tenant)} are not addressable from scope ${JSON.stringify(String(scope.tenant))}`,
        details: { tenant },
      });
    }
    return this.grantLedger.filter(
      (record) =>
        record.kind === 'grant-issuance' && record.granteeTenant === tenant,
    );
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private requireActiveOffer(offerId: string): MarketplaceOffer {
    const active = this.activeOfferByOfferId.get(offerId);
    if (active === undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.NOT_FOUND, {
        message: `no active offer registration for offerId ${JSON.stringify(offerId)}`,
      });
    }
    return active;
  }

  private requireOfferByDigest(digest: string): MarketplaceOffer {
    const record = this.offerByDigest.get(digest);
    if (record === undefined) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.NOT_FOUND, {
        message: 'offer registration digest is not in the ledger',
        details: { digest },
      });
    }
    return record;
  }

  private assertOfferVisible(offer: MarketplaceOffer, scope: MarketplaceReadScope): void {
    if (
      offer.visibility !== null &&
      offer.visibility !== 'public' &&
      offer.tenant !== scope.tenant
    ) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `offer ${JSON.stringify(offer.offerId)} belongs to another tenant — cross-tenant reads fail closed`,
        details: { offerId: offer.offerId },
      });
    }
  }

  /** The publisher's tenant must own the artifact namespace (or it is public). */
  private assertPublisherOwnsArtifact(record: MarketplaceOffer): void {
    if (record.artifact === null || record.publisher === null) return;
    const namespace = record.artifact.namespace;
    const publisherTenant = record.publisher.tenant;
    if (namespace !== 'public' && namespace !== publisherTenant) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.TENANT_FORBIDDEN, {
        message: 'a publisher may only list artifacts of its own tenant namespace (or the public namespace)',
        details: { namespace, publisherTenant },
      });
    }
  }
}

/** Construct a fresh, empty reference marketplace fabric. */
export function createMarketplaceArtifactsFabric(): MarketplaceArtifactsFabric {
  return new MarketplaceArtifactsFabric();
}

