/**
 * Node tests — the eleven digest-addressed versioned node kinds
 * (Work Order A004, gates 2, 6, 11, 12): creation for every kind, payload
 * validation, content-addressed dedup (same content ⇒ same digest; different
 * content ⇒ different digest), deep-freeze (mutation throws), supersession
 * inputs and fail-closed digest verification.
 */

import { describe, expect, it } from 'vitest';
import {
  capabilityNodeRef,
  createCapabilityNode,
  isCapabilityNode,
  isCapabilityNodeRef,
  payloadSchemaForNodeKind,
  toCapabilityNodeRef,
  verifyCapabilityNode,
} from './nodes.js';
import { capabilityNodeKey } from './identifiers.js';
import { CAPABILITY_GRAPH_ERROR_CODES } from './errors.js';
import { CapabilityGraphError } from './errors.js';
import {
  CAPABILITY_DECOMPOSITION_CATEGORIES,
} from './payload.js';
import {
  FIXTURE_PROVENANCE,
  FIXTURE_PROVENANCE_2,
  makeNode,
  observedFailurePayload,
  skillPayload,
  titledPayload,
} from './testing.js';
import { isProvenanceRefView } from './shared.js';

describe('node creation (positive — all eleven kinds)', () => {
  it('creates a versioned, digest-addressed node for every §4 kind', async () => {
    const kinds = [
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
    ] as const;
    for (const kind of kinds) {
      const node = await makeNode(kind, `${kind}-fixture`, '1.2.3', {
        ...(kind === 'skill' ? { provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest } } : {}),
      });
      expect(node.kind).toBe(kind);
      expect(node.id).toBe(`${kind}-fixture`);
      expect(node.version).toBe('1.2.3');
      expect(node.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(isCapabilityNode(node)).toBe(true);
      expect(Object.isFrozen(node)).toBe(true);
      expect(Object.isFrozen(node.payload)).toBe(true);
      expect(node.payloadSchema.namespace).toBe('capability');
    }
  });

  it('payload schemas are versioned SchemaRefs per payload family', () => {
    expect(payloadSchemaForNodeKind('skill')).toEqual({
      namespace: 'capability',
      name: 'skill-payload',
      version: '1.0.0',
    });
    expect(payloadSchemaForNodeKind('observed-failure')).toEqual({
      namespace: 'capability',
      name: 'observed-failure-payload',
      version: '1.0.0',
    });
    expect(payloadSchemaForNodeKind('domain')).toEqual({
      namespace: 'capability',
      name: 'node-payload',
      version: '1.0.0',
    });
  });

  it('skill nodes carry the §3 shape and provenance is addressable', async () => {
    const node = await makeNode('skill', 'read-diff', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const payload = node.payload;
    if (!('inputs' in payload)) throw new Error('expected a skill payload');
    expect(payload.inputs).toHaveLength(1);
    expect(payload.outputs).toHaveLength(1);
    expect(payload.prerequisites).toEqual(['fixture-prerequisite']);
    expect(payload.evidence).toHaveLength(1);
    expect(payload.tests).toHaveLength(1);
    expect(payload.professionalLimitations).toEqual([]);
    expect(payload.customerData).toBe('none');
    expect(isProvenanceRefView(node.provenance)).toBe(true);
    expect(node.provenance?.recordDigest).toBe(FIXTURE_PROVENANCE.recordDigest);
  });

  it('observed-failure payloads carry observedAt and severity', async () => {
    const node = await makeNode('observed-failure', 'late-review', '1.0.0');
    const payload = node.payload;
    if (!('severity' in payload)) throw new Error('expected an observed-failure payload');
    expect(payload.severity).toBe('moderate');
    expect(payload.observedAt).toBe('2026-09-26T12:00:00.000Z');
  });
});

describe('node creation (negative — invalid inputs are rejected)', () => {
  it('rejects unknown kinds', async () => {
    await expect(
      createCapabilityNode({ kind: 'model', id: 'gpt-thing', version: '1.0.0', payload: titledPayload() }),
    ).rejects.toThrow(/unknown capability node kind/);
    await expect(
      createCapabilityNode({ kind: '', id: 'x', version: '1.0.0', payload: titledPayload() }),
    ).rejects.toThrow(CapabilityGraphError);
  });

  it('rejects invalid ids and versions', async () => {
    await expect(
      createCapabilityNode({ kind: 'domain', id: 'Bad Id', version: '1.0.0', payload: titledPayload() }),
    ).rejects.toThrow(/invalid capability node id/);
    await expect(
      createCapabilityNode({ kind: 'domain', id: 'ok', version: '1.0', payload: titledPayload() }),
    ).rejects.toThrow(/invalid capability node version/);
  });

  it('rejects kind/payload mismatches', async () => {
    await expect(
      createCapabilityNode({ kind: 'skill', id: 'x', version: '1.0.0', payload: titledPayload() }),
    ).rejects.toThrow(/skill nodes require a skill payload/);
    await expect(
      createCapabilityNode({ kind: 'domain', id: 'x', version: '1.0.0', payload: skillPayload() }),
    ).rejects.toThrow(/titled node kinds require a titled payload/);
    await expect(
      createCapabilityNode({
        kind: 'observed-failure',
        id: 'x',
        version: '1.0.0',
        payload: titledPayload(),
      }),
    ).rejects.toThrow(/observed-failure nodes require an observed-failure payload/);
  });

  it('rejects malformed skill payloads field by field', async () => {
    const base = {
      kind: 'skill',
      id: 'x',
      version: '1.0.0',
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    };
    await expect(
      createCapabilityNode({ ...base, payload: { ...skillPayload(), title: '' } }),
    ).rejects.toThrow(CapabilityGraphError);
    await expect(
      createCapabilityNode({ ...base, payload: { ...skillPayload(), customerData: 'somehow' } }),
    ).rejects.toThrow(CapabilityGraphError);
    await expect(
      createCapabilityNode({ ...base, payload: { ...skillPayload(), inputs: [{ name: 'Bad Name' }] } }),
    ).rejects.toThrow(CapabilityGraphError);
    await expect(
      createCapabilityNode({ ...base, payload: { ...skillPayload(), evidence: [{ namespace: 'BAD' }] } }),
    ).rejects.toThrow(CapabilityGraphError);
    await expect(
      createCapabilityNode({ ...base, payload: { ...skillPayload(), prerequisites: [''] } }),
    ).rejects.toThrow(CapabilityGraphError);
  });

  it('rejects malformed titled and observed-failure payloads', async () => {
    await expect(
      createCapabilityNode({ kind: 'domain', id: 'x', version: '1.0.0', payload: { title: '' } }),
    ).rejects.toThrow(CapabilityGraphError);
    await expect(
      createCapabilityNode({ kind: 'domain', id: 'x', version: '1.0.0', payload: { title: 'x', category: 'not-a-category' } }),
    ).rejects.toThrow(CapabilityGraphError);
    await expect(
      createCapabilityNode({
        kind: 'observed-failure',
        id: 'x',
        version: '1.0.0',
        payload: { ...observedFailurePayload(), observedAt: '2026-02-30T00:00:00.000Z' },
      }),
    ).rejects.toThrow(CapabilityGraphError);
    await expect(
      createCapabilityNode({
        kind: 'observed-failure',
        id: 'x',
        version: '1.0.0',
        payload: { ...observedFailurePayload(), severity: 'catastrophic' },
      }),
    ).rejects.toThrow(CapabilityGraphError);
  });

  it('rejects skill nodes without provenance (§3)', async () => {
    await expect(
      createCapabilityNode({
        kind: 'skill',
        id: 'x',
        version: '1.0.0',
        payload: skillPayload(),
      }),
    ).rejects.toThrow(/skill nodes require provenance/);
  });

  it('rejects malformed provenance refs and supersedes digests', async () => {
    await expect(
      createCapabilityNode({
        kind: 'domain',
        id: 'x',
        version: '1.0.0',
        payload: titledPayload(),
        provenance: { recordDigest: 'not-hex' },
      }),
    ).rejects.toThrow(/provenance/);
    await expect(
      createCapabilityNode({
        kind: 'domain',
        id: 'x',
        version: '1.0.0',
        payload: titledPayload(),
        supersedes: 'XYZ',
      }),
    ).rejects.toThrow(/invalid node digest/);
  });
});

describe('content-addressed dedup (gate 2)', () => {
  it('same content ⇒ same digest; different content ⇒ different digest', async () => {
    const a = await makeNode('domain', 'd', '1.0.0');
    const b = await makeNode('domain', 'd', '1.0.0');
    expect(a.digest).toBe(b.digest);

    const changedTitle = await makeNode('domain', 'd', '1.0.0', {
      payload: titledPayload({ description: 'different' }),
    });
    expect(changedTitle.digest).not.toBe(a.digest);

    const changedProvenance = await makeNode('skill', 'skill-id', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE_2.recordDigest },
    });
    const original = await makeNode('skill', 'skill-id', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    expect(changedProvenance.digest).not.toBe(original.digest);

    const supersedesView = await makeNode('domain', 'd', '1.1.0', {
      supersedes: a.digest,
    });
    const plainView = await makeNode('domain', 'd', '1.1.0');
    expect(supersedesView.digest).not.toBe(plainView.digest);
  });

  it('payload key order does not affect the digest (canonical JSON)', async () => {
    const payloadA = { title: 'T', description: 'D', category: 'domain-method' };
    const payloadB = { category: 'domain-method', description: 'D', title: 'T' };
    const nodeA = await createCapabilityNode({
      kind: 'sub-capability',
      id: 'sc',
      version: '1.0.0',
      payload: payloadA,
    });
    const nodeB = await createCapabilityNode({
      kind: 'sub-capability',
      id: 'sc',
      version: '1.0.0',
      payload: payloadB,
    });
    expect(nodeA.digest).toBe(nodeB.digest);
  });
});

