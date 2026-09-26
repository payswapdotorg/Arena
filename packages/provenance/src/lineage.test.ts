import { describe, expect, it } from 'vitest';
import type { ArtifactRefView } from './shared.js';
import { artifactRefViewKey } from './shared.js';
import { createProvenanceRecord, type ProvenanceRecord } from './record.js';
import {
  ancestors,
  buildLineageGraph,
  descendants,
  isAncestorOf,
  topologicalOrder,
} from './lineage.js';
import { PROVENANCE_ERROR_CODES, ProvenanceError } from './errors.js';

const RIGHTS = {
  license: 'Proprietary',
  commercialUse: 'requires-license',
  redistribution: 'tenant-only',
  customerData: 'none',
};
const TRANSFORM = {
  namespace: 'acme',
  name: 'identity-transform',
  version: '1.0.0',
  digest: 'e'.repeat(64),
};

function ref(name: string, seed = name): ArtifactRefView {
  // Deterministic VALID hex digest derived from the seed (test values must
  // satisfy the sha256-hex pattern even though they are synthetic).
  const hexSeed = Array.from(seed, (char) =>
    char.charCodeAt(0).toString(16).padStart(2, '0'),
  ).join('');
  return {
    namespace: 'acme',
    name,
    version: '1.0.0',
    digest: hexSeed.padEnd(64, '0').slice(0, 64),
  };
}

function recordFor(
  name: string,
  parents: { parent: ArtifactRefView; relation: string }[],
): ProvenanceRecord {
  return createProvenanceRecord({
    // Same seed convention as ref(name): recordFor('x') produces a record
    // for exactly the ref returned by ref('x').
    artifact: ref(name),
    creator: { type: 'service', tenant: 'acme', principalId: 'pipeline' },
    createdAt: '2026-09-26T12:00:00.000Z',
    parents,
    transformation: { transform: TRANSFORM, inputs: parents.map((edge) => edge.parent) },
    rights: RIGHTS,
    verification: [],
  });
}

describe('Lineage queries (positive)', () => {
  it('builds a graph and answers ancestors transitively', () => {
    // corpus ← clean ← dataset ← report ; corpus ← audit
    const corpus = ref('corpus', 'corpus');
    const clean = recordFor('clean', [{ parent: corpus, relation: 'derived-from' }]);
    const dataset = recordFor('dataset', [
      { parent: clean.artifact, relation: 'derived-from' },
    ]);
    const report = recordFor('report', [
      { parent: dataset.artifact, relation: 'composed-of' },
      { parent: corpus, relation: 'extracted-from' },
    ]);
    const graph = buildLineageGraph([clean, dataset, report]);

    const reportAncestors = ancestors(graph, report.artifact).map((r) => r.name);
    expect(reportAncestors.sort()).toEqual(['clean', 'corpus', 'dataset']);

    const corpusDescendants = descendants(graph, corpus).map((r) => r.name);
    expect(corpusDescendants.sort()).toEqual(['clean', 'dataset', 'report']);

    expect(isAncestorOf(graph, corpus, report.artifact)).toBe(true);
    expect(isAncestorOf(graph, dataset.artifact, report.artifact)).toBe(true);
    expect(isAncestorOf(graph, report.artifact, corpus)).toBe(false);
    expect(isAncestorOf(graph, dataset.artifact, clean.artifact)).toBe(false);
  });

  it('topologicalOrder places every parent before its children', () => {
    const corpus = ref('corpus', 'corpus');
    const clean = recordFor('clean', [{ parent: corpus, relation: 'derived-from' }]);
    const dataset = recordFor('dataset', [
      { parent: clean.artifact, relation: 'derived-from' },
    ]);
    const audit = recordFor('audit', [{ parent: corpus, relation: 'extracted-from' }]);
    const graph = buildLineageGraph([clean, dataset, audit]);
    const order = topologicalOrder(graph).map((r) => artifactRefViewKey(r));

    const indexOf = (name: string): number =>
      order.findIndex((key) => key.startsWith(`acme/${name}@`));
    expect(indexOf('corpus')).toBeLessThan(indexOf('clean'));
    expect(indexOf('clean')).toBeLessThan(indexOf('dataset'));
    expect(indexOf('corpus')).toBeLessThan(indexOf('audit'));
    expect(order).toHaveLength(graph.nodes.size);
    // Deterministic: same graph → same order.
    expect(topologicalOrder(graph).map((r) => artifactRefViewKey(r))).toEqual(order);
  });

  it('handles open-world parents (refs without records) gracefully', () => {
    const foreign = ref('foreign-parent', 'foreign');
    const child = recordFor('child', [{ parent: foreign, relation: 'derived-from' }]);
    const graph = buildLineageGraph([child]);
    expect(ancestors(graph, child.artifact)).toEqual([foreign]);
    expect(descendants(graph, foreign)).toEqual([child.artifact]);
    // Unknown query ref: empty, total, no throw.
    expect(ancestors(graph, ref('unknown', 'unknown'))).toEqual([]);
    expect(descendants(graph, ref('unknown', 'unknown'))).toEqual([]);
    expect(isAncestorOf(graph, foreign, child.artifact)).toBe(true);
  });

  it('re-asserting an identical record is idempotent', () => {
    const corpus = ref('corpus', 'corpus');
    const clean = recordFor('clean', [{ parent: corpus, relation: 'derived-from' }]);
    const cleanAgain = createProvenanceRecord({
      artifact: clean.artifact,
      creator: clean.creator,
      createdAt: clean.createdAt,
      recordedAt: clean.recordedAt,
      parents: clean.parents.map((edge) => ({ parent: edge.parent, relation: edge.relation })),
      transformation: {
        transform: clean.transformation.transform,
        inputs: clean.transformation.inputs.map((input) => ({ ...input })),
      },
      rights: clean.rights,
      verification: [],
    });
    const graph = buildLineageGraph([clean, cleanAgain]);
    expect(graph.records.size).toBe(1);
  });
});

