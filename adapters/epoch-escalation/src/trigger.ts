/**
 * The Epoch → Arena escalation trigger event (Work Order C019;
 * spec/epoch-integration.md EPI1.0 "Asynchronous contract" +
 * spec/expert-escalation-api.md ES1.0 derivation).
 *
 * HONESTY NOTE (recorded in the C019 PR): EPI1.0 specifies the shape of
 * a CapabilityDevelopmentRequest (the A-series capability-development
 * loop), NOT an escalation request. The escalation-request mapping below
 * is DERIVED from ES1.0's EscalationRequest minimum fields + the EPI1.0
 * asynchronous contract (job id, correlation id, causation id,
 * idempotency key, artifact digests, authorization metadata, explicit
 * lifecycle) + architecture-lock rule 36 (Epoch is a reference customer
 * of the generic Escalation API). Deviations are recorded as open
 * architecture questions in the PR body.
 *
 * Parsing is CLOSED-SHAPE and fail-closed: unknown fields, wrong types,
 * out-of-vocabulary values and malformed ids are all typed rejections.
 */

import { EPOCH_ESCALATION_ERROR_CODES, EpochEscalationError, invalidTrigger } from './errors.js';

/** Epoch escalation trigger wire version. */
export const EPOCH_ESCALATION_TRIGGER_VERSION = 1 as const;

/** Closed trigger vocabulary: why Epoch escalated. */
export const EPOCH_TRIGGER_TYPES = Object.freeze([
  'capability-failure',
  'uncertainty-boundary',
  'tool-gap',
] as const);
export type EpochTriggerType = (typeof EPOCH_TRIGGER_TYPES)[number];

/** Closed vocabulary mapped onto the ES1.0 permitted escalation modes. */
export const EPOCH_ESCALATION_MODES = Object.freeze([
  'solve',
  'correct',
  'unblock',
  'review',
  'teach',
  'tool_gap',
  'knowledge',
  'evaluate',
] as const);
export type EpochEscalationMode = (typeof EPOCH_ESCALATION_MODES)[number];

/** Closed urgency vocabulary (mirrors the ES1.0 urgency set). */
export const EPOCH_URGENCIES = Object.freeze(['routine', 'priority', 'urgent', 'critical'] as const);
export type EpochUrgency = (typeof EPOCH_URGENCIES)[number];

/** Artifact digest kind (EPI1.0 "artifact digest(s)"). */
export const EPOCH_DIGEST_KINDS = Object.freeze(['trajectory', 'evaluation', 'environment'] as const);
export type EpochDigestKind = (typeof EPOCH_DIGEST_KINDS)[number];

/** EPI1.0 job-id / id shape (closed pattern, hex-free, dash-separated). */
const EPOCH_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,127}$/;
const CAPABILITY_NEED_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const SOURCE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface EpochAuthorizationMetadata {
  /** The Arena-registered client application filing the escalation. */
  readonly clientAppId: string;
  /** The Arena tenant the escalation runs under. */
  readonly tenantId: string;
}

/** One EPI1.0 artifact digest carried by the trigger. */
export interface EpochArtifactDigest {
  readonly kind: EpochDigestKind;
  /** sha256 hex digest of the referenced Epoch-side artifact. */
  readonly digest: string;
  /** Stable Epoch-side reference to the digested artifact. */
  readonly ref: string;
}

