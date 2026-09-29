/**
 * SkillDraft — the packaging of an accepted SkillCandidate into
 * A004 skill-node-ready payloads (Work Order A019; requirement R17;
 * docs/architecture.md §3 — "A Skill is a versioned artifact with
 * inputs, outputs, prerequisites, evidence, tests and provenance";
 * architecture-lock rules 5, 6, 18, 23).
 *
 * A draft carries:
 *
 *   - `skillNode` — a REAL @arena/capability-graph CapabilityNode of
 *     kind `skill`, constructed through that package's own
 *     createCapabilityNode (compatibility with the A004 surface is BY
 *     CONSTRUCTION, not by resemblance):
 *       - payload: the §3 shape — title/summary mined
 *         deterministically from the candidate, category
 *         `procedural-skill` (an action-sequence skill IS procedural
 *         by construction — a disclosed design decision), inputs /
 *         outputs / prerequisites from the candidate, evidence = the
 *         REAL A002-shaped artifact refs the validating verification
 *         records examined (the trajectory-addressing evidence of the
 *         candidate's source refs), tests = [] (extraction mints no
 *         test artifacts — explicit, see README limitations),
 *         professionalLimitations + customerData explicit (lock rule
 *         23; mined skills are DERIVED from trajectory content and
 *         carry no human semantic review);
 *       - provenance: { recordDigest: <candidate digest> } — the
 *         candidate is the content-addressed provenance record of the
 *         extraction (extractor version, policy digest, source
 *         trajectories, correlation id); this is how the lineage back
 *         to the source trajectories flows (see the note below);
 *       - supersedes: optional digest of a PRIOR skill-node version —
 *         append-only supersession per A004 (the prior node stays
 *         immutable and addressable forever; extraction NEVER edits
 *         graph history — lock rule 6).
 *
 *   - `edges` — REAL @arena/capability-graph CapabilityEdges, one
 *     provenance-bearing `decomposes-into` edge from the policy's
 *     taxonomy target node to the skill node. Every edge carries
 *     provenance { recordDigest: <candidate digest> } (lock rule 18).
 *
 *   - `supersedes` — the digest of the superseded prior skill-node
 *     version, or null (mirrored in the node's own supersedes field).
 *
 * NOTE on "edges back to source trajectories": trajectories are NOT a
 * node kind of the A004 graph (its closed eleven-kind set does not
 * include trajectories — the graph relates capabilities, skills, tools,
 * task families, evaluators, verifiers, expert competencies, observed
 * failures, body versions and domains). A direct edge to a trajectory
 * is therefore NOT expressible in A004 terms, and fabricating a
 * trajectory node kind would modify A004's owned surface. The honest,
 * in-contract lineage is the PROVENANCE CHAIN: skill node + edges →
 * candidate digest → candidate evidence set (trajectory chain heads +
 * evaluation digests + verification digests). The draft's node payload
 * evidence additionally carries the real A002-shaped artifact refs the
 * verifiers examined.
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  capabilityEdgeContentView,
  capabilityNodeContentView,
  createCapabilityEdge,
  createCapabilityNode,
  isCapabilityEdge,
  isCapabilityNode,
} from '@arena/capability-graph';
import type { CapabilityEdge, CapabilityNode } from '@arena/capability-graph';
import { SKILL_EXTRACTION_ERROR_CODES, SkillExtractionError } from './errors.js';
import type { ExtractionPolicy } from './policy.js';
import {
  candidateSummary,
  candidateTitle,
  isSkillCandidate,
} from './candidate.js';
import type { SkillCandidate } from './candidate.js';
import type { ValidatedTrajectoryRef } from './validated-ref.js';
import { deepFreeze, toContentDigest, toSkillExtractionVersion } from './shared.js';
import type { ContentDigest } from './shared.js';

/** Wire version of the skill-draft shape. */
export const SKILL_DRAFT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// SkillDraft
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the draft digest commits to. */
export interface SkillDraftView {
  readonly recordVersion: typeof SKILL_DRAFT_VERSION;
  /** The accepted candidate this draft packages. */
  readonly candidateDigest: ContentDigest;
  /** The REAL A004 skill node (constructed by @arena/capability-graph). */
  readonly skillNode: CapabilityNode;
  /** The REAL A004 provenance-bearing edges (decomposes-into, taxonomy). */
  readonly edges: readonly CapabilityEdge[];
  /** Prior skill-node digest superseded by this draft (append-only), or null. */
  readonly supersedes: string | null;
}

