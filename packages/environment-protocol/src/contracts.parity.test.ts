/**
 * Contract parity tests — bind the generated contracts
 * (contracts/environment/*.json, produced by
 * packages/environment-protocol/scripts/generate-contracts.mjs) to the
 * TypeScript surface of @arena/environment-protocol.
 *
 * If someone edits the TS constants without regenerating contracts (or vice
 * versa), these tests fail — and the drift suite (drift.test.ts) fails when
 * the committed JSON no longer matches the generator. Two independent
 * tripwires for contract drift, exactly like the A001/A002 convention.
 */

import { describe, expect, it } from 'vitest';
import actionSurfaceSchema from '../../../contracts/environment/action-surface.v1.json' with { type: 'json' };
import admitCommandSchema from '../../../contracts/environment/admit-workload-command.v1.json' with { type: 'json' };
import checkpointSemanticsSchema from '../../../contracts/environment/checkpoint-semantics.v1.json' with { type: 'json' };
import definitionSchema from '../../../contracts/environment/environment-definition.v1.json' with { type: 'json' };
import errorSchema from '../../../contracts/environment/environment-error.v1.json' with { type: 'json' };
import imageSchema from '../../../contracts/environment/environment-image.v1.json' with { type: 'json' };
import registeredEventSchema from '../../../contracts/environment/environment-registered-event.v1.json' with { type: 'json' };
import versionRefSchema from '../../../contracts/environment/environment-version-ref.v1.json' with { type: 'json' };
import evaluationHooksSchema from '../../../contracts/environment/evaluation-hooks.v1.json' with { type: 'json' };
import evidenceOutputsSchema from '../../../contracts/environment/evidence-outputs.v1.json' with { type: 'json' };
import filesystemPolicySchema from '../../../contracts/environment/filesystem-policy.v1.json' with { type: 'json' };
import networkPolicySchema from '../../../contracts/environment/network-policy.v1.json' with { type: 'json' };
import observationSurfaceSchema from '../../../contracts/environment/observation-surface.v1.json' with { type: 'json' };
import registerCommandSchema from '../../../contracts/environment/register-environment-command.v1.json' with { type: 'json' };
import reproducibilitySchema from '../../../contracts/environment/reproducibility-profile.v1.json' with { type: 'json' };
import resetSemanticsSchema from '../../../contracts/environment/reset-semantics.v1.json' with { type: 'json' };
import resourceLimitsSchema from '../../../contracts/environment/resource-limits.v1.json' with { type: 'json' };
import runAddressSchema from '../../../contracts/environment/run-address.v1.json' with { type: 'json' };
import schemaRegistrySchema from '../../../contracts/environment/environment-schema-registry.v1.json' with { type: 'json' };
import secretPolicySchema from '../../../contracts/environment/secret-policy.v1.json' with { type: 'json' };
import seedPolicySchema from '../../../contracts/environment/seed-policy.v1.json' with { type: 'json' };
import stateSnapshotSchema from '../../../contracts/environment/state-snapshot.v1.json' with { type: 'json' };
import taskVersionRefSchema from '../../../contracts/environment/task-version-ref.v1.json' with { type: 'json' };
import timeLimitsSchema from '../../../contracts/environment/time-limits.v1.json' with { type: 'json' };
import workloadAdmittedSchema from '../../../contracts/environment/workload-admitted-event.v1.json' with { type: 'json' };
import workloadSchema from '../../../contracts/environment/workload-declaration.v1.json' with { type: 'json' };

