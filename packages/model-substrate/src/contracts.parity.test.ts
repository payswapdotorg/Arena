/**
 * Contract parity tests — bind the generated contracts
 * (contracts/model-substrate/*.json, produced by
 * packages/model-substrate/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/model-substrate, AND pin the vendored
 * screening conventions against the committed @arena/agent-body contract
 * (contracts/agent-body/cognitive-substrate.v1.json — read as a FILE, not
 * a workspace import, per the A016 domain purity gate).
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001/A002 convention.
 */

import { describe, expect, it } from 'vitest';
import adapterDescriptorSchema from '../../../contracts/model-substrate/adapter-descriptor.v1.json' with { type: 'json' };
import registrationDescriptorSchema from '../../../contracts/model-substrate/substrate-registration-descriptor.v1.json' with { type: 'json' };
import substrateRecordSchema from '../../../contracts/model-substrate/substrate-record.v1.json' with { type: 'json' };
import capabilityProfileSchema from '../../../contracts/model-substrate/capability-profile.v1.json' with { type: 'json' };
import adapterHealthSchema from '../../../contracts/model-substrate/adapter-health.v1.json' with { type: 'json' };
import registrationSchema from '../../../contracts/model-substrate/substrate-registration.v1.json' with { type: 'json' };
import registrySchema from '../../../contracts/model-substrate/substrate-registry.v1.json' with { type: 'json' };
import compatibilityTestSchema from '../../../contracts/model-substrate/compatibility-test.v1.json' with { type: 'json' };
import compatibilityResultSchema from '../../../contracts/model-substrate/compatibility-result.v1.json' with { type: 'json' };
import upgradeSchema from '../../../contracts/model-substrate/substrate-upgrade.v1.json' with { type: 'json' };
import errorSchema from '../../../contracts/model-substrate/model-substrate-error.v1.json' with { type: 'json' };
import registerCommandSchema from '../../../contracts/model-substrate/register-substrate-command.v1.json' with { type: 'json' };
import upgradeCommandSchema from '../../../contracts/model-substrate/declare-substrate-upgrade-command.v1.json' with { type: 'json' };
import compatCommandSchema from '../../../contracts/model-substrate/record-compatibility-result-command.v1.json' with { type: 'json' };
import registeredEventSchema from '../../../contracts/model-substrate/substrate-registered-event.v1.json' with { type: 'json' };
import upgradeEventSchema from '../../../contracts/model-substrate/substrate-upgrade-declared-event.v1.json' with { type: 'json' };
import compatEventSchema from '../../../contracts/model-substrate/compatibility-result-recorded-event.v1.json' with { type: 'json' };
import registryIndexSchema from '../../../contracts/model-substrate/model-substrate-schema-registry.v1.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL_SUBSTRATE_ERROR_CATEGORIES,
  MODEL_SUBSTRATE_ERROR_CODES,
} from './errors.js';
import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  MODEL_SUBSTRATE_ID_PATTERN_SOURCE,
  MODEL_SUBSTRATE_NAME_PATTERN_SOURCE,
  MODEL_SUBSTRATE_NAMESPACE_PATTERN_SOURCE,
  MODEL_SUBSTRATE_TIMESTAMP_PATTERN_SOURCE,
  MODEL_SUBSTRATE_VERSION_PATTERN_SOURCE,
  SUBSTRATE_MODEL_FAMILY_PATTERN_SOURCE,
  SUBSTRATE_MODEL_ID_PATTERN_SOURCE,
  SUBSTRATE_MODEL_REVISION_PATTERN_SOURCE,
  SUBSTRATE_MODALITIES,
  SUBSTRATE_CONDITIONS,
  TOOL_CALLING_LEVELS,
} from './shared.js';
import {
  ADAPTER_DESCRIPTOR_RECORD_VERSION,
  ADAPTER_HEALTH_RECORD_VERSION,
  ADAPTER_HEALTH_STATUSES,
} from './adapter.js';
import { CAPABILITY_PROFILE_RECORD_VERSION } from './adapter.js';
import { SUBSTRATE_RECORD_VERSION } from './substrate.js';
import { SUBSTRATE_REGISTRATION_RECORD_VERSION } from './registry.js';
import {
  SUBSTRATE_COMPATIBILITY_RESULT_RECORD_VERSION,
  SUBSTRATE_COMPATIBILITY_TEST_RECORD_VERSION,
  SUBSTRATE_COMPATIBILITY_OUTCOMES,
  COMPATIBILITY_MAX_UNITS_LIMIT,
} from './compatibility.js';
import { SUBSTRATE_UPGRADE_RECORD_VERSION } from './upgrade.js';
import { MODEL_SUBSTRATE_SCHEMAS, MODEL_SUBSTRATE_SCHEMA_VERSION } from './envelopes.js';
import { SUBSTRATE_MAX_UNITS_LIMIT } from './substrate.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

