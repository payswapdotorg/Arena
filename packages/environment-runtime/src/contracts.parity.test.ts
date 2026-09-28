/**
 * Contract parity tests — bind the generated contracts
 * (packages/environment-runtime/contracts/*.v1.json, produced by
 * scripts/generate-contracts.mjs) to the TypeScript surface of
 * @arena/environment-runtime.
 *
 * If someone edits the TS constants without regenerating contracts (or
 * vice versa), these tests fail — and the drift suite (drift.test.ts)
 * fails when the committed JSON no longer matches the generator. Two
 * independent tripwires for contract drift, exactly like the
 * A001/A002/A009 convention.
 */

import { describe, expect, it } from 'vitest';
import admissionDecisionSchema from '../contracts/admission-decision.v1.json' with { type: 'json' };
import admissionDecidedSchema from '../contracts/admission-decided-event.v1.json' with { type: 'json' };
import advanceCommandSchema from '../contracts/advance-run-command.v1.json' with { type: 'json' };
import checkpointCommandSchema from '../contracts/checkpoint-run-command.v1.json' with { type: 'json' };
import checkpointRecordedSchema from '../contracts/checkpoint-recorded-event.v1.json' with { type: 'json' };
import checkpointRestoredSchema from '../contracts/checkpoint-restored-event.v1.json' with { type: 'json' };
import cleanupCommandSchema from '../contracts/cleanup-run-command.v1.json' with { type: 'json' };
import completeCommandSchema from '../contracts/complete-run-command.v1.json' with { type: 'json' };
import environmentEventLogSchema from '../contracts/environment-event-log.v1.json' with { type: 'json' };
import failCommandSchema from '../contracts/fail-run-command.v1.json' with { type: 'json' };
import restoreCommandSchema from '../contracts/restore-run-command.v1.json' with { type: 'json' };
import runCheckpointSchema from '../contracts/run-checkpoint.v1.json' with { type: 'json' };
import runRecordSchema from '../contracts/run-record.v1.json' with { type: 'json' };
import runResultSchema from '../contracts/run-result.v1.json' with { type: 'json' };
import runStateSchema from '../contracts/run-state.v1.json' with { type: 'json' };
import runSubmittedSchema from '../contracts/run-submitted-event.v1.json' with { type: 'json' };
import runtimeErrorSchema from '../contracts/runtime-error.v1.json' with { type: 'json' };
import schemaRegistrySchema from '../contracts/schema-registry.v1.json' with { type: 'json' };
import startCommandSchema from '../contracts/start-run-command.v1.json' with { type: 'json' };
import stateTransitionedSchema from '../contracts/state-transitioned-event.v1.json' with { type: 'json' };
import submitCommandSchema from '../contracts/submit-run-command.v1.json' with { type: 'json' };
import workloadProgressedSchema from '../contracts/workload-progressed-event.v1.json' with { type: 'json' };
import runResultProducedSchema from '../contracts/run-result-produced-event.v1.json' with { type: 'json' };

import {
  ENVIRONMENT_RUNTIME_ERROR_CATEGORIES,
  ENVIRONMENT_RUNTIME_ERROR_CODES,
} from './errors.js';
import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  RUN_ID_PATTERN_SOURCE,
  RUN_KEY_PATTERN_SOURCE,
  RUN_TIMESTAMP_PATTERN_SOURCE,
  SEED_PATTERN_SOURCE,
  TENANT_PATTERN_SOURCE,
} from './shared.js';
import { JOB_REF_PATTERN_SOURCE, RUN_RECORD_FIELDS } from './run-record.js';
import {
  HOSTNAME_PATTERN_SOURCE,
  MOUNT_PATH_PATTERN_SOURCE,
  NAME_PATTERN_SOURCE,
  NAMESPACE_PATTERN_SOURCE,
  SEMVER_PATTERN_SOURCE,
} from './isolation-envelope.js';
import { RUN_STATES, RUN_LIFECYCLE_EVENTS } from './lifecycle.js';
import { RUNTIME_EVENT_KINDS } from './events.js';
import {
  ENVIRONMENT_RUNTIME_SCHEMAS,
  ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  environmentRuntimeSchemaRef,
} from './envelopes.js';

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

type Contract = {
  $schema?: string;
  $id?: string;
  title?: string;
  enum?: unknown[];
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, Record<string, unknown>>;
};

