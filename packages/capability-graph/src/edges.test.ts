/**
 * Edge tests — typed, provenance-bearing edges (Work Order A004, gates 3,
 * 12): all nine edge kinds, unknown-kind rejection, the endpoint matrix,
 * self-edge rejection, provenance requirement, dedup digests, freeze and
 * fail-closed verification.
 */

import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_EDGE_KINDS,
  EDGE_ENDPOINTS,
  HIERARCHICAL_EDGE_KINDS,
  capabilityEdgeKey,
  createCapabilityEdge,
  isCapabilityEdge,
  verifyCapabilityEdge,
} from './edges.js';
import { CAPABILITY_GRAPH_ERROR_CODES } from './errors.js';
import { CapabilityGraphError } from './errors.js';
import { FIXTURE_PROVENANCE, FIXTURE_PROVENANCE_2, makeNode } from './testing.js';

describe('edge kinds (positive)', () => {
  it('the closed set has exactly the nine §4 relations', () => {
    expect([...CAPABILITY_EDGE_KINDS].sort()).toEqual([
      'competent-in',
      'decomposes-into',
      'evaluates',
      'exercised-by',
      'extends-domain',
      'observes-failure-of',
      'produces',
      'requires',
      'verifies',
    ]);
  });

  it('the endpoint matrix covers every node kind at least once', () => {
    const sources = new Set<string>();
    const targets = new Set<string>();
    for (const endpoints of Object.values(EDGE_ENDPOINTS)) {
      for (const kind of endpoints.source) sources.add(kind);
      for (const kind of endpoints.target) targets.add(kind);
    }
    for (const kind of [
      'domain',
      'capability',
      'sub-capability',
      'skill',
      'tool',
      'task-family',
      'evaluator',
      'verifier',
      'expert-competency',
      'observed-failure',
      'body-version',
    ]) {
      expect(sources.has(kind) || targets.has(kind)).toBe(true);
    }
  });

  it('hierarchical edge kinds are the acyclicity-guarded set', () => {
    expect([...HIERARCHICAL_EDGE_KINDS].sort()).toEqual([
      'decomposes-into',
      'extends-domain',
      'produces',
      'requires',
    ]);
  });
});

