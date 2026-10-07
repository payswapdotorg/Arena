/**
 * EscalationRequest — the ES1.0 primary object (Work Order C001;
 * spec/expert-escalation-api.md "Primary object").
 *
 * The request carries every ES1.0 minimum field:
 *   request_id, client_app_id, tenant_id, source_workflow_ref,
 *   source_run_ref, task_ref?, capability_need, escalation_mode(s),
 *   urgency, deadline, budget/currency, required expert capabilities,
 *   geographic/locale requirements, desired output schema, context
 *   references, environment-session policy, privacy policy, permitted
 *   actions, learning permissions, data-retention policy, idempotency
 *   key, correlation ID.
 *
 * Construction is STRICT (fail-closed on every field) and the request is
 * content-addressed: the digest is sha256 over the canonical JSON of the
 * digest-free view via @arena/protocol-core's digestCanonical — NEVER
 * reimplemented here. Records are deep-frozen on construction.
 *
 * Tenant isolation is a DOMAIN concern (not just an API concern): the
 * tenant id is part of the identity of the object and every accessor
 * that takes an expected tenant compares it (see lifecycle.ts).
 */

import { digestCanonical } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import {
  isCorrelationId,
  isIdempotencyKey,
  toCorrelationId,
  toIdempotencyKey,
} from '@arena/protocol-core';
import { ESCALATION_ERROR_CODES, EscalationError } from './errors.js';
import type {
  ClientAppId,
  EscalationId,
  EscalationMode,
  EscalationTimestamp,
  EscalationUrgency,
  PlainJsonValue,
  TenantId,
} from './shared.js';
import {
  CLIENT_APP_ID_PATTERN_SOURCE,
  ESCALATION_ID_PATTERN_SOURCE,
  ESCALATION_MODES,
  TENANT_ID_PATTERN_SOURCE,
  deepFreeze,
  isCapabilityNeed,
  isClientAppId,
  isEscalationId,
  isEscalationMode,
  isEscalationTimestamp,
  isEscalationUrgency,
  isLocaleTag,
  isPlainJsonValue,
  isSourceRef,
  isTenantId,
  isCurrencyCode,
  newEscalationId,
  toClientAppId,
  toEscalationId,
  toEscalationTimestamp,
  toTenantId,
} from './shared.js';

/** Wire version of the escalation request shape. */
export const ESCALATION_REQUEST_VERSION = 1 as const;

/** Closed vocabulary of permitted expert actions (ES1.0 "permitted actions"). */
export const PERMITTED_ACTIONS = Object.freeze([
  'read-context',
  'run-approved-tools',
  'propose-patch',
  'annotate-evidence',
  'ask-clarification',
  'signal-tool-gap',
] as const);
export type PermittedAction = (typeof PERMITTED_ACTIONS)[number];

export function isPermittedAction(value: unknown): value is PermittedAction {
  return typeof value === 'string' && (PERMITTED_ACTIONS as readonly string[]).includes(value);
}

/** Environment-session policy (architecture-lock rule 28/29). */
export const SESSION_MODES = Object.freeze(['none', 'bounded-replica'] as const);
export type SessionMode = (typeof SESSION_MODES)[number];

export const PRIVACY_CLASSIFICATIONS = Object.freeze(['public', 'internal', 'confidential'] as const);
export type PrivacyClassification = (typeof PRIVACY_CLASSIFICATIONS)[number];

export const PII_POLICIES = Object.freeze(['forbid', 'redact', 'allow'] as const);
export type PiiPolicy = (typeof PII_POLICIES)[number];

export const RETENTION_DISPOSITIONS = Object.freeze(['retain', 'purge'] as const);
export type RetentionDisposition = (typeof RETENTION_DISPOSITIONS)[number];

// ---------------------------------------------------------------------------
// Policy shapes (pure data)
// ---------------------------------------------------------------------------

export interface BudgetPolicy {
  /** Maximum spend in minor currency units (integer, >= 0; 0 = no monetary cap authorized). */
  readonly amountMinorUnits: number;
  readonly currency: string;
}

export interface ExpertRequirements {
  /** Capability needs a qualified expert MUST satisfy (>= 1, closed pattern). */
  readonly requiredCapabilities: readonly string[];
  /** Preferred locales (subset of the locale pattern; may be empty). */
  readonly preferredLocales?: readonly string[];
  /** Jurisdiction / geography constraints (source-ref pattern; may be empty). */
  readonly jurisdictions?: readonly string[];
}

