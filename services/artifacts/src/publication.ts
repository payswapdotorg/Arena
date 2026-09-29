/**
 * PublicationService (Work Order A014) — the A002 PublicationLedger
 * semantics wrapped as service operations (requirements R23, R24;
 * architecture-lock rules 6, 12).
 *
 * Wraps the REUSED @arena/artifact-protocol publication machinery —
 * publishArtifact (explicit, immutable publication records),
 * retractPublication (appends a NEW record whose supersedes field carries
 * the original record digest) and appendPublicationRecord / resolvePublication
 * (append-only ledger + private-by-default visibility) — and adds the A014
 * service semantics:
 *
 *   - publish(artifact, publisher, rights) — the artifact must ALREADY be
 *     ingested in the ArtifactStore (you publish what the service holds);
 *     the read happens THROUGH the store under the publisher's tenant
 *     scope, so cross-tenant publication attempts fail closed with
 *     ARTIFACTS_TENANT_FORBIDDEN and tampered artifacts fail closed at the
 *     store's on-read verification. Publishing NEVER silently changes
 *     tenant visibility: the artifact's namespace is untouched; only the
 *     ledger records the explicit, immutable publication.
 *   - retract(publication, publisher) — appends a NEW retraction record
 *     (the original publication record is never edited); only publish
 *     records can be retracted, only once (A002 invariants).
 *   - status(identity) — the artifact's visibility: private by default,
 *     public exactly while an un-superseded publish record exists.
 *   - listPublic(scope) — the actively-published records, optionally
 *     filtered by artifact namespace.
 *   - listPrivate(caller, scope) — the STORED artifacts of a namespace
 *     that have NO active publication (the tenant's own private view;
 *     cross-tenant private listing is rejected).
 *   - ledger() — the frozen, append-only ledger projection.
 */

import {
  EMPTY_PUBLICATION_LEDGER,
  appendPublicationRecord,
  publicationRecordDigest,
  publishArtifact,
  resolvePublication,
  retractPublication,
  toPrincipalRef,
} from '@arena/artifact-protocol';
import type {
  MaterialArtifact,
  PrincipalRef,
  PublicationLedger,
  PublicationRecord,
  PublicationStatus,
} from '@arena/artifact-protocol';
import { ARTIFACTS_ERROR_CODES, ArtifactsError } from './errors.js';
import type { ArtifactStore, StoreCallerInput } from './store.js';

function toCaller(caller: StoreCallerInput): PrincipalRef {
  return toPrincipalRef(caller);
}

/** Scope filter for listings: all namespaces, or one namespace. */
export interface PublicationScope {
  readonly namespace?: string;
}

/** The result of a publish operation. */
export interface PublishResult {
  readonly record: PublicationRecord;
  /** True when the identical publication was already active (idempotent). */
  readonly idempotent: boolean;
  readonly ledger: PublicationLedger;
}

/** The result of a retract operation. */
export interface RetractResult {
  readonly record: PublicationRecord;
  readonly ledger: PublicationLedger;
}

/**
 * The publication service: wraps one append-only PublicationLedger over
 * one ArtifactStore. Construct with `new PublicationService(store)`.
 */
export class PublicationService {
  private readonly store: ArtifactStore;
  private publicationLedger: PublicationLedger = EMPTY_PUBLICATION_LEDGER;

  constructor(store: ArtifactStore) {
    this.store = store;
  }

  /**
   * Publish an artifact: an explicit, immutable publication record.
   * Requires the artifact to be ingested in the store (read through the
   * store under the publisher's tenant scope — cross-tenant publication
   * is rejected; content verification happens on that read). The record
   * is appended to the ledger (idempotent for the bit-identical record).
   * Publication NEVER silently changes tenant visibility: the artifact
   * stays in its namespace; only the ledger grows.
   */
  async publish(
    artifact: MaterialArtifact<unknown>,
    publisher: StoreCallerInput,
    rights: unknown,
    options: { readonly publishedAt?: string } = {},
  ): Promise<PublishResult> {
    const principal = toCaller(publisher);
    // Cross-tenant publish is rejected by the store read guard; the read
    // also re-verifies content (tamper fails closed before a record is
    // ever created).
    await this.store.getByIdentity(artifact.identity, principal);

    const record = await publishArtifact({
      artifact,
      publisher: principal,
      rights,
      ...(options.publishedAt !== undefined ? { publishedAt: options.publishedAt } : {}),
    });
    const before = this.publicationLedger;
    const after = await appendPublicationRecord(this.publicationLedger, record);
    const idempotent = before === after;
    this.publicationLedger = after;
    return { record, idempotent, ledger: after };
  }