export interface EpochEscalationTrigger {
  readonly triggerVersion: typeof EPOCH_ESCALATION_TRIGGER_VERSION;
  readonly triggerType: EpochTriggerType;
  /** EPI1.0 job id — the Epoch job whose capability boundary was hit. */
  readonly epochJobId: string;
  /** EPI1.0 correlation id — ties this escalation into Epoch's causal chain. */
  readonly correlationId: string;
  /** EPI1.0 causation id — the Epoch event that caused this escalation. */
  readonly causationId: string;
  /** EPI1.0 idempotency key — retries of the same trigger replay, never re-file. */
  readonly idempotencyKey: string;
  /** EPI1.0 authorization metadata (must match the declared posture). */
  readonly authorization: EpochAuthorizationMetadata;
  /** Epoch source references (workflow / run / task). */
  readonly source: {
    readonly workflowRef: string;
    readonly runRef: string;
    readonly taskRef?: string;
  };
  /** The capability boundary Epoch hit (dot-separated, ES1.0 capability need). */
  readonly capabilityNeed: string;
  /** Free-text uncertainty notes (non-empty, bounded). */
  readonly uncertaintyNotes: string;
  /** The escalation modes Epoch permits for this incident (>= 1). */
  readonly escalationModes: readonly EpochEscalationMode[];
  readonly urgency: EpochUrgency;
  /** Absolute deadline (ISO-8601, must be in the future relative to `occurredAt`). */
  readonly deadlineAt: string;
  /** When Epoch raised the trigger (ISO-8601). */
  readonly occurredAt: string;
  readonly budget: {
    readonly amountMinorUnits: number;
    readonly currency: string;
  };
  /** Capabilities a qualified expert must satisfy (>= 1). */
  readonly requiredExpertCapabilities: readonly string[];
  readonly preferredLocales?: readonly string[];
  /** Desired output schema (plain JSON object schema). */
  readonly desiredOutputSchema: unknown;
  /** EPI1.0 artifact digests (trajectory/evaluation/environment evidence). */
  readonly artifactDigests: readonly EpochArtifactDigest[];
}

