/**
 * Envelope wiring for the environment runtime (Work Order A010 gate 4;
 * architecture-lock rules 17, 18, 22; requirement R33).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T> —
 * reused, never reimplemented:
 *   - COMMANDS (submit / start / advance / checkpoint / restore /
 *     complete / fail / cleanup run) carry a REQUIRED non-null
 *     idempotency key (lock rule 17: long-running jobs are idempotent
 *     and correlation-addressable — the runner is the workload executor
 *     the job orchestrator commands);
 *   - EVENTS (every lifecycle transition, admission decision,
 *     checkpoint record, workload step, cleanup) carry the run's
 *     correlation id AND idempotency key (gate 4: lifecycle transitions
 *     are emitted as enveloped, idempotency-keyed events);
 *   - payloads are canonical-JSON serializable and digest-verifiable;
 *     unknown envelope versions are rejected by the core parser.
 *
 * Payload schemas are versioned SchemaRefs in the `environment-runtime`
 * namespace (arena:schema/environment-runtime/<name>@<major.minor.patch>)
 * and mirrored by the generated contracts in
 * packages/environment-runtime/contracts/ (see
 * scripts/generate-contracts.mjs — package-local artifacts; the root
 * contracts/ intake is noted for the Tech Lead).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import type { RuntimeEvent, RuntimeEventKind } from './events.js';
import { isRuntimeEvent } from './events.js';

export const ENVIRONMENT_RUNTIME_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/environment-runtime. Mirrored
 * by the generated contracts (contracts.parity.test.ts asserts parity).
 */
export const ENVIRONMENT_RUNTIME_SCHEMAS = Object.freeze({
  // data schemas
  'environment-runtime/run-record': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/run-state': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/runtime-error': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/run-checkpoint': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/admission-decision': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/run-result': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/environment-event-log': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/schema-registry': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  // event payload schemas (one per taxonomy kind)
  'environment-runtime/run-submitted-event': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/admission-decided-event': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/state-transitioned-event': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/workload-progressed-event': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/checkpoint-recorded-event': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/checkpoint-restored-event': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/run-result-produced-event': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  // command payload schemas (orchestrator → runner)
  'environment-runtime/submit-run-command': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/start-run-command': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/advance-run-command': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/checkpoint-run-command': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/restore-run-command': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/complete-run-command': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/fail-run-command': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
  'environment-runtime/cleanup-run-command': ENVIRONMENT_RUNTIME_SCHEMA_VERSION,
} as const);

export type EnvironmentRuntimeSchemaName = keyof typeof ENVIRONMENT_RUNTIME_SCHEMAS;

/** Resolve an environment-runtime schema name to its SchemaRef. */
export function environmentRuntimeSchemaRef(
  name: EnvironmentRuntimeSchemaName,
): SchemaRef {
  const version = ENVIRONMENT_RUNTIME_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown environment-runtime schema: ${String(name)}`,
      details: { known: Object.keys(ENVIRONMENT_RUNTIME_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names an environment-runtime schema at the registered version. */
export function isKnownEnvironmentRuntimeSchema(ref: SchemaRef): boolean {
  const registered = (
    ENVIRONMENT_RUNTIME_SCHEMAS as Readonly<Record<string, string>>
  )[`${ref.namespace}/${ref.name}`];
  return registered === ref.version;
}

/** Event kind → payload schema name (one schema per taxonomy kind). */
export function runtimeEventSchemaName(kind: RuntimeEventKind): EnvironmentRuntimeSchemaName {
  switch (kind) {
    case 'run-submitted':
      return 'environment-runtime/run-submitted-event';
    case 'admission-decided':
      return 'environment-runtime/admission-decided-event';
    case 'state-transitioned':
      return 'environment-runtime/state-transitioned-event';
    case 'workload-progressed':
      return 'environment-runtime/workload-progressed-event';
    case 'checkpoint-recorded':
      return 'environment-runtime/checkpoint-recorded-event';
    case 'checkpoint-restored':
      return 'environment-runtime/checkpoint-restored-event';
    case 'run-result-produced':
      return 'environment-runtime/run-result-produced-event';
    default: {
      const exhausted: never = kind;
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
        message: `unknown runtime event kind: ${JSON.stringify(exhausted)}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Command payloads (orchestrator → runner; job-orchestrator style)
// ---------------------------------------------------------------------------

/** Command envelope context: correlation + REQUIRED idempotency key. */
export interface RuntimeCommandContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: IdempotencyKey;
}

export interface SubmitRunCommandPayload {
  /** The full run declaration (validated into a RunRecord by the runner). */
  readonly declaration: {
    readonly runKey: string;
    readonly tenantId: string;
    readonly environment: {
      namespace: string;
      name: string;
      version: string;
      digest: string;
    };
    readonly jobRef: string;
    readonly taskVersion: { taskId: string; version: string };
    readonly initialSnapshotDigest: string;
    readonly seed: string | null;
    readonly resourceEnvelope: { cpuMillis: number; memoryMiB: number; wallClockSeconds: number };
    readonly networkEnvelope: {
      egress: string;
      allows?: readonly { host: string; port: number; protocol: string }[];
    };
    readonly filesystemEnvelope: {
      writeMode: string;
      mounts?: readonly { mountPath: string; access: string; source: string }[];
    };
    readonly secretEnvelope: {
      isolation: string;
      injectionPoints?: readonly {
        secretId: string;
        mountPath: string;
        mechanism: string;
      }[];
    };
  };
}

