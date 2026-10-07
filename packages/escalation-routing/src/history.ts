/**
 * Routing decision history — the append-only, digest-chained per-escalation
 * decision log (Work Order C002; the supersession house pattern of
 * @arena/escalation / @arena/expert-qualification).
 *
 * Every routing run appends ONE record referencing the verdict digest and
 * the PREVIOUS record's digest (a hash chain): decisions are never
 * rewritten or dropped — a later routing run (retry, re-route after expert
 * replacement) SUPERSEDES the earlier decision by appending, and the
 * earlier record stays immutable and addressable forever. Chain integrity
 * is verifiable (`verifyRoutingDecisionChain` recomputes every digest and
 * every link; any tamper is a typed ESCALATION_ROUTING_TAMPERED failure).
 */

import { digestCanonical } from '@arena/protocol-core';
import { ESCALATION_ROUTING_ERROR_CODES, EscalationRoutingError } from './errors.js';
import type { RoutingVerdict } from './engine.js';

/** Wire version of the routing-decision record shape. */
export const ROUTING_DECISION_RECORD_VERSION = 1 as const;

const REQUEST_ID_PATTERN = /^esc_[0-9a-f]{32}$/;
const TENANT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The digest-free view — exactly what the record digest commits to. */
export interface RoutingDecisionRecordView {
  readonly recordVersion: typeof ROUTING_DECISION_RECORD_VERSION;
  readonly requestId: string;
  readonly tenantId: string;
  /** Contiguous 1..n append position. */
  readonly sequence: number;
  /** The routing verdict this record commits to. */
  readonly verdictDigest: string;
  readonly verdictOutcome: string;
  readonly expertRef?: string;
  /** The previous record digest — null only for the first decision. */
  readonly previousRecordDigest: string | null;
  readonly recordedAt: string;
}

/** A frozen, content-addressed routing decision record: view + digest. */
export interface RoutingDecisionRecord extends RoutingDecisionRecordView {
  readonly digest: string;
}

/**
 * Append one routing decision to a history. The prior history is never
 * mutated; the new history is the old array plus the new record
 * (supersession by append — the house pattern).
 */
export async function appendRoutingDecision(
  history: readonly RoutingDecisionRecord[],
  verdict: RoutingVerdict,
  options: { readonly requestId: string; readonly tenantId: string; readonly recordedAt: string },
): Promise<{ readonly history: readonly RoutingDecisionRecord[]; readonly record: RoutingDecisionRecord }> {
  if (!Array.isArray(history)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_HISTORY, {
      message: 'routing decision history must be an array',
    });
  }
  if (!REQUEST_ID_PATTERN.test(options.requestId)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_HISTORY, {
      message: `requestId is invalid: ${JSON.stringify(options.requestId)}`,
    });
  }
  if (!TENANT_ID_PATTERN.test(options.tenantId)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_HISTORY, {
      message: `tenantId is invalid: ${JSON.stringify(options.tenantId)}`,
    });
  }
  if (!ISO_TIMESTAMP_PATTERN.test(options.recordedAt)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_HISTORY, {
      message: `recordedAt must be an ms-precision UTC timestamp: ${JSON.stringify(options.recordedAt)}`,
    });
  }
  if (verdict.tenantId !== options.tenantId) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.CROSS_TENANT_ACCESS, {
      message: `routing decision history is tenant-scoped: verdict tenant ${verdict.tenantId} cannot append to tenant ${options.tenantId}`,
    });
  }

  const head = history.length > 0 ? history[history.length - 1] : undefined;
  const sequence = history.length + 1;
  const view: RoutingDecisionRecordView = {
    recordVersion: ROUTING_DECISION_RECORD_VERSION,
    requestId: options.requestId,
    tenantId: options.tenantId,
    sequence,
    verdictDigest: verdict.digest,
    verdictOutcome: verdict.outcome,
    ...(verdict.expertRef !== undefined ? { expertRef: verdict.expertRef } : {}),
    previousRecordDigest: head !== undefined ? head.digest : null,
    recordedAt: options.recordedAt,
  };
  const digest = await digestCanonical(view);
  const record: RoutingDecisionRecord = Object.freeze({ ...view, digest });
  return { history: Object.freeze([...history, record]), record };
}

/** The head (latest) record of a history, or null when empty. */
export function routingDecisionHistoryHead(
  history: readonly RoutingDecisionRecord[],
): RoutingDecisionRecord | null {
  if (!Array.isArray(history) || history.length === 0) return null;
  return history[history.length - 1] ?? null;
}

/**
 * Verify a routing decision history end-to-end: contiguous sequences
 * starting at 1, consistent request/tenant scoping, every digest
 * recomputes over its digest-free view, and every record links to the
 * previous record's digest (the chain). Throws ESCALATION_ROUTING_TAMPERED
 * on the first inconsistency.
 */
export async function verifyRoutingDecisionChain(
  history: readonly RoutingDecisionRecord[],
): Promise<void> {
  if (!Array.isArray(history)) {
    throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.INVALID_HISTORY, {
      message: 'routing decision history must be an array',
    });
  }
  let previousDigest: string | null = null;
  let expectedRequest: string | null = null;
  let expectedTenant: string | null = null;
  for (let index = 0; index < history.length; index += 1) {
    const record = history[index];
    if (record === undefined) {
      throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.TAMPERED, {
        message: `routing decision history has a hole at index ${index}`,
      });
    }
    if (record.sequence !== index + 1) {
      throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.TAMPERED, {
        message: `routing decision ${record.requestId} sequence ${record.sequence} is not contiguous (expected ${index + 1})`,
      });
    }
    if (expectedRequest !== null && record.requestId !== expectedRequest) {
      throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.TAMPERED, {
        message: `routing decision history mixes requests: ${record.requestId} after ${expectedRequest}`,
      });
    }
    if (expectedTenant !== null && record.tenantId !== expectedTenant) {
      throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `routing decision history mixes tenants: ${record.tenantId} after ${expectedTenant}`,
      });
    }
    expectedRequest = record.requestId;
    expectedTenant = record.tenantId;
    if (record.previousRecordDigest !== previousDigest) {
      throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.TAMPERED, {
        message: `routing decision ${record.requestId} sequence ${record.sequence} breaks the chain: previous ${JSON.stringify(record.previousRecordDigest)} expected ${JSON.stringify(previousDigest)}`,
      });
    }
    const { digest: _digest, ...view } = record;
    const actual = await digestCanonical(view);
    if (actual !== record.digest) {
      throw new EscalationRoutingError(ESCALATION_ROUTING_ERROR_CODES.TAMPERED, {
        message: `routing decision ${record.requestId} sequence ${record.sequence} digest mismatch: expected ${record.digest}, got ${actual}`,
      });
    }
    previousDigest = record.digest;
  }
}
