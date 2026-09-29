/**
 * @arena/artifact-service — the in-process artifact storage/lineage
 * reference service for Arena (Work Order A014; requirements R14, R23,
 * R24; architecture-lock rules 5, 6, 11, 12, 18, 23).
 *
 * Pure TypeScript, ZERO external runtime dependencies: only
 * @arena/protocol-core, @arena/artifact-protocol and @arena/provenance
 * workspace packages (the REAL A002 primitives — identity, content
 * addressing, verification, publication, lineage vocabulary — reused
 * throughout, never reimplemented). @arena/datasets is a devDependency
 * used only by the interop test that proves the store's resolver feeds
 * dataset bundle resolution.
 *
 *   - ArtifactStore — the in-process REFERENCE STORE (not object storage
 *     itself): PUT/GET by digest + identity, permanent identity↔digest
 *     binding (a second artifact under a bound identity+version is
 *     REJECTED, never overwritten), tenant-scope isolation (cross-tenant
 *     reads rejected), content verification on read (fail-closed tamper
 *     detection). No update/delete APIs.
 *   - LineageService — append-only transformation lineage recording +
 *     deep queries (ancestry walk with cycle rejection reporting the
 *     offending path), closed-world provenance validation (every parent
 *     ref resolvable + digest-verified through the store).
 *   - PublicationService — the A002 PublicationLedger semantics as
 *     service operations: publish (explicit, immutable), retract (appends
 *     a NEW record), public/private listings per scope. Publication never
 *     silently changes tenant visibility.
 *
 * Durable persistence (databases, object storage) is a deployment-tier
 * concern and is deliberately NOT modeled here — the service is the
 * protocol-faithful in-process reference implementation, exactly like the
 * A011 trajectory store.
 */

export * from './errors.js';
export * from './store.js';
export * from './lineage.js';
export * from './publication.js';

import { ArtifactStore } from './store.js';
import { LineageService } from './lineage.js';
import { PublicationService } from './publication.js';

/** The composed facade: one store shared by the lineage + publication services. */
export interface ArtifactService {
  readonly store: ArtifactStore;
  readonly lineage: LineageService;
  readonly publication: PublicationService;
}

/** Factory: a fresh, empty in-process artifact service (store + lineage + publication). */
export function createArtifactService(): ArtifactService {
  const store = new ArtifactStore();
  const lineage = new LineageService(store);
  const publication = new PublicationService(store);
  return { store, lineage, publication };
}
