/**
 * AgentInstance — the ephemeral execution of a Possession
 * (spec AB1.0; architecture-lock rule 17; docs/architecture.md §2).
 *
 * An instance carries: an instance id; the DIGEST of the possession it
 * executes (the ephemeral object never re-embeds the whole binding — it
 * cites it by content address); the environment instance it runs in; its
 * runtime state; its append-only event stream; and its termination status.
 *
 * Lifecycle is STRICTLY append-only and terminal-final:
 *   - every transition is a PURE function returning a NEW frozen instance
 *     (the input instance is never modified);
 *   - the event stream only ever grows, with contiguous 1..n sequences and
 *     monotonically non-decreasing timestamps;
 *   - terminal states (completed / failed / terminated) are FINAL: every
 *     lifecycle operation on a terminated instance throws
 *     AGENT_BODY_INSTANCE_TERMINATED, and because instances are deep-frozen,
 *     in-place mutation throws as well. Nothing can revive or rewrite a
 *     terminated instance (asserted by instance.test.ts).
 */

import { AGENT_BODY_ERROR_CODES, AgentBodyError } from './errors.js';
import type { ContentDigest, TimestampView } from './shared.js';
import {
  AGENT_BODY_ID_PATTERN_SOURCE,
  assertNoCredentialFields,
  assertProviderNeutralString,
  deepFreeze,
  isContentDigest,
  isNeutralId,
  isTimestampView,
  toAgentBodySemver,
  toContentDigest,
  toTimestampView,
  nowTimestampView,
} from './shared.js';

// ---------------------------------------------------------------------------
// Closed lifecycle vocabulary
// ---------------------------------------------------------------------------

/** Non-terminal runtime states of an instance. */
export const INSTANCE_RUNTIME_STATES = ['initialized', 'running', 'suspended'] as const;
export type InstanceRuntimeState = (typeof INSTANCE_RUNTIME_STATES)[number];

/** Terminal statuses — FINAL once set (spec AB1.0 "termination status"). */
export const INSTANCE_TERMINATION_STATUSES = ['completed', 'failed', 'terminated'] as const;
export type InstanceTerminationStatus = (typeof INSTANCE_TERMINATION_STATUSES)[number];

/**
 * Closed event-stream vocabulary. `instance-created` and `terminated` are
 * reserved for lifecycle transitions; `started` and `state-changed` are
 * managed by start/suspend/resume; user code appends observations, actions,
 * escalations and errors via appendAgentInstanceEvent.
 */
export const INSTANCE_EVENT_KINDS = [
  'instance-created',
  'started',
  'state-changed',
  'observation',
  'action',
  'escalation',
  'error',
  'terminated',
] as const;
export type InstanceEventKind = (typeof INSTANCE_EVENT_KINDS)[number];

/** Event kinds that unprivileged appends may carry. */
export const INSTANCE_APPENDABLE_EVENT_KINDS = [
  'observation',
  'action',
  'escalation',
  'error',
] as const;

export function isInstanceRuntimeState(value: unknown): value is InstanceRuntimeState {
  return (
    typeof value === 'string' &&
    (INSTANCE_RUNTIME_STATES as readonly string[]).includes(value)
  );
}

export function isInstanceTerminationStatus(
  value: unknown,
): value is InstanceTerminationStatus {
  return (
    typeof value === 'string' &&
    (INSTANCE_TERMINATION_STATUSES as readonly string[]).includes(value)
  );
}