import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  ENVIRONMENT_ID_PATTERN_SOURCE,
  ENVIRONMENT_NAMESPACE_PATTERN_SOURCE,
  ENVIRONMENT_NAME_PATTERN_SOURCE,
  ENVIRONMENT_VERSION_PATTERN_SOURCE,
  HOSTNAME_PATTERN_SOURCE,
  MOUNT_PATH_PATTERN_SOURCE,
  NEUTRAL_TEXT_PATTERN_SOURCE,
} from './shared.js';
import { IMAGE_KINDS } from './image.js';
import { SNAPSHOT_SUPPORT_MODES } from './snapshot.js';
import { REPRODUCIBILITY_MODES, RESEED_POLICIES } from './reproducibility.js';
import { OBSERVATION_CHANNELS } from './surfaces.js';
import {
  DEADLINE_BEHAVIORS,
  EGRESS_PROTOCOLS,
  FILESYSTEM_WRITE_MODES,
  MOUNT_ACCESS_MODES,
  MOUNT_SOURCES,
  SECRET_INJECTION_MECHANISMS,
} from './isolation.js';
import { RESET_CLEANUPS, RESET_MODES, CHECKPOINT_TRIGGERS } from './lifecycle.js';
import {
  EVIDENCE_ADDRESSING_POLICIES,
  EVIDENCE_OUTPUT_KINDS,
  HOOK_PHASES,
  HOOK_ROLES,
} from './evidence.js';
import { WORKLOAD_TRUST_LEVELS } from './workload.js';
import { ENVIRONMENT_ERROR_CODES, ENVIRONMENT_ERROR_CATEGORIES } from './errors.js';
import {
  ENVIRONMENT_SCHEMAS,
  ENVIRONMENT_SCHEMA_VERSION,
  environmentSchemaRef,
} from './envelopes.js';
import { ENVIRONMENT_DECLARE_FIELDS } from './definition.js';

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('generated contract parity — environment-protocol', () => {
  it('every contract is draft 2020-12 with a versioned SchemaRef $id', () => {
    const contracts = [
      actionSurfaceSchema,
      admitCommandSchema,
      checkpointSemanticsSchema,
      definitionSchema,
      errorSchema,
      imageSchema,
      registeredEventSchema,
      versionRefSchema,
      evaluationHooksSchema,
      evidenceOutputsSchema,
      filesystemPolicySchema,
      networkPolicySchema,
      observationSurfaceSchema,
      registerCommandSchema,
      reproducibilitySchema,
      resetSemanticsSchema,
      resourceLimitsSchema,
      runAddressSchema,
      schemaRegistrySchema,
      secretPolicySchema,
      seedPolicySchema,
      stateSnapshotSchema,
      taskVersionRefSchema,
      timeLimitsSchema,
      workloadAdmittedSchema,
      workloadSchema,
    ];
    expect(contracts).toHaveLength(26);
    for (const contract of contracts) {
      expect(contract['$schema']).toBe(DRAFT);
      expect(String(contract['$id'])).toMatch(/^arena:schema\/environment\/[a-z0-9-]+@1\.0\.0$/);
    }
  });

  it('the environment definition schema mirrors the fifteen declare fields', () => {
    expect(sorted(definitionSchema.required as string[])).toEqual(
      sorted([...ENVIRONMENT_DECLARE_FIELDS, 'recordVersion', 'digest']),
    );
    expect(definitionSchema.additionalProperties).toBe(false);
    expect(definitionSchema.properties.recordVersion.const).toBe(1);
    expect(definitionSchema.properties.identity.properties.namespace.pattern).toBe(
      ENVIRONMENT_NAMESPACE_PATTERN_SOURCE,
    );
    expect(definitionSchema.properties.identity.properties.name.pattern).toBe(
      ENVIRONMENT_NAME_PATTERN_SOURCE,
    );
    expect(definitionSchema.properties.version.pattern).toBe(ENVIRONMENT_VERSION_PATTERN_SOURCE);
    expect(definitionSchema.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
  });

  it('nested definition $defs mirror the TS pattern sources and enums', () => {
    const defs = definitionSchema.$defs;
    expect(defs.environmentImage.properties.imageKind.enum).toEqual([...IMAGE_KINDS]);
    expect(defs.environmentImage.properties.digest.pattern).toBe(CONTENT_DIGEST_PATTERN_SOURCE);
    expect(defs.initialState.properties.snapshotSupport.enum).toEqual([...SNAPSHOT_SUPPORT_MODES]);
    expect(defs.stateSnapshotRef.properties.snapshotId.pattern).toBe(ENVIRONMENT_ID_PATTERN_SOURCE);
    expect(defs.seedPolicy.properties.reseedPolicy.enum).toEqual([...RESEED_POLICIES]);
    expect(defs.reproducibilityProfile.properties.mode.enum).toEqual([...REPRODUCIBILITY_MODES]);
    expect(sorted(defs.nondeterminismCapture.required as string[])).toEqual(
      sorted(['seed', 'versions', 'externalInputs', 'timingContext']),
    );
    expect(defs.nondeterminismCapture.properties.seed.pattern).toBe(NEUTRAL_TEXT_PATTERN_SOURCE);
    expect(defs.actionSurface.properties.actions.minItems).toBe(1);
    expect(defs.observationSurface.properties.observations.minItems).toBe(1);
    expect(sorted(defs.resourceLimits.required as string[])).toEqual(
      sorted(['cpuMillis', 'memoryMiB', 'wallClockSeconds']),
    );
    expect(defs.resourceLimits.properties.cpuMillis.minimum).toBe(1);
    expect(defs.networkPolicy.properties.egress.const).toBe('default-deny');
    expect(defs.networkPolicy.properties.allows.items.properties.port.maximum).toBe(65535);
    expect(defs.filesystemPolicy.properties.writeMode.enum).toEqual([...FILESYSTEM_WRITE_MODES]);
    expect(defs.filesystemPolicy.properties.mounts.items.properties.access.enum).toEqual([
      ...MOUNT_ACCESS_MODES,
    ]);
    expect(defs.filesystemPolicy.properties.mounts.items.properties.source.enum).toEqual([
      ...MOUNT_SOURCES,
    ]);
    expect(defs.filesystemPolicy.properties.mounts.items.properties.mountPath.pattern).toBe(
      MOUNT_PATH_PATTERN_SOURCE,
    );
    expect(defs.secretPolicy.properties.isolation.const).toBe('isolation-boundary');
    expect(
      defs.secretPolicy.properties.injectionPoints.items.properties.mechanism.enum,
    ).toEqual([...SECRET_INJECTION_MECHANISMS]);
    expect(defs.timeLimits.properties.deadlineBehavior.enum).toEqual([...DEADLINE_BEHAVIORS]);
    expect(defs.resetSemantics.properties.mode.enum).toEqual([...RESET_MODES]);
    expect(defs.resetSemantics.properties.cleanup.enum).toEqual([...RESET_CLEANUPS]);
    expect(defs.checkpointSemantics.properties.triggers.items.enum).toEqual([
      ...CHECKPOINT_TRIGGERS,
    ]);
    expect(defs.evidenceOutputs.properties.outputs.minItems).toBe(1);
    expect(defs.evaluationHooks.properties.evaluators.minItems).toBe(1);
    expect(defs.evaluationHooks.properties.verifiers.minItems).toBe(1);
  });

  it('standalone field contracts mirror their TS counterparts', () => {
    expect(sorted(versionRefSchema.required as string[])).toEqual(
      sorted(['namespace', 'name', 'version', 'digest']),
    );
    expect(imageSchema.properties.imageKind.enum).toEqual([...IMAGE_KINDS]);
    expect(stateSnapshotSchema.properties.snapshotSupport.enum).toEqual([
      ...SNAPSHOT_SUPPORT_MODES,
    ]);
    expect(sorted(seedPolicySchema.required as string[])).toEqual(
      sorted(['reproducibility', 'seed', 'seedAlgorithm', 'reseedPolicy', 'note']),
    );
    expect(reproducibilitySchema.properties.mode.enum).toEqual([...REPRODUCIBILITY_MODES]);
    expect(actionSurfaceSchema.properties.actions.minItems).toBe(1);
    expect(observationSurfaceSchema.properties.observations.items.properties.channel.enum).toEqual([
      ...OBSERVATION_CHANNELS,
    ]);
    expect(resourceLimitsSchema.properties.wallClockSeconds.minimum).toBe(1);
    expect(networkPolicySchema.properties.egress.const).toBe('default-deny');
    expect(networkPolicySchema.properties.allows.items.properties.protocol.enum).toEqual([
      ...EGRESS_PROTOCOLS,
    ]);
    expect(networkPolicySchema.properties.allows.items.properties.host.pattern).toBe(
      HOSTNAME_PATTERN_SOURCE,
    );
    expect(filesystemPolicySchema.properties.writeMode.enum).toEqual([...FILESYSTEM_WRITE_MODES]);
    expect(secretPolicySchema.properties.isolation.const).toBe('isolation-boundary');
    expect(timeLimitsSchema.properties.deadlineBehavior.enum).toEqual([...DEADLINE_BEHAVIORS]);
    expect(resetSemanticsSchema.properties.mode.enum).toEqual([...RESET_MODES]);
    expect(checkpointSemanticsSchema.properties.supported.type).toBe('boolean');
    expect(evidenceOutputsSchema.properties.outputs.items.properties.kind.enum).toEqual([
      ...EVIDENCE_OUTPUT_KINDS,
    ]);
    expect(
      evidenceOutputsSchema.properties.outputs.items.properties.addressing.enum,
    ).toEqual([...EVIDENCE_ADDRESSING_POLICIES]);
    expect(evaluationHooksSchema.$defs.hookDeclaration.properties.role.enum).toEqual([
      ...HOOK_ROLES,
    ]);
    expect(evaluationHooksSchema.$defs.hookDeclaration.properties.phase.enum).toEqual([
      ...HOOK_PHASES,
    ]);
    expect(workloadSchema.properties.trust.enum).toEqual([...WORKLOAD_TRUST_LEVELS]);
  });

  it('run address + task ref contracts mirror the required six parts', () => {
    expect(sorted(runAddressSchema.required as string[])).toEqual(
      sorted([
        'taskVersion',
        'environmentVersion',
        'runId',
        'initialSnapshotDigest',
        'trajectoryDigest',
        'evidenceDigests',
      ]),
    );
    expect(runAddressSchema.properties.evidenceDigests.minItems).toBe(1);
    expect(taskVersionRefSchema.properties.taskId.pattern).toBe(ENVIRONMENT_ID_PATTERN_SOURCE);
  });

  it('the error schema enumerates exactly the TS error codes and categories', () => {
    expect(sorted(errorSchema.properties.code.enum as string[])).toEqual(
      sorted(Object.values(ENVIRONMENT_ERROR_CODES)),
    );
    expect(sorted(errorSchema.properties.category.enum as string[])).toEqual(
      sorted([...ENVIRONMENT_ERROR_CATEGORIES]),
    );
    expect(sorted(errorSchema.required as string[])).toEqual(
      sorted(['code', 'category', 'message']),
    );
  });

  it('the schema registry enumerates exactly the TS schema map', () => {
    const expected = (Object.keys(ENVIRONMENT_SCHEMAS) as (keyof typeof ENVIRONMENT_SCHEMAS)[]).map(
      (name) => {
        const ref = environmentSchemaRef(name);
        return `arena:schema/${ref.namespace}/${ref.name}@${ref.version}`;
      },
    );
    expect(sorted(schemaRegistrySchema.enum as string[])).toEqual(sorted(expected));
    expect(ENVIRONMENT_SCHEMA_VERSION).toBe('1.0.0');
  });

  it('command/event payload schemas reference the domain objects they carry', () => {
    expect(registerCommandSchema.properties.environment.$ref).toBe(
      `arena:schema/environment/environment-definition@${ENVIRONMENT_SCHEMA_VERSION}`,
    );
    expect(registeredEventSchema.properties.environment.$ref).toBe(
      `arena:schema/environment/environment-version-ref@${ENVIRONMENT_SCHEMA_VERSION}`,
    );
    expect(admitCommandSchema.properties.workload.$ref).toBe(
      `arena:schema/environment/workload-declaration@${ENVIRONMENT_SCHEMA_VERSION}`,
    );
    expect(workloadAdmittedSchema.properties.environment.$ref).toBe(
      `arena:schema/environment/environment-version-ref@${ENVIRONMENT_SCHEMA_VERSION}`,
    );
    expect(sorted(admitCommandSchema.required as string[])).toEqual(
      sorted(['environment', 'workload']),
    );
  });
});
