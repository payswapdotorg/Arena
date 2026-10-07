/**
 * Reference fabric (Work Order C015) — in-memory implementations of the
 * service ports + STRUCTURAL-MIRROR adapters from the merged read
 * surfaces' record shapes into the @arena/capability-routing candidate
 * views. A service may not import another service (boundary rule B2):
 * the adapter input types below are plain-data structural mirrors of
 * the C014 CapabilityBodyListing and A032 MarketplaceOffer/Grant views
 * (byte-equal field names), documented here and recorded as an
 * architecture question in the PR — hosts wire the real read surfaces
 * through these ports.
 */

import type { CapabilityGraph } from '@arena/capability-graph';
import {
  createArtifactCandidate,
  createBodyCandidate,
  createToolCandidate,
} from '@arena/capability-routing';
import type {
  ArtifactCandidateView,
  BodyCandidateView,
  ExpertCandidateView,
  KnowledgeCandidateView,
  ResourceDecisionRecord,
  ToolCandidateView,
} from '@arena/capability-routing';
import type {
  ArtifactOfferCatalog,
  BodyListingCatalog,
  CapabilityGraphSource,
  Clock,
  ExpertCandidateDirectory,
  KnowledgeRecordCatalog,
  ResourceDecisionLog,
  ToolCandidateCatalog,
} from './ports.js';
import type { CapabilityRoutingJobRecord, CapabilityRoutingJobStore } from './jobs.js';

/** Fixed clock — deterministic drains/tests (rule 17: no wall clock). */
export class FixedClock implements Clock {
  private current: number;
  constructor(start: number) {
    this.current = start;
  }
  now(): number {
    return this.current;
  }
  advance(to: number): void {
    this.current = Math.max(this.current, to);
  }
}

/** Static graph source. */
export class StaticGraphSource implements CapabilityGraphSource {
  constructor(private readonly graph: CapabilityGraph) {}
  load(): Promise<CapabilityGraph> {
    return Promise.resolve(this.graph);
  }
}

/** In-memory expert directory (tenant-scoped listing). */
export class InMemoryExpertCandidateDirectory implements ExpertCandidateDirectory {
  constructor(private readonly experts: readonly ExpertCandidateView[]) {}
  async listExpertCandidates(tenantId: string): Promise<readonly ExpertCandidateView[]> {
    return this.experts.filter(
      (candidate) => candidate.candidate.tenant === tenantId || candidate.candidate.tenant === 'public',
    );
  }
}

/** In-memory body listing catalog. */
export class InMemoryBodyListingCatalog implements BodyListingCatalog {
  constructor(private readonly bodies: readonly BodyCandidateView[]) {}
  async listBodyCandidates(tenantId: string): Promise<readonly BodyCandidateView[]> {
    return this.bodies.filter(
      (candidate) => candidate.tenantId === tenantId || candidate.tenantId === 'public',
    );
  }
}

/** In-memory tool candidate catalog. */
export class InMemoryToolCandidateCatalog implements ToolCandidateCatalog {
  constructor(private readonly tools: readonly ToolCandidateView[]) {}
  async listToolCandidates(tenantId: string): Promise<readonly ToolCandidateView[]> {
    return this.tools.filter(
      (candidate) => candidate.tenantId === tenantId || candidate.tenantId === 'public',
    );
  }
}

/** In-memory knowledge record catalog. */
export class InMemoryKnowledgeRecordCatalog implements KnowledgeRecordCatalog {
  constructor(private readonly knowledge: readonly KnowledgeCandidateView[]) {}
  async listKnowledgeCandidates(tenantId: string): Promise<readonly KnowledgeCandidateView[]> {
    return this.knowledge.filter(
      (candidate) => candidate.tenantId === tenantId || candidate.tenantId === 'public',
    );
  }
}

/** In-memory artifact offer catalog. */
export class InMemoryArtifactOfferCatalog implements ArtifactOfferCatalog {
  constructor(private readonly artifacts: readonly ArtifactCandidateView[]) {}
  async listArtifactCandidates(tenantId: string): Promise<readonly ArtifactCandidateView[]> {
    return this.artifacts.filter(
      (candidate) => candidate.visibility === 'public' || candidate.tenantId === tenantId,
    );
  }
}

/** In-memory append-only decision log (throws on duplicate digest). */
export class InMemoryResourceDecisionLog implements ResourceDecisionLog {
  private readonly byDemand = new Map<string, ResourceDecisionRecord[]>();
  private readonly digests = new Set<string>();
  async append(record: ResourceDecisionRecord): Promise<void> {
    if (this.digests.has(record.digest)) {
      throw new Error(`duplicate decision record digest: ${record.digest}`);
    }
    this.digests.add(record.digest);
    const key = `${record.tenantId}/${record.demandId}`;
    this.byDemand.set(key, [...(this.byDemand.get(key) ?? []), record]);
  }
  async list(demandId: string, tenantId: string): Promise<readonly ResourceDecisionRecord[]> {
    return [...(this.byDemand.get(`${tenantId}/${demandId}`) ?? [])];
  }
}

