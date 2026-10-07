/**
 * Cross-resource routing decision history — the append-only,
 * digest-chained per-demand decision log (Work Order C015; the
 * supersession house pattern of @arena/escalation-routing /
 * @arena/escalation / @arena/expert-qualification).
 *
 * Every match run appends ONE record referencing the ResourceMatch
 * digest and the PREVIOUS record's digest (a hash chain): decisions are
 * never rewritten or dropped — a later routing run SUPERSEDES the
 * earlier decision by appending, and the earlier record stays immutable
 * and addressable forever. Chain integrity is verifiable
 * (`verifyResourceDecisionChain` recomputes every digest and every
 * link; any tamper is a typed CAPABILITY_ROUTING_TAMPERED failure).
 *
 * Lock rules 9/35: the records capture routing decisions and the
 * qualification/performance evidence that fed them as DIGEST references
 * — they grant, imply or record no permission.
 */

import { digestCanonical } from '@arena/protocol-core';
import { CAPABILITY_ROUTING_ERROR_CODES, CapabilityRoutingError } from './errors.js';
import type { ResourceMatch } from './engine.js';

/** Wire version of the resource-routing decision record shape. */
export const RESOURCE_DECISION_RECORD_VERSION = 1 as const;

const DEMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TENANT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The digest-free view — exactly what the record digest commits to. */
export interface ResourceDecisionRecordView {
  readonly recordVersion: typeof RESOURCE_DECISION_RECORD_VERSION;
  readonly demandId: string;
  readonly tenantId: string;
  /** Contiguous 1..n append position. */
  readonly sequence: number;
  /** The ResourceMatch verdict this record commits to. */
  readonly matchDigest: string;
  readonly matchOutcome: string;
  /** The composition ref summary (class:ref pairs), when a composition matched. */
  readonly compositionRefs: readonly string[];
  /** The previous record digest — null only for the first decision. */
  readonly previousRecordDigest: string | null;
  readonly recordedAt: string;
}

/** A frozen, content-addressed routing decision record: view + digest. */
export interface ResourceDecisionRecord extends ResourceDecisionRecordView {
  readonly digest: string;
}

/**
 * Append one routing decision to a history. The prior history is never
 * mutated; the new history is the old array plus the new record
 * (supersession by append — the house pattern).
 */
export async function appendResourceDecision(
  history: readonly ResourceDecisionRecord[],
  match: ResourceMatch,
  options: {
    readonly demandId: string;
    readonly tenantId: string;
    readonly recordedAt: string;
  },
): Promise<{
  readonly history: readonly ResourceDecisionRecord[];
  readonly record: ResourceDecisionRecord;
}> {
  if (!Array.isArray(history)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_HISTORY, {
      message: 'resource routing decision history must be an array',
    });
  }
  if (!DEMAND_ID_PATTERN.test(options.demandId)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_HISTORY, {
      message: `demandId is invalid: ${JSON.stringify(options.demandId)}`,
    });
  }
  if (!TENANT_ID_PATTERN.test(options.tenantId)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_HISTORY, {
      message: `tenantId is invalid: ${JSON.stringify(options.tenantId)}`,
    });
  }
  if (!ISO_TIMESTAMP_PATTERN.test(options.recordedAt)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_HISTORY, {
      message: `recordedAt must be an ms-precision UTC timestamp: ${JSON.stringify(options.recordedAt)}`,
    });
  }
  if (match.tenantId !== options.tenantId) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.CROSS_TENANT_ACCESS, {
      message: `resource routing decision history is tenant-scoped: match tenant ${match.tenantId} cannot append to tenant ${options.tenantId}`,
    });
  }

  const head = history.length > 0 ? history[history.length - 1] : undefined;
  const sequence = history.length + 1;
  const view: ResourceDecisionRecordView = {
    recordVersion: RESOURCE_DECISION_RECORD_VERSION,
    demandId: options.demandId,
    tenantId: options.tenantId,
    sequence,
    matchDigest: match.digest,
    matchOutcome: match.outcome,
    compositionRefs: Object.freeze(
      (match.composition?.components ?? []).map(
        (component) => `${component.resourceClass}:${component.ref}`,
      ),
    ),
    previousRecordDigest: head !== undefined ? head.digest : null,
    recordedAt: options.recordedAt,
  };
  const digest = await digestCanonical(view);
  const record: ResourceDecisionRecord = Object.freeze({ ...view, digest });
  return { history: Object.freeze([...history, record]), record };
}

/** The head (latest) record of a history, or null when empty. */
export function resourceDecisionHistoryHead(
  history: readonly ResourceDecisionRecord[],
): ResourceDecisionRecord | null {
  if (!Array.isArray(history) || history.length === 0) return null;
  return history[history.length - 1] ?? null;
}

/**
 * Verify a routing decision history end-to-end: contiguous sequences
 * starting at 1, consistent demand/tenant scoping, every digest
 * recomputes over its digest-free view, and every record links to the
 * previous record's digest (the chain). Throws CAPABILITY_ROUTING_TAMPERED
 * on the first inconsistency.
 */
export async function verifyResourceDecisionChain(
  history: readonly ResourceDecisionRecord[],
): Promise<void> {
  if (!Array.isArray(history)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_HISTORY, {
      message: 'resource routing decision history must be an array',
    });
  }
  let previousDigest: string | null = null;
  let expectedDemand: string | null = null;
  let expectedTenant: string | null = null;
  for (let index = 0; index < history.length; index += 1) {
    const record = history[index];
    if (record === undefined) {
      throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.TAMPERED, {
        message: `resource routing decision history has a hole at index ${index}`,
      });
    }
    if (record.sequence !== index + 1) {
      throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.TAMPERED, {
        message: `resource routing decision ${record.demandId} sequence ${record.sequence} is not contiguous (expected ${index + 1})`,
      });
    }
    if (expectedDemand !== null && record.demandId !== expectedDemand) {
      throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.TAMPERED, {
        message: `resource routing decision history mixes demands: ${record.demandId} after ${expectedDemand}`,
      });
    }
    if (expectedTenant !== null && record.tenantId !== expectedTenant) {
      throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `resource routing decision history mixes tenants: ${record.tenantId} after ${expectedTenant}`,
      });
    }
    expectedDemand = record.demandId;
    expectedTenant = record.tenantId;
    if (record.previousRecordDigest !== previousDigest) {
      throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.TAMPERED, {
        message: `resource routing decision ${record.demandId} sequence ${record.sequence} breaks the chain: previous ${JSON.stringify(record.previousRecordDigest)} expected ${JSON.stringify(previousDigest)}`,
      });
    }
    const { digest: _digest, ...view } = record;
    const actual = await digestCanonical(view);
    if (actual !== record.digest) {
      throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.TAMPERED, {
        message: `resource routing decision ${record.demandId} sequence ${record.sequence} digest mismatch: expected ${record.digest}, got ${actual}`,
      });
    }
    previousDigest = record.digest;
  }
}