/** Precise view of the agent-body substrate contract fields we pin. */
interface AgentBodySubstrateContract {
  readonly properties: {
    readonly adapterId: { readonly pattern: string };
    readonly adapterVersion: { readonly pattern: string };
    readonly modelFamily: { readonly pattern: string };
    readonly modelId: { readonly pattern: string };
    readonly modelRevision: { readonly pattern: string };
    readonly modalityProfile: { readonly items: { readonly enum: string[] } };
    readonly toolCallingProfile: { readonly enum: string[] };
    readonly conditions: { readonly items: { readonly enum: string[] } };
    readonly integrity: {
      readonly properties: { readonly contentDigest: { readonly pattern: string } };
    };
    readonly contextLimits: unknown;
  };
}

/** The committed agent-body substrate contract, read as a FILE (purity gate:
 *  @arena/agent-body is type-only importable in this package). */
const agentBodySubstrateContract = JSON.parse(
  readFileSync(join(REPO_ROOT, 'contracts', 'agent-body', 'cognitive-substrate.v1.json'), 'utf-8'),
) as AgentBodySubstrateContract;

describe('generated contract parity — model-substrate (positive)', () => {
  it('adapter descriptor schema mirrors the TS wire shape and patterns', () => {
    expect(sorted(adapterDescriptorSchema.required as string[])).toEqual(
      sorted([
        'recordVersion',
        'adapterId',
        'adapterVersion',
        'protocolVersion',
        'supportedModalities',
        'supportedToolCalling',
        'contextCeiling',
        'digest',
      ]),
    );
    expect(adapterDescriptorSchema.properties.adapterId.pattern).toBe(MODEL_SUBSTRATE_ID_PATTERN_SOURCE);
    expect(adapterDescriptorSchema.properties.adapterVersion.pattern).toBe(
      MODEL_SUBSTRATE_VERSION_PATTERN_SOURCE,
    );
    expect(adapterDescriptorSchema.properties.protocolVersion.pattern).toBe(
      MODEL_SUBSTRATE_VERSION_PATTERN_SOURCE,
    );
    expect(adapterDescriptorSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(sorted(adapterDescriptorSchema.properties.supportedModalities.items.enum as string[])).toEqual(
      sorted([...SUBSTRATE_MODALITIES]),
    );
    expect(sorted(adapterDescriptorSchema.properties.supportedToolCalling.enum as string[])).toEqual(
      sorted([...TOOL_CALLING_LEVELS]),
    );
    expect(adapterDescriptorSchema.properties.recordVersion.const).toBe(
      ADAPTER_DESCRIPTOR_RECORD_VERSION,
    );
    expect(adapterDescriptorSchema.additionalProperties).toBe(false);
  });

  it('substrate record schema mirrors the agent-body CognitiveSubstrate shape', () => {
    expect(sorted(substrateRecordSchema.required as string[])).toEqual(
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
    expect(substrateRecordSchema.properties.recordVersion.const).toBe(SUBSTRATE_RECORD_VERSION);
    expect(substrateRecordSchema.properties.modelFamily.pattern).toBe(
      SUBSTRATE_MODEL_FAMILY_PATTERN_SOURCE,
    );
    expect(substrateRecordSchema.properties.modelId.pattern).toBe(SUBSTRATE_MODEL_ID_PATTERN_SOURCE);
    expect(substrateRecordSchema.properties.modelRevision.pattern).toBe(
      SUBSTRATE_MODEL_REVISION_PATTERN_SOURCE,
    );
    expect(substrateRecordSchema.properties.integrity.properties.digestAlgorithm.const).toBe('sha256');
    expect(substrateRecordSchema.properties.integrity.properties.contentDigest.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
    expect(substrateRecordSchema.additionalProperties).toBe(false);
  });

  it('registration descriptor, capability profile and health schemas mirror the TS shapes', () => {
    expect(sorted(registrationDescriptorSchema.required as string[])).toEqual(
      sorted([
        'modelFamily',
        'modelId',
        'modelRevision',
        'modalityProfile',
        'toolCallingProfile',
        'contextLimits',
        'conditions',
      ]),
    );
    expect(registrationDescriptorSchema.additionalProperties).toBe(false);
    expect(sorted(capabilityProfileSchema.required as string[])).toEqual(
      sorted(['recordVersion', 'modalityProfile', 'toolCallingProfile', 'contextLimits', 'conditions']),
    );
    expect(capabilityProfileSchema.properties.recordVersion.const).toBe(CAPABILITY_PROFILE_RECORD_VERSION);
    expect(sorted(adapterHealthSchema.properties.status.enum as string[])).toEqual(
      sorted([...ADAPTER_HEALTH_STATUSES]),
    );
    expect(adapterHealthSchema.properties.checkedAt.pattern).toBe(
      MODEL_SUBSTRATE_TIMESTAMP_PATTERN_SOURCE,
    );
    expect(adapterHealthSchema.properties.recordVersion.const).toBe(ADAPTER_HEALTH_RECORD_VERSION);
  });

  it('registration and registry schemas mirror the registry records', () => {
    expect(sorted(registrationSchema.required as string[])).toEqual(
      sorted([
        'recordVersion',
        'substrateId',
        'substrate',
        'adapterDescriptor',
        'registeredAt',
        'registrationDigest',
      ]),
    );
    expect(registrationSchema.properties.substrateId.pattern).toBe(MODEL_SUBSTRATE_ID_PATTERN_SOURCE);
    expect(registrationSchema.properties.registeredAt.pattern).toBe(
      MODEL_SUBSTRATE_TIMESTAMP_PATTERN_SOURCE,
    );
    expect(registrationSchema.properties.substrate.$ref).toBe('substrate-record.v1.json');
    expect(registrationSchema.properties.adapterDescriptor.$ref).toBe('adapter-descriptor.v1.json');
    expect(registrationSchema.properties.recordVersion.const).toBe(SUBSTRATE_REGISTRATION_RECORD_VERSION);
    expect(registrySchema.type).toBe('array');
    expect(registrySchema.uniqueItems).toBe(true);
    expect(registrySchema.items.$ref).toBe('substrate-registration.v1.json');
  });

  it('compatibility test/result schemas mirror the harness types (gate 5)', () => {
    expect(sorted(compatibilityTestSchema.required as string[])).toEqual(
      sorted(['recordVersion', 'testId', 'bodyVersion', 'substrateDigest', 'spec']),
    );
    expect(compatibilityTestSchema.properties.testId.pattern).toBe(MODEL_SUBSTRATE_ID_PATTERN_SOURCE);
    expect(compatibilityTestSchema.properties.bodyVersion.$ref).toBe('#/$defs/bodyVersionRef');
    expect(compatibilityTestSchema.$defs.bodyVersionRef.required).toEqual([
      'tenant',
      'name',
      'version',
      'digest',
    ]);
    expect(compatibilityTestSchema.$defs.bodyVersionRef.properties.tenant.pattern).toBe(
      MODEL_SUBSTRATE_NAMESPACE_PATTERN_SOURCE,
    );
    expect(compatibilityTestSchema.$defs.bodyVersionRef.properties.name.pattern).toBe(
      MODEL_SUBSTRATE_NAME_PATTERN_SOURCE,
    );
    expect(compatibilityResultSchema.$defs.versionedArtifactRef.properties.namespace.pattern).toBe(
      MODEL_SUBSTRATE_NAMESPACE_PATTERN_SOURCE,
    );
    expect(compatibilityResultSchema.$defs.versionedArtifactRef.properties.name.pattern).toBe(
      MODEL_SUBSTRATE_NAME_PATTERN_SOURCE,
    );
    expect(compatibilityTestSchema.properties.spec.properties.minContextUnits.maximum).toBe(
      COMPATIBILITY_MAX_UNITS_LIMIT,
    );
    expect(compatibilityTestSchema.properties.recordVersion.const).toBe(
      SUBSTRATE_COMPATIBILITY_TEST_RECORD_VERSION,
    );
    expect(sorted(compatibilityResultSchema.properties.outcome.enum as string[])).toEqual(
      sorted([...SUBSTRATE_COMPATIBILITY_OUTCOMES]),
    );
    expect(compatibilityResultSchema.properties.recordVersion.const).toBe(
      SUBSTRATE_COMPATIBILITY_RESULT_RECORD_VERSION,
    );
    expect(compatibilityResultSchema.properties.evidenceRefs.items.$ref).toBe(
      '#/$defs/versionedArtifactRef',
    );
  });

  it('upgrade schema mirrors the R45 declaration (gate 6)', () => {
    expect(sorted(upgradeSchema.required as string[])).toEqual(
      sorted([
        'recordVersion',
        'upgradeId',
        'fromSubstrateDigest',
        'toSubstrateDigest',
        'recertificationRequired',
        'adaptations',
        'declaredAt',
      ]),
    );
    // Recertification is the literal true — no recertification-free upgrade exists.
    expect(upgradeSchema.properties.recertificationRequired.const).toBe(true);
    expect(upgradeSchema.properties.recordVersion.const).toBe(SUBSTRATE_UPGRADE_RECORD_VERSION);
    expect(upgradeSchema.properties.declaredAt.pattern).toBe(MODEL_SUBSTRATE_TIMESTAMP_PATTERN_SOURCE);
    // The closed property set admits no possession field.
    expect(Object.keys(upgradeSchema.properties as Record<string, unknown>)).not.toContain(
      'possession',
    );
    expect(Object.keys(upgradeSchema.properties as Record<string, unknown>)).not.toContain(
      'possessionDigest',
    );
    expect(upgradeSchema.additionalProperties).toBe(false);
  });

  it('error schema enumerates exactly the TS taxonomy', () => {
    expect(sorted(errorSchema.properties.code.enum as string[])).toEqual(
      sorted(Object.values(MODEL_SUBSTRATE_ERROR_CODES)),
    );
    expect(sorted(errorSchema.properties.category.enum as string[])).toEqual(
      sorted([...MODEL_SUBSTRATE_ERROR_CATEGORIES]),
    );
    expect(errorSchema.additionalProperties).toBe(false);
  });

  it('command and event payload schemas reference their record contracts', () => {
    expect(sorted(registerCommandSchema.required as string[])).toEqual(['registration']);
    expect(registerCommandSchema.properties.registration.$ref).toBe('substrate-registration.v1.json');
    expect(sorted(upgradeCommandSchema.required as string[])).toEqual(['upgrade']);
    expect(upgradeCommandSchema.properties.upgrade.$ref).toBe('substrate-upgrade.v1.json');
    expect(sorted(compatCommandSchema.required as string[])).toEqual(['result']);
    expect(compatCommandSchema.properties.result.$ref).toBe('compatibility-result.v1.json');
    expect(sorted(registeredEventSchema.required as string[])).toEqual(['registration']);
    expect(sorted(upgradeEventSchema.required as string[])).toEqual(['upgrade']);
    expect(sorted(compatEventSchema.required as string[])).toEqual(['result']);
  });

  it('schema registry enumerates exactly the model-substrate schemas', () => {
    const expected = sorted(
      Object.keys(MODEL_SUBSTRATE_SCHEMAS).map(
        (name) =>
          `arena:schema/${name.replace('model-substrate/', 'model-substrate/')}@${MODEL_SUBSTRATE_SCHEMA_VERSION}`,
      ),
    );
    expect(sorted(registryIndexSchema.enum as string[])).toEqual(expected);
    expect(registryIndexSchema.enum).toHaveLength(18);
  });

  it('context limits bound mirrors the TS unit limit', () => {
    const ceiling = adapterDescriptorSchema.$defs.contextLimits.properties.maxContextUnits.maximum;
    expect(ceiling).toBe(SUBSTRATE_MAX_UNITS_LIMIT);
    expect(
      compatibilityTestSchema.properties.spec.properties.minContextUnits.maximum,
    ).toBe(SUBSTRATE_MAX_UNITS_LIMIT);
  });

  it('contracts target JSON Schema draft 2020-12 and carry versioned $ids', () => {
    const schemas = [
      adapterDescriptorSchema,
      registrationDescriptorSchema,
      substrateRecordSchema,
      capabilityProfileSchema,
      adapterHealthSchema,
      registrationSchema,
      registrySchema,
      compatibilityTestSchema,
      compatibilityResultSchema,
      upgradeSchema,
      errorSchema,
      registerCommandSchema,
      upgradeCommandSchema,
      compatCommandSchema,
      registeredEventSchema,
      upgradeEventSchema,
      compatEventSchema,
      registryIndexSchema,
    ];
    for (const schema of schemas) {
      expect(schema.$schema).toBe(DRAFT);
      expect(String(schema.$id)).toMatch(
        /^arena:schema\/model-substrate\/[a-z0-9-]+@1\.0\.0$/,
      );
    }
  });
});

describe('cross-package parity — vendored conventions vs contracts/agent-body (A003)', () => {
  it('the closed vocabularies match the agent-body substrate contract exactly', () => {
    expect(sorted(substrateRecordSchema.properties.modalityProfile.items.enum as string[])).toEqual(
      sorted(agentBodySubstrateContract.properties.modalityProfile.items?.enum ?? []),
    );
    expect(sorted(substrateRecordSchema.properties.toolCallingProfile.enum as string[])).toEqual(
      sorted(agentBodySubstrateContract.properties.toolCallingProfile.enum ?? []),
    );
    expect(sorted(substrateRecordSchema.properties.conditions.items.enum as string[])).toEqual(
      sorted(agentBodySubstrateContract.properties.conditions.items?.enum ?? []),
    );
    // And the TS constants match the agent-body contract directly:
    expect(sorted([...SUBSTRATE_MODALITIES])).toEqual(
      sorted(agentBodySubstrateContract.properties.modalityProfile.items?.enum ?? []),
    );
    expect(sorted([...TOOL_CALLING_LEVELS])).toEqual(
      sorted(agentBodySubstrateContract.properties.toolCallingProfile.enum ?? []),
    );
    expect(sorted([...SUBSTRATE_CONDITIONS])).toEqual(
      sorted(agentBodySubstrateContract.properties.conditions.items?.enum ?? []),
    );
  });

  it('the identifier pattern sources match the agent-body substrate contract exactly', () => {
    expect(substrateRecordSchema.properties.adapterId.pattern).toBe(
      agentBodySubstrateContract.properties.adapterId.pattern,
    );
    expect(substrateRecordSchema.properties.adapterVersion.pattern).toBe(
      agentBodySubstrateContract.properties.adapterVersion.pattern,
    );
    expect(substrateRecordSchema.properties.modelFamily.pattern).toBe(
      agentBodySubstrateContract.properties.modelFamily.pattern,
    );
    expect(substrateRecordSchema.properties.modelId.pattern).toBe(
      agentBodySubstrateContract.properties.modelId.pattern,
    );
    expect(substrateRecordSchema.properties.modelRevision.pattern).toBe(
      agentBodySubstrateContract.properties.modelRevision.pattern,
    );
    expect(substrateRecordSchema.properties.integrity.properties.contentDigest.pattern).toBe(
      agentBodySubstrateContract.properties.integrity.properties.contentDigest.pattern,
    );
    expect(substrateRecordSchema.properties.contextLimits).toEqual(
      agentBodySubstrateContract.properties.contextLimits,
    );
  });
});

describe('generated contract parity — model-substrate (negative — drift must not pass silently)', () => {
  it('a hypothetical extra modality would not match the contract enum', () => {
    const hypothetical = sorted([...SUBSTRATE_MODALITIES, 'smell-input']);
    expect(hypothetical).not.toEqual(
      sorted(substrateRecordSchema.properties.modalityProfile.items.enum as string[]),
    );
  });

  it('a hypothetical extra error code would not match the contract enum', () => {
    const hypothetical = sorted([...Object.values(MODEL_SUBSTRATE_ERROR_CODES), 'MODEL_SUBSTRATE_MADE_UP']);
    expect(hypothetical).not.toEqual(sorted(errorSchema.properties.code.enum as string[]));
  });

  it('a hypothetical extra outcome would not match the contract enum', () => {
    const hypothetical = sorted([...SUBSTRATE_COMPATIBILITY_OUTCOMES, 'equivalent']);
    expect(hypothetical).not.toEqual(
      sorted(compatibilityResultSchema.properties.outcome.enum as string[]),
    );
  });

  it('an unknown schema would not match the registry enum', () => {
    const registry = registryIndexSchema.enum as string[];
    expect(registry).not.toContain('arena:schema/model-substrate/does-not-exist@1.0.0');
    expect(registry).not.toContain('arena:schema/agent-body/cognitive-substrate@1.0.0');
  });

  it('recertification is only ever the literal true', () => {
    expect(upgradeSchema.properties.recertificationRequired.const).not.toBe(false);
    expect(upgradeSchema.properties.recertificationRequired.const).not.toBe('true');
  });
});