/** In-memory job store (insert / find / list / update). */
export class InMemoryCapabilityRoutingJobStore implements CapabilityRoutingJobStore {
  private readonly jobs: CapabilityRoutingJobRecord[] = [];
  private readonly keys = new Set<string>();
  async insert(job: CapabilityRoutingJobRecord): Promise<void> {
    if (this.keys.has(job.submissionKey)) {
      throw new Error(`duplicate job submission key: ${job.submissionKey}`);
    }
    this.keys.add(job.submissionKey);
    this.jobs.push(job);
  }
  async findBySubmissionKey(
    submissionKey: string,
  ): Promise<CapabilityRoutingJobRecord | undefined> {
    return this.jobs.find((job) => job.submissionKey === submissionKey);
  }
  async list(): Promise<readonly CapabilityRoutingJobRecord[]> {
    return [...this.jobs];
  }
  async update(job: CapabilityRoutingJobRecord): Promise<void> {
    const index = this.jobs.findIndex((entry) => entry.submissionKey === job.submissionKey);
    if (index === -1) throw new Error(`unknown job submission key: ${job.submissionKey}`);
    this.jobs[index] = job;
  }
}

// ---------------------------------------------------------------------------
// Structural-mirror adapters (plain data in → validated candidate views)
// ---------------------------------------------------------------------------

/** A structural mirror of C014's CapabilityBodyListing (plain data). */
export interface CapabilityBodyListingMirror {
  readonly listingId: string;
  readonly tenantId: string;
  readonly releaseDigest: string;
  readonly bodyVersionRef: {
    readonly tenant: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly capabilityEvidenceRefs: readonly string[];
  readonly certificationRefs: readonly string[];
  readonly substrateCompatibility: Readonly<Record<string, unknown>> | null;
  readonly pricing: { readonly amountMinorUnits: number; readonly currency: string; readonly model: string } | null;
  readonly state: string;
}

/** A structural mirror of A032's MarketplaceOfferView (plain data). */
export interface MarketplaceOfferMirror {
  readonly offerId: string;
  readonly artifactKind: string;
  /** The projected offer state (registered / superseded / retired / unknown). */
  readonly state: string;
  readonly tenant: string | null;
  readonly visibility: string | null;
  readonly title: string | null;
}

/** A structural mirror of A032's grant/entitlement projection (plain data). */
export interface MarketplaceEntitlementMirror {
  readonly offerId: string;
  readonly state: string;
}

/** A structural mirror of a C008 tool-gap tool specification (plain data). */
export interface ToolSpecificationMirror {
  readonly toolId: string;
  readonly tenantId: string;
  readonly operations: readonly string[];
  readonly availability: string;
  readonly sourceToolGapSignalId: string | null;
}

/**
 * Adapt one C014-shaped listing record into a routing candidate view.
 * The substrate compatibility record is projected onto the typed
 * { substrateId, environmentIds } view (unknown shapes → null — the
 * engine treats a null compatibility as incompatible-substrate when the
 * demand constrains the substrate: fail-closed, never guessed).
 */
export function bodyCandidateFromListing(
  listing: CapabilityBodyListingMirror,
): BodyCandidateView {
  const compatibility = listing.substrateCompatibility;
  const substrateId =
    compatibility !== null && typeof compatibility['substrateId'] === 'string'
      ? (compatibility['substrateId'] as string)
      : null;
  const environments =
    compatibility !== null && Array.isArray(compatibility['environmentIds'])
      ? (compatibility['environmentIds'] as unknown[]).filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [];
  return createBodyCandidate({
    listingId: listing.listingId,
    tenantId: listing.tenantId,
    bodyVersionRef: {
      name: listing.bodyVersionRef.name,
      version: listing.bodyVersionRef.version,
      digest: listing.bodyVersionRef.digest,
    },
    capabilityEvidenceRefs: listing.capabilityEvidenceRefs,
    certificationRecordDigests: listing.certificationRefs,
    substrateCompatibility:
      substrateId !== null ? { substrateId, environmentIds: environments } : null,
    pricing: listing.pricing === null ? null : {
      amountMinorUnits: listing.pricing.amountMinorUnits,
      currency: listing.pricing.currency,
    },
    state: listing.state,
  });
}

/**
 * Adapt one A032-shaped offer record (+ entitlement projection) into a
 * routing candidate view. Unknown/absent states map to the fail-closed
 * defaults ('unknown' offer state ⇒ delisted; absent grant ⇒ 'none').
 */
export function artifactCandidateFromOffer(
  offer: MarketplaceOfferMirror,
  entitlement: MarketplaceEntitlementMirror | null,
  price: { readonly amountMinorUnits: number; readonly currency: string } | null,
): ArtifactCandidateView {
  return createArtifactCandidate({
    offerId: offer.offerId,
    tenantId: offer.tenant ?? 'public',
    artifactKind: offer.artifactKind,
    state: offer.state,
    visibility: offer.visibility ?? 'public',
    entitlementState: entitlement?.state ?? 'none',
    price,
  });
}

/** Adapt one C008-shaped tool specification into a routing candidate view. */
export function toolCandidateFromSpecification(
  specification: ToolSpecificationMirror,
): ToolCandidateView {
  return createToolCandidate({
    toolId: specification.toolId,
    tenantId: specification.tenantId,
    operations: specification.operations,
    availability: specification.availability,
    sourceToolGapSignalId: specification.sourceToolGapSignalId,
  });
}
