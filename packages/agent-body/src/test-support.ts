/**
 * Internal test support — fixture builders shared by the agent-body test
 * suites. NOT part of the public surface: index.ts does not export it and
 * tsconfig.build.json excludes it from dist. Every fixture value is
 * deliberately provider-neutral (neutral identifiers, no provider brand
 * names, no credential-shaped fields).
 */

import { createBodyVersion, type BodyVersion } from './body.js';
import { toSubstrateCompatibilityProfile } from './compatibility.js';
import { createPossession, type Possession } from './possession.js';
import { createCognitiveSubstrate, type CognitiveSubstrate } from './substrate.js';
import type { CreateBodyVersionInput } from './body.js';
import type { CreateSubstrateCompatibilityProfileInput } from './compatibility.js';
import type { CreateCognitiveSubstrateInput } from './substrate.js';

export const DIGEST_A = '1111111111111111111111111111111111111111111111111111111111111111';
export const DIGEST_B = '2222222222222222222222222222222222222222222222222222222222222222';
export const DIGEST_C = '3333333333333333333333333333333333333333333333333333333333333333';
export const DIGEST_D = '4444444444444444444444444444444444444444444444444444444444444444';

export const CREATOR = {
  type: 'agent-body',
  tenant: 'tenant-a',
  principalId: 'forge-principal-1',
} as const;

export const RIGHTS = {
  license: 'Proprietary',
  commercialUse: 'requires-license',
  redistribution: 'tenant-only',
  customerData: 'derived',
  professionalLimitations: ['structural-review-signoff-required'],
} as const;

export const TIMESTAMP = '2026-01-15T09:30:00.000Z';
export const TIMESTAMP_LATER = '2026-01-15T10:15:00.000Z';

export function makeSubstrateInput(
  overrides: Partial<CreateCognitiveSubstrateInput> = {},
): CreateCognitiveSubstrateInput {
  return {
    adapterId: 'adapter-reasoning-1',
    adapterVersion: '1.4.0',
    modelFamily: 'reasoner',
    modelId: 'reasoner-general-2',
    modelRevision: 'r7',
    modalityProfile: ['text-input', 'text-output', 'structured-input'],
    toolCallingProfile: 'function-calling',
    contextLimits: { maxContextUnits: 200000, maxOutputUnits: 32000 },
    conditions: ['stable'],
    ...overrides,
  };
}

export async function makeSubstrate(
  overrides: Partial<CreateCognitiveSubstrateInput> = {},
): Promise<CognitiveSubstrate> {
  return createCognitiveSubstrate(makeSubstrateInput(overrides));
}

export function makeProfileInput(
  overrides: Partial<CreateSubstrateCompatibilityProfileInput> = {},
): CreateSubstrateCompatibilityProfileInput {
  return {
    requiredModalities: ['text-input', 'text-output'],
    requiredToolCalling: 'json-schema',
    contextRequirements: { minContextUnits: 100000 },
    requiredEvaluationSuites: [
      { namespace: 'tenant-a', name: 'eval-suite', version: '1.0.0', digest: DIGEST_A },
    ],
    prohibitedConditions: ['deprecated'],
    ...overrides,
  };
}

export function makeProfile(
  overrides: Partial<CreateSubstrateCompatibilityProfileInput> = {},
) {
  return toSubstrateCompatibilityProfile(makeProfileInput(overrides));
}

export function makeBodyVersionInput(
  overrides: Partial<CreateBodyVersionInput> = {},
): CreateBodyVersionInput {
  return {
    body: { tenant: 'tenant-a', name: 'structural-engineer' },
    version: '1.2.0',
    mission: 'Deliver structural engineering review with auditable provenance.',
    role: 'senior-structural-reviewer',
    domainScope: ['structural-engineering', 'code-compliance'],
    capabilities: ['load-analysis', 'code-compliance-review'],
    skills: [
      { namespace: 'tenant-a', name: 'skill-load-analysis', version: '2.0.0', digest: DIGEST_A },
    ],
    knowledge: [
      { namespace: 'tenant-a', name: 'knowledge-codes', version: '1.1.0', digest: DIGEST_B },
    ],
    tools: [
      { namespace: 'tenant-a', name: 'tool-fe-solver', version: '3.0.0', digest: DIGEST_C },
    ],
    procedures: [
      { namespace: 'tenant-a', name: 'proc-review-flow', version: '1.0.0', digest: DIGEST_D },
    ],
    memoryPolicy: { policyId: 'memory-policy', statements: ['persist task outcomes only'] },
    planningPolicy: { policyId: 'planning-policy', statements: ['plan before acting'] },
    escalation: {
      rules: [
        {
          condition: 'loads-beyond-comfort-table',
          target: { type: 'expert', tenant: 'tenant-a', principalId: 'expert-reviewer-9' },
        },
      ],
    },
    authorityBoundaries: ['may-approve-loads-below-limit', 'never-signs-off-final-drawings'],
    safetyPolicy: { policyId: 'safety-policy', statements: ['refuse-unsafe-load-approvals'] },
    evaluationSuites: [
      { namespace: 'tenant-a', name: 'eval-suite', version: '1.0.0', digest: DIGEST_A },
    ],
    verificationSuites: [
      { namespace: 'tenant-a', name: 'verif-suite', version: '1.0.0', digest: DIGEST_B },
    ],
    environmentRequirements: [
      { namespace: 'tenant-a', name: 'env-cad-tools', version: '2.1.0', digest: DIGEST_C },
    ],
    substrateCompatibility: makeProfileInput(),
    provenance: {
      creator: CREATOR,
      createdAt: TIMESTAMP,
      rights: RIGHTS,
      records: [],
    },
    lineage: { parents: [] },
    ...overrides,
  };
}

export async function makeBodyVersion(
  overrides: Partial<CreateBodyVersionInput> = {},
): Promise<BodyVersion> {
  return createBodyVersion(makeBodyVersionInput(overrides));
}

export async function makePossession(
  overrides: {
    bodyVersion?: BodyVersion;
    substrate?: CognitiveSubstrate;
  } = {},
): Promise<Possession> {
  const bodyVersion = overrides.bodyVersion ?? (await makeBodyVersion());
  const substrate = overrides.substrate ?? (await makeSubstrate());
  return createPossession({
    bodyVersion,
    substrate,
    runtime: {
      runtimeId: 'runtime-agent-1',
      runtimeVersion: '1.0.0',
      configuration: { locale: 'en', strictMode: true, retries: 2 },
    },
    environment: {
      environmentId: 'env-standard',
      environmentVersion: '3.2.0',
      constraints: ['network-egress-denied', 'fs-read-only'],
    },
    policies: {
      bundleId: 'bundle-tenant-a',
      bundleVersion: '1.0.0',
      policies: [
        { policyId: 'memory-policy', statements: ['persist task outcomes only'] },
        { policyId: 'safety-policy', statements: ['refuse-unsafe-load-approvals'] },
      ],
    },
    modelSpecificArtifacts: [
      {
        artifactId: 'artifact-review-style',
        artifactVersion: '1.0.0',
        digest: DIGEST_A,
        materiality: 'behavioral',
      },
    ],
  });
}