describe('deep-freeze (gates 6, 11)', () => {
  it('any mutation attempt on a node throws TypeError', async () => {
    const node = await makeNode('skill', 'read-diff', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    expect(() => {
      (node as unknown as Record<string, unknown>)['id'] = 'other';
    }).toThrow(TypeError);
    expect(() => {
      (node.payload as unknown as Record<string, unknown>)['title'] = 'other';
    }).toThrow(TypeError);
    const payload = node.payload;
    if ('inputs' in payload) {
      expect(() => {
        (payload.inputs as unknown as Record<string, unknown>)['length'] = 0;
      }).toThrow(TypeError);
      expect(() => {
        (payload.inputs as unknown as { push(item: unknown): void }).push({ name: 'x' });
      }).toThrow(TypeError);
    }
    // the node is unchanged after the attempts
    expect(node.id).toBe('read-diff');
    expect(isCapabilityNode(node)).toBe(true);
  });
});

describe('fail-closed verification (tamper tripwire)', () => {
  it('verifyCapabilityNode recomputes and accepts honest nodes', async () => {
    const node = await makeNode('tool', 'git-cli', '1.0.0');
    await expect(verifyCapabilityNode(node)).resolves.toBe(node.digest);
  });

  it('detects a tampered payload (stale digest) — fails closed', async () => {
    const node = await makeNode('tool', 'git-cli', '1.0.0');
    const tampered = {
      ...node,
      payload: { title: 'Tampered title' },
    };
    await expect(verifyCapabilityNode(tampered)).rejects.toMatchObject({
      code: CAPABILITY_GRAPH_ERROR_CODES.TAMPERED,
    });
  });

  it('rejects structurally invalid nodes outright', async () => {
    await expect(verifyCapabilityNode({ kind: 'tool' } as never)).rejects.toMatchObject({
      code: CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE,
    });
  });

  it('structural validator rejects wrong payloadSchema, bad digests, bad provenance', async () => {
    const node = await makeNode('tool', 'git-cli', '1.0.0');
    expect(isCapabilityNode({ ...node, digest: 'zzz' })).toBe(false);
    expect(
      isCapabilityNode({ ...node, payloadSchema: { namespace: 'wrong', name: 'node-payload', version: '1.0.0' } }),
    ).toBe(false);
    expect(
      isCapabilityNode({
        ...node,
        provenance: { recordDigest: 'not-hex' },
      }),
    ).toBe(false);
  });
});

describe('node refs', () => {
  it('toCapabilityNodeRef validates and freezes; capabilityNodeRef views a node', async () => {
    const node = await makeNode('skill', 'read-diff', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const ref = toCapabilityNodeRef({
      kind: 'skill',
      id: 'read-diff',
      version: '1.0.0',
      digest: node.digest,
    });
    expect(isCapabilityNodeRef(ref)).toBe(true);
    expect(Object.isFrozen(ref)).toBe(true);
    expect(() =>
      toCapabilityNodeRef({ kind: 'model', id: 'x', version: '1.0.0', digest: node.digest }),
    ).toThrow(/unknown capability node kind/);
    expect(() =>
      toCapabilityNodeRef({ kind: 'skill', id: 'x', version: '1.0.0', digest: 'zzz' }),
    ).toThrow(/invalid node digest/);
    const view = capabilityNodeRef(node);
    expect(view.digest).toBe(node.digest);
    expect(capabilityNodeKey(view)).toBe('skill/read-diff@1.0.0');
  });
});

describe('decomposition categories (§3, verbatim seven)', () => {
  it('the enum carries exactly the seven §3 categories', () => {
    expect([...CAPABILITY_DECOMPOSITION_CATEGORIES].sort()).toEqual([
      'communication-escalation-behavior',
      'declarative-knowledge',
      'domain-method',
      'procedural-skill',
      'reasoning-decision-pattern',
      'tool-skill',
      'verification-skill',
    ]);
  });
});