/** A frozen, content-addressed skill draft: the view plus its sha256 digest. */
export interface SkillDraft extends SkillDraftView {
  readonly digest: ContentDigest;
}

/** Stable field list for the draft view (tests mirror it). */
export const SKILL_DRAFT_FIELDS = Object.freeze([
  'recordVersion',
  'candidateDigest',
  'skillNode',
  'edges',
  'supersedes',
] as const) as readonly string[];

/** Structural (non-throwing) check for the digest-free draft view. */
export function isSkillDraftView(value: unknown): value is SkillDraftView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === SKILL_DRAFT_VERSION &&
    typeof candidate['candidateDigest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['candidateDigest']) &&
    isCapabilityNode(candidate['skillNode']) &&
    (candidate['skillNode'] as CapabilityNode).kind === 'skill' &&
    Array.isArray(candidate['edges']) &&
    (candidate['edges'] as unknown[]).every((edge) => isCapabilityEdge(edge)) &&
    (candidate['supersedes'] === null ||
      (typeof candidate['supersedes'] === 'string' && /^[0-9a-f]{64}$/.test(candidate['supersedes'])))
  );
}

/** Structural (non-throwing) check for the full draft (view + digest). */
export function isSkillDraft(value: unknown): value is SkillDraft {
  if (!isSkillDraftView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate['digest'] === 'string' && /^[0-9a-f]{64}$/.test(candidate['digest']);
}

/** Options for building a draft from a candidate. */
export interface BuildSkillDraftOptions {
  /**
   * Skill-node version override (default: the candidate's proposed
   * version). A supersession bumps this above the prior version.
   */
  readonly skillVersion?: string;
  /** Digest of the prior skill-node version being superseded (append-only). */
  readonly supersedes?: string | null;
}

/**
 * The REAL A002-shaped artifact refs the candidate's validating
 * verification records examined — derived deterministically from the
 * refs whose verification digests appear in the candidate's evidence
 * set (deduped, digest-sorted). These become the A004 skill payload's
 * `evidence` entries.
 */
export function draftEvidenceArtifactRefs(
  candidate: SkillCandidate,
  refs: readonly ValidatedTrajectoryRef[],
): readonly { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string }[] {
  const wanted = new Set<string>(candidate.evidence.verifications.map((digest) => digest as string));
  const byKey = new Map<
    string,
    { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string }
  >();
  for (const ref of refs) {
    for (const verification of ref.verifications) {
      if (!wanted.has(verification.digest as string)) continue;
      for (const evidence of verification.evidence) {
        const artifact = evidence.artifact;
        byKey.set(
          `${artifact.namespace}/${artifact.name}@${artifact.version}#${artifact.digest}`,
          artifact,
        );
      }
    }
  }
  return Object.freeze(
    [...byKey.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, artifact]) => artifact),
  );
}

/**
 * Build a SkillDraft from an accepted candidate — A004-ready BY
 * CONSTRUCTION: the node and edges are created through
 * @arena/capability-graph's own constructors, which enforce the skill
 * payload shape (§3), the provenance requirement, the edge endpoint
 * matrix and content addressing.
 *
 * `refs` must contain the validated refs that produced the candidate
 * (they supply the real evidence artifact refs; refs whose
 * verification digests are not in the candidate's evidence set are
 * ignored). Deterministic: same candidate + policy + refs + options ⇒
 * the same draft digest.
 */