export interface RunTargetedCommandPayload {
  /** The tenant-scoped run id the command addresses. */
  readonly runId: string;
  /** The tenant issuing the command (must own the run — gate 6). */
  readonly tenantId: string;
}

export type StartRunCommandPayload = RunTargetedCommandPayload;

export type AdvanceRunCommandPayload = RunTargetedCommandPayload;

export type CheckpointRunCommandPayload = RunTargetedCommandPayload;

export interface RestoreRunCommandPayload extends RunTargetedCommandPayload {
  readonly checkpoint: { runId: string; sequence: number; snapshotDigest: string };
}

export type CompleteRunCommandPayload = RunTargetedCommandPayload;

export interface FailRunCommandPayload extends RunTargetedCommandPayload {
  readonly errorClass: string;
  readonly message: string;
}

export type CleanupRunCommandPayload = RunTargetedCommandPayload;

// ---------------------------------------------------------------------------
// Command constructors (strictly validated shapes)
// ---------------------------------------------------------------------------

function requireCommandContext(context: RuntimeCommandContext): void {
  if (context.idempotencyKey === undefined || context.idempotencyKey === null) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
}

function command<T>(
  schema: EnvironmentRuntimeSchemaName,
  payload: T,
  context: RuntimeCommandContext,
): Envelope<T> {
  requireCommandContext(context);
  return makeEnvelope({
    kind: 'command',
    schema: environmentRuntimeSchemaRef(schema),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export function makeSubmitRunCommand(
  payload: SubmitRunCommandPayload,
  context: RuntimeCommandContext,
): Envelope<SubmitRunCommandPayload> {
  return command('environment-runtime/submit-run-command', payload, context);
}

export function makeStartRunCommand(
  payload: StartRunCommandPayload,
  context: RuntimeCommandContext,
): Envelope<StartRunCommandPayload> {
  return command('environment-runtime/start-run-command', payload, context);
}

export function makeAdvanceRunCommand(
  payload: AdvanceRunCommandPayload,
  context: RuntimeCommandContext,
): Envelope<AdvanceRunCommandPayload> {
  return command('environment-runtime/advance-run-command', payload, context);
}

export function makeCheckpointRunCommand(
  payload: CheckpointRunCommandPayload,
  context: RuntimeCommandContext,
): Envelope<CheckpointRunCommandPayload> {
  return command('environment-runtime/checkpoint-run-command', payload, context);
}

export function makeRestoreRunCommand(
  payload: RestoreRunCommandPayload,
  context: RuntimeCommandContext,
): Envelope<RestoreRunCommandPayload> {
  return command('environment-runtime/restore-run-command', payload, context);
}

export function makeCompleteRunCommand(
  payload: CompleteRunCommandPayload,
  context: RuntimeCommandContext,
): Envelope<CompleteRunCommandPayload> {
  return command('environment-runtime/complete-run-command', payload, context);
}

export function makeFailRunCommand(
  payload: FailRunCommandPayload,
  context: RuntimeCommandContext,
): Envelope<FailRunCommandPayload> {
  return command('environment-runtime/fail-run-command', payload, context);
}

export function makeCleanupRunCommand(
  payload: CleanupRunCommandPayload,
  context: RuntimeCommandContext,
): Envelope<CleanupRunCommandPayload> {
  return command('environment-runtime/cleanup-run-command', payload, context);
}

// ---------------------------------------------------------------------------
// Event envelopes (runner → observers; gate 4: idempotency-keyed)
// ---------------------------------------------------------------------------

/** Event envelope context: correlation id + REQUIRED idempotency key. */
export interface RuntimeEventContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: IdempotencyKey;
  readonly id?: string;
  readonly issuedAt?: string;
}

/**
 * Wrap a runtime event in a versioned event Envelope carrying the run's
 * correlation id AND idempotency key (gate 4 — mirror of the job
 * protocol's envelope wiring with the idempotency key REQUIRED for
 * environment-runtime events). The payload is validated structurally
 * first.
 */
export function makeRuntimeEventEnvelope(
  event: RuntimeEvent,
  context: RuntimeEventContext,
): Envelope<RuntimeEvent> {
  if (!isRuntimeEvent(event)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'runtime event envelopes require a structurally valid runtime event payload',
    });
  }
  if (context.idempotencyKey === undefined || context.idempotencyKey === null) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'runtime event envelopes require an idempotency key (Work Order A010 gate 4: every lifecycle transition is emitted as an idempotency-keyed envelope)',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: environmentRuntimeSchemaRef(runtimeEventSchemaName(event.kind)),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload: event,
    ...(context.id !== undefined ? { id: context.id } : {}),
    ...(context.issuedAt !== undefined ? { issuedAt: context.issuedAt } : {}),
  });
}

// ---------------------------------------------------------------------------
// Parsing / verification
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to an
 * environment-runtime schema. The core parser rejects unknown envelope
 * versions (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes
 * (PROTOCOL_INVALID_ENVELOPE) and commands without an idempotency key.
 */
export function parseRuntimeEnvelope<T>(
  raw: string,
  expectedSchema?: EnvironmentRuntimeSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string'
      ? environmentRuntimeSchemaRef(expectedSchema)
      : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of a runtime envelope. */
export async function runtimeEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Verify that `raw` parses as a valid runtime envelope whose canonical
 * digest equals `expectedDigest` (PROTOCOL_ENVELOPE_TAMPERED on any
 * mismatch — the core tamper tripwire, reused verbatim).
 */
export async function verifyRuntimeEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  return verifyEnvelope(raw, expectedDigest);
}
