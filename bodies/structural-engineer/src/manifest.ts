/**
 * The reference Structural Engineer BodyManifest (AB1.0 via A021
 * BodyForge) plus its append-only evolution lineage.
 *
 * `structuralEngineerManifestInput()` produces the v1.0.0 manifest
 * input; `structuralEngineerEvolutionManifestInput()` produces the
 * v1.1.0 successor whose lineage cites the forged v1.0.0 BodyVersion
 * as BOTH parent and superseded ref (the hard A021 lineage rule).
 */

import type { CreateBodyManifestInput } from '@arena/body-forge';
import type { BodyVersionRef, VersionedArtifactRef } from '@arena/agent-body';
import { digestCanonical } from '@arena/protocol-core';
import {
  STRUCTURAL_ENGINEER_AUTHORED_AT,
  STRUCTURAL_ENGINEER_BODY_ERROR_CODES,
  STRUCTURAL_ENGINEER_BODY_IDENTITY,
  STRUCTURAL_ENGINEER_BODY_TENANT,
  STRUCTURAL_ENGINEER_MANIFEST_ID,
  StructuralEngineerBodyError,
  assertNeutralId,
  deepFreeze,
} from './shared.js';
import {
  buildStructuralEngineerCapabilities,
  buildStructuralEngineerKnowledge,
  buildStructuralEngineerProcedures,
  buildStructuralEngineerSkills,
  buildStructuralEngineerToolSurface,
  structuralEngineerEnvironmentRequirement,
} from './reference-surface.js';
import { capabilityNodeRef } from './surface.js';

/** Initial reference version of the body. */
export const STRUCTURAL_ENGINEER_BODY_INITIAL_VERSION = '1.0.0' as const;
/** Evolved reference version (demonstrates append-only supersession). */
export const STRUCTURAL_ENGINEER_BODY_EVOLVED_VERSION = '1.1.0' as const;

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
    throw new StructuralEngineerBodyError(
      STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_MANIFEST_INPUT,
      `role must be 'evaluation' | 'verification' (got: ${String(input.role)})`,
      { role: input.role },
    );
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(input.version)) {
    throw new StructuralEngineerBodyError(
      STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_MANIFEST_INPUT,
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
      namespace: 'structural-engineer-body',
      name: input.suiteId,
      version: input.version,
      digest,
    }),
  }) as SuiteRequirement;
}

/** The body's pinned evaluation-suite prerequisite. */
export async function structuralEngineerEvaluationSuiteRequirement(): Promise<SuiteRequirement> {
  return createSuiteRequirement({
    suiteId: 'suite-struct-reference-evaluation',
    role: 'evaluation',
    version: '1.0.0',
    description:
      'Reference evaluation suite for the structural engineer body: analysis-correction trajectories judged against explicit weighted criteria.',
  });
}

/** The body's pinned verification-suite prerequisite. */
export async function structuralEngineerVerificationSuiteRequirement(): Promise<SuiteRequirement> {
  return createSuiteRequirement({
    suiteId: 'suite-struct-reference-verification',
    role: 'verification',
    version: '1.0.0',
    description:
      'Reference verification suite for the structural engineer body: digest-verified compliance reports and trajectory-chain proofs.',
  });
}

function referenceRights() {
  return Object.freeze({
    license: 'Proprietary',
    commercialUse: 'requires-license',
    redistribution: 'tenant-only',
    customerData: 'derived',
    professionalLimitations: [
      'not a licensed engineering authority; no sign-off or stamping authority',
    ],
  });
}

/**
 * The full v1.0.0 BodyManifest input for the reference structural
 * engineer body. Deterministic: same call → same input → same digest.
 */