export async function buildSkillDraft(
  candidate: SkillCandidate,
  policy: ExtractionPolicy,
  refs: readonly ValidatedTrajectoryRef[],
  options: BuildSkillDraftOptions = {},
): Promise<SkillDraft> {
  if (!isSkillCandidate(candidate)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'skill draft construction requires a structurally valid skill candidate',
    });
  }
  const skillVersion =
    options.skillVersion === undefined
      ? (candidate.proposedSkill.version as string)
      : toSkillExtractionVersion(options.skillVersion, 'draft skillVersion');
  const supersedes = options.supersedes === undefined || options.supersedes === null
    ? undefined
    : toContentDigest(options.supersedes, 'draft supersedes');

  const evidenceArtifacts = draftEvidenceArtifactRefs(candidate, refs);

  const skillNode = await createCapabilityNode({
    kind: 'skill',
    id: candidate.candidateId as string,
    version: skillVersion,
    payload: {
      title: candidateTitle(candidate.signature),
      summary: candidateSummary(candidate.signature, candidate.evidence, candidate.provenance),
      category: 'procedural-skill',
      inputs: candidate.inputs.map((port) => ({ name: port.name, description: port.description })),
      outputs: candidate.outputs.map((port) => ({ name: port.name, description: port.description })),
      prerequisites: [...candidate.prerequisites],
      evidence: evidenceArtifacts.map((artifact) => ({ ...artifact })),
      tests: [],
      professionalLimitations: [
        'extracted by deterministic pattern mining from validated trajectories; no human semantic review',
      ],
      customerData: 'derived',
    },
    provenance: { recordDigest: candidate.digest as string },
    ...(supersedes !== undefined ? { supersedes: supersedes as string } : {}),
  });

  const edge = await createCapabilityEdge({
    kind: 'decomposes-into',
    source: {
      kind: policy.taxonomy.targetNode.kind as string,
      id: policy.taxonomy.targetNode.id as string,
      version: policy.taxonomy.targetNode.version as string,
      digest: policy.taxonomy.targetNode.digest as string,
    },
    target: {
      kind: skillNode.kind,
      id: skillNode.id,
      version: skillNode.version,
      digest: skillNode.digest,
    },
    payload: {
      note: `skill extracted under policy ${policy.policyId}@${policy.version} (digest ${policy.digest})`,
    },
    provenance: { recordDigest: candidate.digest as string },
  });

  const view: SkillDraftView = {
    recordVersion: SKILL_DRAFT_VERSION,
    candidateDigest: candidate.digest,
    skillNode,
    edges: Object.freeze([edge]),
    supersedes: supersedes === undefined ? null : (supersedes as string),
  };
  const digest = await computeSkillDraftDigest(view);
  return deepFreeze({ ...view, digest }) as SkillDraft;
}

/** The draft digest: sha256 over the canonical digest-free view. */
export async function computeSkillDraftDigest(view: SkillDraftView): Promise<ContentDigest> {
  return toContentDigest(
    await digestCanonical({
      recordVersion: view.recordVersion,
      candidateDigest: view.candidateDigest,
      skillNode: capabilityNodeContentView(view.skillNode),
      edges: view.edges.map((edge) => capabilityEdgeContentView(edge)),
      supersedes: view.supersedes,
    }),
    'skill draft digest',
  );
}

/** The digest-free view of a draft (what the digest commits to). */
export function skillDraftView(draft: SkillDraft): SkillDraftView {
  const { digest: _digest, ...view } = draft;
  return deepFreeze({ ...view }) as SkillDraftView;
}

/**
 * Verify a draft: recompute the digest over the digest-free view and
 * compare (optionally against an expected digest). Throws
 * SKILL_EXTRACTION_TAMPERED on any mismatch.
 */
export async function verifySkillDraft(
  draft: SkillDraft,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isSkillDraft(draft)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_DRAFT, {
      message: 'draft verification requires a structurally valid skill draft',
    });
  }
  const actual = await computeSkillDraftDigest(skillDraftView(draft));
  const claimed = expectedDigest ?? (draft.digest as string);
  if (actual !== claimed) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.TAMPERED, {
      message: `skill draft digest mismatch: expected ${claimed}, recomputed ${actual}`,
      details: { candidateDigest: draft.candidateDigest, expected: claimed, actual },
    });
  }
  return actual;
}
