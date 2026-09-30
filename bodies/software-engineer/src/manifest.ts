/**
 * The reference Software Engineer BodyManifest (AB1.0 via A021
 * BodyForge) plus its append-only evolution lineage.
 *
 * `softwareEngineerManifestInput()` produces the v1.0.0 manifest input;
 * `softwareEngineerEvolutionManifestInput()` produces the v1.1.0
 * successor whose lineage cites the forged v1.0.0 BodyVersion as BOTH
 * parent and superseded ref (the hard A021 lineage rule).
 */

import type { CreateBodyManifestInput } from '@arena/body-forge';
import type { BodyVersionRef, VersionedArtifactRef } from '@arena/agent-body';
import { digestCanonical } from '@arena/protocol-core';
import {
  SOFTWARE_ENGINEER_AUTHORED_AT,
  SOFTWARE_ENGINEER_BODY_ERROR_CODES,
  SOFTWARE_ENGINEER_BODY_IDENTITY,
  SOFTWARE_ENGINEER_BODY_TENANT,
  SOFTWARE_ENGINEER_MANIFEST_ID,
  SoftwareEngineerBodyError,
  assertNeutralId,
  deepFreeze,
} from './shared.js';
import {
  buildSoftwareEngineerCapabilities,
  buildSoftwareEngineerKnowledge,
  buildSoftwareEngineerProcedures,
  buildSoftwareEngineerSkills,
  buildSoftwareEngineerToolSurface,
  softwareEngineerEnvironmentRequirement,
} from './reference-surface.js';
import { capabilityNodeRef } from './surface.js';

/** Initial reference version of the body. */
export const SOFTWARE_ENGINEER_BODY_INITIAL_VERSION = '1.0.0' as const;
/** Evolved reference version (demonstrates append-only supersession). */
export const SOFTWARE_ENGINEER_BODY_EVOLVED_VERSION = '1.1.0' as const;

export const SUITE_REQUIREMENT_RECORD_VERSION = 1 as const;
export const SUITE_REQUIREMENT_ROLES = Object.freeze(['evaluation', 'verification'] as const);
export type SuiteRequirementRole = (typeof SUITE_REQUIREMENT_ROLES)[number];

/** A content-addressed suite prerequisite declared by the body. */
export interface SuiteRequirementView {
  readonly recordVersion: typeof SUITE_REQUIREMENT_RECORD_VERSION;
  readonly suiteId: string;
  readonly role: SuiteRequirementRole;
  readonly version: string;
  readonly description: string;
}

export interface SuiteRequirement extends SuiteRequirementView {
  readonly digest: string;
  readonly ref: VersionedArtifactRef;
}

/** Validate + digest a suite prerequisite declaration. */
export async function createSuiteRequirement(input: {
  readonly suiteId: string;
  readonly role: SuiteRequirementRole;
  readonly version: string;
  readonly description: string;
}): Promise<SuiteRequirement> {
  assertNeutralId(input.suiteId, 'suiteId');
  if (input.role !== 'evaluation' && input.role !== 'verification') {
    throw new SoftwareEngineerBodyError(
      SOFTWARE_ENGINEER_BODY_ERROR_CODES.INVALID_MANIFEST_INPUT,
      `role must be 'evaluation' | 'verification' (got: ${String(input.role)})`,
      { role: input.role },
    );
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(input.version)) {
    throw new SoftwareEngineerBodyError(
      SOFTWARE_ENGINEER_BODY_ERROR_CODES.INVALID_MANIFEST_INPUT,
      `version must be semver (got: ${String(input.version)})`,
      { version: input.version },
    );
  }
  const view: SuiteRequirementView = Object.freeze({
    recordVersion: SUITE_REQUIREMENT_RECORD_VERSION,
    suiteId: input.suiteId,
    role: input.role,
    version: input.version,
    description: input.description,
  });
  const digest = await digestCanonical(view);
  return deepFreeze({
    ...view,
    digest,
    ref: Object.freeze({
      namespace: 'software-engineer-body',
      name: input.suiteId,
      version: input.version,
      digest,
    }),
  }) as SuiteRequirement;
}

/** The body's pinned evaluation-suite prerequisite. */
export async function softwareEngineerEvaluationSuiteRequirement(): Promise<SuiteRequirement> {
  return createSuiteRequirement({
    suiteId: 'suite-se-reference-evaluation',
    role: 'evaluation',
    version: '1.0.0',
    description:
      'Reference evaluation suite for the software engineer body: test-repair trajectories judged against explicit weighted criteria.',
  });
}

/** The body's pinned verification-suite prerequisite. */
export async function softwareEngineerVerificationSuiteRequirement(): Promise<SuiteRequirement> {
  return createSuiteRequirement({
    suiteId: 'suite-se-reference-verification',
    role: 'verification',
    version: '1.0.0',
    description:
      'Reference verification suite for the software engineer body: digest-verified test reports and trajectory-chain proofs.',
  });
}

function referenceRights() {
  return Object.freeze({
    license: 'Proprietary',
    commercialUse: 'requires-license',
    redistribution: 'tenant-only',
    customerData: 'derived',
    professionalLimitations: [
      'not a licensed engineering authority; no sign-off authority',
    ],
  });
}

/**
 * The full v1.0.0 BodyManifest input for the reference software
 * engineer body. Deterministic: same call → same input → same digest.
 */
