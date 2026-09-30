/**
 * Deterministic body builders: forge the reference BodyVersions
 * through the REAL @arena/body-forge pipeline and register them on an
 * append-only @arena/agent-body AgentBody.
 */

import {
  createAgentBody,
  registerBodyVersion,
} from '@arena/agent-body';
import type { AgentBody, BodyVersion, BodyVersionRef } from '@arena/agent-body';
import {
  createBodyManifest,
  createForgePolicy,
  forge,
} from '@arena/body-forge';
import type { BodyManifest, ForgePolicy, ForgeRecord } from '@arena/body-forge';
import {
  STRUCTURAL_ENGINEER_BODY_CREATED_AT,
  STRUCTURAL_ENGINEER_BODY_ERROR_CODES,
  STRUCTURAL_ENGINEER_BODY_IDENTITY,
  STRUCTURAL_ENGINEER_BODY_TENANT,
  STRUCTURAL_ENGINEER_FORGE_CORRELATION_ID,
  STRUCTURAL_ENGINEER_FORGE_KEY,
  STRUCTURAL_ENGINEER_FORGE_PRINCIPAL_ID,
  STRUCTURAL_ENGINEER_FORGED_AT,
  StructuralEngineerBodyError,
} from './shared.js';
import {
  structuralEngineerEvolutionManifestInput,
  structuralEngineerManifestInput,
} from './manifest.js';

/** The reference forge policy: A003 floors STRENGTHENED for this body. */
export const STRUCTURAL_ENGINEER_FORGE_POLICY_ID = 'policy-structural-engineer-reference' as const;

export async function structuralEngineerForgePolicy(): Promise<ForgePolicy> {
  return createForgePolicy({
    policyId: STRUCTURAL_ENGINEER_FORGE_POLICY_ID,
    version: '1.0.0',
    requirements: {
      minSkills: 3,
      minKnowledge: 3,
      minTools: 6,
      minProcedures: 2,
      minCapabilities: 3,
      minEvaluationSuites: 1,
      minVerificationSuites: 1,
      minEnvironmentRequirements: 1,
    },
    learningAdmission: {
      allowExperimentRecordCitations: true,
      allowSkillDraftCitations: true,
      requireExperimentForSkillDraft: false,
      uncitedSkillsAllowed: true,
    },
    lineage: {
      requireParents: false,
      allowSupersession: true,
    },
  });
}

/** The deterministic forge recipe (no hidden clock reads). */
export function structuralEngineerForgeRecipe() {
  return Object.freeze({
    forgePrincipal: {
      type: 'service',
      tenant: STRUCTURAL_ENGINEER_BODY_TENANT,
      principalId: STRUCTURAL_ENGINEER_FORGE_PRINCIPAL_ID,
    },
    forgedAt: STRUCTURAL_ENGINEER_FORGED_AT,
    correlationId: STRUCTURAL_ENGINEER_FORGE_CORRELATION_ID,
  });
}

export interface ForgedStructuralEngineerBody {
  readonly manifest: BodyManifest;
  readonly policy: ForgePolicy;
  readonly bodyVersion: BodyVersion;
  readonly forgeRecord: ForgeRecord;
}

/** Forge one BodyVersion from a manifest input through the REAL pipeline. */
export async function forgeStructuralEngineerBody(
  manifestInput: Parameters<typeof createBodyManifest>[0],
  options: { readonly forgeKey?: string } = {},
): Promise<ForgedStructuralEngineerBody> {
  const manifest = await createBodyManifest(manifestInput);
  const policy = await structuralEngineerForgePolicy();
  const { bodyVersion, record } = await forge(manifest, policy, structuralEngineerForgeRecipe(), {
    forgeKey: options.forgeKey ?? STRUCTURAL_ENGINEER_FORGE_KEY,
  });
  return { manifest, policy, bodyVersion, forgeRecord: record };
}

/** Forge the initial v1.0.0 reference body version. */
export async function forgeInitialStructuralEngineerBody(): Promise<ForgedStructuralEngineerBody> {
  return forgeStructuralEngineerBody(await structuralEngineerManifestInput());
}

/** Forge the evolved v1.1.0 body version citing `parents` in its lineage. */
export async function forgeEvolvedStructuralEngineerBody(
  parents: readonly BodyVersionRef[],
): Promise<ForgedStructuralEngineerBody> {
  const input = await structuralEngineerEvolutionManifestInput(parents);
  return forgeStructuralEngineerBody(input, { forgeKey: 'forge-key-struct-body-0002' });
}

export interface StructuralEngineerBodyBuild {
  readonly body: AgentBody;
  readonly initial: ForgedStructuralEngineerBody;
  readonly evolved: ForgedStructuralEngineerBody;
}

/**
 * Build the complete reference body: an AgentBody with the v1.0.0 and
 * v1.1.0 BodyVersions registered append-only (v1.1.0 supersedes
 * v1.0.0). Deterministic end-to-end.
 */
export async function buildStructuralEngineerBody(): Promise<StructuralEngineerBodyBuild> {
  const initial = await forgeInitialStructuralEngineerBody();
  const body = createAgentBody({
    identity: STRUCTURAL_ENGINEER_BODY_IDENTITY,
    createdAt: STRUCTURAL_ENGINEER_BODY_CREATED_AT,
    creator: {
      type: 'service',
      tenant: STRUCTURAL_ENGINEER_BODY_TENANT,
      principalId: STRUCTURAL_ENGINEER_FORGE_PRINCIPAL_ID,
    },
    rights: initial.manifest.rights,
  });
  const bodyWithInitial = await registerBodyVersion(body, initial.bodyVersion);
  const evolved = await forgeEvolvedStructuralEngineerBody([
    {
      tenant: initial.bodyVersion.body.tenant,
      name: initial.bodyVersion.body.name,
      version: initial.bodyVersion.version,
      digest: initial.bodyVersion.digest,
    },
  ]);
  const bodyWithBoth = await registerBodyVersion(bodyWithInitial, evolved.bodyVersion);
  if (bodyWithBoth.versions.length !== 2) {
    throw new StructuralEngineerBodyError(
      STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_LINEAGE,
      'expected exactly two registered body versions',
    );
  }
  return { body: bodyWithBoth, initial, evolved };
}

/** Convenience: the latest (evolved) BodyVersionRef of the reference body. */
export function latestStructuralEngineerVersionRef(
  build: StructuralEngineerBodyBuild,
): BodyVersionRef {
  const last = build.body.versions[build.body.versions.length - 1];
  if (last === undefined) {
    throw new StructuralEngineerBodyError(
      STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_LINEAGE,
      'reference body has no registered versions',
    );
  }
  return last;
}
