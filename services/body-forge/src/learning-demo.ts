/**
 * The compose-from-learning demo path (Work Order A021 item 8; lock
 * rule 6 — historical evidence is append-only and NEVER rewritten by
 * learning; the learning→forge boundary is PROPOSAL-only).
 *
 * `composeFromLearning` demonstrates the full A020→A019→A021 bridge:
 *
 *   1. it VALIDATES the motivating A020 ExperimentRunRecord through
 *      @arena/learning's REAL guard (isExperimentRunRecord);
 *   2. it VALIDATES the A019 SkillDraft through @arena/skill-extraction's
 *      REAL guard (isSkillDraft);
 *   3. it derives a NEW BodyManifest from a base manifest that CITES
 *      both records as EXPLICIT provenance refs (the experiment record
 *      by digest; the skill draft by digest, bound to the skill ref
 *      it proposes) and carries the requested parent/supersession
 *      lineage;
 *   4. it composes the new BodyVersion proposal through the fabric's
 *      deterministic core under the caller's policy.
 *
 * The source records are only READ: they stay bit-identical and frozen
 * (the learning-demo suite proves it). Learning PROPOSES; the forge
 * COMPOSES; history is never rewritten — the new version is a NEW
 * content-addressed object whose lineage cites its parents, and whose
 * manifest cites the experiment + draft that motivated it.
 */

import {
  BODY_FORGE_ERROR_CODES,
  BodyForgeError,
  createBodyManifest,
} from '@arena/body-forge';
import type { BodyManifest, ForgePolicy, ForgeResult } from '@arena/body-forge';
import { isExperimentRunRecord } from '@arena/learning';
import type { ExperimentRunRecord } from '@arena/learning';
import { isSkillDraft } from '@arena/skill-extraction';
import type { SkillDraft } from '@arena/skill-extraction';
import { isIdempotencyKey } from '@arena/protocol-core';
import { ForgeService } from './fabric.js';
import type { SubmitOptions } from './fabric.js';