export async function softwareEngineerManifestInput(): Promise<CreateBodyManifestInput> {
  const [
    tools,
    skills,
    knowledge,
    procedures,
    capabilities,
    environmentRequirement,
    evaluationSuite,
    verificationSuite,
  ] = await Promise.all([
    buildSoftwareEngineerToolSurface(),
    buildSoftwareEngineerSkills(),
    buildSoftwareEngineerKnowledge(),
    buildSoftwareEngineerProcedures(),
    buildSoftwareEngineerCapabilities(),
    softwareEngineerEnvironmentRequirement(),
    softwareEngineerEvaluationSuiteRequirement(),
    softwareEngineerVerificationSuiteRequirement(),
  ]);

  return deepFreeze({
    manifestId: SOFTWARE_ENGINEER_MANIFEST_ID,
    version: SOFTWARE_ENGINEER_BODY_INITIAL_VERSION,
    body: SOFTWARE_ENGINEER_BODY_IDENTITY,
    targetVersion: SOFTWARE_ENGINEER_BODY_INITIAL_VERSION,
    mission:
      'Deliver correct, reviewable software changes with auditable evidence, from reproduction through green builds.',
    role: 'senior-software-engineer',
    domainScope: ['software-engineering', 'code-review', 'developer-productivity'],
    capabilities: capabilities.map(capabilityNodeRef),
    skills: skills.map((skill) => skill.ref),
    knowledge: knowledge.map((entry) => entry.ref),
    tools: tools.map((tool) => tool.ref),
    procedures: procedures.map((procedure) => procedure.ref),
    memoryPolicy: {
      policyId: 'memory-task-scoped',
      statements: [
        'retain task-scoped working notes only',
        'never persist secrets or credentials',
      ],
    },
    planningPolicy: {
      policyId: 'planning-reproduce-first',
      statements: [
        'reproduce the failure before editing',
        'smallest failing test first',
      ],
    },
    safetyPolicy: {
      policyId: 'safety-protected-branches',
      statements: [
        'never force-push or rewrite protected branches',
        'require human review before merge to protected branches',
      ],
    },
    escalation: {
      rules: [
        {
          condition: 'security-sensitive-change',
          target: {
            type: 'user',
            tenant: SOFTWARE_ENGINEER_BODY_TENANT,
            principalId: 'lead-engineer-01',
          },
        },
        {
          condition: 'credential-exposure-suspected',
          target: {
            type: 'user',
            tenant: SOFTWARE_ENGINEER_BODY_TENANT,
            principalId: 'security-oncall-01',
          },
        },
      ],
    },
    authorityBoundaries: [
      'may propose commits and pull requests',
      'may not merge to protected branches without review',
      'may not modify CI configuration without escalation',
      'may not push credentials or customer data into evidence mounts',
    ],
    evaluationSuites: [evaluationSuite.ref],
    verificationSuites: [verificationSuite.ref],
    environmentRequirements: [environmentRequirement],
    substrateCompatibility: {
      requiredModalities: ['text-input', 'text-output'],
      requiredToolCalling: 'json-schema',
      contextRequirements: { minContextUnits: 65536 },
      prohibitedConditions: ['deprecated'],
      substrateAdaptations: [],
    },
    rights: referenceRights(),
    provenance: {
      author: {
        type: 'service',
        tenant: SOFTWARE_ENGINEER_BODY_TENANT,
        principalId: 'arena-body-forge-fabric',
      },
      authoredAt: SOFTWARE_ENGINEER_AUTHORED_AT,
      citations: [],
    },
    lineage: { parents: [] },
  }) as CreateBodyManifestInput;
}

/**
 * The v1.1.0 successor manifest input: extends the professional
 * surface (a green-build verification procedure is already present;
 * the evolution adds stricter authority boundaries) and cites the
 * forged predecessor BodyVersion in its lineage. `supersedes` MUST
 * also appear in `parents` (hard A021 rule).
 */
export async function softwareEngineerEvolutionManifestInput(parents: readonly {
  readonly tenant: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}[]): Promise<CreateBodyManifestInput> {
  if (parents.length === 0) {
    throw new SoftwareEngineerBodyError(
      SOFTWARE_ENGINEER_BODY_ERROR_CODES.INVALID_LINEAGE,
      'evolution manifest requires at least one parent BodyVersionRef',
    );
  }
  for (const parent of parents) {
    if (
      parent.tenant !== SOFTWARE_ENGINEER_BODY_IDENTITY.tenant ||
      parent.name !== SOFTWARE_ENGINEER_BODY_IDENTITY.name
    ) {
      throw new SoftwareEngineerBodyError(
        SOFTWARE_ENGINEER_BODY_ERROR_CODES.INVALID_LINEAGE,
        'lineage parents must reference the same body identity',
        { parent },
      );
    }
  }
  const base = await softwareEngineerManifestInput();
  const supersedes: BodyVersionRef = Object.freeze({
    tenant: parents[0]!.tenant,
    name: parents[0]!.name,
    version: parents[0]!.version,
    digest: parents[0]!.digest,
  }) as BodyVersionRef;
  return deepFreeze({
    ...base,
    version: SOFTWARE_ENGINEER_BODY_EVOLVED_VERSION,
    targetVersion: SOFTWARE_ENGINEER_BODY_EVOLVED_VERSION,
    authorityBoundaries: [
      ...base.authorityBoundaries,
      'may not disable or weaken required CI checks',
    ],
    lineage: { parents, supersedes },
  }) as CreateBodyManifestInput;
}
