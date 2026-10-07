/**
 * The Epoch escalation reference adapter core (Work Order C019).
 *
 * Epoch → Arena: mapEpochEscalationTrigger validates the trigger's
 * authorization metadata against the declared posture (typed
 * AUTHORIZATION_MISMATCH on any divergence — the cross-tenant
 * adversarial case) and maps the closed trigger shape onto the REAL
 * ES1.0 EscalationRequest constructor from @arena/escalation (never
 * reimplemented here). EPI1.0 artifact digests become ES1.0 context
 * references; the posture supplies the environment-session/privacy/
 * learning/retention policy Epoch declared.
 *
 * Arena → Epoch: epochDeliveryFromRecord projects an EscalationRecord
 * (or a webhook event) into a deep-frozen, READ-ONLY
 * EpochEscalationDelivery — typed result taxonomy, evidence refs,
 * validation status, cost/fee fields, learning-artifact refs where the
 * request authorized reuse. There is NO write-back surface: Epoch
 * consumes the delivery and applies it through its OWN authority
 * (authority.ts enforces this structurally; EPI1.0 + lock rules
 * 13-15, 36).
 */

import {
  createEscalationRequest,
  isEscalationRecord,
  isEscalationResult,
} from '@arena/escalation';
import type {
  CreateEscalationRequestInput,
  EscalationRecord,
  EscalationRequest,
  EscalationResult,
  EscalationWebhookEvent,
} from '@arena/escalation';
import { EPOCH_ESCALATION_ERROR_CODES, EpochEscalationError, normalizeToEpochEscalationError } from './errors.js';
import type { EpochIntegrationPosture } from './posture.js';
import { isEpochEscalationTrigger, parseEpochEscalationTrigger } from './trigger.js';
import type { EpochEscalationTrigger } from './trigger.js';

/** Delivery wire version. */
export const EPOCH_ESCALATION_DELIVERY_VERSION = 1 as const;

/** Explicit delivery lifecycle — the EPI1.0 "explicit lifecycle" clause. */
export const EPOCH_DELIVERY_LIFECYCLE = Object.freeze([
  'delivered',
  'observed',
  'applied-by-epoch',
] as const);
export type EpochDeliveryLifecycle = (typeof EPOCH_DELIVERY_LIFECYCLE)[number];

/** Epoch-consumable reference kinds (the Arena outputs Epoch may hold). */
export const EPOCH_DELIVERY_REF_KINDS = Object.freeze([
  'escalation-request-ref',
  'expert-session-ref',
  'evidence-ref',
  'result-ref',
  'learning-artifact-ref',
] as const);
export type EpochDeliveryRefKind = (typeof EPOCH_DELIVERY_REF_KINDS)[number];

export interface EpochDeliveryRef {
  readonly kind: EpochDeliveryRefKind;
  readonly ref: string;
  /** Content digest where the referenced artifact is content-addressed. */
  readonly digest?: string;
}

/**
 * The READ-ONLY Arena → Epoch delivery projection. Deep-frozen; no
 * setters; no Epoch store handles; applying it is Epoch's OWN act
 * (architecture-lock rule 26: external applications remain
 * authoritative for their live workflows/worlds).
 */
export interface EpochEscalationDelivery {
  readonly deliveryVersion: typeof EPOCH_ESCALATION_DELIVERY_VERSION;
  readonly requestId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly epochJobId: string | null;
  readonly state: string;
  readonly expertRef?: string;
  readonly sessionRef?: string;
  readonly resultKind?: string;
  readonly result?: EscalationResult;
  readonly validationStatus?: string;
  readonly cost?: {
    readonly amountMinorUnits: number;
    readonly currency: string;
    readonly arenaFeeMinorUnits: number;
    readonly expertPayoutStatus: string;
  };
  /** Evidence + artifact refs (result digest, evidence refs, learning refs). */
  readonly refs: readonly EpochDeliveryRef[];
  /** Learning reuse is surfaced ONLY when the request authorized it. */
  readonly learningArtifactRefs: readonly EpochDeliveryRef[];
  readonly deliveredAt: string;
}

