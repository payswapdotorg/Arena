/**
 * Contract parity tests — bind the generated contracts
 * (contracts/agent-body/*.json, produced by
 * packages/agent-body/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/agent-body.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001/A002 convention.
 */

import { describe, expect, it } from 'vitest';
import agentBodySchema from '../../../contracts/agent-body/agent-body.v1.json' with { type: 'json' };
import agentBodyErrorSchema from '../../../contracts/agent-body/agent-body-error.v1.json' with { type: 'json' };
import agentInstanceSchema from '../../../contracts/agent-body/agent-instance.v1.json' with { type: 'json' };
import agentInstanceEventSchema from '../../../contracts/agent-body/agent-instance-event.v1.json' with { type: 'json' };
import bodyVersionSchema from '../../../contracts/agent-body/body-version.v1.json' with { type: 'json' };
import bodyVersionRefSchema from '../../../contracts/agent-body/body-version-ref.v1.json' with { type: 'json' };
import cognitiveSubstrateSchema from '../../../contracts/agent-body/cognitive-substrate.v1.json' with { type: 'json' };
import compatibilitySchema from '../../../contracts/agent-body/substrate-compatibility-profile.v1.json' with { type: 'json' };
import modelArtifactSchema from '../../../contracts/agent-body/model-specific-artifact.v1.json' with { type: 'json' };
import possessionSchema from '../../../contracts/agent-body/possession.v1.json' with { type: 'json' };
import registerCommandSchema from '../../../contracts/agent-body/register-substrate-command.v1.json' with { type: 'json' };
import createPossessionCommandSchema from '../../../contracts/agent-body/create-possession-command.v1.json' with { type: 'json' };
import terminateCommandSchema from '../../../contracts/agent-body/terminate-instance-command.v1.json' with { type: 'json' };
import substrateRegisteredEventSchema from '../../../contracts/agent-body/substrate-registered-event.v1.json' with { type: 'json' };
import possessionCreatedEventSchema from '../../../contracts/agent-body/possession-created-event.v1.json' with { type: 'json' };
import instanceTerminatedEventSchema from '../../../contracts/agent-body/agent-instance-terminated-event.v1.json' with { type: 'json' };
import registrySchema from '../../../contracts/agent-body/agent-body-schema-registry.v1.json' with { type: 'json' };
import {
  AGENT_BODY_ERROR_CATEGORIES,
  AGENT_BODY_ERROR_CODES,
} from './errors.js';
import {
  AGENT_BODY_NAMESPACE_PATTERN_SOURCE,
  AGENT_BODY_NAME_PATTERN_SOURCE,
  AGENT_BODY_VERSION_PATTERN_SOURCE,
  AGENT_BODY_ID_PATTERN_SOURCE,
  AGENT_BODY_TIMESTAMP_PATTERN_SOURCE,
  CONTENT_DIGEST_PATTERN_SOURCE,
  PRINCIPAL_ID_PATTERN_SOURCE,
  LICENSE_PATTERN_SOURCE,
  COMMERCIAL_USE_POLICIES,
  REDISTRIBUTION_POLICIES,
  CUSTOMER_DATA_POLICIES,
  PRINCIPAL_TYPES,
} from './shared.js';
import {
  SUBSTRATE_MODALITIES,
  SUBSTRATE_CONDITIONS,
  TOOL_CALLING_LEVELS,
  SUBSTRATE_RECORD_VERSION,
  SUBSTRATE_MAX_UNITS_LIMIT,
  SUBSTRATE_MODEL_FAMILY_PATTERN_SOURCE,
  SUBSTRATE_MODEL_ID_PATTERN_SOURCE,
  SUBSTRATE_MODEL_REVISION_PATTERN_SOURCE,
} from './substrate.js';
import {
  COMPATIBILITY_MAX_UNITS_LIMIT,
  SUBSTRATE_COMPATIBILITY_PROFILE_FIELDS,
} from './compatibility.js';
import {
  MODEL_ARTIFACT_MATERIALITIES,
  POSSESSION_RECORD_VERSION,
} from './possession.js';
import {
  AGENT_INSTANCE_RECORD_VERSION,
  INSTANCE_EVENT_KINDS,
  INSTANCE_ID_PATTERN_SOURCE,
  INSTANCE_RUNTIME_STATES,
  INSTANCE_TERMINATION_STATUSES,
} from './instance.js';
import {
  AGENT_BODY_RECORD_VERSION,
  BODY_VERSION_RECORD_VERSION,
} from './body.js';
import { AGENT_BODY_SCHEMAS } from './envelopes.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('generated contract parity — agent-body (positive)', () => {
  it('agent body schema mirrors the persistent object shape', () => {
    expect(sorted(agentBodySchema.required as string[])).toEqual(
      sorted(['recordVersion', 'identity', 'createdAt', 'creator', 'rights', 'versions']),
    );
    expect(agentBodySchema.properties.recordVersion.const).toBe(AGENT_BODY_RECORD_VERSION);
    expect(agentBodySchema.properties.identity.properties.tenant.pattern).toBe(
      AGENT_BODY_NAMESPACE_PATTERN_SOURCE,
    );
    expect(agentBodySchema.properties.identity.properties.name.pattern).toBe(
      AGENT_BODY_NAME_PATTERN_SOURCE,
    );
    expect(agentBodySchema.properties.createdAt.pattern).toBe(AGENT_BODY_TIMESTAMP_PATTERN_SOURCE);
    expect(agentBodySchema.additionalProperties).toBe(false);
    expect(agentBodySchema.$defs.principal.properties.tenant.pattern).toBe(
      AGENT_BODY_NAMESPACE_PATTERN_SOURCE,
    );
  });

  it('body version schema mirrors the full AB1.0 snapshot', () => {
    expect(sorted(bodyVersionSchema.required as string[])).toEqual(
      sorted([
        'recordVersion',
        'body',
        'version',
        'mission',
        'role',
        'domainScope',
        'capabilities',
        'skills',
        'knowledge',
        'tools',
        'procedures',
        'memoryPolicy',
        'planningPolicy',
        'escalation',
        'authorityBoundaries',
        'safetyPolicy',
        'evaluationSuites',
        'verificationSuites',
        'environmentRequirements',
        'substrateCompatibility',
        'provenance',
        'lineage',
        'digest',
      ]),
    );
    expect(bodyVersionSchema.properties.recordVersion.const).toBe(BODY_VERSION_RECORD_VERSION);
    expect(bodyVersionSchema.properties.version.pattern).toBe(AGENT_BODY_VERSION_PATTERN_SOURCE);
    expect(bodyVersionSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(bodyVersionSchema.properties.evaluationSuites.minItems).toBe(1);
    expect(bodyVersionSchema.properties.verificationSuites.minItems).toBe(1);
    expect(bodyVersionSchema.properties.environmentRequirements.minItems).toBe(1);
    expect(bodyVersionSchema.properties.domainScope.minItems).toBe(1);
    expect(bodyVersionSchema.properties.authorityBoundaries.minItems).toBe(1);
    expect(bodyVersionSchema.additionalProperties).toBe(false);
  });

  it('body version ref schema is the content-addressed lineage unit', () => {
    expect(sorted(bodyVersionRefSchema.required as string[])).toEqual(
      sorted(['tenant', 'name', 'version', 'digest']),
    );
    expect(bodyVersionRefSchema.properties.version.pattern).toBe(AGENT_BODY_VERSION_PATTERN_SOURCE);
    expect(bodyVersionRefSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
  });

  it('cognitive substrate schema mirrors all 8 spec-identified items', () => {
    expect(sorted(cognitiveSubstrateSchema.required as string[])).toEqual(
      sorted([
        'recordVersion',
        'adapterId',
        'adapterVersion',
        'modelFamily',
        'modelId',
        'modelRevision',
        'modalityProfile',
        'toolCallingProfile',
        'contextLimits',
        'conditions',
        'integrity',
      ]),
    );
    expect(cognitiveSubstrateSchema.properties.recordVersion.const).toBe(SUBSTRATE_RECORD_VERSION);
    expect(cognitiveSubstrateSchema.properties.adapterId.pattern).toBe(AGENT_BODY_ID_PATTERN_SOURCE);
    expect(cognitiveSubstrateSchema.properties.adapterVersion.pattern).toBe(
      AGENT_BODY_VERSION_PATTERN_SOURCE,
    );
    expect(cognitiveSubstrateSchema.properties.modelFamily.pattern).toBe(
      SUBSTRATE_MODEL_FAMILY_PATTERN_SOURCE,
    );
    expect(cognitiveSubstrateSchema.properties.modelId.pattern).toBe(
      SUBSTRATE_MODEL_ID_PATTERN_SOURCE,
    );
    expect(cognitiveSubstrateSchema.properties.modelRevision.pattern).toBe(
      SUBSTRATE_MODEL_REVISION_PATTERN_SOURCE,
    );
  });

  it('substrate enums enumerate exactly the TS vocabulary', () => {
    expect(
      sorted(cognitiveSubstrateSchema.properties.modalityProfile.items.enum as string[]),
    ).toEqual(sorted([...SUBSTRATE_MODALITIES]));
    expect(sorted(cognitiveSubstrateSchema.properties.toolCallingProfile.enum as string[])).toEqual(
      sorted([...TOOL_CALLING_LEVELS]),
    );
    expect(sorted(cognitiveSubstrateSchema.properties.conditions.items.enum as string[])).toEqual(
      sorted([...SUBSTRATE_CONDITIONS]),
    );
    expect(
      cognitiveSubstrateSchema.$defs.contextLimits.properties.maxContextUnits.maximum,
    ).toBe(SUBSTRATE_MAX_UNITS_LIMIT);
    expect(cognitiveSubstrateSchema.properties.integrity.properties.digestAlgorithm.const).toBe(
      'sha256',
    );
  });

  it('compatibility profile schema mirrors the declared requirements (and no identity member)', () => {
    expect(sorted(compatibilitySchema.required as string[])).toEqual(
      sorted([
        'requiredModalities',
        'requiredToolCalling',
        'contextRequirements',
        'requiredEvaluationSuites',
        'prohibitedConditions',
        'substrateAdaptations',
      ]),
    );
    expect(
      sorted(compatibilitySchema.properties.requiredModalities.items.enum as string[]),
    ).toEqual(sorted([...SUBSTRATE_MODALITIES]));
    expect(
      sorted(compatibilitySchema.properties.prohibitedConditions.items.enum as string[]),
    ).toEqual(sorted([...SUBSTRATE_CONDITIONS]));
    expect(
      compatibilitySchema.properties.contextRequirements.properties.minContextUnits.maximum,
    ).toBe(COMPATIBILITY_MAX_UNITS_LIMIT);
    // The closed property set equals the TS-declared field set: nothing can
    // carry a model identity (spec AB1.0 anti-alias rule).
    expect(sorted(Object.keys(compatibilitySchema.properties as Record<string, unknown>))).toEqual(
      sorted([...SUBSTRATE_COMPATIBILITY_PROFILE_FIELDS]),
    );
    expect(compatibilitySchema.properties.substrateAdaptations.items.properties.substrateDigest.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
  });

  it('model-specific artifact schema mirrors the materiality enum', () => {
    expect(sorted(modelArtifactSchema.properties.materiality.enum as string[])).toEqual(
      sorted([...MODEL_ARTIFACT_MATERIALITIES]),
    );
    expect(sorted(modelArtifactSchema.required as string[])).toEqual(
      sorted(['artifactId', 'artifactVersion', 'digest', 'materiality']),
    );
    expect(modelArtifactSchema.properties.artifactId.pattern).toBe(AGENT_BODY_ID_PATTERN_SOURCE);
  });

  it('possession schema mirrors the binding', () => {
    expect(sorted(possessionSchema.required as string[])).toEqual(
      sorted([
        'recordVersion',
        'bodyVersion',
        'substrate',
        'runtime',
        'environment',
        'policies',
        'modelSpecificArtifacts',
        'digest',
      ]),
    );
    expect(possessionSchema.properties.recordVersion.const).toBe(POSSESSION_RECORD_VERSION);
    expect(possessionSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(possessionSchema.$defs.cognitiveSubstrate.properties.adapterId.pattern).toBe(
      AGENT_BODY_ID_PATTERN_SOURCE,
    );
  });

  it('agent instance + event schemas mirror the lifecycle vocabulary', () => {
    expect(sorted(agentInstanceSchema.required as string[])).toEqual(
      sorted([
        'recordVersion',
        'instanceId',
        'possessionDigest',
        'environment',
        'runtimeState',
        'events',
        'termination',
      ]),
    );
    expect(agentInstanceSchema.properties.recordVersion.const).toBe(AGENT_INSTANCE_RECORD_VERSION);
    expect(sorted(agentInstanceSchema.properties.runtimeState.enum as string[])).toEqual(
      sorted([...INSTANCE_RUNTIME_STATES]),
    );
    const terminationOneOf = agentInstanceSchema.properties.termination.oneOf as unknown as Array<{
      properties: { status: { enum: string[] } };
    }>;
    const terminatedBranch = terminationOneOf[1];
    expect(terminatedBranch).toBeDefined();
    expect(sorted(terminatedBranch?.properties.status.enum ?? [])).toEqual(
      sorted([...INSTANCE_TERMINATION_STATUSES]),
    );
    expect(sorted(agentInstanceEventSchema.properties.kind.enum as string[])).toEqual(
      sorted([...INSTANCE_EVENT_KINDS]),
    );
    expect(agentInstanceEventSchema.properties.sequence.minimum).toBe(1);
    expect(agentInstanceSchema.properties.instanceId.pattern).toBe(INSTANCE_ID_PATTERN_SOURCE);
    expect(agentInstanceEventSchema.properties.occurredAt.pattern).toBe(
      AGENT_BODY_TIMESTAMP_PATTERN_SOURCE,
    );
  });

  it('agent body error schema enumerates exactly the TS taxonomy', () => {
    expect(sorted(agentBodyErrorSchema.properties.code.enum as string[])).toEqual(
      sorted(Object.values(AGENT_BODY_ERROR_CODES)),
    );
    expect(sorted(agentBodyErrorSchema.properties.category.enum as string[])).toEqual(
      sorted([...AGENT_BODY_ERROR_CATEGORIES]),
    );
    expect(agentBodyErrorSchema.additionalProperties).toBe(false);
    expect(agentBodyErrorSchema.properties.correlationId.pattern).toBe(PRINCIPAL_ID_PATTERN_SOURCE);
  });

  it('command payload schemas require their full payload shapes', () => {
    expect(sorted(registerCommandSchema.required as string[])).toEqual(
      sorted(['substrate', 'registrant']),
    );
    expect(sorted(createPossessionCommandSchema.required as string[])).toEqual(
      sorted(['possession', 'creator']),
    );
    expect(sorted(terminateCommandSchema.required as string[])).toEqual(
      sorted(['instanceId', 'possessionDigest', 'status', 'reason', 'terminatedAt']),
    );
    expect(
      sorted(terminateCommandSchema.properties.status.enum as string[]),
    ).toEqual(sorted([...INSTANCE_TERMINATION_STATUSES]));
    expect(terminateCommandSchema.properties.possessionDigest.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
  });

  it('event payload schemas require their full payload shapes', () => {
    expect(sorted(substrateRegisteredEventSchema.required as string[])).toEqual(['substrate']);
    expect(sorted(possessionCreatedEventSchema.required as string[])).toEqual(['possession']);
    expect(sorted(instanceTerminatedEventSchema.required as string[])).toEqual(
      sorted(['instanceId', 'possessionDigest', 'termination']),
    );
    expect(
      sorted(instanceTerminatedEventSchema.properties.termination.properties.status.enum as string[]),
    ).toEqual(sorted([...INSTANCE_TERMINATION_STATUSES]));
  });

  it('shared view patterns match the A002 vocabulary (principal, rights)', () => {
    expect(sorted(bodyVersionSchema.$defs.principal.properties.type.enum as string[])).toEqual(
      sorted([...PRINCIPAL_TYPES]),
    );
    expect(bodyVersionSchema.$defs.principal.properties.principalId.pattern).toBe(
      PRINCIPAL_ID_PATTERN_SOURCE,
    );
    expect(bodyVersionSchema.$defs.rights.properties.license.pattern).toBe(LICENSE_PATTERN_SOURCE);
    expect(
      sorted(bodyVersionSchema.$defs.rights.properties.commercialUse.enum as string[]),
    ).toEqual(sorted([...COMMERCIAL_USE_POLICIES]));
    expect(
      sorted(bodyVersionSchema.$defs.rights.properties.redistribution.enum as string[]),
    ).toEqual(sorted([...REDISTRIBUTION_POLICIES]));
    expect(
      sorted(bodyVersionSchema.$defs.rights.properties.customerData.enum as string[]),
    ).toEqual(sorted([...CUSTOMER_DATA_POLICIES]));
    expect(bodyVersionSchema.$defs.policyDocument.properties.policyId.pattern).toBe(
      AGENT_BODY_ID_PATTERN_SOURCE,
    );
    expect(
      bodyVersionSchema.$defs.versionedArtifactRef.properties.version.pattern,
    ).toBe(AGENT_BODY_VERSION_PATTERN_SOURCE);
  });

  it('schema registry enumerates exactly the agent-body schemas', () => {
    const expected = sorted(
      Object.keys(AGENT_BODY_SCHEMAS).map(
        (name) =>
          `arena:schema/${name.replace('/', '/')}@${(AGENT_BODY_SCHEMAS as Record<string, string>)[name]}`,
      ),
    );
    expect(sorted(registrySchema.enum as string[])).toEqual(expected);
    expect(registrySchema.enum).toHaveLength(17);
  });

  it('contract $ids are the formatted agent-body schema refs', () => {
    expect(agentBodySchema.$id).toBe('arena:schema/agent-body/agent-body@1.0.0');
    expect(bodyVersionSchema.$id).toBe('arena:schema/agent-body/body-version@1.0.0');
    expect(cognitiveSubstrateSchema.$id).toBe(
      'arena:schema/agent-body/cognitive-substrate@1.0.0',
    );
    expect(possessionSchema.$id).toBe('arena:schema/agent-body/possession@1.0.0');
    expect(agentInstanceSchema.$id).toBe('arena:schema/agent-body/agent-instance@1.0.0');
    expect(agentBodyErrorSchema.$id).toBe('arena:schema/agent-body/agent-body-error@1.0.0');
    expect(registrySchema.$id).toBe('arena:schema/agent-body/schema-registry@1.0.0');
  });

  it('contracts target JSON Schema draft 2020-12', () => {
    const schemas = [
      agentBodySchema,
      bodyVersionRefSchema,
      bodyVersionSchema,
      cognitiveSubstrateSchema,
      compatibilitySchema,
      modelArtifactSchema,
      possessionSchema,
      agentInstanceSchema,
      agentInstanceEventSchema,
      agentBodyErrorSchema,
      registerCommandSchema,
      createPossessionCommandSchema,
      terminateCommandSchema,
      substrateRegisteredEventSchema,
      possessionCreatedEventSchema,
      instanceTerminatedEventSchema,
      registrySchema,
    ];
    for (const schema of schemas) {
      expect(schema.$schema).toBe(DRAFT);
    }
    expect(schemas).toHaveLength(17);
  });
});

describe('generated contract parity — agent-body (negative — drift must not pass silently)', () => {
  it('a hypothetical extra error code would not match the contract enum', () => {
    const hypothetical = sorted([...Object.values(AGENT_BODY_ERROR_CODES), 'AGENT_BODY_MADE_UP']);
    expect(hypothetical).not.toEqual(sorted(agentBodyErrorSchema.properties.code.enum as string[]));
  });

  it('a hypothetical extra substrate modality would not match the contract enum', () => {
    const hypothetical = sorted([...SUBSTRATE_MODALITIES, 'smell-input']);
    expect(hypothetical).not.toEqual(
      sorted(cognitiveSubstrateSchema.properties.modalityProfile.items.enum as string[]),
    );
  });

  it('a hypothetical unknown agent-body schema would not match the registry enum', () => {
    const registry = registrySchema.enum as string[];
    expect(registry).not.toContain('arena:schema/agent-body/does-not-exist@1.0.0');
    expect(registry).not.toContain('arena:schema/artifacts/material-artifact@1.0.0');
  });

  it('wire versions are pinned consts (never 2)', () => {
    expect(agentBodySchema.properties.recordVersion.const).not.toBe(2);
    expect(bodyVersionSchema.properties.recordVersion.const).not.toBe(2);
    expect(possessionSchema.properties.recordVersion.const).not.toBe(2);
    expect(agentInstanceSchema.properties.recordVersion.const).not.toBe(2);
    expect(cognitiveSubstrateSchema.properties.recordVersion.const).not.toBe(2);
  });
});
