/**
 * ArtifactStore (Work Order A014) — the in-process REFERENCE STORE for
 * Arena material artifacts (requirements R14, R24; architecture-lock rules
 * 5, 6, 11, 12, 18).
 *
 * Pure TypeScript, ZERO external runtime dependencies (only
 * @arena/protocol-core + @arena/artifact-protocol). Storage is neutral by
 * construction: everything lives in Maps inside this object — durable
 * persistence and object storage are deployment-tier concerns and are
 * deliberately NOT modeled here (the A002 protocol is storage-neutral;
 * this reference store demonstrates the protocol boundary, exactly like
 * the A011 trajectory store).
 *
 *   - put(artifact, caller) — PUT by artifact digest + identity. The store
 *     NEVER trusts caller-side digests: put verifies the artifact content
 *     through the REUSED A002 verifyArtifact before indexing (fail closed
 *     with ARTIFACT_TAMPERED). Identity↔digest binding is PERMANENT: a
 *     second artifact under an already-bound identity+version with a
 *     DIFFERENT digest is REJECTED with ARTIFACT_IDENTITY_CONFLICT — never
 *     overwritten; putting the bit-identical artifact is idempotent. The
 *     caller's tenant must be the artifact's namespace (or the reserved
 *     `public` namespace) — no cross-tenant ingest.
 *   - getByDigest / getByIdentity — GET by artifact digest + identity.
 *     Tenant-scope isolation: cross-tenant reads are REJECTED with
 *     ARTIFACTS_TENANT_FORBIDDEN (a caller may read its own namespace or
 *     the reserved `public` namespace, nothing else). Content verification
 *     happens ON READ: every get re-verifies the artifact digest and fails
 *     closed with ARTIFACT_TAMPERED (defense in depth — an in-process
 *     adversary who corrupts a stored entry is detected at read time).
 *   - resolverFor(caller) — an A002 ArtifactResolver bound to the caller's
 *     read scope (used by verifyArtifactTree, dataset bundle resolution
 *     and lineage validation).
 *   - NO update/delete APIs — artifacts are immutable; there is no
 *     mutation surface (negative tests assert both the frozen objects and
 *     the absence of any mutation method).
 */

import {
  ARTIFACTS_ERROR_CODES,
  ArtifactsError,
} from './errors.js';
import {
  ARTIFACT_ERROR_CODES,
  ArtifactError,
  PUBLIC_NAMESPACE,
  toPrincipalRef,
  verifyArtifact,
} from '@arena/artifact-protocol';
import type {
  ArtifactIdentity,
  MaterialArtifact,
  PrincipalRef,
} from '@arena/artifact-protocol';

/** A caller operating on the store: a tenant-scoped principal. */
export type StoreCallerInput = PrincipalRef | { type: string; tenant: string; principalId: string };

export interface ArtifactPutReceipt {
  readonly artifact: MaterialArtifact<unknown>;
  readonly digest: string;
  /** True when the artifact was already present (idempotent re-put). */
  readonly idempotent: boolean;
}

function identityKeyOf(identity: ArtifactIdentity): string {
  return `${identity.namespace}/${identity.name}@${identity.version}`;
}

function artifactKeyOf(artifact: MaterialArtifact<unknown>): string {
  return `${artifact.identity.namespace}/${artifact.identity.name}@${artifact.identity.version}#${artifact.digest}`;
}

function toCaller(caller: StoreCallerInput): PrincipalRef {
  return toPrincipalRef(caller);
}

/**
 * The in-process reference store. Construct with `new ArtifactStore()`;
 * every operation is async so a durable implementation can substitute 1:1
 * behind the same surface.
 */
export class ArtifactStore {
  /** digest → material artifact (content-addressed primary index). */
  private readonly byDigest = new Map<string, MaterialArtifact<unknown>>();
  /** identity key (`ns/name@version`) → the PERMANENTLY bound digest. */
  private readonly identityBindings = new Map<string, string>();

  /**
   * Put an artifact: verify content (the store never trusts caller-side
   * digests), then bind identity↔digest permanently. Idempotent for the
   * bit-identical artifact; a different digest under a bound identity is
   * an identity conflict (fail closed, never overwritten).
   */
  async put(
    artifact: MaterialArtifact<unknown>,
    caller: StoreCallerInput,
  ): Promise<ArtifactPutReceipt> {
    const principal = toCaller(caller);
    const namespace = artifact.identity.namespace;
    if (namespace !== principal.tenant && namespace !== PUBLIC_NAMESPACE) {
      throw new ArtifactsError(ARTIFACTS_ERROR_CODES.TENANT_FORBIDDEN, {
        message: `caller tenant ${principal.tenant} cannot ingest into namespace ${namespace} (put requires the artifact's own tenant scope or the reserved public namespace)`,
        details: { callerTenant: principal.tenant, artifactNamespace: namespace },
      });
    }

    // The store never trusts the claimed digest — verify before indexing.
    await verifyArtifact(artifact);

    const identityKey = identityKeyOf(artifact.identity);
    const bound = this.identityBindings.get(identityKey);
    if (bound !== undefined) {
      if (bound === artifact.digest) {
        const stored = this.requireByDigest(bound);
        return { artifact: stored, digest: bound, idempotent: true };
      }
      throw new ArtifactError(ARTIFACT_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `identity ${identityKey} is already bound to digest ${bound}; a second artifact under the same identity+version with a different digest is rejected, not overwritten (artifacts are immutable)`,
        details: {
          identity: identityKey,
          bound,
          attempted: artifact.digest,
        },
      });
    }