export interface EnvironmentSessionPolicy {
  readonly sessionMode: SessionMode;
  /** Privacy sanitization strength applied to the bounded replica. */
  readonly sanitization: 'standard' | 'strict';
}

export interface PrivacyPolicy {
  readonly dataClassification: PrivacyClassification;
  readonly pii: PiiPolicy;
}

export interface LearningPermissions {
  readonly allowKnowledgeCapture: boolean;
  readonly allowToolGapSignals: boolean;
  readonly allowArtifactReuse: boolean;
  readonly requireApproval: boolean;
}

export interface RetentionPolicy {
  /** Retention window in ms (>= 0). */
  readonly retentionMs: number;
  readonly disposition: RetentionDisposition;
}

export interface ContextReference {
  readonly kind: 'uri' | 'artifact-ref' | 'trajectory-ref' | 'task-ref';
  readonly ref: string;
}

// ---------------------------------------------------------------------------
// EscalationRequest
// ---------------------------------------------------------------------------

export interface EscalationRequest {
  readonly requestVersion: typeof ESCALATION_REQUEST_VERSION;
  readonly requestId: EscalationId;
  readonly clientAppId: ClientAppId;
  readonly tenantId: TenantId;
  readonly sourceWorkflowRef: string;
  readonly sourceRunRef: string;
  readonly taskRef?: string;
  readonly capabilityNeed: string;
  readonly escalationModes: readonly EscalationMode[];
  readonly urgency: EscalationUrgency;
  readonly createdAt: EscalationTimestamp;
  readonly deadline: EscalationTimestamp;
  readonly budget: BudgetPolicy;
  readonly expertRequirements: ExpertRequirements;
  readonly locale: string;
  readonly desiredOutputSchema: PlainJsonValue;
  readonly contextReferences: readonly ContextReference[];
  readonly environmentSessionPolicy: EnvironmentSessionPolicy;
  readonly privacyPolicy: PrivacyPolicy;
  readonly permittedActions: readonly PermittedAction[];
  readonly learningPermissions: LearningPermissions;
  readonly retentionPolicy: RetentionPolicy;
  readonly idempotencyKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
  /** sha256 over the canonical serialization of the digest-free view. */
  readonly digest: string;
}

/** The digest-free view (digest is computed over this, canonically). */
function digestFreeView(request: Omit<EscalationRequest, 'digest'>): Record<string, unknown> {
  return {
    requestVersion: request.requestVersion,
    requestId: request.requestId,
    clientAppId: request.clientAppId,
    tenantId: request.tenantId,
    sourceWorkflowRef: request.sourceWorkflowRef,
    sourceRunRef: request.sourceRunRef,
    ...(request.taskRef !== undefined ? { taskRef: request.taskRef } : {}),
    capabilityNeed: request.capabilityNeed,
    escalationModes: request.escalationModes,
    urgency: request.urgency,
    createdAt: request.createdAt,
    deadline: request.deadline,
    budget: request.budget,
    expertRequirements: request.expertRequirements,
    locale: request.locale,
    desiredOutputSchema: request.desiredOutputSchema,
    contextReferences: request.contextReferences,
    environmentSessionPolicy: request.environmentSessionPolicy,
    privacyPolicy: request.privacyPolicy,
    permittedActions: request.permittedActions,
    learningPermissions: request.learningPermissions,
    retentionPolicy: request.retentionPolicy,
    idempotencyKey: request.idempotencyKey,
    correlationId: request.correlationId,
  };
}

export interface CreateEscalationRequestInput {
  readonly clientAppId: string;
  readonly tenantId: string;
  readonly sourceWorkflowRef: string;
  readonly sourceRunRef: string;
  readonly taskRef?: string;
  readonly capabilityNeed: string;
  readonly escalationModes: readonly string[];
  readonly urgency: string;
  /** Injected creation time (epoch ms / ISO string / Date) — never a wall-clock read. */
  readonly now: number | string | Date;
  /** Deadline as an offset from `now` in ms (>= 1), or an absolute instant. */
  readonly deadlineInMs?: number;
  readonly deadlineAt?: number | string | Date;
  readonly budget: { amountMinorUnits: number; currency: string };
  readonly expertRequirements: {
    requiredCapabilities: readonly string[];
    preferredLocales?: readonly string[];
    jurisdictions?: readonly string[];
  };
  readonly locale: string;
  readonly desiredOutputSchema: unknown;
  readonly contextReferences?: readonly ContextReference[];
  readonly environmentSessionPolicy: { sessionMode: string; sanitization?: string };
  readonly privacyPolicy: { dataClassification: string; pii: string };
  readonly permittedActions: readonly string[];
  readonly learningPermissions: {
    allowKnowledgeCapture: boolean;
    allowToolGapSignals: boolean;
    allowArtifactReuse: boolean;
    requireApproval: boolean;
  };
  readonly retentionPolicy: { retentionMs: number; disposition: string };
  readonly idempotencyKey: string;
  readonly correlationId: string;
  /** Fixed request id (idempotent replays / tests); generated when omitted. */
  readonly requestId?: string;
}

