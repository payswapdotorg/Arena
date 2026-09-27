/**
 * Domain pack tests (Work Order A004, gate 9; architecture-lock rule 21;
 * requirement R37): packs extend the graph append-only, declare
 * skills/environments/evaluators, are idempotent on re-application, and can
 * NEVER supersede/rewrite nodes they do not own (PACK_OVERREACH).
 */

import { describe, expect, it } from 'vitest';
import {
  applyDomainPack,
  isDomainPack,
  isEnvironmentExtensionRef,
  toDomainPack,
} from './domain-pack.js';
import { CAPABILITY_GRAPH_ERROR_CODES } from './errors.js';
import {
  appendNode,
  buildCapabilityGraph,
  emptyCapabilityGraph,
  getNode,
  nodeDeclaredBy,
} from './graph.js';
import { makeNode, skillPayload, titledPayload, FIXTURE_PROVENANCE } from './testing.js';

describe('domain pack application (positive — packs only append)', () => {
  it('applies a pack: adds skills, evaluators and edges; records ownership', async () => {
    const domain = await makeNode('domain', 'software-engineering', '1.0.0');
    const graph = await appendNode(emptyCapabilityGraph(), domain);

    const skill = {
      id: 'pack-skill',
      version: '1.0.0',
      payload: skillPayload({ title: 'Pack skill' }),
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    };
    const evaluator = {
      id: 'pack-evaluator',
      version: '1.0.0',
      payload: titledPayload({ title: 'Pack evaluator' }),
    };
    const pack = toDomainPack({
      packId: 'se-review-pack',
      version: '1.0.0',
      targetDomain: { kind: 'domain', id: 'software-engineering', version: '1.0.0' },
      declaration: {
        skills: [skill],
        evaluators: [evaluator],
        environments: [{ environmentId: 'se-ci-env', version: '1.2.0' }],
        edges: [],
      },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });

    const applied = await applyDomainPack(graph, pack, {
      appliedAt: '2026-09-26T12:00:00.000Z',
    });
    expect(applied.nodes).toHaveLength(3); // domain + skill + evaluator
    expect(applied.packs).toHaveLength(1);
    expect(applied.packs[0]?.pack.packId).toBe('se-review-pack');
    expect(applied.packs[0]?.declaredNodeKeys).toEqual([
      'evaluator/pack-evaluator@1.0.0',
      'skill/pack-skill@1.0.0',
    ]);
    expect(applied.packs[0]?.packDigest).toMatch(/^[0-9a-f]{64}$/);

    // ownership is derived from the pack record
    const packSkill = getNode(applied, { kind: 'skill', id: 'pack-skill', version: '1.0.0' });
    expect(packSkill).not.toBeNull();
    if (packSkill !== null) {
      expect(nodeDeclaredBy(applied, packSkill)).toBe('se-review-pack');
    }
    expect(nodeDeclaredBy(applied, domain)).toBeNull();
  });

  it('pack edges connect pack nodes and existing nodes (append)', async () => {
    const domain = await makeNode('domain', 'd', '1.0.0');
    const coreSkill = await makeNode('skill', 'core-skill', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const graph = await buildCapabilityGraph([domain, coreSkill]);

    const packSkillNode = await makeNode('skill', 'pack-skill', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const pack = toDomainPack({
      packId: 'edge-pack',
      version: '1.0.0',
      targetDomain: { kind: 'domain', id: 'd', version: '1.0.0' },
      declaration: {
        skills: [
          {
            id: 'pack-skill',
            version: '1.0.0',
            payload: skillPayload(),
            provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
          },
        ],
        evaluators: [],
        environments: [],
        edges: [
          {
            kind: 'requires',
            source: {
              kind: 'skill',
              id: 'core-skill',
              version: '1.0.0',
              digest: coreSkill.digest,
            },
            target: {
              kind: 'skill',
              id: 'pack-skill',
              version: '1.0.0',
              digest: packSkillNode.digest,
            },
            provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
          },
        ],
      },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const applied = await applyDomainPack(graph, pack, {
      appliedAt: '2026-09-26T12:00:00.000Z',
    });
    expect(applied.edges).toHaveLength(1);
    expect(applied.edges[0]?.kind).toBe('requires');
    expect(applied.nodes).toHaveLength(3);
  });

  it('re-applying a bit-identical pack is idempotent', async () => {
    const domain = await makeNode('domain', 'd', '1.0.0');
    const graph = await appendNode(emptyCapabilityGraph(), domain);
    const pack = toDomainPack({
      packId: 'idem-pack',
      version: '1.0.0',
      targetDomain: { kind: 'domain', id: 'd', version: '1.0.0' },
      declaration: {
        skills: [
          {
            id: 'idem-skill',
            version: '1.0.0',
            payload: skillPayload(),
            provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
          },
        ],
        evaluators: [],
        environments: [],
        edges: [],
      },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const once = await applyDomainPack(graph, pack, {
      appliedAt: '2026-09-26T12:00:00.000Z',
    });
    const twice = await applyDomainPack(once, pack, {
      appliedAt: '2026-09-26T13:00:00.000Z',
    });
    expect(twice).toBe(once); // same object — nothing appended
  });

  it('a NEW version of the same pack can supersede its own prior node', async () => {
    const domain = await makeNode('domain', 'd', '1.0.0');
    const graph = await appendNode(emptyCapabilityGraph(), domain);
    const v1Pack = toDomainPack({
      packId: 'evolving-pack',
      version: '1.0.0',
      targetDomain: { kind: 'domain', id: 'd', version: '1.0.0' },
      declaration: {
        skills: [
          {
            id: 'evolving-skill',
            version: '1.0.0',
            payload: skillPayload(),
            provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
          },
        ],
        evaluators: [],
        environments: [],
        edges: [],
      },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const withV1 = await applyDomainPack(graph, v1Pack, {
      appliedAt: '2026-09-26T12:00:00.000Z',
    });
    const v1Node = getNode(withV1, {
      kind: 'skill',
      id: 'evolving-skill',
      version: '1.0.0',
    });
    expect(v1Node).not.toBeNull();
    if (v1Node === null) throw new Error('fixture node missing');

    const v2Pack = toDomainPack({
      packId: 'evolving-pack',
      version: '1.1.0',
      targetDomain: { kind: 'domain', id: 'd', version: '1.0.0' },
      declaration: {
        skills: [
          {
            id: 'evolving-skill',
            version: '2.0.0',
            payload: skillPayload({ summary: 'Evolved.' }),
            provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
            supersedes: v1Node.digest,
          },
        ],
        evaluators: [],
        environments: [],
        edges: [],
      },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const withV2 = await applyDomainPack(withV1, v2Pack, {
      appliedAt: '2026-09-26T14:00:00.000Z',
    });
    expect(withV2.nodes).toHaveLength(3); // domain + v1 + v2 (append-only!)
    expect(getNode(withV2, { kind: 'skill', id: 'evolving-skill', version: '1.0.0' })).toBe(
      v1Node,
    );
  });
});

describe('domain pack overreach (negative — gate 9, lock rule 21)', () => {
  it('a pack cannot REDEFINE an existing non-owned node', async () => {
    const domain = await makeNode('domain', 'd', '1.0.0');
    const coreSkill = await makeNode('skill', 'core-skill', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const graph = await buildCapabilityGraph([domain, coreSkill]);
    const hostile = toDomainPack({
      packId: 'hostile-pack',
      version: '1.0.0',
      targetDomain: { kind: 'domain', id: 'd', version: '1.0.0' },
      declaration: {
        skills: [
          {
            id: 'core-skill',
            version: '1.0.0',
            payload: skillPayload({ summary: 'Hostile rewrite.' }),
            provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
          },
        ],
        evaluators: [],
        environments: [],
        edges: [],
      },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    await expect(applyDomainPack(graph, hostile)).rejects.toMatchObject({
      code: CAPABILITY_GRAPH_ERROR_CODES.PACK_OVERREACH,
    });
  });

  it('a pack cannot SUPERSEDE a non-owned node', async () => {
    const domain = await makeNode('domain', 'd', '1.0.0');
    const coreSkill = await makeNode('skill', 'core-skill', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const graph = await buildCapabilityGraph([domain, coreSkill]);
    const hostile = toDomainPack({
      packId: 'hostile-pack',
      version: '1.0.0',
      targetDomain: { kind: 'domain', id: 'd', version: '1.0.0' },
      declaration: {
        skills: [
          {
            id: 'core-skill',
            version: '2.0.0',
            payload: skillPayload(),
            provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
            supersedes: coreSkill.digest,
          },
        ],
        evaluators: [],
        environments: [],
        edges: [],
      },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    let caught: unknown;
    try {
      await applyDomainPack(graph, hostile);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    const message = String((caught as Error).message);
    expect(message).toContain('pack hostile-pack attempts');
    expect(message).toContain('which it does not own');
  });

  it('a pack cannot supersede a node owned by a DIFFERENT pack', async () => {
    const domain = await makeNode('domain', 'd', '1.0.0');
    const graph = await appendNode(emptyCapabilityGraph(), domain);
    const packA = toDomainPack({
      packId: 'pack-a',
      version: '1.0.0',
      targetDomain: { kind: 'domain', id: 'd', version: '1.0.0' },
      declaration: {
        skills: [
          {
            id: 'shared-skill',
            version: '1.0.0',
            payload: skillPayload(),
            provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
          },
        ],
        evaluators: [],
        environments: [],
        edges: [],
      },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const withA = await applyDomainPack(graph, packA, {
      appliedAt: '2026-09-26T12:00:00.000Z',
    });
    const aSkill = getNode(withA, { kind: 'skill', id: 'shared-skill', version: '1.0.0' });
    expect(aSkill).not.toBeNull();
    if (aSkill === null) throw new Error('fixture node missing');
    const packB = toDomainPack({
      packId: 'pack-b',
      version: '1.0.0',
      targetDomain: { kind: 'domain', id: 'd', version: '1.0.0' },
      declaration: {
        skills: [
          {
            id: 'shared-skill',
            version: '2.0.0',
            payload: skillPayload(),
            provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
            supersedes: aSkill.digest,
          },
        ],
        evaluators: [],
        environments: [],
        edges: [],
      },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    await expect(applyDomainPack(withA, packB)).rejects.toMatchObject({
      code: CAPABILITY_GRAPH_ERROR_CODES.PACK_OVERREACH,
    });
  });

  it('the same pack identity with different content is rejected', async () => {
    const domain = await makeNode('domain', 'd', '1.0.0');
    const graph = await appendNode(emptyCapabilityGraph(), domain);
    const base: Parameters<typeof toDomainPack>[0] = {
      packId: 'conflicting-pack',
      version: '1.0.0',
      targetDomain: { kind: 'domain', id: 'd', version: '1.0.0' },
      declaration: {
        skills: [
          {
            id: 'conflicting-skill',
            version: '1.0.0',
            payload: skillPayload(),
            provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
          },
        ],
        evaluators: [],
        environments: [],
        edges: [],
      },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    };
    const applied = await applyDomainPack(graph, toDomainPack(base), {
      appliedAt: '2026-09-26T12:00:00.000Z',
    });
    const mutated = toDomainPack({
      ...base,
      declaration: {
        ...base.declaration,
        skills: [
          {
            id: 'conflicting-skill',
            version: '1.0.0',
            payload: skillPayload({ summary: 'Different content.' }),
            provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
          },
        ],
      },
    });
    await expect(applyDomainPack(applied, mutated)).rejects.toMatchObject({
      code: CAPABILITY_GRAPH_ERROR_CODES.IDENTITY_CONFLICT,
    });
  });

  it('a pack whose target domain is missing is rejected', async () => {
    const graph = emptyCapabilityGraph();
    const pack = toDomainPack({
      packId: 'orphan-pack',
      version: '1.0.0',
      targetDomain: { kind: 'domain', id: 'no-such-domain', version: '1.0.0' },
      declaration: { skills: [], evaluators: [], environments: [], edges: [] },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    await expect(applyDomainPack(graph, pack)).rejects.toMatchObject({
      code: CAPABILITY_GRAPH_ERROR_CODES.NODE_NOT_FOUND,
    });
  });
});

describe('descriptor validation (positive + negative)', () => {
  it('isDomainPack and toDomainPack validate the descriptor shape', () => {
    const good: Parameters<typeof toDomainPack>[0] = {
      packId: 'ok-pack',
      version: '1.0.0',
      targetDomain: { kind: 'domain', id: 'd', version: '1.0.0' },
      declaration: {
        skills: [],
        evaluators: [],
        environments: [{ environmentId: 'env', version: '1.0.0' }],
        edges: [],
      },
      provenance: { recordDigest: 'a'.repeat(64) },
    };
    expect(isDomainPack(good)).toBe(true);
    expect(() => toDomainPack(good)).not.toThrow();
    expect(isEnvironmentExtensionRef({ environmentId: 'env', version: '1.0.0' })).toBe(true);

    expect(isDomainPack({ ...good, packId: 'BAD ID' })).toBe(false);
    expect(() => toDomainPack({ ...good, packId: 'BAD ID' })).toThrow(/invalid domain pack id/);
    expect(() => toDomainPack({ ...good, version: '1.0' })).toThrow(/invalid domain pack version/);
    expect(() =>
      toDomainPack({
        ...good,
        targetDomain: { kind: 'skill', id: 'd', version: '1.0.0' } as never,
      }),
    ).toThrow(/targetDomain/);
    expect(() =>
      toDomainPack({ ...good, declaration: { ...good.declaration, skills: 'nope' as never } }),
    ).toThrow(/skills array/);
    expect(() =>
      toDomainPack({
        ...good,
        declaration: { ...good.declaration, environments: [{}] as never },
      }),
    ).toThrow(/environment extension reference/);
    expect(() => toDomainPack({ ...good, provenance: { recordDigest: 'zz' } })).toThrow(
      /provenance reference/,
    );
    expect(isEnvironmentExtensionRef({ environmentId: 'BAD', version: '1.0.0' })).toBe(false);
    expect(isEnvironmentExtensionRef(null)).toBe(false);
  });

  it('environments are recorded as explicit references, never nodes', async () => {
    const domain = await makeNode('domain', 'd', '1.0.0');
    const graph = await appendNode(emptyCapabilityGraph(), domain);
    const pack = toDomainPack({
      packId: 'env-pack',
      version: '1.0.0',
      targetDomain: { kind: 'domain', id: 'd', version: '1.0.0' },
      declaration: {
        skills: [],
        evaluators: [],
        environments: [
          { environmentId: 'ci-env', version: '1.0.0' },
          { environmentId: 'staging-env', version: '2.1.0' },
        ],
        edges: [],
      },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const applied = await applyDomainPack(graph, pack, {
      appliedAt: '2026-09-26T12:00:00.000Z',
    });
    // no environment nodes were created (environment is not one of the 11 kinds)
    expect(applied.nodes).toHaveLength(1);
    expect(applied.nodes.map((node) => node.kind)).toEqual(['domain']);
    expect(applied.packs[0]?.pack.declaration.environments).toHaveLength(2);
  });
});