export function isInstanceEventKind(value: unknown): value is InstanceEventKind {
  return (
    typeof value === 'string' && (INSTANCE_EVENT_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Environment instance
// ---------------------------------------------------------------------------

/**
 * The environment instance an agent instance executes in: environment id +
 * version + ephemeral instance id + a sha256 snapshot digest pinning the
 * instance state at execution time.
 */
export interface EnvironmentInstanceView {
  readonly environmentId: string;
  readonly environmentVersion: string;
  readonly instanceId: string;
  readonly snapshotDigest: string;
}

export function isEnvironmentInstanceView(value: unknown): value is EnvironmentInstanceView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['environmentId'] === 'string' &&
    isNeutralId(candidate['environmentId']) &&
    typeof candidate['instanceId'] === 'string' &&
    INSTANCE_ID_PATTERN.test(candidate['instanceId']) &&
    isContentDigest(candidate['snapshotDigest'])
  );
}

function toEnvironmentInstanceView(value: {
  environmentId: string;
  environmentVersion: string;
  instanceId: string;
  snapshotDigest: string;
}): EnvironmentInstanceView {
  assertProviderNeutralString(value.environmentId, 'environmentId');
  assertProviderNeutralString(value.instanceId, 'environment instanceId');
  if (typeof value.environmentId !== 'string' || !isNeutralId(value.environmentId)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE, {
      message: `invalid environment id: ${JSON.stringify(value.environmentId)} (lowercase neutral identifier required)`,
      details: { pattern: AGENT_BODY_ID_PATTERN_SOURCE },
    });
  }
  const environmentVersion = toAgentBodySemver(value.environmentVersion);
  if (typeof value.instanceId !== 'string' || !INSTANCE_ID_PATTERN.test(value.instanceId)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE, {
      message: `invalid environment instance id: ${JSON.stringify(value.instanceId)}`,
      details: { pattern: INSTANCE_ID_PATTERN_SOURCE },
    });
  }
  const snapshotDigest = toContentDigest(value.snapshotDigest);
  return Object.freeze({
    environmentId: value.environmentId,
    environmentVersion,
    instanceId: value.instanceId,
    snapshotDigest,
  });
}

// ---------------------------------------------------------------------------
// Instance id
// ---------------------------------------------------------------------------

/** Exact pattern source (allows UUIDv4 and human-readable instance ids). */
export const INSTANCE_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

const INSTANCE_ID_PATTERN = new RegExp(INSTANCE_ID_PATTERN_SOURCE);

function isValidInstanceId(value: unknown): value is string {
  return typeof value === 'string' && INSTANCE_ID_PATTERN.test(value);
}

function toInstanceId(value: string): string {
  if (!isValidInstanceId(value)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE, {
      message: `invalid agent instance id: ${JSON.stringify(value)}`,
      details: { pattern: INSTANCE_ID_PATTERN_SOURCE },
    });
  }
  assertProviderNeutralString(value, 'instanceId');
  return value;
}

// ---------------------------------------------------------------------------
// Event stream
// ---------------------------------------------------------------------------

/** One append-only event in an instance's stream. */
export interface AgentInstanceEvent {
  readonly sequence: number;
  readonly kind: InstanceEventKind;
  readonly occurredAt: string;
  readonly payload?: unknown;
}

function isPlainJsonValue(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (Array.isArray(value)) return value.every((item) => isPlainJsonValue(item));
      if (Object.getPrototypeOf(value) !== Object.prototype) return false;
      return Object.values(value).every((item) => isPlainJsonValue(item));
    }
    default:
      return false;
  }
}