// ---------------------------------------------------------------------------
// Epoch → Arena: trigger → ES1.0 EscalationRequest
// ---------------------------------------------------------------------------

/**
 * Assert the trigger's authorization metadata matches the declared
 * posture (fail-closed; typed AUTHORIZATION_MISMATCH).
 */
export function assertTriggerAuthorization(
  trigger: EpochEscalationTrigger,
  posture: EpochIntegrationPosture,
): void {
  if (
    trigger.authorization.clientAppId !== posture.clientAppId ||
    trigger.authorization.tenantId !== posture.tenantId
  ) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.AUTHORIZATION_MISMATCH, {
      message: `trigger authorization (clientAppId ${JSON.stringify(trigger.authorization.clientAppId)}, tenantId ${JSON.stringify(trigger.authorization.tenantId)}) does not match the declared posture (clientAppId ${JSON.stringify(posture.clientAppId)}, tenantId ${JSON.stringify(posture.tenantId)})`,
      details: {
        triggerClientAppId: trigger.authorization.clientAppId,
        postureClientAppId: posture.clientAppId,
        triggerTenantId: trigger.authorization.tenantId,
        postureTenantId: posture.tenantId,
      },
    });
  }
}

/**
 * Pure mapping of a validated trigger + declared posture onto the
 * ES1.0 CreateEscalationRequestInput shape (no validation logic of its
 * own — the @arena/escalation constructor is the single validator).
 */
export function mapTriggerToCreateInput(
  trigger: EpochEscalationTrigger,
  posture: EpochIntegrationPosture,
): CreateEscalationRequestInput {
  if (!isEpochEscalationTrigger(trigger)) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER, {
      message: 'Epoch escalation trigger failed closed-shape validation',
    });
  }
  assertTriggerAuthorization(trigger, posture);

  // EPI1.0 artifact digests → ES1.0 context references (evidence the
  // expert session replica is built from; kind kept lossless).
  const contextReferences: { kind: 'uri' | 'artifact-ref' | 'trajectory-ref' | 'task-ref'; ref: string }[] =
    trigger.artifactDigests.map((artifact) => {
      const kind: 'uri' | 'artifact-ref' | 'trajectory-ref' =
        artifact.kind === 'trajectory'
          ? 'trajectory-ref'
          : artifact.kind === 'evaluation'
            ? 'artifact-ref'
            : 'uri';
      return { kind, ref: artifact.ref };
    });
  if (trigger.source.taskRef !== undefined) {
    contextReferences.push({ kind: 'task-ref' as const, ref: trigger.source.taskRef });
  }

  return {
    clientAppId: trigger.authorization.clientAppId,
    tenantId: trigger.authorization.tenantId,
    sourceWorkflowRef: trigger.source.workflowRef,
    sourceRunRef: trigger.source.runRef,
    ...(trigger.source.taskRef !== undefined ? { taskRef: trigger.source.taskRef } : {}),
    capabilityNeed: trigger.capabilityNeed,
    escalationModes: [...trigger.escalationModes],
    urgency: trigger.urgency,
    now: trigger.occurredAt,
    deadlineAt: trigger.deadlineAt,
    budget: { ...trigger.budget },
    expertRequirements: {
      requiredCapabilities: [...trigger.requiredExpertCapabilities],
      ...(trigger.preferredLocales !== undefined
        ? { preferredLocales: [...trigger.preferredLocales] }
        : {}),
    },
    locale: posture.locale,
    desiredOutputSchema: trigger.desiredOutputSchema,
    contextReferences,
    environmentSessionPolicy: { ...posture.environmentSessionPolicy },
    privacyPolicy: { ...posture.privacyPolicy },
    permittedActions: [...posture.permittedActions],
    learningPermissions: { ...posture.learningPermissions },
    retentionPolicy: { ...posture.retentionPolicy },
    idempotencyKey: trigger.idempotencyKey,
    correlationId: trigger.correlationId,
  };
}

