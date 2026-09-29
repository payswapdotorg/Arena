/**
 * SkillDraft tests (Work Order A019): A004 compatibility BY CONSTRUCTION —
 * drafts carry REAL CapabilityNodes/CapabilityEdges built through
 * @arena/capability-graph's own constructors, and the integration proof
 * appends a draft's node + edges into a REAL graph (supersession by
 * append; the superseded node stays immutable and addressable — lock
 * rule 6).
 */

import { describe, expect, it } from 'vitest';
import {
  appendEdge,
  appendNode,
  createCapabilityNode,
  emptyCapabilityGraph,
  isCapabilityNode,
  isCapabilityEdge,
  verifyCapabilityNode,
} from '@arena/capability-graph';
import { SKILL_EXTRACTION_ERROR_CODES } from './errors.js';
import {
  buildSkillDraft,
  draftEvidenceArtifactRefs,
  isSkillDraft,
  isSkillDraftView,
  skillDraftView,
  verifySkillDraft,
} from './draft.js';
import { createExtractionPolicy } from './policy.js';
import { mineSkillCandidates } from './candidate.js';
import type { MiningContext } from './candidate.js';
import { CORR_ID, makePolicyInput, makeValidatedRef, T7 } from './test-support.js';
import type { CorrelationId } from '@arena/protocol-core';

const CONTEXT: MiningContext = {
  correlationId: CORR_ID as CorrelationId,
  extractedAt: T7,
};

/** Build a REAL A004 target capability node for taxonomy placement. */
async function makeRealTargetNode() {
  return createCapabilityNode({
    kind: 'capability',
    id: 'capability-reconciliation',
    version: '1.2.0',
    payload: { title: 'Reconciliation capability', description: 'fixture target node' },
  });
}

describe('SkillDraft — A004 compatibility by construction', () => {
  it('packages an accepted candidate into a REAL A004 skill node + provenance-bearing edge', async () => {
    const ref = await makeValidatedRef();
    const targetNode = await makeRealTargetNode();
    const policy = await createExtractionPolicy(
      makePolicyInput({
        targetNode: {
          kind: targetNode.kind,
          id: targetNode.id,
          version: targetNode.version,
          digest: targetNode.digest,
        },
      }),
    );
    const mining = await mineSkillCandidates([ref], policy, CONTEXT);
    const candidate = mining.candidates[0];
    expect(candidate).toBeDefined();
    const draft = await buildSkillDraft(candidate!, policy, [ref]);

    expect(isSkillDraftView(draft)).toBe(true);
    expect(isSkillDraft(draft)).toBe(true);
    expect(draft.candidateDigest).toBe(candidate!.digest);
    expect(draft.supersedes).toBeNull();

    // The node is a REAL A004 skill node: §3 payload shape + provenance.
    const node = draft.skillNode;
    expect(isCapabilityNode(node)).toBe(true);
    expect(node.kind).toBe('skill');
    await expect(verifyCapabilityNode(node)).resolves.toBe(node.digest);
    expect(node.provenance).toEqual({ recordDigest: candidate!.digest });
    expect(node.payload).toMatchObject({
      category: 'procedural-skill',
      customerData: 'derived',
    });
    if ('title' in node.payload && 'inputs' in node.payload && 'evidence' in node.payload) {
      expect(node.payload.title).toContain('Mined skill');
      expect(node.payload.inputs.length).toBeGreaterThan(0);
      expect(node.payload.evidence.length).toBeGreaterThan(0);
      expect(node.payload.tests).toEqual([]);
      expect(node.payload.professionalLimitations.length).toBeGreaterThan(0);
    } else {
      expect.unreachable('skill node payload must be a skill payload');
    }

    // The edge is a REAL provenance-bearing decomposes-into edge.
    expect(draft.edges).toHaveLength(1);
    const edge = draft.edges[0] as NonNullable<typeof draft.edges[0]>;
    expect(isCapabilityEdge(edge)).toBe(true);
    expect(edge.kind).toBe('decomposes-into');
    expect(edge.provenance).toEqual({ recordDigest: candidate!.digest });
    expect(edge.source.digest).toBe(targetNode.digest);
    expect(edge.target.digest).toBe(node.digest);
  });

  it('the draft digest is content-addressed and verifiable', async () => {
    const ref = await makeValidatedRef();
    const targetNode = await makeRealTargetNode();
    const policy = await createExtractionPolicy(
      makePolicyInput({
        targetNode: {
          kind: targetNode.kind,
          id: targetNode.id,
          version: targetNode.version,
          digest: targetNode.digest,
        },
      }),
    );
    const mining = await mineSkillCandidates([ref], policy, CONTEXT);
    const candidate = mining.candidates[0]!;
    const draftA = await buildSkillDraft(candidate, policy, [ref]);
    const draftB = await buildSkillDraft(candidate, policy, [ref]);
    expect(draftA.digest).toBe(draftB.digest);
    await expect(verifySkillDraft(draftA)).resolves.toBe(draftA.digest);
    const view = skillDraftView(draftA);
    expect('digest' in view).toBe(false);
  });

  it('draft evidence carries the REAL artifact refs the verifiers examined', async () => {
    const ref = await makeValidatedRef();
    const targetNode = await makeRealTargetNode();
    const policy = await createExtractionPolicy(
      makePolicyInput({
        targetNode: {
          kind: targetNode.kind,
          id: targetNode.id,
          version: targetNode.version,
          digest: targetNode.digest,
        },
      }),
    );
    const mining = await mineSkillCandidates([ref], policy, CONTEXT);
    const candidate = mining.candidates[0]!;
    const refs = draftEvidenceArtifactRefs(candidate, [ref]);
    expect(refs.length).toBeGreaterThan(0);
    for (const artifact of refs) {
      expect(artifact.digest).toMatch(/^[0-9a-f]{64}$/);
    }
    // The trajectory chain head is among the addressed evidence.
    expect(refs.some((artifact) => artifact.digest === (ref.trajectory.chainHead as string))).toBe(true);
  });
});