describe('Lineage queries (negative — construction fails closed)', () => {
  it('rejects CYCLES across records', () => {
    const a = ref('artifact-a');
    const b = ref('artifact-b');
    const recordA = recordFor('artifact-a', [{ parent: b, relation: 'derived-from' }]);
    const recordB = recordFor('artifact-b', [{ parent: a, relation: 'derived-from' }]);
    let thrown: unknown;
    try {
      buildLineageGraph([recordA, recordB]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvenanceError);
    expect((thrown as ProvenanceError).code).toBe(PROVENANCE_ERROR_CODES.CYCLE_DETECTED);
  });

  it('rejects longer cycles (3 nodes)', () => {
    const a = ref('node-a');
    const b = ref('node-b');
    const c = ref('node-c');
    const records = [
      recordFor('node-a', [{ parent: c, relation: 'derived-from' }]),
      recordFor('node-b', [{ parent: a, relation: 'derived-from' }]),
      recordFor('node-c', [{ parent: b, relation: 'derived-from' }]),
    ];
    let thrown: unknown;
    try {
      buildLineageGraph(records);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvenanceError);
    expect((thrown as ProvenanceError).code).toBe(PROVENANCE_ERROR_CODES.CYCLE_DETECTED);
  });

  it('rejects the same IDENTITY bound to different digests across records', () => {
    const corpus = ref('corpus');
    const v1 = recordFor('dataset', [{ parent: corpus, relation: 'derived-from' }]);
    const v2 = createProvenanceRecord({
      artifact: { ...v1.artifact, digest: 'f'.repeat(64) },
      creator: v1.creator,
      createdAt: v1.createdAt,
      parents: v1.parents.map((edge) => ({ parent: edge.parent, relation: edge.relation })),
      transformation: {
        transform: v1.transformation.transform,
        inputs: v1.transformation.inputs.map((input) => ({ ...input })),
      },
      rights: v1.rights,
      verification: [],
    });
    let thrown: unknown;
    try {
      buildLineageGraph([v1, v2]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvenanceError);
    expect((thrown as ProvenanceError).code).toBe(PROVENANCE_ERROR_CODES.IDENTITY_CONFLICT);
  });

  it('rejects CONFLICTING records for the same content-addressed artifact', () => {
    const corpus = ref('corpus');
    const v1 = recordFor('dataset', [{ parent: corpus, relation: 'derived-from' }]);
    const v2 = createProvenanceRecord({
      artifact: v1.artifact,
      creator: { type: 'user', tenant: 'acme', principalId: 'someone-else' },
      createdAt: '2026-09-26T13:00:00.000Z',
      parents: [],
      transformation: { transform: TRANSFORM, inputs: [] },
      rights: v1.rights,
      verification: [],
    });
    let thrown: unknown;
    try {
      buildLineageGraph([v1, v2]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvenanceError);
    expect((thrown as ProvenanceError).code).toBe(PROVENANCE_ERROR_CODES.INVALID_RECORD);
  });
});