  /**
   * Retract a publication: appends a NEW record (action `retract`) whose
   * supersedes field carries the original publication record digest. The
   * original record is never edited; a publication can be retracted once.
   */
  async retract(
    publication: PublicationRecord,
    publisher: StoreCallerInput,
    options: { readonly retractedAt?: string } = {},
  ): Promise<RetractResult> {
    const principal = toCaller(publisher);
    if (
      publication.artifact.namespace !== principal.tenant &&
      publication.artifact.namespace !== 'public'
    ) {
      throw new ArtifactsError(ARTIFACTS_ERROR_CODES.TENANT_FORBIDDEN, {
        message: `caller tenant ${principal.tenant} cannot retract a publication of namespace ${publication.artifact.namespace}`,
        details: { callerTenant: principal.tenant, namespace: publication.artifact.namespace },
      });
    }
    const record = await retractPublication({
      publication,
      publisher: principal,
      ...(options.retractedAt !== undefined ? { retractedAt: options.retractedAt } : {}),
    });
    this.publicationLedger = await appendPublicationRecord(this.publicationLedger, record);
    return { record, ledger: this.publicationLedger };
  }

  /**
   * The visibility of an artifact identity: PRIVATE by default (lock rule
   * 12); public exactly while an un-superseded publish record exists.
   */
  async status(identity: {
    namespace: string;
    name: string;
    version: string;
  }): Promise<PublicationStatus> {
    return resolvePublication(this.publicationLedger, identity);
  }

  /**
   * The actively-published records (public visibility), optionally
   * filtered by artifact namespace scope. Public listings are open: the
   * publication ledger is the public surface.
   */
  async listPublic(scope: PublicationScope = {}): Promise<readonly PublicationRecord[]> {
    const identityKeys = new Set<string>();
    for (const record of this.publicationLedger.records) {
      if (record.action !== 'publish') continue;
      if (scope.namespace !== undefined && record.artifact.namespace !== scope.namespace) {
        continue;
      }
      identityKeys.add(
        `${record.artifact.namespace}/${record.artifact.name}@${record.artifact.version}`,
      );
    }
    const active: PublicationRecord[] = [];
    for (const key of [...identityKeys].sort()) {
      const [namespace, rest] = splitIdentityKey(key);
      const status = await resolvePublication(this.publicationLedger, {
        namespace,
        name: rest.name,
        version: rest.version,
      });
      if (status.visibility === 'public') active.push(status.publication);
    }
    return Object.freeze(active);
  }

  /**
   * The PRIVATE artifacts of a namespace: stored artifacts with NO active
   * publication. This is the tenant's own view — the caller's tenant must
   * be the namespace (or the reserved `public` namespace); cross-tenant
   * private listing is rejected.
   */
  async listPrivate(
    caller: StoreCallerInput,
    scope: PublicationScope = {},
  ): Promise<readonly MaterialArtifact<unknown>[]> {
    const principal = toCaller(caller);
    const namespace = scope.namespace ?? principal.tenant;
    if (namespace !== principal.tenant && namespace !== 'public') {
      throw new ArtifactsError(ARTIFACTS_ERROR_CODES.TENANT_FORBIDDEN, {
        message: `caller tenant ${principal.tenant} cannot list private artifacts of namespace ${namespace}`,
        details: { callerTenant: principal.tenant, namespace },
      });
    }
    const stored = await this.store.listByNamespace(namespace, principal);
    const privateArtifacts: MaterialArtifact<unknown>[] = [];
    for (const artifact of stored) {
      const status = await resolvePublication(this.publicationLedger, artifact.identity);
      if (status.visibility === 'private') privateArtifacts.push(artifact);
    }
    return Object.freeze(privateArtifacts);
  }

  /** The digest of one publication record (A002 content addressing). */
  async recordDigest(record: PublicationRecord): Promise<string> {
    return publicationRecordDigest(record);
  }

  /** The frozen, append-only ledger projection (insertion order). */
  ledger(): PublicationLedger {
    return this.publicationLedger;
  }
}

function splitIdentityKey(
  key: string,
): [string, { name: string; version: string }] {
  const slash = key.indexOf('/');
  const at = key.indexOf('@');
  return [
    key.slice(0, slash),
    { name: key.slice(slash + 1, at), version: key.slice(at + 1) },
  ];
}