/**
 * Build the ES1.0 EscalationRequest from a trigger under the declared
 * posture — the REAL @arena/escalation constructor validates and
 * content-addresses it (async: canonical digest). Upstream domain
 * failures are normalized into typed EpochEscalationErrors with the
 * cause preserved.
 */
export async function buildEscalationRequest(
  trigger: EpochEscalationTrigger,
  posture: EpochIntegrationPosture,
): Promise<EscalationRequest> {
  const input = mapTriggerToCreateInput(trigger, posture);
  try {
    return await createEscalationRequest(input);
  } catch (error) {
    throw new EpochEscalationError(
      EPOCH_ESCALATION_ERROR_CODES.MAPPING_FAILED,
      {
        message: `ES1.0 EscalationRequest construction rejected the mapped trigger: ${error instanceof Error ? error.message : String(error)}`,
        details: { capabilityNeed: trigger.capabilityNeed },
      },
      error,
    );
  }
}

// ---------------------------------------------------------------------------
// Arena → Epoch: EscalationRecord / webhook event → delivery projection
// ---------------------------------------------------------------------------

/** Per-kind evidence-ref extraction from the closed ES1.0 result taxonomy. */
function resultRefs(result: EscalationResult): EpochDeliveryRef[] {
  const refs: EpochDeliveryRef[] = [];
  if (result.kind === 'correction') {
    refs.push({ kind: 'evidence-ref', ref: result.correctedRef });
  } else if (result.kind === 'unblock') {
    refs.push({ kind: 'evidence-ref', ref: result.blockageRef });
  } else if (result.kind === 'evidence-bundle') {
    for (const ref of result.evidenceRefs) {
      refs.push({ kind: 'evidence-ref', ref });
    }
  } else if (result.kind === 'evaluation-verdict') {
    refs.push({ kind: 'evidence-ref', ref: result.subjectRef });
  }
  return refs;
}

/**
 * Project an EscalationRecord into the Epoch-consumable delivery
 * (read-only, deep-frozen). Learning-artifact refs are surfaced ONLY
 * when the originating request authorized artifact reuse.
 */
export function epochDeliveryFromRecord(record: EscalationRecord): EpochEscalationDelivery {
  if (!isEscalationRecord(record)) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_DELIVERY, {
      message: 'delivery projection requires a structurally valid EscalationRecord',
    });
  }
  return freezeDelivery(projectRecord(record, null));
}

/**
 * Project an escalation webhook event (already signature-verified and
 * deduped by webhook.ts) into the delivery projection. The event's
 * `data` carries the same lifecycle fields the record does.
 */
export function epochDeliveryFromEvent(
  event: EscalationWebhookEvent,
  epochJobId: string | null,
): EpochEscalationDelivery {
  const data =
    typeof event.data === 'object' && event.data !== null ? (event.data as Record<string, unknown>) : {};
  return freezeDelivery({
    deliveryVersion: EPOCH_ESCALATION_DELIVERY_VERSION,
    requestId: event.requestId,
    tenantId: event.tenantId,
    correlationId: event.correlationId,
    epochJobId,
    state: String(data['state'] ?? event.state ?? 'unknown'),
    ...(typeof data['expertRef'] === 'string' ? { expertRef: data['expertRef'] } : {}),
    ...(typeof data['sessionRef'] === 'string' ? { sessionRef: data['sessionRef'] } : {}),
    ...(typeof data['resultKind'] === 'string' ? { resultKind: data['resultKind'] } : {}),
    ...(isEscalationResult(data['result']) ? { result: data['result'] } : {}),
    ...(typeof data['cost'] === 'object' && data['cost'] !== null
      ? {
          cost: {
            amountMinorUnits: (data['cost'] as Record<string, unknown>)['amountMinorUnits'] as number,
            currency: (data['cost'] as Record<string, unknown>)['currency'] as string,
            arenaFeeMinorUnits: (data['cost'] as Record<string, unknown>)['arenaFeeMinorUnits'] as number,
            expertPayoutStatus: (data['cost'] as Record<string, unknown>)['expertPayoutStatus'] as string,
          },
        }
      : {}),
    refs: Object.freeze([
      { kind: 'escalation-request-ref' as const, ref: event.requestId },
      ...(typeof data['sessionRef'] === 'string'
        ? [{ kind: 'expert-session-ref' as const, ref: data['sessionRef'] }]
        : []),
    ]),
    learningArtifactRefs: Object.freeze([]),
    deliveredAt: event.occurredAt,
  });
}