function validateStringArray(
  values: readonly unknown[],
  guard: (value: unknown) => boolean,
  field: string,
): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `${field} must be a non-empty array`,
    });
  }
  for (const value of values) {
    if (!guard(value)) {
      throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
        message: `${field} contains an invalid entry: ${JSON.stringify(value)}`,
      });
    }
  }
}

function noDuplicates(values: readonly string[], field: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
        message: `${field} contains a duplicate entry: ${JSON.stringify(value)}`,
      });
    }
    seen.add(value);
  }
}

/**
 * Validate and freeze an ES1.0 EscalationRequest. Async because the
 * content digest is computed with protocol-core's async digestCanonical.
 */
export async function createEscalationRequest(
  input: CreateEscalationRequestInput,
): Promise<EscalationRequest> {
  if (typeof input !== 'object' || input === null) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'escalation request input must be an object',
    });
  }

  if (!isClientAppId(input.clientAppId)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `clientAppId is invalid: ${JSON.stringify(input.clientAppId)} (expected ${CLIENT_APP_ID_PATTERN_SOURCE})`,
    });
  }
  if (!isTenantId(input.tenantId)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_TENANT, {
      message: `tenantId is invalid: ${JSON.stringify(input.tenantId)} (expected ${TENANT_ID_PATTERN_SOURCE})`,
    });
  }
  if (!isIdempotencyKey(input.idempotencyKey)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `idempotencyKey is invalid: ${JSON.stringify(input.idempotencyKey)}`,
    });
  }
  if (!isCorrelationId(input.correlationId)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `correlationId is invalid: ${JSON.stringify(input.correlationId)}`,
    });
  }
  if (input.requestId !== undefined && !isEscalationId(input.requestId)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `requestId is invalid: ${JSON.stringify(input.requestId)} (expected ${ESCALATION_ID_PATTERN_SOURCE})`,
    });
  }

  const createdAt = toEscalationTimestamp(input.now);
  let deadline: EscalationTimestamp;
  if (input.deadlineAt !== undefined) {
    deadline = toEscalationTimestamp(input.deadlineAt);
  } else if (input.deadlineInMs !== undefined) {
    if (!Number.isInteger(input.deadlineInMs) || input.deadlineInMs < 1) {
      throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
        message: 'deadlineInMs must be a positive integer (>= 1)',
      });
    }
    deadline = toEscalationTimestamp(Date.parse(createdAt) + input.deadlineInMs);
  } else {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'a deadline is required (deadlineAt or deadlineInMs)',
    });
  }
  if (Date.parse(deadline) <= Date.parse(createdAt)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.DEADLINE_PASSED, {
      message: `deadline ${deadline} is not after createdAt ${createdAt}`,
    });
  }

  if (!Array.isArray(input.escalationModes) || input.escalationModes.length === 0) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'escalationModes must be a non-empty array (>= 1 approved mode)',
    });
  }
  for (const mode of input.escalationModes) {
    if (!isEscalationMode(mode)) {
      throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_MODE, {
        message: `escalation mode is not in the approved closed vocabulary: ${JSON.stringify(mode)}`,
        details: { approved: ESCALATION_MODES },
      });
    }
  }
  noDuplicates(input.escalationModes, 'escalationModes');

  if (!isEscalationUrgency(input.urgency)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `urgency is not in the closed vocabulary: ${JSON.stringify(input.urgency)}`,
    });
  }

  const budgetAmount = input.budget?.amountMinorUnits;
  if (
    typeof budgetAmount !== 'number' ||
    !Number.isInteger(budgetAmount) ||
    budgetAmount < 0 ||
    budgetAmount > Number.MAX_SAFE_INTEGER
  ) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'budget.amountMinorUnits must be a safe integer >= 0',
    });
  }
  if (!isCurrencyCode(input.budget?.currency)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `budget.currency must be an ISO-4217-shaped code: ${JSON.stringify(input.budget?.currency)}`,
    });
  }

  validateStringArray(input.expertRequirements?.requiredCapabilities, isCapabilityNeed, 'expertRequirements.requiredCapabilities');

  const desiredOutputSchema = input.desiredOutputSchema;
  if (!isPlainJsonValue(desiredOutputSchema) || typeof desiredOutputSchema !== 'object') {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'desiredOutputSchema must be a plain-JSON object schema',
    });
  }

  const contextReferences =
    input.contextReferences === undefined
      ? []
      : [...input.contextReferences].map((ref) => {
          if (
            typeof ref !== 'object' ||
            ref === null ||
            !['uri', 'artifact-ref', 'trajectory-ref', 'task-ref'].includes(String(ref.kind)) ||
            !isSourceRef(ref.ref)
          ) {
            throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
              message: `context reference is invalid: ${JSON.stringify(ref)}`,
            });
          }
          return Object.freeze({ kind: ref.kind, ref: ref.ref });
        });

  const sanitization =
    input.environmentSessionPolicy?.sanitization === undefined
      ? 'standard'
      : input.environmentSessionPolicy.sanitization;
  if (!['standard', 'strict'].includes(sanitization)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `environmentSessionPolicy.sanitization must be 'standard' or 'strict': ${JSON.stringify(sanitization)}`,
    });
  }
  if (!SESSION_MODES.includes(input.environmentSessionPolicy?.sessionMode as SessionMode)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `environmentSessionPolicy.sessionMode must be one of ${JSON.stringify(SESSION_MODES)}`,
    });
  }

  if (!PRIVACY_CLASSIFICATIONS.includes(input.privacyPolicy?.dataClassification as PrivacyClassification)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `privacyPolicy.dataClassification is invalid: ${JSON.stringify(input.privacyPolicy?.dataClassification)}`,
    });
  }
  if (!PII_POLICIES.includes(input.privacyPolicy?.pii as PiiPolicy)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `privacyPolicy.pii is invalid: ${JSON.stringify(input.privacyPolicy?.pii)}`,
    });
  }

  validateStringArray(input.permittedActions, isPermittedAction, 'permittedActions');
  noDuplicates(input.permittedActions, 'permittedActions');

  const learning = input.learningPermissions;
  if (
    typeof learning !== 'object' ||
    learning === null ||
    typeof learning.allowKnowledgeCapture !== 'boolean' ||
    typeof learning.allowToolGapSignals !== 'boolean' ||
    typeof learning.allowArtifactReuse !== 'boolean' ||
    typeof learning.requireApproval !== 'boolean'
  ) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'learningPermissions must carry the four boolean permissions',
    });
  }

  const retentionMs = input.retentionPolicy?.retentionMs;
  if (
    typeof retentionMs !== 'number' ||
    !Number.isInteger(retentionMs) ||
    retentionMs < 0 ||
    retentionMs > Number.MAX_SAFE_INTEGER
  ) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'retentionPolicy.retentionMs must be a safe integer >= 0',
    });
  }
  if (!RETENTION_DISPOSITIONS.includes(input.retentionPolicy?.disposition as RetentionDisposition)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `retentionPolicy.disposition is invalid: ${JSON.stringify(input.retentionPolicy?.disposition)}`,
    });
  }

  const requestId = input.requestId === undefined ? newEscalationId() : toEscalationId(input.requestId);

  const view: Omit<EscalationRequest, 'digest'> = {
    requestVersion: ESCALATION_REQUEST_VERSION,
    requestId,
    clientAppId: toClientAppId(input.clientAppId),
    tenantId: toTenantId(input.tenantId),
    sourceWorkflowRef: assertSourceRef(input.sourceWorkflowRef, 'sourceWorkflowRef'),
    sourceRunRef: assertSourceRef(input.sourceRunRef, 'sourceRunRef'),
    ...(input.taskRef !== undefined ? { taskRef: assertSourceRef(input.taskRef, 'taskRef') } : {}),
    capabilityNeed: assertCapabilityNeed(input.capabilityNeed),
    escalationModes: Object.freeze([...input.escalationModes] as readonly EscalationMode[]),
    urgency: input.urgency,
    createdAt,
    deadline,
    budget: Object.freeze({
      amountMinorUnits: budgetAmount,
      currency: input.budget.currency,
    }),
    expertRequirements: Object.freeze({
      requiredCapabilities: Object.freeze([...input.expertRequirements.requiredCapabilities]),
      ...(input.expertRequirements.preferredLocales !== undefined
        ? {
            preferredLocales: Object.freeze(
              validateLocaleArray(input.expertRequirements.preferredLocales),
            ),
          }
        : {}),
      ...(input.expertRequirements.jurisdictions !== undefined
        ? {
            jurisdictions: Object.freeze(
              validateSourceRefArray(input.expertRequirements.jurisdictions, 'jurisdictions'),
            ),
          }
        : {}),
    }),
    locale: assertLocale(input.locale),
    desiredOutputSchema: deepFreeze(desiredOutputSchema),
    contextReferences: Object.freeze(contextReferences),
    environmentSessionPolicy: Object.freeze({
      sessionMode: input.environmentSessionPolicy.sessionMode as SessionMode,
      sanitization: sanitization as 'standard' | 'strict',
    }),
    privacyPolicy: Object.freeze({
      dataClassification: input.privacyPolicy.dataClassification as PrivacyClassification,
      pii: input.privacyPolicy.pii as PiiPolicy,
    }),
    permittedActions: Object.freeze([...input.permittedActions] as readonly PermittedAction[]),
    learningPermissions: Object.freeze({ ...learning }),
    retentionPolicy: Object.freeze({
      retentionMs,
      disposition: input.retentionPolicy.disposition as RetentionDisposition,
    }),
    idempotencyKey: toIdempotencyKey(input.idempotencyKey),
    correlationId: toCorrelationId(input.correlationId),
  };

  const digest = await digestCanonical(digestFreeView(view));
  const request: EscalationRequest = Object.freeze({ ...view, digest });
  deepFreeze(request as unknown as PlainJsonValue);
  return request;
}