export async function structuralEngineerManifestInput(): Promise<CreateBodyManifestInput> {
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
    buildStructuralEngineerToolSurface(),
    buildStructuralEngineerSkills(),
    buildStructuralEngineerKnowledge(),
    buildStructuralEngineerProcedures(),
    buildStructuralEngineerCapabilities(),
    structuralEngineerEnvironmentRequirement(),
    structuralEngineerEvaluationSuiteRequirement(),
    structuralEngineerVerificationSuiteRequirement(),
  ]);

  return deepFreeze({
    manifestId: STRUCTURAL_ENGINEER_MANIFEST_ID,
    version: STRUCTURAL_ENGINEER_BODY_INITIAL_VERSION,
    body: STRUCTURAL_ENGINEER_BODY_IDENTITY,
    targetVersion: STRUCTURAL_ENGINEER_BODY_INITIAL_VERSION,
    mission:
      'Deliver correct, auditable structural verification decisions with pinned code editions, drawings, and model parameters.',
    role: 'senior-structural-engineer',
    domainScope: ['structural-engineering', 'load-path-analysis', 'code-compliance'],
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
        'reproduce the failing check before touching the model',
        'trace the load path before correcting parameters',
      ],
    },
    safetyPolicy: {
      policyId: 'safety-no-silent-capacity',
      statements: [
        'never silently assume capacity; every check cites the pinned code edition',
        'escalate life-safety-relevant discrepancies for human review',
      ],
    },
    escalation: {
      rules: [
        {
          condition: 'life-safety-relevant-discrepancy',
          target: {
            type: 'user',
            tenant: STRUCTURAL_ENGINEER_BODY_TENANT,
            principalId: 'senior-reviewer-01',
          },
        },
        {
          condition: 'drawing-spec-mismatch-suspected',
          target: {
            type: 'user',
            tenant: STRUCTURAL_ENGINEER_BODY_TENANT,
            principalId: 'drawing-controller-01',
          },
        },
      ],
    },
    authorityBoundaries: [
      'may propose model corrections and calculation sheets',
      'may not approve, certify or stamp engineering deliverables',
      'may not change the pinned design-code edition without escalation',
      'may not relax limit-state criteria to make a check pass',
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
        tenant: STRUCTURAL_ENGINEER_BODY_TENANT,
        principalId: 'arena-body-forge-fabric',
      },
      authoredAt: STRUCTURAL_ENGINEER_AUTHORED_AT,
      citations: [],
    },
    lineage: { parents: [] },
  }) as CreateBodyManifestInput;
}

/**
 * The v1.1.0 successor manifest input: extends the professional
 * surface with stricter authority boundaries (a sealed drawing-package
 * review constraint is added) and cites the forged predecessor
 * BodyVersion in its lineage. `supersedes` MUST also appear in
 * `parents` (hard A021 rule).
 */
export async function structuralEngineerEvolutionManifestInput(parents: readonly {
  readonly tenant: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}[]): Promise<CreateBodyManifestInput> {
  if (parents.length === 0) {
    throw new StructuralEngineerBodyError(
      STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_LINEAGE,
      'evolution manifest requires at least one parent BodyVersionRef',
    );
  }
  for (const parent of parents) {
    if (
      parent.tenant !== STRUCTURAL_ENGINEER_BODY_IDENTITY.tenant ||
      parent.name !== STRUCTURAL_ENGINEER_BODY_IDENTITY.name
    ) {
      throw new StructuralEngineerBodyError(
        STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_LINEAGE,
        'lineage parents must reference the same body identity',
        { parent },
      );
    }
  }
  const base = await structuralEngineerManifestInput();
  const supersedes: BodyVersionRef = Object.freeze({
    tenant: parents[0]!.tenant,
    name: parents[0]!.name,
    version: parents[0]!.version,
    digest: parents[0]!.digest,
  }) as BodyVersionRef;
  return deepFreeze({
    ...base,
    version: STRUCTURAL_ENGINEER_BODY_EVOLVED_VERSION,
    targetVersion: STRUCTURAL_ENGINEER_BODY_EVOLVED_VERSION,
    authorityBoundaries: [
      ...base.authorityBoundaries,
      'may not review sealed drawing packages outside a hermetic review environment',
    ],
    lineage: { parents, supersedes },
  }) as CreateBodyManifestInput;
}
