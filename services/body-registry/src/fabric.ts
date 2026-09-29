/**
 * BodyRegistryService — the in-process reference BODY REGISTRY FABRIC
 * (Work Order A024; the RELEASE stage; architecture-lock rules 5, 6,
 * 12, 16, 17, 18, 23).
 *
 * Pure reference fabric, mirroring the sibling fabrics (A021
 * ForgeService, A023 CertificationFabric): INJECTED evidence stores
 * (fail-closed, no network, no database), digest-addressed append-only
 * ledgers, deterministic idempotent replay.
 *
 * `register(candidate, options)` is PURE ORCHESTRATION:
 *   1. evaluate the RELEASE ADMISSION GATE against the injected
 *      evidence stores — a rejected candidate throws
 *      BODY_REGISTRY_REGISTRATION_REJECTED with the structured,
 *      closed-vocabulary rejections in `details` (never admitted
 *      partially, never a rubber stamp);
 *   2. idempotency (lock rule 17): the same idempotency key + the same
 *      candidate tuple REPLAYS the stored record byte-identically; the
 *      same key + a different tuple is an IDEMPOTENCY_CONFLICT;
 *   3. release identity immutability (A002 publication law): a release
 *      identity (namespace/name@version) already bound to a digest can
 *      never be re-bound to different content — IDENTITY_CONFLICT;
 *   4. the registration record is created through the package's
 *      deterministic constructor, tamper-verified, and appended to the
 *      digest-addressed, append-only ledger (record-once semantics for
 *      byte-identical records).
 *
 * `supersede` / `retire` append lineage records (never mutations); the
 * ledger PROJECTS the effective state (registered → superseded /
 * retired). `publish` / `retract` drive the release publication ledger
 * (idempotent, reproducible; see @arena/body-registry publication.ts).
 */

import {
  BODY_REGISTRY_ERROR_CODES,
  BodyRegistryError,
  appendReleasePublication,
  createReleaseRegistrationRecord,
  createReleaseRetirementRecord,
  createReleaseSupersessionRecord,
  evaluateReleaseGate,
  isBodyRegistryError,
  isReleaseRecord,
  publishRelease,
  releaseArtifactIdentityKey,
  resolveReleasePublication,
  retractRelease,
  verifyReleaseRecord,
} from '@arena/body-registry';
import type {
  ReleaseCandidateInput,
  ReleaseEvidenceStores,
  ReleasePublicationLedger,
  ReleasePublicationRecord,
  ReleaseRecord,
  ReleaseVisibility,
} from '@arena/body-registry';
import { isCorrelationId, isIdempotencyKey } from '@arena/protocol-core';
import type { IdempotencyKey } from '@arena/protocol-core';
import type { PrincipalRefView, RightsMetadataView } from '@arena/agent-body';

// ---------------------------------------------------------------------------
// Configuration + options
// ---------------------------------------------------------------------------

/** Service configuration (all injected). */
export interface BodyRegistryConfig {
  /** The digest-addressed evidence stores the gate resolves against. */
  readonly stores: ReleaseEvidenceStores;
}

export interface RegisterOptions {
  readonly correlationId: string;
  /** REQUIRED idempotency key — the registration address (lock rule 17). */
  readonly idempotencyKey: string;
  /** The release version assigned to this release. */
  readonly releaseVersion: string;
  /** Immutable release tags. */
  readonly tags?: readonly string[];
  readonly tenantId?: string | null;
  readonly workspaceId?: string | null;
  /** The release timestamp (caller-supplied; no hidden clock reads). */
  readonly recordedAt: string;
  readonly provenance: {
    readonly releasedBy: string;
    readonly notes: string | null;
  };
}

export interface LineageOptions {
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly grounds: string;
  readonly tenantId?: string | null;
  readonly workspaceId?: string | null;
  readonly recordedAt: string;
  readonly provenance: {
    readonly releasedBy: string;
    readonly notes: string | null;
  };
}

export interface PublishOptions {
  readonly publisher: PrincipalRefView | { type: string; tenant: string; principalId: string };
  /** MANDATORY rights metadata (lock rule 23). */
  readonly rights: RightsMetadataView | unknown;
  /** The publication timestamp (caller-supplied; reproducible). */
  readonly publishedAt: string;
}

export interface RetractOptions {
  readonly publisher: PrincipalRefView | { type: string; tenant: string; principalId: string };
  readonly retractedAt: string;
}

/** The projected lifecycle state of one registration record. */
export type ReleaseLifecycleState = 'registered' | 'superseded' | 'retired' | 'unknown';