describe('SkillDraft — real graph integration (append-only)', () => {
  it('a draft appends cleanly into a REAL capability graph containing the target node', async () => {
    const ref = await makeValidatedRef();
    const targetNode = await makeRealTargetNode();
    const policy = await createExtractionPolicy(
      makePolicyInput({
        targetNode: {
          kind: targetNode.kind,
          id: targetNode.id,
          version: targetNode.version,
          digest: targetNode.digest,
        },
      }),
    );
    const mining = await mineSkillCandidates([ref], policy, CONTEXT);
    const candidate = mining.candidates[0]!;
    const draft = await buildSkillDraft(candidate, policy, [ref]);

    let graph = await appendNode(emptyCapabilityGraph(), targetNode);
    graph = await appendNode(graph, draft.skillNode);
    for (const edge of draft.edges) {
      graph = await appendEdge(graph, edge);
    }
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.nodes[1]?.digest).toBe(draft.skillNode.digest);
  });

  it('supersession is APPEND-ONLY: a superseding draft appends, the original stays immutable and addressable', async () => {
    const ref = await makeValidatedRef();
    const targetNode = await makeRealTargetNode();
    const policy = await createExtractionPolicy(
      makePolicyInput({
        targetNode: {
          kind: targetNode.kind,
          id: targetNode.id,
          version: targetNode.version,
          digest: targetNode.digest,
        },
      }),
    );
    const mining = await mineSkillCandidates([ref], policy, CONTEXT);
    const candidate = mining.candidates[0]!;
    const first = await buildSkillDraft(candidate, policy, [ref]);

    let graph = await appendNode(emptyCapabilityGraph(), targetNode);
    graph = await appendNode(graph, first.skillNode);

    // Re-extraction under a bumped version supersedes BY APPEND.
    const second = await buildSkillDraft(candidate, policy, [ref], {
      skillVersion: '1.1.0',
      supersedes: first.skillNode.digest,
    });
    expect(second.supersedes).toBe(first.skillNode.digest);
    expect(second.skillNode.version).toBe('1.1.0');
    graph = await appendNode(graph, second.skillNode);

    // The original node is still present, immutable and addressable.
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.some((node) => node.digest === first.skillNode.digest)).toBe(true);
    expect(graph.nodes.some((node) => node.digest === second.skillNode.digest)).toBe(true);
  });

  it('REJECTS a supersedes digest that is not sha256 hex', async () => {
    const ref = await makeValidatedRef();
    const targetNode = await makeRealTargetNode();
    const policy = await createExtractionPolicy(
      makePolicyInput({
        targetNode: {
          kind: targetNode.kind,
          id: targetNode.id,
          version: targetNode.version,
          digest: targetNode.digest,
        },
      }),
    );
    const mining = await mineSkillCandidates([ref], policy, CONTEXT);
    const candidate = mining.candidates[0]!;
    await expect(
      buildSkillDraft(candidate, policy, [ref], { supersedes: 'nothex' }),
    ).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_DIGEST,
    });
  });

  it('REJECTS a structurally invalid candidate', async () => {
    const ref = await makeValidatedRef();
    const targetNode = await makeRealTargetNode();
    const policy = await createExtractionPolicy(
      makePolicyInput({
        targetNode: {
          kind: targetNode.kind,
          id: targetNode.id,
          version: targetNode.version,
          digest: targetNode.digest,
        },
      }),
    );
    await expect(
      buildSkillDraft({ not: 'a-candidate' } as never, policy, [ref]),
    ).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_CANDIDATE,
    });
  });

  it('detects draft tampering (digest recomputation mismatch)', async () => {
    const ref = await makeValidatedRef();
    const targetNode = await makeRealTargetNode();
    const policy = await createExtractionPolicy(
      makePolicyInput({
        targetNode: {
          kind: targetNode.kind,
          id: targetNode.id,
          version: targetNode.version,
          digest: targetNode.digest,
        },
      }),
    );
    const mining = await mineSkillCandidates([ref], policy, CONTEXT);
    const candidate = mining.candidates[0]!;
    const draft = await buildSkillDraft(candidate, policy, [ref]);
    const tampered = {
      ...draft,
      supersedes: '1111111111111111111111111111111111111111111111111111111111111111',
    };
    await expect(verifySkillDraft(tampered)).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.TAMPERED,
    });
  });
});