const CONTRACTS: Record<string, Contract> = {
  'environment-runtime/admission-decision': admissionDecisionSchema as Contract,
  'environment-runtime/admission-decided-event': admissionDecidedSchema as Contract,
  'environment-runtime/advance-run-command': advanceCommandSchema as Contract,
  'environment-runtime/checkpoint-run-command': checkpointCommandSchema as Contract,
  'environment-runtime/checkpoint-recorded-event': checkpointRecordedSchema as Contract,
  'environment-runtime/checkpoint-restored-event': checkpointRestoredSchema as Contract,
  'environment-runtime/cleanup-run-command': cleanupCommandSchema as Contract,
  'environment-runtime/complete-run-command': completeCommandSchema as Contract,
  'environment-runtime/environment-event-log': environmentEventLogSchema as Contract,
  'environment-runtime/fail-run-command': failCommandSchema as Contract,
  'environment-runtime/restore-run-command': restoreCommandSchema as Contract,
  'environment-runtime/run-checkpoint': runCheckpointSchema as Contract,
  'environment-runtime/run-record': runRecordSchema as Contract,
  'environment-runtime/run-result': runResultSchema as Contract,
  'environment-runtime/run-state': runStateSchema as Contract,
  'environment-runtime/run-submitted-event': runSubmittedSchema as Contract,
  'environment-runtime/runtime-error': runtimeErrorSchema as Contract,
  'environment-runtime/schema-registry': schemaRegistrySchema as Contract,
  'environment-runtime/start-run-command': startCommandSchema as Contract,
  'environment-runtime/state-transitioned-event': stateTransitionedSchema as Contract,
  'environment-runtime/submit-run-command': submitCommandSchema as Contract,
  'environment-runtime/workload-progressed-event': workloadProgressedSchema as Contract,
  'environment-runtime/run-result-produced-event': runResultProducedSchema as Contract,
};