/** Options for the compose-from-learning demo path. */
export interface ComposeFromLearningOptions extends SubmitOptions {
  /**
   * The base manifest the new composition derives from (its §12
   * content is inherited; target version, skills, citations and
   * lineage are extended per the demo rules below).
   */
  readonly baseManifest: BodyManifest;
  /** The policy to compose under (its learningAdmission rules apply). */
  readonly policy: ForgePolicy;
  /** The version number of the NEW BodyVersion (must differ from any parent's). */
  readonly targetVersion: string;
  /**
   * The prior body version the new version supersedes (append-only):
   * becomes BOTH the parent ref and the supersedes ref.
   */
  readonly supersedes?: {
    readonly tenant: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  /**
   * Namespace under which the draft's skill node is addressed as a
   * skill ref (default `arena-skills`; a demo-path default the caller
   * may override).
   */
  readonly skillNamespace?: string;
  /**
   * Optional shared fabric (default: a fresh ForgeService). Passing a
   * shared service lets the demo path participate in the caller's
   * idempotent replay and registry.
   */
  readonly service?: ForgeService;
}

/**
 * Derive the skill ref an A019 SkillDraft's skill node contributes to
 * a manifest: `{namespace, name: node.id, version: node.version,
 * digest: node.digest}` — the A003 VersionedArtifactRef shape the
 * BodyVersion's skills list commits to, content-addressed by the
 * node's digest.
 */
export function skillRefOfDraft(
  draft: SkillDraft,
  namespace = 'arena-skills',
): { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string } {
  return {
    namespace,
    name: draft.skillNode.id,
    version: draft.skillNode.version,
    digest: draft.skillNode.digest,
  };
}

/** The output of the compose-from-learning demo path: the derived manifest + the standard forge result. */
export interface ComposeFromLearningResult extends ForgeResult {
  /** The NEW manifest derived from the base, citing both learning records. */
  readonly manifest: BodyManifest;
}

/**
 * The compose-from-learning demo path: REAL A020 ExperimentRecord +
 * REAL A019 SkillDraft → a NEW manifest citing both as explicit
 * provenance → a NEW BodyVersion proposal (never a rewrite).
 */
export async function composeFromLearning(
  experimentRecord: ExperimentRunRecord,
  skillDraft: SkillDraft,
  options: ComposeFromLearningOptions,
): Promise<ComposeFromLearningResult> {
  if (!isIdempotencyKey(options.forgeKey)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_RECORD, {
      message: `composeFromLearning requires a valid forge key (idempotency key): ${JSON.stringify(options.forgeKey)}`,
    });
  }
  // REAL A020 guard: the motivating experiment record.
  if (!isExperimentRunRecord(experimentRecord)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'composeFromLearning requires a structurally valid A020 ExperimentRunRecord as its motivating evidence',
    });
  }
  // REAL A019 guard: the skill draft being admitted.
  if (!isSkillDraft(skillDraft)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'composeFromLearning requires a structurally valid A019 SkillDraft as the proposed skill content',
    });
  }

  const base = options.baseManifest;
  const skillRef = skillRefOfDraft(skillDraft, options.skillNamespace);
  const existingSkillKeys = new Set(base.skills.map((skill) => `${skill.namespace}/${skill.name}`));
  const draftSkillIsNew = !existingSkillKeys.has(`${skillRef.namespace}/${skillRef.name}`);
  const skills = draftSkillIsNew ? [...base.skills, skillRef] : [...base.skills];

  // The new manifest cites BOTH learning records explicitly. A NEW
  // manifest id/version pair keeps the derived manifest distinct from
  // its base (manifests are versioned artifacts).
  const manifest = await createBodyManifest({
    manifestId: `${base.manifestId}-from-learning`,
    version: base.version,
    body: { tenant: base.body.tenant, name: base.body.name },
    targetVersion: options.targetVersion,
    mission: base.mission,
    role: base.role,
    domainScope: [...base.domainScope],
    capabilities: base.capabilities.map((capability) => ({
      kind: capability.kind,
      id: capability.id,
      version: capability.version,
      digest: capability.digest,
    })),
    skills,
    knowledge: [...base.knowledge],
    tools: [...base.tools],
    procedures: [...base.procedures],
    memoryPolicy: base.memoryPolicy,
    planningPolicy: base.planningPolicy,
    safetyPolicy: base.safetyPolicy,
    escalation: {
      rules: base.escalation.rules.map((rule) => ({
        condition: rule.condition,
        target: {
          type: rule.target.type,
          tenant: rule.target.tenant,
          principalId: rule.target.principalId,
        },
      })),
    },
    authorityBoundaries: [...base.authorityBoundaries],
    evaluationSuites: [...base.evaluationSuites],
    verificationSuites: [...base.verificationSuites],
    environmentRequirements: [...base.environmentRequirements],
    substrateCompatibility: base.substrateCompatibility,
    rights: base.rights,
    provenance: {
      author: {
        type: base.provenance.author.type,
        tenant: base.provenance.author.tenant,
        principalId: base.provenance.author.principalId,
      },
      authoredAt: options.recipe.forgedAt,
      citations: [
        // The motivating A020 experiment record, cited by digest.
        { kind: 'experiment-record', digest: experimentRecord.digest },
        // The admitted A019 skill draft, bound to the skill ref it proposes.
        { kind: 'skill-draft', digest: skillDraft.digest, skills: [skillRef] },
      ],
    },
    lineage: {
      parents: options.supersedes === undefined ? [] : [options.supersedes],
      ...(options.supersedes === undefined ? {} : { supersedes: options.supersedes }),
    },
  });

  const service = options.service ?? new ForgeService();
  const result = await service.submit(manifest, options.policy, {
    forgeKey: options.forgeKey,
    recipe: options.recipe,
    ...(options.notes === undefined ? {} : { notes: options.notes }),
  });
  return Object.freeze({ ...result, manifest });
}
