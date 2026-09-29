/**
 * Envelope wiring for the task-spec protocol (Work Order A008;
 * architecture-lock rules 17, 18, 22).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages carry a
 * correlation id, payloads are canonical-JSON serializable and
 * digest-verifiable, and unknown envelope versions are rejected by the
 * core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Messages:
 *   - run-compilation-command (COMMAND, idempotency key REQUIRED): the
 *     intent to compile one registered capability case (by case digest)
 *     under one registered compilation policy (by identity + digest), at
 *     explicit derive/compile timestamps (the fabric takes NO clock
 *     reads — determinism under test);
 *   - compilation-recorded-event (EVENT): the resulting CompilationRecord
 *     plus the emitted TaskSpec PROPOSALS (the case itself is never
 *     mutated — compilation is a proposal, lock rule 6).
 *
 * Payload schemas are versioned as SchemaRefs in the `task` namespace
 * (arena:schema/task/<name>@<major.minor.patch>) and mirrored by the
 * generated contracts in contracts/task/ (see
 * packages/task-spec/scripts/generate-contracts.mjs; parity is asserted
 * by contracts.parity.test.ts).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';
import type { CompilationPolicyRefView } from './shared.js';
import { isCompilationPolicyRefView } from './shared.js';
import type { CompilationRecord } from './compilation-record.js';
import { isCompilationRecord } from './compilation-record.js';
import type { TaskSpec } from './spec.js';
import { isTaskSpec } from './spec.js';

export const TASK_SPEC_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/task-spec. Mirrored by the
 * generated contract task/schema-registry.v1.json (parity asserted in
 * contracts.parity.test.ts).
 */
export const TASK_SPEC_SCHEMAS = {
  'task/task-spec': TASK_SPEC_SCHEMA_VERSION,
  'task/task-class': TASK_SPEC_SCHEMA_VERSION,
  'task/compilation-policy': TASK_SPEC_SCHEMA_VERSION,
  'task/compilation-record': TASK_SPEC_SCHEMA_VERSION,
  'task/run-compilation-command': TASK_SPEC_SCHEMA_VERSION,
  'task/compilation-recorded-event': TASK_SPEC_SCHEMA_VERSION,
  'task/error': TASK_SPEC_SCHEMA_VERSION,
  'task/schema-registry': TASK_SPEC_SCHEMA_VERSION,
} as const;

export type TaskSpecSchemaName = keyof typeof TASK_SPEC_SCHEMAS;

/** Resolve a task-spec schema name to its SchemaRef. */
export function taskSpecSchemaRef(name: TaskSpecSchemaName): SchemaRef {
  const version = TASK_SPEC_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown task-spec protocol schema: ${String(name)}`,
      details: { known: Object.keys(TASK_SPEC_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a task-spec schema at the registered version. */
export function isKnownTaskSpecSchema(ref: SchemaRef): boolean {
  const registered = (TASK_SPEC_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// run-compilation-command
// ---------------------------------------------------------------------------

/**
 * The intent to compile one registered case under one registered policy.
 * The case is addressed by its content digest (the exact case state);
 * timestamps are EXPLICIT inputs (no clock reads — reproducible runs).
 */
export interface RunCompilationCommandPayload {
  readonly caseDigest: string;
  readonly policyRef: CompilationPolicyRefView;
  readonly derivedAt: string;
  readonly compiledAt: string;
}

export function isRunCompilationCommandPayload(
  value: unknown,
): value is RunCompilationCommandPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['caseDigest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['caseDigest']) &&
    isCompilationPolicyRefView(candidate['policyRef']) &&
    typeof candidate['derivedAt'] === 'string' &&
    typeof candidate['compiledAt'] === 'string'
  );
}

export function makeRunCompilationCommand(
  payload: RunCompilationCommandPayload,
  options: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<RunCompilationCommandPayload> {
  if (!isRunCompilationCommandPayload(payload)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_RECORD, {
      message: 'run-compilation-command payload is not structurally valid',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: taskSpecSchemaRef('task/run-compilation-command'),
    correlationId: options.correlationId,
    idempotencyKey: options.idempotencyKey,
    payload,
  });
}

export function parseRunCompilationCommand(
  raw: string,
): Envelope<RunCompilationCommandPayload> {
  return parseEnvelopeAs<RunCompilationCommandPayload>(
    raw,
    taskSpecSchemaRef('task/run-compilation-command'),
  );
}

// ---------------------------------------------------------------------------
// compilation-recorded-event
// ---------------------------------------------------------------------------

/** The result of one compilation run: the record + the emitted proposals. */
export interface CompilationRecordedEventPayload {
  readonly record: CompilationRecord;
  readonly specs: readonly TaskSpec[];
}

export function isCompilationRecordedEventPayload(
  value: unknown,
): value is CompilationRecordedEventPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isCompilationRecord(candidate['record']) &&
    Array.isArray(candidate['specs']) &&
    candidate['specs'].every((spec) => isTaskSpec(spec))
  );
}

export function makeCompilationRecordedEvent(
  payload: CompilationRecordedEventPayload,
  options: { correlationId: CorrelationId },
): Envelope<CompilationRecordedEventPayload> {
  if (!isCompilationRecordedEventPayload(payload)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_RECORD, {
      message: 'compilation-recorded-event payload is not structurally valid',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: taskSpecSchemaRef('task/compilation-recorded-event'),
    correlationId: options.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export function parseCompilationRecordedEvent(
  raw: string,
): Envelope<CompilationRecordedEventPayload> {
  return parseEnvelopeAs<CompilationRecordedEventPayload>(
    raw,
    taskSpecSchemaRef('task/compilation-recorded-event'),
  );
}

// ---------------------------------------------------------------------------
// Digest helpers (re-exported for the fabric's convenience)
// ---------------------------------------------------------------------------

export { envelopeDigest, verifyEnvelope };