describe('generated contract parity — environment-runtime', () => {
  it('every contract is draft 2020-12 with a versioned SchemaRef $id', () => {
    for (const [id, contract] of Object.entries(CONTRACTS)) {
      expect(contract.$schema, id).toBe(DRAFT);
      expect(contract.$id, id).toBe(
        `arena:schema/${id}@${ENVIRONMENT_RUNTIME_SCHEMA_VERSION}`,
      );
      expect(typeof contract.title).toBe('string');
    }
  });

  it('the contract set is exactly the schema registry (1:1, no drift)', () => {
    const registryNames = Object.keys(ENVIRONMENT_RUNTIME_SCHEMAS);
    expect(registryNames.length).toBe(23);
    expect(Object.keys(CONTRACTS).sort()).toEqual([...registryNames].sort());
    // The schema-registry contract enumerates every schema ref.
    const enumerated = schemaRegistrySchema.enum as string[];
    expect([...enumerated].sort()).toEqual(
      registryNames.map((name) => `arena:schema/${name}@1.0.0`).sort(),
    );
  });

  it('error taxonomy parity (codes + categories)', () => {
    const codeEnum = runtimeErrorSchema.properties?.['code']?.enum as string[];
    expect([...codeEnum].sort()).toEqual(
      Object.values(ENVIRONMENT_RUNTIME_ERROR_CODES).sort(),
    );
    const categoryEnum = runtimeErrorSchema.properties?.['category']?.enum as string[];
    expect([...categoryEnum].sort()).toEqual([...ENVIRONMENT_RUNTIME_ERROR_CATEGORIES].sort());
  });

  it('lifecycle vocabulary parity (states + lifecycle events)', () => {
    const fromEnum = stateTransitionedSchema.properties?.['from']?.enum as string[];
    const toEnum = stateTransitionedSchema.properties?.['to']?.enum as string[];
    const eventEnum = stateTransitionedSchema.properties?.['lifecycleEvent']?.enum as string[];
    const statusEnum = runStateSchema.properties?.['status']?.enum as string[];
    expect([...fromEnum].sort()).toEqual([...RUN_STATES].sort());
    expect([...toEnum].sort()).toEqual([...RUN_STATES].sort());
    expect([...eventEnum].sort()).toEqual([...RUN_LIFECYCLE_EVENTS].sort());
    expect([...statusEnum].sort()).toEqual([...RUN_STATES].sort());
  });

  it('event taxonomy parity (kinds + per-kind schemas)', () => {
    // Every event kind has a dedicated schema carrying a const kind.
    for (const kind of RUNTIME_EVENT_KINDS) {
      const schemaName = `environment-runtime/${kind}-event`;
      const contract = CONTRACTS[schemaName];
      expect(contract, schemaName).toBeDefined();
      expect(contract?.properties?.['kind']).toMatchObject({ const: kind });
    }
  });

  it('pattern source parity (character-for-character mirrors)', () => {
    const patterns: Record<string, string> = {
      tenant: TENANT_PATTERN_SOURCE,
      runKey: RUN_KEY_PATTERN_SOURCE,
      runId: RUN_ID_PATTERN_SOURCE,
      digest: CONTENT_DIGEST_PATTERN_SOURCE,
      timestamp: RUN_TIMESTAMP_PATTERN_SOURCE,
      seed: SEED_PATTERN_SOURCE,
      jobRef: JOB_REF_PATTERN_SOURCE,
      namespace: NAMESPACE_PATTERN_SOURCE,
      name: NAME_PATTERN_SOURCE,
      semver: SEMVER_PATTERN_SOURCE,
      hostname: HOSTNAME_PATTERN_SOURCE,
      mountPath: MOUNT_PATH_PATTERN_SOURCE,
    };
    const recordProperties = runRecordSchema.properties as Record<
      string,
      { pattern?: string }
    >;
    for (const [field, source] of Object.entries(patterns)) {
      const inRecord = recordProperties[field]?.pattern;
      if (inRecord !== undefined) {
        expect(inRecord, field).toBe(source);
      }
    }
    expect(recordProperties['runId']?.pattern).toBe(RUN_ID_PATTERN_SOURCE);
    expect(recordProperties['jobRef']?.pattern).toBe(JOB_REF_PATTERN_SOURCE);
    expect(recordProperties['initialSnapshotDigest']?.pattern).toBe(
      CONTENT_DIGEST_PATTERN_SOURCE,
    );
  });

  it('run record field parity (view fields + digest, strict shape)', () => {
    const required = runRecordSchema.required as string[];
    expect([...required].sort()).toEqual([...RUN_RECORD_FIELDS, 'digest'].sort());
    expect(runRecordSchema.additionalProperties).toBe(false);
    expect(runRecordSchema.properties?.['recordVersion']).toMatchObject({ const: 1 });
  });

  it('command payload parity (run-targeted commands)', () => {
    for (const name of [
      'environment-runtime/start-run-command',
      'environment-runtime/advance-run-command',
      'environment-runtime/checkpoint-run-command',
      'environment-runtime/complete-run-command',
      'environment-runtime/cleanup-run-command',
    ]) {
      const contract = CONTRACTS[name];
      expect(contract?.required, name).toEqual(['runId', 'tenantId']);
      expect(contract?.additionalProperties, name).toBe(false);
    }
    expect(
      CONTRACTS['environment-runtime/restore-run-command']?.required,
    ).toEqual(['runId', 'tenantId', 'checkpoint']);
    expect(CONTRACTS['environment-runtime/fail-run-command']?.required).toEqual([
      'runId',
      'tenantId',
      'errorClass',
      'message',
    ]);
    expect(CONTRACTS['environment-runtime/submit-run-command']?.required).toEqual([
      'declaration',
    ]);
  });

  it('run result + run address parity (all address parts required)', () => {
    const address = runResultSchema.properties?.['runAddress'] as {
      required?: string[];
      properties?: Record<string, { pattern?: string; minItems?: number }>;
    };
    expect(address.required).toEqual([
      'taskVersion',
      'environmentVersion',
      'runId',
      'initialSnapshotDigest',
      'trajectoryDigest',
      'evidenceDigests',
    ]);
    expect(address.properties?.['runId']?.pattern).toBe('^[a-z][a-z0-9-]{0,63}$');
    expect(address.properties?.['evidenceDigests']?.minItems).toBe(1);
    expect(runResultSchema.properties?.['finalState']).toMatchObject({ const: 'completed' });
  });

  it('environmentRuntimeSchemaRef matches the contract $ids', () => {
    for (const name of Object.keys(ENVIRONMENT_RUNTIME_SCHEMAS)) {
      const ref = environmentRuntimeSchemaRef(
        name as keyof typeof ENVIRONMENT_RUNTIME_SCHEMAS,
      );
      expect(`arena:schema/${name}@${ref.version}`).toBe(
        `arena:schema/${name}@${ENVIRONMENT_RUNTIME_SCHEMA_VERSION}`,
      );
    }
  });
});
