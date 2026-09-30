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
  SOFTWARE_ENGINEER_BODY_CREATED_AT,
  SOFTWARE_ENGINEER_BODY_ERROR_CODES,
  SOFTWARE_ENGINEER_BODY_IDENTITY,
  SOFTWARE_ENGINEER_BODY_TENANT,
  SOFTWARE_ENGINEER_FORGE_CORRELATION_ID,
  SOFTWARE_ENGINEER_FORGE_KEY,
  SOFTWARE_ENGINEER_FORGE_PRINCIPAL_ID,
  SOFTWARE_ENGINEER_FORGED_AT,
  SoftwareEngineerBodyError,
} from './shared.js';
import {
  softwareEngineerEvolutionManifestInput,
  softwareEngineerManifestInput,
} from './manifest.js';

/** The reference forge policy: A003 floors STRENGTHENED for this body. */
export const SOFTWARE_ENGINEER_FORGE_POLICY_ID = 'policy-software-engineer-reference' as const;

export async function softwareEngineerForgePolicy(): Promise<ForgePolicy> {
  return createForgePolicy({
    policyId: SOFTWARE_ENGINEER_FORGE_POLICY_ID,
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
export function softwareEngineerForgeRecipe() {
  return Object.freeze({
    forgePrincipal: {
      type: 'service',
      tenant: SOFTWARE_ENGINEER_BODY_TENANT,
      principalId: SOFTWARE_ENGINEER_FORGE_PRINCIPAL_ID,
    },
    forgedAt: SOFTWARE_ENGINEER_FORGED_AT,
    correlationId: SOFTWARE_ENGINEER_FORGE_CORRELATION_ID,
  });
}

export interface ForgedSoftwareEngineerBody {
  readonly manifest: BodyManifest;
  readonly policy: ForgePolicy;
  readonly bodyVersion: BodyVersion;
  readonly forgeRecord: ForgeRecord;
}

/** Forge one BodyVersion from a manifest input through the REAL pipeline. */
export async function forgeSoftwareEngineerBody(
  manifestInput: Parameters<typeof createBodyManifest>[0],
  options: { readonly forgeKey?: string } = {},
): Promise<ForgedSoftwareEngineerBody> {
  const manifest = await createBodyManifest(manifestInput);
  const policy = await softwareEngineerForgePolicy();
  const { bodyVersion, record } = await forge(manifest, policy, softwareEngineerForgeRecipe(), {
    forgeKey: options.forgeKey ?? SOFTWARE_ENGINEER_FORGE_KEY,
  });
  return { manifest, policy, bodyVersion, forgeRecord: record };
}

/** Forge the initial v1.0.0 reference body version. */
export async function forgeInitialSoftwareEngineerBody(): Promise<ForgedSoftwareEngineerBody> {
  return forgeSoftwareEngineerBody(await softwareEngineerManifestInput());
}

/** Forge the evolved v1.1.0 body version citing `parents` in its lineage. */
export async function forgeEvolvedSoftwareEngineerBody(
  parents: readonly BodyVersionRef[],
): Promise<ForgedSoftwareEngineerBody> {
  const input = await softwareEngineerEvolutionManifestInput(parents);
  return forgeSoftwareEngineerBody(input, { forgeKey: 'forge-key-se-body-0002' });
}

export interface SoftwareEngineerBodyBuild {
  readonly body: AgentBody;
  readonly initial: ForgedSoftwareEngineerBody;
  readonly evolved: ForgedSoftwareEngineerBody;
}

/**
 * Build the complete reference body: an AgentBody with the v1.0.0 and
 * v1.1.0 BodyVersions registered append-only (v1.1.0 supersedes
 * v1.0.0). Deterministic end-to-end.
 */
export async function buildSoftwareEngineerBody(): Promise<SoftwareEngineerBodyBuild> {
  const initial = await forgeInitialSoftwareEngineerBody();
  const body = createAgentBody({
    identity: SOFTWARE_ENGINEER_BODY_IDENTITY,
    createdAt: SOFTWARE_ENGINEER_BODY_CREATED_AT,
    creator: {
      type: 'service',
      tenant: SOFTWARE_ENGINEER_BODY_TENANT,
      principalId: SOFTWARE_ENGINEER_FORGE_PRINCIPAL_ID,
    },
    rights: initial.manifest.rights,
  });
  const bodyWithInitial = await registerBodyVersion(body, initial.bodyVersion);
  const evolved = await forgeEvolvedSoftwareEngineerBody([
    {
      tenant: initial.bodyVersion.body.tenant,
      name: initial.bodyVersion.body.name,
      version: initial.bodyVersion.version,
      digest: initial.bodyVersion.digest,
    },
  ]);
  const bodyWithBoth = await registerBodyVersion(bodyWithInitial, evolved.bodyVersion);
  if (bodyWithBoth.versions.length !== 2) {
    throw new SoftwareEngineerBodyError(
      SOFTWARE_ENGINEER_BODY_ERROR_CODES.INVALID_LINEAGE,
      'expected exactly two registered body versions',
    );
  }
  return { body: bodyWithBoth, initial, evolved };
}

/** Convenience: the latest (evolved) BodyVersionRef of the reference body. */
export function latestSoftwareEngineerVersionRef(
  build: SoftwareEngineerBodyBuild,
): BodyVersionRef {
  const last = build.body.versions[build.body.versions.length - 1];
  if (last === undefined) {
    throw new SoftwareEngineerBodyError(
      SOFTWARE_ENGINEER_BODY_ERROR_CODES.INVALID_LINEAGE,
      'reference body has no registered versions',
    );
  }
  return last;
}
