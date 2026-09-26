/**
 * Cross-package parity + integration (Work Order A002).
 *
 * @arena/provenance deliberately has NO runtime dependency on
 * @arena/artifact-protocol (acceptance criterion 9: zero runtime dependencies
 * beyond @arena/protocol-core), so its record components are validated
 * plain-string views. This test binds the two packages together:
 *
 *   1. PATTERN/ENUM PARITY — the duplicated pattern sources and closed enums
 *      in provenance/src/shared.ts must equal the artifact-protocol constants
 *      exactly (the duplication cannot drift silently);
 *   2. STRUCTURAL COMPATIBILITY — an @arena/artifact-protocol ArtifactRef /
 *      PrincipalRef / RightsMetadata value flows through the provenance
 *      validators unchanged (branded strings are plain strings here);
 *   3. END-TO-END — artifact → publication → provenance record → lineage
 *      graph, with queries answering over artifact-protocol-produced values.
 *
 * The import below is a devDependency: runtime modules of this package never
 * import @arena/artifact-protocol (enforced by review + this file being the
 * only importer).
 */

import { describe, expect, it } from 'vitest';
import * as artifactProtocol from '@arena/artifact-protocol';
import {
  appendPublicationRecord,
  createMaterialArtifact,
  publishArtifact,
  resolvePublication,
} from '@arena/artifact-protocol';
import {
  createProvenanceRecord,
  buildLineageGraph,
  ancestors,
  descendants,
  isAncestorOf,
  topologicalOrder,
} from './index.js';
import { artifactRefViewKey } from './shared.js';

describe('cross-package pattern/enum parity (no silent drift)', () => {
  it('pattern sources are identical across the two packages', async () => {
    const artifactModule = await import('@arena/artifact-protocol');
    expect(artifactModule.ARTIFACT_NAMESPACE_PATTERN_SOURCE).toBe(
      (await import('./shared.js')).ARTIFACT_NAMESPACE_PATTERN_SOURCE,
    );
    expect(artifactModule.ARTIFACT_NAME_PATTERN_SOURCE).toBe(
      (await import('./shared.js')).ARTIFACT_NAME_PATTERN_SOURCE,
    );
    expect(artifactModule.ARTIFACT_VERSION_PATTERN_SOURCE).toBe(
      (await import('./shared.js')).ARTIFACT_VERSION_PATTERN_SOURCE,
    );
    expect(artifactModule.CONTENT_DIGEST_PATTERN_SOURCE).toBe(
      (await import('./shared.js')).CONTENT_DIGEST_PATTERN_SOURCE,
    );
    expect(artifactModule.ARTIFACT_TIMESTAMP_PATTERN_SOURCE).toBe(
      (await import('./shared.js')).PROVENANCE_TIMESTAMP_PATTERN_SOURCE,
    );
    expect(artifactModule.PRINCIPAL_ID_PATTERN_SOURCE).toBe(
      (await import('./shared.js')).PRINCIPAL_ID_PATTERN_SOURCE,
    );
    expect(artifactModule.LICENSE_PATTERN_SOURCE).toBe(
      (await import('./shared.js')).LICENSE_PATTERN_SOURCE,
    );
  });

  it('principal types and rights policies are identical across the packages', async () => {
    const artifactModule = await import('@arena/artifact-protocol');
    const shared = await import('./shared.js');
    expect([...artifactModule.PRINCIPAL_TYPES].sort()).toEqual(
      [...shared.PRINCIPAL_TYPES].sort(),
    );
    expect([...artifactModule.COMMERCIAL_USE_POLICIES].sort()).toEqual(
      [...shared.COMMERCIAL_USE_POLICIES].sort(),
    );
    expect([...artifactModule.REDISTRIBUTION_POLICIES].sort()).toEqual(
      [...shared.REDISTRIBUTION_POLICIES].sort(),
    );
    expect([...artifactModule.CUSTOMER_DATA_POLICIES].sort()).toEqual(
      [...shared.CUSTOMER_DATA_POLICIES].sort(),
    );
  });
});