/** The projected status of one release identity. */
export interface ReleaseStatus {
  readonly state: ReleaseLifecycleState;
  readonly visibility: ReleaseVisibility;
  readonly registration: ReleaseRecord | null;
  readonly publication: ReleasePublicationRecord | null;
}

// ---------------------------------------------------------------------------
// The fabric
// ---------------------------------------------------------------------------

interface IdempotencyBinding {
  readonly commandCanonical: string;
  readonly recordDigest: string;
}

function commandCanonicalOf(candidate: ReleaseCandidateInput, options: RegisterOptions): string {
  return JSON.stringify([
    candidate.bodyVersionRef,
    candidate.channel,
    options.releaseVersion,
    candidate.certificationRefs,
    candidate.compatibilityRefs,
    candidate.forgeRecordDigest ?? null,
  ]);
}

/** The in-process reference body-registry fabric. */
export class BodyRegistryService {
  /** ReleaseRecords by digest — the append-only, content-addressed ledger. */
  private readonly recordsByDigest = new Map<string, ReleaseRecord>();
  /** records in append order. */
  private readonly ledger: ReleaseRecord[] = [];
  /** idempotency key → the registration it authorized. */
  private readonly idempotency: Map<string, IdempotencyBinding> = new Map();
  /** release identity (ns/name@version) → bound digest (immutability law). */
  private readonly identityBindings = new Map<string, string>();
  /** The stored registration results by idempotency key (replay). */
  private readonly registrationsByKey = new Map<string, ReleaseRecord>();
  /** The publication ledger (append-only, idempotent). */
  private publicationLedger: ReleasePublicationLedger = { records: [] };
  /** Publication records by digest. */
  private readonly publicationsByDigest = new Map<string, ReleasePublicationRecord>();

  readonly stores: ReleaseEvidenceStores;

  constructor(config: BodyRegistryConfig) {
    this.stores = config.stores;
  }

  // -------------------------------------------------------------------------
  // Registration (gate → idempotency → identity binding → append)
  // -------------------------------------------------------------------------