    this.byDigest.set(artifact.digest, artifact);
    this.identityBindings.set(identityKey, artifact.digest);
    return { artifact, digest: artifact.digest, idempotent: false };
  }

  /** GET by artifact digest — exact content-addressed read. */
  async getByDigest(digest: string, caller: StoreCallerInput): Promise<MaterialArtifact<unknown>> {
    const principal = toCaller(caller);
    const stored = this.byDigest.get(digest);
    if (stored === undefined) {
      throw new ArtifactsError(ARTIFACTS_ERROR_CODES.NOT_FOUND, {
        message: `no stored artifact with digest ${JSON.stringify(digest)}`,
        details: { digest },
      });
    }
    this.assertReadScope(stored, principal);
    return this.verifyOnRead(stored);
  }

  /** GET by identity — resolves through the permanent identity binding. */
  async getByIdentity(
    identity: { namespace: string; name: string; version: string },
    caller: StoreCallerInput,
  ): Promise<MaterialArtifact<unknown>> {
    const principal = toCaller(caller);
    const identityKey = `${identity.namespace}/${identity.name}@${identity.version}`;
    const bound = this.identityBindings.get(identityKey);
    if (bound === undefined) {
      throw new ArtifactsError(ARTIFACTS_ERROR_CODES.NOT_FOUND, {
        message: `no stored artifact under identity ${identityKey}`,
        details: { identity: identityKey },
      });
    }
    return this.getByDigest(bound, principal);
  }

  /** True iff the identity is bound (no tenant check — a pure existence probe). */
  async hasIdentity(
    identity: { namespace: string; name: string; version: string },
  ): Promise<boolean> {
    return this.identityBindings.has(
      `${identity.namespace}/${identity.name}@${identity.version}`,
    );
  }

  /**
   * List the artifacts of one namespace. The namespace must be the
   * caller's own tenant scope or the reserved `public` namespace —
   * cross-tenant listing is rejected exactly like cross-tenant reads.
   */
  async listByNamespace(
    namespace: string,
    caller: StoreCallerInput,
  ): Promise<readonly MaterialArtifact<unknown>[]> {
    const principal = toCaller(caller);
    if (namespace !== principal.tenant && namespace !== PUBLIC_NAMESPACE) {
      throw new ArtifactsError(ARTIFACTS_ERROR_CODES.TENANT_FORBIDDEN, {
        message: `caller tenant ${principal.tenant} cannot list namespace ${namespace}`,
        details: { callerTenant: principal.tenant, namespace },
      });
    }
    const found: MaterialArtifact<unknown>[] = [];
    for (const artifact of this.byDigest.values()) {
      if (artifact.identity.namespace === namespace) found.push(artifact);
    }
    return Object.freeze(
      found.sort((a, b) => artifactKeyOf(a).localeCompare(artifactKeyOf(b))),
    );
  }

  /**
   * An A002-compatible artifact resolver bound to the caller's read
   * scope: resolves refs through the store honoring the tenant-scope
   * rules (own namespace or `public`), returning null for unknown refs.
   * Cross-tenant refs resolve to null (unresolvable) rather than
   * throwing, so tree verification reports them as unresolved refs.
   *
   * The parameter type is the plain ref VIEW (unbranded digest) — an
   * A002 `ArtifactRef` is assignable to it, so this function satisfies
   * A002's `ArtifactResolver` (contravariance) while also accepting
   * `@arena/provenance` view refs.
   */
  resolverFor(
    caller: StoreCallerInput,
  ): (
    ref: { namespace: string; name: string; version: string; digest: string },
  ) => Promise<MaterialArtifact<unknown> | null> {
    const principal = toCaller(caller);
    return async (ref) => {
      if (ref.namespace !== principal.tenant && ref.namespace !== PUBLIC_NAMESPACE) {
        return null;
      }
      return this.byDigest.get(ref.digest) ?? null;
    };
  }

  /** Number of stored artifacts (test/observability helper). */
  async size(): Promise<number> {
    return this.byDigest.size;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private assertReadScope(artifact: MaterialArtifact<unknown>, principal: PrincipalRef): void {
    const namespace = artifact.identity.namespace;
    if (namespace !== principal.tenant && namespace !== PUBLIC_NAMESPACE) {
      throw new ArtifactsError(ARTIFACTS_ERROR_CODES.TENANT_FORBIDDEN, {
        message: `caller tenant ${principal.tenant} cannot read namespace ${namespace} (tenant-scope isolation: own namespace or the reserved public namespace only)`,
        details: { callerTenant: principal.tenant, artifactNamespace: namespace },
      });
    }
  }

  /**
   * Content verification ON READ (fail closed): recompute the digest and
   * compare. The REUSED A002 verifyArtifact throws ARTIFACT_TAMPERED on
   * mismatch — an in-process adversary who corrupts a stored entry is
   * detected here, before the artifact is returned.
   */
  private async verifyOnRead(
    artifact: MaterialArtifact<unknown>,
  ): Promise<MaterialArtifact<unknown>> {
    await verifyArtifact(artifact);
    return artifact;
  }

  private requireByDigest(digest: string): MaterialArtifact<unknown> {
    const stored = this.byDigest.get(digest);
    if (stored === undefined) {
      throw new ArtifactsError(ARTIFACTS_ERROR_CODES.UNKNOWN_ERROR, {
        message: `store invariant broken: identity binding ${digest} has no stored artifact`,
      });
    }
    return stored;
  }
}