/** Structural guard for wire values claiming to be EscalationRequests. */
export function isEscalationRequest(value: unknown): value is EscalationRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['requestVersion'] === ESCALATION_REQUEST_VERSION &&
    isEscalationId(candidate['requestId']) &&
    isClientAppId(candidate['clientAppId']) &&
    isTenantId(candidate['tenantId']) &&
    isSourceRef(candidate['sourceWorkflowRef']) &&
    isSourceRef(candidate['sourceRunRef']) &&
    (candidate['taskRef'] === undefined || isSourceRef(candidate['taskRef'])) &&
    isCapabilityNeed(candidate['capabilityNeed']) &&
    Array.isArray(candidate['escalationModes']) &&
    candidate['escalationModes'].length > 0 &&
    candidate['escalationModes'].every((mode) => isEscalationMode(mode)) &&
    isEscalationUrgency(candidate['urgency']) &&
    isEscalationTimestamp(candidate['createdAt']) &&
    isEscalationTimestamp(candidate['deadline']) &&
    typeof candidate['budget'] === 'object' &&
    candidate['budget'] !== null &&
    Number.isInteger((candidate['budget'] as Record<string, unknown>)['amountMinorUnits']) &&
    isCurrencyCode((candidate['budget'] as Record<string, unknown>)['currency']) &&
    typeof candidate['digest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['digest']) &&
    isIdempotencyKey(candidate['idempotencyKey']) &&
    isCorrelationId(candidate['correlationId'])
  );
}