  /**
   * Register one release candidate: gate → record. A gate rejection
   * throws BODY_REGISTRY_REGISTRATION_REJECTED carrying the structured
   * rejections in `details` (fail-closed; never a rubber stamp).
   * Deterministic replay: same key + same tuple ⇒ the stored record.
   */
  async register(
    candidate: ReleaseCandidateInput,
    options: RegisterOptions,
  ): Promise<ReleaseRecord> {
    if (!isCorrelationId(options.correlationId)) {
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_IDENTITY, {
        message: `register requires a valid correlation id: ${JSON.stringify(options.correlationId)}`,
      });
    }
    if (!isIdempotencyKey(options.idempotencyKey)) {
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_IDENTITY, {
        message: `register requires a valid idempotency key (lock rule 17): ${JSON.stringify(options.idempotencyKey)}`,
      });
    }

    const command = commandCanonicalOf(candidate, options);
    const binding = this.idempotency.get(options.idempotencyKey);
    if (binding !== undefined) {
      if (binding.commandCanonical !== command) {
        throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${JSON.stringify(options.idempotencyKey)} is already bound to a different registration (same key + different candidate/options is a conflict, not a rerun)`,
          details: {
            idempotencyKey: options.idempotencyKey,
            bound: binding.commandCanonical,
            attempted: command,
          },
        });
      }
      const stored = this.registrationsByKey.get(options.idempotencyKey);
      if (stored !== undefined) return stored;
    }

    // --- the gate (fail-closed; structured rejections on refusal) -------
    const verdict = await evaluateReleaseGate(candidate, this.stores);
    if (!verdict.admitted) {
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.REGISTRATION_REJECTED, {
        message: `release registration REJECTED by the admission gate (${verdict.rejections.length} structured rejection${verdict.rejections.length === 1 ? '' : 's'})`,
        details: {
          admitted: false,
          rejections: verdict.rejections.map((rejection) => ({ ...rejection })),
        },
      });
    }

    // --- release identity immutability (A002 publication law) -----------
    const identityKey = `${verdict.evidence!.bodyVersionRef.tenant}/${verdict.evidence!.bodyVersionRef.name}@${options.releaseVersion}`;
    const bound = this.identityBindings.get(identityKey);
    if (bound !== undefined && bound !== verdict.evidence!.bodyVersionRef.digest) {
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `release identity ${identityKey} is already bound to digest ${bound}; registering a different digest for the same identity is forbidden (releases are immutable)`,
        details: { identity: identityKey, bound, attempted: verdict.evidence!.bodyVersionRef.digest },
      });
    }

    const record = await createReleaseRegistrationRecord({
      bodyVersionRef: {
        tenant: verdict.evidence!.bodyVersionRef.tenant,
        name: verdict.evidence!.bodyVersionRef.name,
        version: verdict.evidence!.bodyVersionRef.version,
        digest: verdict.evidence!.bodyVersionRef.digest,
      },
      releaseVersion: options.releaseVersion,
      gate: verdict.evidence!,
      ...(options.tags !== undefined ? { tags: options.tags } : {}),
      releasedAt: options.recordedAt,
      correlationId: options.correlationId,
      idempotencyKey: options.idempotencyKey,
      ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : { tenantId: null }),
      ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : { workspaceId: null }),
      provenance: {
        releasedBy: options.provenance.releasedBy,
        recordedAt: options.recordedAt,
        notes: options.provenance.notes,
      },
    });
    await verifyReleaseRecord(record); // belt and braces

    // Append (record-once semantics for byte-identical records).
    const existing = this.recordsByDigest.get(record.digest);
    if (existing === undefined) {
      this.recordsByDigest.set(record.digest, record);
      this.ledger.push(record);
      this.identityBindings.set(identityKey, record.release!.digest);
    }
    this.idempotency.set(options.idempotencyKey, {
      commandCanonical: command,
      recordDigest: record.digest,
    });
    this.registrationsByKey.set(options.idempotencyKey, record);
    return record;
  }

  // -------------------------------------------------------------------------
  // Supersession / retirement (append-only lineage)
  // -------------------------------------------------------------------------

  /** Append a SUPERSESSION record ending the active registration `target`. */
  async supersede(target: string, options: LineageOptions): Promise<ReleaseRecord> {
    return this.appendLineage('supersede', target, options);
  }

  /** Append a RETIREMENT record ending the active registration `target`. */
  async retire(target: string, options: LineageOptions): Promise<ReleaseRecord> {
    return this.appendLineage('retire', target, options);
  }

  private async appendLineage(
    action: 'supersede' | 'retire',
    target: string,
    options: LineageOptions,
  ): Promise<ReleaseRecord> {
    const registration = this.recordsByDigest.get(target);
    if (registration === undefined) {
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.NOT_FOUND, {
        message: `${action}: unknown release record digest ${JSON.stringify(target)}`,
        details: { target },
      });
    }
    if (registration.kind !== 'release-registration') {
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.LINEAGE_VIOLATION, {
        message: `${action}: target ${target} is a '${registration.kind}' record — only registration records can be superseded or retired`,
        details: { target, kind: registration.kind },
      });
    }
    const state = this.projectLifecycle(target);
    if (state !== 'registered') {
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.LINEAGE_VIOLATION, {
        message: `${action}: release ${target} is already ${state} (append-only history: a lifecycle terminal state is never rewritten)`,
        details: { target, state },
      });
    }
    const record =
      action === 'supersede'
        ? await createReleaseSupersessionRecord({
            target,
            grounds: options.grounds,
            correlationId: options.correlationId,
            idempotencyKey: options.idempotencyKey,
            ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : { tenantId: null }),
            ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : { workspaceId: null }),
            provenance: {
              releasedBy: options.provenance.releasedBy,
              recordedAt: options.recordedAt,
              notes: options.provenance.notes,
            },
          })
        : await createReleaseRetirementRecord({
            target,
            grounds: options.grounds,
            correlationId: options.correlationId,
            idempotencyKey: options.idempotencyKey,
            ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : { tenantId: null }),
            ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : { workspaceId: null }),
            provenance: {
              releasedBy: options.provenance.releasedBy,
              recordedAt: options.recordedAt,
              notes: options.provenance.notes,
            },
          });
    const existing = this.recordsByDigest.get(record.digest);
    if (existing === undefined) {
      this.recordsByDigest.set(record.digest, record);
      this.ledger.push(record);
    }
    return record;
  }

  // -------------------------------------------------------------------------
  // Publication (idempotent, reproducible)
  // -------------------------------------------------------------------------

  /** Publish one registered release (idempotent: identical publication replays). */
  async publish(target: string, options: PublishOptions): Promise<ReleasePublicationRecord> {
    const registration = this.recordsByDigest.get(target);
    if (registration === undefined) {
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.NOT_FOUND, {
        message: `publish: unknown release record digest ${JSON.stringify(target)}`,
        details: { target },
      });
    }
    if (!isReleaseRecord(registration)) {
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_RECORD, {
        message: 'publish: the stored registration failed structural validation',
      });
    }
    const publication = await publishRelease({
      registration,
      publisher: options.publisher,
      rights: options.rights,
      publishedAt: options.publishedAt,
    });
    this.publicationLedger = await appendReleasePublication(this.publicationLedger, publication);
    for (const record of this.publicationLedger.records) {
      this.publicationsByDigest.set(record.digest, record);
    }
    return publication;
  }

  /** Retract one active publication (append-only; never mutates the original). */
  async retract(publicationDigest: string, options: RetractOptions): Promise<ReleasePublicationRecord> {
    const publication = this.publicationsByDigest.get(publicationDigest);
    if (publication === undefined) {
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.NOT_FOUND, {
        message: `retract: unknown publication record digest ${JSON.stringify(publicationDigest)}`,
        details: { publicationDigest },
      });
    }
    const retraction = await retractRelease({
      publication,
      publisher: options.publisher,
      retractedAt: options.retractedAt,
    });
    this.publicationLedger = await appendReleasePublication(this.publicationLedger, retraction);
    for (const record of this.publicationLedger.records) {
      this.publicationsByDigest.set(record.digest, record);
    }
    return retraction;
  }

  // -------------------------------------------------------------------------
  // Projections (pure queries)
  // -------------------------------------------------------------------------

  /** Look up a release record by digest. */
  getRecord(digest: string): ReleaseRecord | undefined {
    return this.recordsByDigest.get(digest);
  }

  /** The full record ledger in append order (observability dump). */
  listRecords(): readonly ReleaseRecord[] {
    return [...this.ledger];
  }

  /** Registration records for one body (tenant/name), in append order. */
  listRegistrations(tenant: string, name: string): readonly ReleaseRecord[] {
    return this.ledger.filter(
      (record) =>
        record.kind === 'release-registration' &&
        record.bodyVersionRef !== null &&
        record.bodyVersionRef.tenant === tenant &&
        record.bodyVersionRef.name === name,
    );
  }

  /** The latest ACTIVE (not superseded, not retired) registration for a body + channel. */
  resolveActiveRelease(tenant: string, name: string, channel: string): ReleaseRecord | null {
    const candidates = this.listRegistrations(tenant, name).filter(
      (record) => record.channel === channel,
    );
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const record = candidates[i];
      if (record !== undefined && this.projectLifecycle(record.digest) === 'registered') {
        return record;
      }
    }
    return null;
  }

  /** Project the lifecycle state of one registration record. */
  projectLifecycle(digest: string): ReleaseLifecycleState {
    const record = this.recordsByDigest.get(digest);
    if (record === undefined) return 'unknown';
    if (record.kind !== 'release-registration') return 'unknown';
    let state: ReleaseLifecycleState = 'registered';
    for (const entry of this.ledger) {
      if (entry.kind === 'release-supersession' && entry.supersedes === digest) {
        state = 'superseded';
      }
      if (entry.kind === 'release-retirement' && entry.retires === digest) {
        state = 'retired';
      }
    }
    return state;
  }

  /** The publication ledger (append-only history). */
  getPublicationLedger(): ReleasePublicationLedger {
    return this.publicationLedger;
  }

  /** Resolve the FULL status of one release identity: lifecycle + visibility. */
  resolveReleaseStatus(release: {
    namespace: string;
    name: string;
    version: string;
  }): ReleaseStatus {
    const identityKey = releaseArtifactIdentityKey(release);
    const registration =
      [...this.ledger].reverse().find(
        (record) =>
          record.kind === 'release-registration' &&
          record.release !== null &&
          releaseArtifactIdentityKey(record.release) === identityKey,
      ) ?? null;
    if (registration === null) {
      return { state: 'unknown', visibility: 'unpublished', registration: null, publication: null };
    }
    const state = this.projectLifecycle(registration.digest);
    const publicationStatus = resolveReleasePublication(this.publicationLedger, release);
    return {
      state,
      visibility: publicationStatus.visibility,
      registration,
      publication:
        publicationStatus.visibility === 'published' ? publicationStatus.publication : null,
    };
  }

  /** Find a publication record by its digest. */
  getPublication(digest: string): ReleasePublicationRecord | undefined {
    return this.publicationsByDigest.get(digest);
  }
}

/** Normalize any thrown value into a BodyRegistryError (fail-closed wiring). */
export function ensureBodyRegistryError(error: unknown): BodyRegistryError {
  if (isBodyRegistryError(error)) return error;
  return new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.UNKNOWN_ERROR, {
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

export type { IdempotencyKey };