describe('edge creation (positive — all nine kinds)', () => {
  it('creates every edge kind with provenance and a content digest', async () => {
    const domain = await makeNode('domain', 'd', '1.0.0');
    const capability = await makeNode('capability', 'c', '1.0.0');
    const sub = await makeNode('sub-capability', 'sc', '1.0.0');
    const skill = await makeNode('skill', 's', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const tool = await makeNode('tool', 't', '1.0.0');
    const taskFamily = await makeNode('task-family', 'tf', '1.0.0');
    const evaluator = await makeNode('evaluator', 'ev', '1.0.0');
    const verifier = await makeNode('verifier', 'vf', '1.0.0');
    const competency = await makeNode('expert-competency', 'ec', '1.0.0');
    const failure = await makeNode('observed-failure', 'of', '1.0.0');
    const bodyVersion = await makeNode('body-version', 'bv', '1.0.0');

    const cases: readonly [string, { kind: string; id: string; version: string; digest: string }, { kind: string; id: string; version: string; digest: string }][] = [
      ['decomposes-into', domain, capability],
      ['decomposes-into', capability, sub],
      ['decomposes-into', sub, skill],
      ['decomposes-into', skill, await makeNode('skill', 's2', '1.0.0', {
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      })],
      ['requires', skill, tool],
      ['produces', skill, await makeNode('skill', 's3', '1.0.0', {
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      })],
      ['evaluates', evaluator, skill],
      ['evaluates', evaluator, taskFamily],
      ['evaluates', evaluator, bodyVersion],
      ['verifies', verifier, capability],
      ['observes-failure-of', failure, skill],
      ['observes-failure-of', failure, tool],
      ['competent-in', competency, domain],
      ['exercised-by', skill, taskFamily],
      ['exercised-by', capability, bodyVersion],
      ['extends-domain', domain, await makeNode('domain', 'd2', '1.0.0')],
    ];
    for (const [kind, source, target] of cases) {
      const edge = await createCapabilityEdge({
        kind,
        source,
        target,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      });
      expect(edge.kind).toBe(kind);
      expect(edge.recordVersion).toBe(1);
      expect(edge.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(isCapabilityEdge(edge)).toBe(true);
      expect(Object.isFrozen(edge)).toBe(true);
      expect(edge.provenance.recordDigest).toBe(FIXTURE_PROVENANCE.recordDigest);
      await expect(verifyCapabilityEdge(edge)).resolves.toBe(edge.digest);
    }
  });

  it('edge payload notes are optional and versioned by the payload schema', async () => {
    const skill = await makeNode('skill', 's', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const tool = await makeNode('tool', 't', '1.0.0');
    const withNote = await createCapabilityEdge({
      kind: 'requires',
      source: skill,
      target: tool,
      payload: { note: 'uses git diff under the hood' },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const withoutNote = await createCapabilityEdge({
      kind: 'requires',
      source: skill,
      target: tool,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    expect(withNote.payload.note).toBe('uses git diff under the hood');
    expect(withoutNote.payload.note).toBeUndefined();
    expect(withNote.digest).not.toBe(withoutNote.digest); // different content, different digest
  });
});

describe('edge creation (negative)', () => {
  it('rejects unknown edge kinds', async () => {
    const skill = await makeNode('skill', 's', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const tool = await makeNode('tool', 't', '1.0.0');
    await expect(
      createCapabilityEdge({
        kind: 'is-friends-with',
        source: skill,
        target: tool,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    ).rejects.toThrow(/unknown capability edge kind/);
    await expect(
      createCapabilityEdge({
        kind: 'decomposes-into-into',
        source: skill,
        target: tool,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    ).rejects.toThrow(CapabilityGraphError);
  });

  it('rejects endpoint-kind violations per the typed matrix', async () => {
    const domain = await makeNode('domain', 'd', '1.0.0');
    const skill = await makeNode('skill', 's', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const evaluator = await makeNode('evaluator', 'ev', '1.0.0');
    const bodyVersion = await makeNode('body-version', 'bv', '1.0.0');

    // requires: only skills require (skill -> skill | tool)
    await expect(
      createCapabilityEdge({
        kind: 'requires',
        source: domain,
        target: skill,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    ).rejects.toThrow(/does not allow source kind "domain"/);
    // evaluates: evaluators evaluate, body versions do not
    await expect(
      createCapabilityEdge({
        kind: 'evaluates',
        source: bodyVersion,
        target: skill,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    ).rejects.toThrow(/does not allow source kind "body-version"/);
    // competent-in: an expert competency cannot be the target
    await expect(
      createCapabilityEdge({
        kind: 'competent-in',
        source: evaluator,
        target: domain,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    ).rejects.toThrow(/does not allow source kind "evaluator"/);
    // observes-failure-of: a skill is not an observer
    await expect(
      createCapabilityEdge({
        kind: 'observes-failure-of',
        source: skill,
        target: domain,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    ).rejects.toThrow(/does not allow source kind "skill"/);
    // decomposes-into: tools cannot decompose
    await expect(
      createCapabilityEdge({
        kind: 'decomposes-into',
        source: await makeNode('tool', 't2', '1.0.0'),
        target: skill,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    ).rejects.toThrow(/does not allow source kind "tool"/);
  });

  it('rejects self-edges', async () => {
    const skill = await makeNode('skill', 's', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    await expect(
      createCapabilityEdge({
        kind: 'requires',
        source: skill,
        target: skill,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    ).rejects.toThrow(/self-edges are not allowed/);
  });

  it('rejects missing or malformed provenance (required on every edge)', async () => {
    const skill = await makeNode('skill', 's', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const tool = await makeNode('tool', 't', '1.0.0');
    await expect(
      createCapabilityEdge({
        kind: 'requires',
        source: skill,
        target: tool,
        provenance: undefined as unknown as { recordDigest: string },
      }),
    ).rejects.toThrow(/provenance/);
    await expect(
      createCapabilityEdge({
        kind: 'requires',
        source: skill,
        target: tool,
        provenance: { recordDigest: 'nope' },
      }),
    ).rejects.toThrow(/provenance/);
  });

  it('rejects malformed payloads and node refs', async () => {
    const skill = await makeNode('skill', 's', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const tool = await makeNode('tool', 't', '1.0.0');
    await expect(
      createCapabilityEdge({
        kind: 'requires',
        source: skill,
        target: tool,
        payload: { note: '' },
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    ).rejects.toThrow(/invalid edge payload note/);
    await expect(
      createCapabilityEdge({
        kind: 'requires',
        source: { kind: 'model', id: 'x', version: '1.0.0', digest: skill.digest },
        target: tool,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    ).rejects.toThrow(/edge source must be a valid capability node ref/);
  });
});

describe('edge content addressing (dedup)', () => {
  it('same edge content ⇒ same digest; different provenance ⇒ different digest', async () => {
    const skill = await makeNode('skill', 's', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const tool = await makeNode('tool', 't', '1.0.0');
    const a = await createCapabilityEdge({
      kind: 'requires',
      source: skill,
      target: tool,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const b = await createCapabilityEdge({
      kind: 'requires',
      source: skill,
      target: tool,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    expect(a.digest).toBe(b.digest);
    const otherProvenance = await createCapabilityEdge({
      kind: 'requires',
      source: skill,
      target: tool,
      provenance: { recordDigest: FIXTURE_PROVENANCE_2.recordDigest },
    });
    expect(otherProvenance.digest).not.toBe(a.digest);
    expect(capabilityEdgeKey(a)).toBe(`requires:skill/s@1.0.0 -> tool/t@1.0.0`);
  });
});

describe('edge freeze + tamper detection', () => {
  it('edges are deep-frozen; tampering fails verification closed', async () => {
    const skill = await makeNode('skill', 's', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const tool = await makeNode('tool', 't', '1.0.0');
    const edge = await createCapabilityEdge({
      kind: 'requires',
      source: skill,
      target: tool,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    expect(() => {
      (edge as unknown as Record<string, unknown>)['kind'] = 'verifies';
    }).toThrow(TypeError);
    expect(() => {
      (edge.payload as unknown as Record<string, unknown>)['note'] = 'rewritten';
    }).toThrow(TypeError);
    const tampered = { ...edge, payload: { note: 'rewritten' } };
    await expect(verifyCapabilityEdge(tampered)).rejects.toMatchObject({
      code: CAPABILITY_GRAPH_ERROR_CODES.TAMPERED,
    });
    await expect(verifyCapabilityEdge({ kind: 'requires' } as never)).rejects.toMatchObject({
      code: CAPABILITY_GRAPH_ERROR_CODES.INVALID_EDGE,
    });
  });
});