function screenPayload(value: unknown, path: string): void {
  if (typeof value === 'string') {
    assertProviderNeutralString(value, path);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => screenPayload(item, `${path}[${String(index)}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    screenPayload(child, `${path}.${key}`);
  }
}

function validatePayload(value: unknown): void {
  if (value === undefined) return;
  if (!isPlainJsonValue(value)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE_EVENT, {
      message: 'event payload must be plain JSON (canonically serializable, no undefined)',
    });
  }
  assertNoCredentialFields(value, 'eventPayload');
  screenPayload(value, 'eventPayload');
}

function appendEvent(
  events: readonly AgentInstanceEvent[],
  kind: InstanceEventKind,
  occurredAt: TimestampView,
  payload?: unknown,
): readonly AgentInstanceEvent[] {
  const last = events.length > 0 ? events[events.length - 1] : undefined;
  if (last !== undefined && last.occurredAt > occurredAt) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE_EVENT, {
      message: `event timestamps must be monotonically non-decreasing (last: ${last.occurredAt}, attempted: ${occurredAt})`,
    });
  }
  const event: AgentInstanceEvent = Object.freeze({
    sequence: events.length + 1,
    kind,
    occurredAt,
    ...(payload !== undefined ? { payload: deepFreeze(payload) } : {}),
  });
  return Object.freeze([...events, event]);
}

// ---------------------------------------------------------------------------
// AgentInstance
// ---------------------------------------------------------------------------

/** Wire version of the agent instance shape. */
export const AGENT_INSTANCE_RECORD_VERSION = 1 as const;

/** The terminal status record (null while the instance is live). */
export interface InstanceTermination {
  readonly status: InstanceTerminationStatus;
  readonly terminatedAt: string;
  readonly reason: string;
}

export interface AgentInstance {
  readonly recordVersion: typeof AGENT_INSTANCE_RECORD_VERSION;
  readonly instanceId: string;
  /** Content digest of the possession this instance executes. */
  readonly possessionDigest: ContentDigest;
  readonly environment: EnvironmentInstanceView;
  readonly runtimeState: InstanceRuntimeState;
  readonly events: readonly AgentInstanceEvent[];
  readonly termination: InstanceTermination | null;
}

export interface CreateAgentInstanceInput {
  readonly possessionDigest: string;
  readonly environment: {
    environmentId: string;
    environmentVersion: string;
    instanceId: string;
    snapshotDigest: string;
  };
  readonly instanceId?: string;
  readonly createdAt?: string;
}

function invalidInstance(message: string, details?: Record<string, unknown>): never {
  throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

function assertNotTerminated(instance: AgentInstance): void {
  if (instance.termination !== null) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INSTANCE_TERMINATED, {
      message: `agent instance ${instance.instanceId} is terminated (${instance.termination.status}) and cannot be mutated: terminal states are final (spec AB1.0)`,
      details: {
        instanceId: instance.instanceId,
        status: instance.termination.status,
        terminatedAt: instance.termination.terminatedAt,
      },
    });
  }
}

/**
 * Create a live agent instance for a possession: instance id (UUIDv4 when
 * absent), the possession's content digest, the environment instance, the
 * `initialized` runtime state, an append-only event stream seeded with the
 * `instance-created` event, and a null termination status. Deep-frozen.
 */
export function createAgentInstance(input: CreateAgentInstanceInput): AgentInstance {
  assertNoCredentialFields(input, 'agentInstance');
  const possessionDigest = toContentDigest(input.possessionDigest);
  const environment = toEnvironmentInstanceView(input.environment);
  const instanceId = toInstanceId(
    input.instanceId ?? globalThis.crypto.randomUUID(),
  );
  const createdAt = toTimestampView(input.createdAt ?? nowTimestampView());

  const instance: AgentInstance = Object.freeze({
    recordVersion: AGENT_INSTANCE_RECORD_VERSION,
    instanceId,
    possessionDigest,
    environment,
    runtimeState: 'initialized',
    events: appendEvent([], 'instance-created', createdAt),
    termination: null,
  });
  return instance;
}

export function isAgentInstance(value: unknown): value is AgentInstance {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== AGENT_INSTANCE_RECORD_VERSION) return false;
  if (typeof candidate['instanceId'] !== 'string') return false;
  if (!isValidInstanceId(candidate['instanceId'])) return false;
  if (!isContentDigest(candidate['possessionDigest'])) return false;
  if (!isEnvironmentInstanceView(candidate['environment'])) return false;
  if (!isInstanceRuntimeState(candidate['runtimeState'])) return false;
  if (!Array.isArray(candidate['events'])) return false;
  for (const event of candidate['events']) {
    if (typeof event !== 'object' || event === null) return false;
    const eventRecord = event as Record<string, unknown>;
    if (
      !isInstanceEventKind(eventRecord['kind']) ||
      typeof eventRecord['sequence'] !== 'number' ||
      !isTimestampView(eventRecord['occurredAt'])
    ) {
      return false;
    }
  }
  const termination = candidate['termination'];
  if (termination === null) return true;
  if (typeof termination !== 'object') return false;
  const terminationRecord = termination as Record<string, unknown>;
  return (
    isInstanceTerminationStatus(terminationRecord['status']) &&
    isTimestampView(terminationRecord['terminatedAt']) &&
    typeof terminationRecord['reason'] === 'string' &&
    terminationRecord['reason'].length > 0
  );
}

/** True iff the instance has reached a terminal state. */
export function isTerminatedAgentInstance(instance: AgentInstance): boolean {
  return instance.termination !== null;
}

// ---------------------------------------------------------------------------
// Lifecycle transitions (pure; terminal states are final)
// ---------------------------------------------------------------------------

function transition(
  instance: AgentInstance,
  runtimeState: InstanceRuntimeState,
  kind: InstanceEventKind,
  occurredAt?: string,
  payload?: unknown,
): AgentInstance {
  assertNotTerminated(instance);
  const at = toTimestampView(occurredAt ?? nowTimestampView());
  const events = appendEvent(instance.events, kind, at, payload);
  return Object.freeze({
    ...instance,
    runtimeState,
    events,
  });
}

/** Start the instance: `initialized` → `running` (appends `started`). */
export function startAgentInstance(instance: AgentInstance, occurredAt?: string): AgentInstance {
  assertNotTerminated(instance);
  if (instance.runtimeState !== 'initialized') {
    invalidInstance(
      `agent instance ${instance.instanceId} cannot start from state ${instance.runtimeState}`,
    );
  }
  return transition(instance, 'running', 'started', occurredAt);
}

/** Suspend the instance: `running` → `suspended` (appends `state-changed`). */
export function suspendAgentInstance(instance: AgentInstance, occurredAt?: string): AgentInstance {
  assertNotTerminated(instance);
  if (instance.runtimeState !== 'running') {
    invalidInstance(
      `agent instance ${instance.instanceId} cannot suspend from state ${instance.runtimeState}`,
    );
  }
  return transition(instance, 'suspended', 'state-changed', occurredAt);
}

/** Resume the instance: `suspended` → `running` (appends `state-changed`). */
export function resumeAgentInstance(instance: AgentInstance, occurredAt?: string): AgentInstance {
  assertNotTerminated(instance);
  if (instance.runtimeState !== 'suspended') {
    invalidInstance(
      `agent instance ${instance.instanceId} cannot resume from state ${instance.runtimeState}`,
    );
  }
  return transition(instance, 'running', 'state-changed', occurredAt);
}

export interface AppendInstanceEventInput {
  readonly kind: string;
  readonly occurredAt?: string;
  readonly payload?: unknown;
}

/**
 * Append an observation / action / escalation / error event to the stream
 * (pure, append-only). Reserved lifecycle kinds (`instance-created`,
 * `started`, `state-changed`, `terminated`) are rejected — they are managed
 * exclusively by the lifecycle transitions. Throws
 * AGENT_BODY_INSTANCE_TERMINATED on a terminated instance.
 */
export function appendAgentInstanceEvent(
  instance: AgentInstance,
  input: AppendInstanceEventInput,
): AgentInstance {
  assertNotTerminated(instance);
  if (
    typeof input.kind !== 'string' ||
    !(INSTANCE_APPENDABLE_EVENT_KINDS as readonly string[]).includes(input.kind)
  ) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE_EVENT, {
      message: `event kind ${JSON.stringify(input.kind)} is not appendable (appendable: ${INSTANCE_APPENDABLE_EVENT_KINDS.join(', ')})`,
      details: { appendable: [...INSTANCE_APPENDABLE_EVENT_KINDS] },
    });
  }
  validatePayload(input.payload);
  return transition(
    instance,
    instance.runtimeState,
    input.kind as (typeof INSTANCE_APPENDABLE_EVENT_KINDS)[number],
    input.occurredAt,
    input.payload,
  );
}

function terminate(
  instance: AgentInstance,
  status: InstanceTerminationStatus,
  reason: string,
  terminatedAt?: string,
): AgentInstance {
  assertNotTerminated(instance);
  if (typeof reason !== 'string' || reason.length === 0) {
    invalidInstance('termination requires a non-empty reason');
  }
  assertProviderNeutralString(reason, 'termination reason');
  const at = toTimestampView(terminatedAt ?? nowTimestampView());
  const termination: InstanceTermination = Object.freeze({
    status,
    terminatedAt: at,
    reason,
  });
  const events = appendEvent(instance.events, 'terminated', at, {
    status,
    reason,
  });
  return Object.freeze({
    ...instance,
    events,
    termination,
  });
}

/** Complete the instance (terminal, final). */
export function completeAgentInstance(
  instance: AgentInstance,
  input: { reason: string; terminatedAt?: string },
): AgentInstance {
  return terminate(instance, 'completed', input.reason, input.terminatedAt);
}

/** Fail the instance (terminal, final). */
export function failAgentInstance(
  instance: AgentInstance,
  input: { reason: string; terminatedAt?: string },
): AgentInstance {
  return terminate(instance, 'failed', input.reason, input.terminatedAt);
}

/** Terminate the instance (terminal, final). */
export function terminateAgentInstance(
  instance: AgentInstance,
  input: { reason: string; terminatedAt?: string },
): AgentInstance {
  return terminate(instance, 'terminated', input.reason, input.terminatedAt);
}

// ---------------------------------------------------------------------------
// Strict wire parsing (append-only invariants enforced on the wire form)
// ---------------------------------------------------------------------------

/**
 * Strictly parse an AgentInstance from its wire (JSON) form. Enforces every
 * append-only invariant on the stream:
 *   - sequences are exactly 1..n in order;
 *   - the first event is `instance-created`;
 *   - timestamps are monotonic non-decreasing;
 *   - a `terminated` event appears exactly when termination is non-null,
 *     as the LAST event, carrying the same status and reason;
 *   - `instance-created`/`terminated` appear exactly once.
 * Throws AGENT_BODY_INVALID_INSTANCE / AGENT_BODY_INVALID_INSTANCE_EVENT.
 */
export function parseAgentInstance(value: unknown): AgentInstance {
  if (!isAgentInstance(value)) {
    invalidInstance('not a structurally valid agent instance');
  }
  assertNoCredentialFields(value, 'agentInstance');
  const instance = value as AgentInstance;

  let lastOccurredAt: string | undefined;
  let createdSeen = false;
  let terminatedSeen = false;
  instance.events.forEach((event, index) => {
    if (event.sequence !== index + 1) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE_EVENT, {
        message: `event sequence must be contiguous from 1 (position ${String(index + 1)} carries sequence ${String(event.sequence)})`,
      });
    }
    if (lastOccurredAt !== undefined && event.occurredAt < lastOccurredAt) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE_EVENT, {
        message: `event timestamps must be monotonically non-decreasing at sequence ${String(event.sequence)}`,
      });
    }
    lastOccurredAt = event.occurredAt;
    if (event.kind === 'instance-created') {
      if (createdSeen || index !== 0) {
        throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE_EVENT, {
          message: 'instance-created must be the unique first event',
        });
      }
      createdSeen = true;
    }
    if (event.kind === 'terminated') {
      if (terminatedSeen) {
        throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE_EVENT, {
          message: 'terminated must appear at most once',
        });
      }
      terminatedSeen = true;
    }
    validatePayload(event.payload);
  });

  const last = instance.events.length > 0 ? instance.events[instance.events.length - 1] : undefined;
  if (!createdSeen || last === undefined) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE_EVENT, {
      message:
        'instance-created must be the unique first event (the event stream must start with instance-created)',
    });
  }
  if (instance.termination !== null) {
    if (!terminatedSeen || last.kind !== 'terminated') {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE_EVENT, {
        message: 'a terminated instance must carry terminated as its LAST event',
      });
    }
    const payload = last.payload as { status?: unknown; reason?: unknown } | undefined;
    if (
      payload === undefined ||
      payload['status'] !== instance.termination.status ||
      payload['reason'] !== instance.termination.reason
    ) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE_EVENT, {
        message: 'the terminated event must carry the termination status and reason',
      });
    }
  } else if (terminatedSeen) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE_EVENT, {
      message: 'a terminated event requires a non-null termination status',
    });
  }

  return deepFreeze({
    ...instance,
    environment: toEnvironmentInstanceView(instance.environment),
  });
}