/** The exact closed field set of the trigger (unknown-field fail-closed). */
const TRIGGER_FIELDS = Object.freeze([
  'triggerVersion',
  'triggerType',
  'epochJobId',
  'correlationId',
  'causationId',
  'idempotencyKey',
  'authorization',
  'source',
  'capabilityNeed',
  'uncertaintyNotes',
  'escalationModes',
  'urgency',
  'deadlineAt',
  'occurredAt',
  'budget',
  'requiredExpertCapabilities',
  'preferredLocales',
  'desiredOutputSchema',
  'artifactDigests',
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(value: Record<string, unknown>, what: string): void {
  for (const key of Object.keys(value)) {
    if (!(TRIGGER_FIELDS as readonly string[]).includes(key)) {
      throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.UNKNOWN_FIELD, {
        message: `${what} carries unknown field ${JSON.stringify(key)} (closed shape — fail closed)`,
        details: { field: key, known: TRIGGER_FIELDS },
      });
    }
  }
}

function isPlainJsonValue(value: unknown): boolean {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return true;
  if (type !== 'object') return false;
  if (Array.isArray(value)) return value.every(isPlainJsonValue);
  return Object.values(value as Record<string, unknown>).every(isPlainJsonValue);
}

/**
 * Parse and freeze an Epoch escalation trigger (closed shape, fail-closed
 * on every field, unknown fields included).
 */
export function parseEpochEscalationTrigger(value: unknown): EpochEscalationTrigger {
  if (!isRecord(value)) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER, {
      message: 'Epoch escalation trigger must be an object',
    });
  }
  rejectUnknownFields(value, 'Epoch escalation trigger');

  if (value['triggerVersion'] !== EPOCH_ESCALATION_TRIGGER_VERSION) {
    invalidTrigger('triggerVersion', value['triggerVersion'], `exactly ${EPOCH_ESCALATION_TRIGGER_VERSION}`);
  }
  if (!(EPOCH_TRIGGER_TYPES as readonly string[]).includes(String(value['triggerType']))) {
    invalidTrigger('triggerType', value['triggerType'], `one of ${JSON.stringify(EPOCH_TRIGGER_TYPES)}`);
  }
  for (const field of ['epochJobId', 'correlationId', 'causationId', 'idempotencyKey'] as const) {
    if (typeof value[field] !== 'string' || !EPOCH_ID_PATTERN.test(String(value[field]))) {
      invalidTrigger(field, value[field], 'lowercase id (3-128 chars, dashes allowed)');
    }
  }

  const authorization = value['authorization'];
  if (
    !isRecord(authorization) ||
    Object.keys(authorization).length !== 2 ||
    typeof authorization['clientAppId'] !== 'string' ||
    !/^[a-z][a-z0-9-]{1,62}$/.test(authorization['clientAppId']) ||
    typeof authorization['tenantId'] !== 'string' ||
    !/^[a-z][a-z0-9-]{1,62}$/.test(authorization['tenantId'])
  ) {
    invalidTrigger('authorization', authorization, '{ clientAppId, tenantId } matching Arena patterns');
  }

  const source = value['source'];
  if (!isRecord(source)) {
    invalidTrigger('source', source, '{ workflowRef, runRef, taskRef? }');
  }
  for (const key of Object.keys(source)) {
    if (!['workflowRef', 'runRef', 'taskRef'].includes(key)) {
      throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.UNKNOWN_FIELD, {
        message: `Epoch escalation trigger source carries unknown field ${JSON.stringify(key)}`,
        details: { field: `source.${key}` },
      });
    }
  }
  if (
    typeof source['workflowRef'] !== 'string' ||
    !SOURCE_REF_PATTERN.test(source['workflowRef']) ||
    typeof source['runRef'] !== 'string' ||
    !SOURCE_REF_PATTERN.test(source['runRef']) ||
    (source['taskRef'] !== undefined &&
      (typeof source['taskRef'] !== 'string' || !SOURCE_REF_PATTERN.test(source['taskRef'])))
  ) {
    invalidTrigger('source', source, 'source-reference strings');
  }

  if (typeof value['capabilityNeed'] !== 'string' || !CAPABILITY_NEED_PATTERN.test(value['capabilityNeed'])) {
    invalidTrigger('capabilityNeed', value['capabilityNeed'], 'dot-separated lowercase segments');
  }
  if (
    typeof value['uncertaintyNotes'] !== 'string' ||
    value['uncertaintyNotes'].length === 0 ||
    value['uncertaintyNotes'].length > 2_000
  ) {
    invalidTrigger('uncertaintyNotes', value['uncertaintyNotes'], 'non-empty string (<= 2000 chars)');
  }

  const modes = value['escalationModes'];
  if (
    !Array.isArray(modes) ||
    modes.length === 0 ||
    modes.some((mode) => !(EPOCH_ESCALATION_MODES as readonly string[]).includes(String(mode))) ||
    new Set(modes.map(String)).size !== modes.length
  ) {
    invalidTrigger('escalationModes', modes, `>= 1 unique modes from ${JSON.stringify(EPOCH_ESCALATION_MODES)}`);
  }

  if (!(EPOCH_URGENCIES as readonly string[]).includes(String(value['urgency']))) {
    invalidTrigger('urgency', value['urgency'], `one of ${JSON.stringify(EPOCH_URGENCIES)}`);
  }

  for (const field of ['deadlineAt', 'occurredAt'] as const) {
    if (typeof value[field] !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value[field])) {
      invalidTrigger(field, value[field], 'ISO-8601 timestamp');
    }
  }
  if (Date.parse(String(value['deadlineAt'])) <= Date.parse(String(value['occurredAt']))) {
    invalidTrigger('deadlineAt', value['deadlineAt'], 'strictly after occurredAt');
  }

  const budget = value['budget'];
  if (
    !isRecord(budget) ||
    Object.keys(budget).length !== 2 ||
    typeof budget['amountMinorUnits'] !== 'number' ||
    !Number.isInteger(budget['amountMinorUnits']) ||
    budget['amountMinorUnits'] < 0 ||
    budget['amountMinorUnits'] > Number.MAX_SAFE_INTEGER ||
    typeof budget['currency'] !== 'string' ||
    !CURRENCY_PATTERN.test(budget['currency'])
  ) {
    invalidTrigger('budget', budget, '{ amountMinorUnits: integer >= 0, currency: ISO-4217 }');
  }

  const requiredCapabilities = value['requiredExpertCapabilities'];
  if (
    !Array.isArray(requiredCapabilities) ||
    requiredCapabilities.length === 0 ||
    requiredCapabilities.some(
      (entry) => typeof entry !== 'string' || !CAPABILITY_NEED_PATTERN.test(entry),
    ) ||
    new Set(requiredCapabilities.map(String)).size !== requiredCapabilities.length
  ) {
    invalidTrigger('requiredExpertCapabilities', requiredCapabilities, '>= 1 unique capability needs');
  }

  if (value['preferredLocales'] !== undefined) {
    const locales = value['preferredLocales'];
    if (
      !Array.isArray(locales) ||
      locales.length === 0 ||
      locales.some((entry) => typeof entry !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(entry)) ||
      new Set(locales.map(String)).size !== locales.length
    ) {
      invalidTrigger('preferredLocales', locales, 'unique BCP-47 subset locales');
    }
  }

  if (!isPlainJsonValue(value['desiredOutputSchema']) || !isRecord(value['desiredOutputSchema'])) {
    invalidTrigger('desiredOutputSchema', value['desiredOutputSchema'], 'plain-JSON object schema');
  }

  const digests = value['artifactDigests'];
  if (
    !Array.isArray(digests) ||
    digests.length === 0 ||
    digests.some(
      (entry) =>
        !isRecord(entry) ||
        Object.keys(entry).length !== 3 ||
        !(EPOCH_DIGEST_KINDS as readonly string[]).includes(String(entry['kind'])) ||
        typeof entry['digest'] !== 'string' ||
        !/^[0-9a-f]{64}$/.test(entry['digest']) ||
        typeof entry['ref'] !== 'string' ||
        !SOURCE_REF_PATTERN.test(entry['ref']),
    )
  ) {
    invalidTrigger('artifactDigests', digests, '>= 1 { kind, digest: sha256-hex, ref }');
  }

  const trigger: EpochEscalationTrigger = Object.freeze({
    triggerVersion: EPOCH_ESCALATION_TRIGGER_VERSION,
    triggerType: value['triggerType'] as EpochTriggerType,
    epochJobId: value['epochJobId'] as string,
    correlationId: value['correlationId'] as string,
    causationId: value['causationId'] as string,
    idempotencyKey: value['idempotencyKey'] as string,
    authorization: Object.freeze({
      clientAppId: authorization['clientAppId'] as string,
      tenantId: authorization['tenantId'] as string,
    }),
    source: Object.freeze({
      workflowRef: source['workflowRef'] as string,
      runRef: source['runRef'] as string,
      ...(source['taskRef'] !== undefined ? { taskRef: source['taskRef'] as string } : {}),
    }),
    capabilityNeed: value['capabilityNeed'] as string,
    uncertaintyNotes: value['uncertaintyNotes'] as string,
    escalationModes: Object.freeze([...modes] as readonly EpochEscalationMode[]),
    urgency: value['urgency'] as EpochUrgency,
    deadlineAt: value['deadlineAt'] as string,
    occurredAt: value['occurredAt'] as string,
    budget: Object.freeze({
      amountMinorUnits: budget['amountMinorUnits'] as number,
      currency: budget['currency'] as string,
    }),
    requiredExpertCapabilities: Object.freeze([...requiredCapabilities] as readonly string[]),
    ...(value['preferredLocales'] !== undefined
      ? {
          preferredLocales: Object.freeze(
            [...(value['preferredLocales'] as string[])].filter((entry) => typeof entry === 'string'),
          ),
        }
      : {}),
    desiredOutputSchema: deepFreeze(value['desiredOutputSchema']),
    artifactDigests: Object.freeze(
      (digests as Record<string, unknown>[]).map((entry) =>
        Object.freeze({
          kind: entry['kind'] as EpochDigestKind,
          digest: entry['digest'] as string,
          ref: entry['ref'] as string,
        }),
      ),
    ),
  });
  return trigger;
}

/** Structural guard for wire values claiming to be triggers. */
export function isEpochEscalationTrigger(value: unknown): value is EpochEscalationTrigger {
  try {
    parseEpochEscalationTrigger(value);
    return true;
  } catch {
    return false;
  }
}

function deepFreeze(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    return Object.freeze(value);
  }
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  return Object.freeze(value);
}