function projectRecord(
  record: EscalationRecord,
  epochJobId: string | null,
): EpochEscalationDelivery {
  const request = record.request;
  const allowReuse = request.learningPermissions.allowArtifactReuse;
  const refs: EpochDeliveryRef[] = [
    { kind: 'escalation-request-ref', ref: request.requestId, digest: request.digest },
  ];
  if (record.sessionRef !== undefined) {
    refs.push({ kind: 'expert-session-ref', ref: record.sessionRef });
  }
  if (record.result !== undefined && isEscalationResult(record.result)) {
    refs.push(...resultRefs(record.result));
  }
  const learningArtifactRefs: EpochDeliveryRef[] = [];
  if (allowReuse && record.result?.kind === 'learning-artifact-ref') {
    const ref = (record.result as { artifactRef?: string }).artifactRef;
    if (typeof ref === 'string') {
      learningArtifactRefs.push({ kind: 'learning-artifact-ref', ref });
    }
  }
  return {
    deliveryVersion: EPOCH_ESCALATION_DELIVERY_VERSION,
    requestId: request.requestId,
    tenantId: request.tenantId,
    correlationId: request.correlationId,
    epochJobId,
    state: record.state,
    ...(record.expertRef !== undefined ? { expertRef: record.expertRef } : {}),
    ...(record.sessionRef !== undefined ? { sessionRef: record.sessionRef } : {}),
    ...(record.result !== undefined ? { resultKind: record.result.kind } : {}),
    ...(record.result !== undefined ? { result: record.result } : {}),
    ...(record.validationStatus !== undefined ? { validationStatus: record.validationStatus } : {}),
    ...(record.cost !== undefined ? { cost: { ...record.cost } } : {}),
    refs: Object.freeze(refs),
    learningArtifactRefs: Object.freeze(learningArtifactRefs),
    deliveredAt: record.updatedAt,
  };
}

/** Bind the Epoch job id onto a delivery (the EPI1.0 correlation back-link). */
export function deliveryForEpochJob(delivery: EpochEscalationDelivery, epochJobId: string): EpochEscalationDelivery {
  if (typeof epochJobId !== 'string' || epochJobId.length === 0) {
    throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_DELIVERY, {
      message: 'epochJobId must be a non-empty string',
    });
  }
  return freezeDelivery({ ...delivery, epochJobId });
}

function freezeDelivery(delivery: EpochEscalationDelivery): EpochEscalationDelivery {
  return deepFreeze(delivery) as EpochEscalationDelivery;
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

/**
 * The adapter facade: binds one declared posture to the mapping
 * functions. Stateless — hosts construct one per Epoch integration.
 */
export class EpochEscalationAdapter {
  readonly posture: EpochIntegrationPosture;

  constructor(posture: EpochIntegrationPosture) {
    this.posture = posture;
  }

  /** Map + validate a trigger into the ES1.0 EscalationRequest. */
  async buildEscalationRequest(trigger: EpochEscalationTrigger): Promise<EscalationRequest> {
    return buildEscalationRequest(trigger, this.posture);
  }

  /** Map a raw wire trigger (closed-shape parse + authorization check). */
  async buildEscalationRequestFromWire(trigger: unknown): Promise<EscalationRequest> {
    return buildEscalationRequest(parseEpochEscalationTrigger(trigger), this.posture);
  }

  /** Project a record into the read-only Epoch delivery. */
  deliveryFromRecord(record: EscalationRecord, epochJobId?: string): EpochEscalationDelivery {
    const delivery = epochDeliveryFromRecord(record);
    return epochJobId === undefined ? delivery : deliveryForEpochJob(delivery, epochJobId);
  }
}

export { normalizeToEpochEscalationError };