describe('cross-package structural compatibility', () => {
  it('an artifact-protocol ArtifactRef value validates as a provenance ref view', async () => {
    const artifact = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'reference-dataset', version: '1.4.2' },
      content: { rows: 3 },
    });
    const ref = {
      namespace: artifact.identity.namespace,
      name: artifact.identity.name,
      version: artifact.identity.version,
      digest: artifact.digest,
    };
    const { toArtifactRefView } = await import('./shared.js');
    const view = toArtifactRefView(ref);
    expect(view).toEqual(ref);
    expect(artifactRefViewKey(view)).toBe(`acme/reference-dataset@1.4.2#${artifact.digest}`);
  });

  it('an artifact-protocol PrincipalRef/RightsMetadata validate as provenance views', async () => {
    const { toPrincipalRef, toRightsMetadata } = await import('@arena/artifact-protocol');
    const { toPrincipalRefView, toRightsMetadataView } = await import('./shared.js');
    const principal = toPrincipalRef({
      type: 'agent-body',
      tenant: 'acme',
      principalId: 'structural-engineer.v4',
    });
    expect(toPrincipalRefView(principal)).toEqual(principal);
    const rights = toRightsMetadata({
      license: 'Apache-2.0',
      commercialUse: 'allowed',
      redistribution: 'tenant-only',
      customerData: 'derived',
      professionalLimitations: ['Not a professional license'],
    });
    expect(toRightsMetadataView(rights)).toEqual(rights);
  });
});

describe('end-to-end: artifact → publication → provenance → lineage', () => {
  it('records provenance for a published artifact and queries its lineage', async () => {
    // 1. Material artifacts (content-addressed, provider-neutral).
    const corpus = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'source-corpus', version: '2.0.0' },
      content: { rows: 100 },
    });
    const dataset = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'reference-dataset', version: '1.4.2' },
      refs: [
        {
          namespace: corpus.identity.namespace,
          name: corpus.identity.name,
          version: corpus.identity.version,
          digest: corpus.digest,
        },
      ],
      content: { rows: 3 },
    });

    // 2. Publication (private by default; explicit record makes it public).
    const publisher = artifactProtocol.toPrincipalRef({
      type: 'service',
      tenant: 'acme',
      principalId: 'registry-control-plane',
    });
    const rights = artifactProtocol.toRightsMetadata({
      license: 'CC-BY-4.0',
      commercialUse: 'allowed',
      redistribution: 'allowed',
      customerData: 'none',
    });
    const publication = await publishArtifact({
      artifact: dataset,
      publisher,
      rights,
      publishedAt: '2026-09-26T12:00:00.000Z',
    });
    const ledger = await appendPublicationRecord(
      artifactProtocol.EMPTY_PUBLICATION_LEDGER,
      publication,
    );
    const status = await resolvePublication(ledger, dataset.identity);
    expect(status.visibility).toBe('public');

    // 3. Provenance record for the dataset, referencing the corpus parent —
    //    the ref data comes straight from the artifact-protocol objects.
    const record = createProvenanceRecord({
      artifact: {
        namespace: dataset.identity.namespace,
        name: dataset.identity.name,
        version: dataset.identity.version,
        digest: dataset.digest,
      },
      creator: { type: 'agent-body', tenant: 'acme', principalId: 'structural-engineer.v4' },
      createdAt: '2026-09-26T11:00:00.000Z',
      recordedAt: '2026-09-26T12:01:00.000Z',
      parents: [
        {
          parent: {
            namespace: corpus.identity.namespace,
            name: corpus.identity.name,
            version: corpus.identity.version,
            digest: corpus.digest,
          },
          relation: 'derived-from',
        },
      ],
      transformation: {
        transform: {
          namespace: 'acme',
          name: 'clean-and-normalize',
          version: '3.1.0',
          digest: 'e'.repeat(64),
        },
        inputs: [
          {
            namespace: corpus.identity.namespace,
            name: corpus.identity.name,
            version: corpus.identity.version,
            digest: corpus.digest,
          },
        ],
      },
      rights: {
        license: 'CC-BY-4.0',
        commercialUse: 'allowed',
        redistribution: 'allowed',
        customerData: 'none',
      },
      verification: [
        {
          kind: 'evaluation',
          evidence: {
            namespace: 'acme',
            name: 'eval-suite',
            version: '1.0.0',
            digest: 'c'.repeat(64),
          },
        },
      ],
    });
    expect(Object.isFrozen(record)).toBe(true);

    // 4. Lineage queries over the provenance of artifact-protocol artifacts.
    const graph = buildLineageGraph([record]);
    expect(ancestors(graph, record.artifact)).toHaveLength(1);
    expect(ancestors(graph, record.artifact)[0]?.digest).toBe(corpus.digest);
    expect(descendants(graph, ancestors(graph, record.artifact)[0]!)).toEqual([
      record.artifact,
    ]);
    expect(
      isAncestorOf(
        graph,
        ancestors(graph, record.artifact)[0]!,
        record.artifact,
      ),
    ).toBe(true);
    const order = topologicalOrder(graph).map((r) => artifactRefViewKey(r));
    expect(order.indexOf(`acme/source-corpus@2.0.0#${corpus.digest}`)).toBeLessThan(
      order.indexOf(`acme/reference-dataset@1.4.2#${dataset.digest}`),
    );
  });
});