// ---------------------------------------------------------------------------
// Field validators (shared with the guard above)
// ---------------------------------------------------------------------------

function assertSourceRef(value: string, field: string): string {
  if (!isSourceRef(value)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `${field} is not a valid source reference: ${JSON.stringify(value)}`,
    });
  }
  return value;
}

function assertCapabilityNeed(value: string): string {
  if (!isCapabilityNeed(value)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `capabilityNeed is invalid: ${JSON.stringify(value)} (dot-separated lowercase segments)`,
    });
  }
  return value;
}

function assertLocale(value: string): string {
  if (!isLocaleTag(value)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `locale is invalid: ${JSON.stringify(value)} (BCP-47 subset ll or ll-CC)`,
    });
  }
  return value;
}

function validateLocaleArray(values: readonly string[]): readonly string[] {
  for (const value of values) {
    if (!isLocaleTag(value)) {
      throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
        message: `preferredLocales entry is invalid: ${JSON.stringify(value)}`,
      });
    }
  }
  return [...values];
}

function validateSourceRefArray(values: readonly string[], field: string): readonly string[] {
  for (const value of values) {
    if (!isSourceRef(value)) {
      throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
        message: `${field} entry is invalid: ${JSON.stringify(value)}`,
      });
    }
  }
  return [...values];
}

export { ESCALATION_MODES };
