/**
 * Envelope wiring for the payments domain (Work Order C010; mirrors
 * @arena/escalation's envelopes.ts pattern).
 *
 * Wire messages (all in the `payments` SchemaRef namespace,
 * arena:schema/payments/<name>@<major.minor.patch>):
 *
 *   - payments/hold-budget-command (kind `command`, REQUIRED idempotency
 *     key — lock rule 17): the money-operation wire form;
 *   - payments/payment-event (kind `event`): the commercial audit event
 *     projection (one per applied money operation);
 *   - payments/payments-error (kind `response`): the typed failure form.
 *
 * Parsing is STRICT: wrong envelope kind, wrong namespace, unknown
 * payload shape — all fail closed with typed payments errors.
 */

import {
  makeEnvelope,
  parseEnvelopeAs,
  parseSchemaRef,
  toCorrelationId,
  toIdempotencyKey,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { PAYMENTS_ERROR_CODES, PaymentError } from './errors.js';
import type { CommercialAuditEvent } from './audit.js';
import { isCommercialAuditEvent } from './audit.js';
import type { Money } from './money.js';
import { isMoney } from './money.js';
import type { WirePaymentsError } from './errors.js';
import { parseWirePaymentsError } from './errors.js';

export const PAYMENTS_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/payments. Mirrored by the
 * generated contract payments-schema-registry.v1.json (parity asserted
 * by contracts.parity.test.ts; drift by drift.test.ts + G9).
 */
export const PAYMENTS_SCHEMAS = Object.freeze({
  'payments/hold-budget-command': PAYMENTS_SCHEMA_VERSION,
  'payments/payment-event': PAYMENTS_SCHEMA_VERSION,
  'payments/payments-error': PAYMENTS_SCHEMA_VERSION,
  'payments/money': PAYMENTS_SCHEMA_VERSION,
  'payments/fee-schedule': PAYMENTS_SCHEMA_VERSION,
  'payments/fee-split': PAYMENTS_SCHEMA_VERSION,
  'payments/commercial-audit-event': PAYMENTS_SCHEMA_VERSION,
  'payments/escrow-ledger-entry': PAYMENTS_SCHEMA_VERSION,
  'payments/payments-error-code': PAYMENTS_SCHEMA_VERSION,
  'payments/schema-registry': PAYMENTS_SCHEMA_VERSION,
} as const);

export type PaymentsSchemaName = keyof typeof PAYMENTS_SCHEMAS;

/** Resolve a payments schema name to its SchemaRef. */
export function paymentsSchemaRef(name: PaymentsSchemaName): SchemaRef {
  const version = PAYMENTS_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `unknown payments schema: ${String(name)}`,
      details: { known: Object.keys(PAYMENTS_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a payments schema at the registered version. */
export function isKnownPaymentsSchema(ref: SchemaRef): boolean {
  const registered = (PAYMENTS_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// hold-budget-command (the money-operation wire form)
// ---------------------------------------------------------------------------

/** The wire payload of a money operation command. */
export interface HoldBudgetCommandPayload {
  readonly commandVersion: 1;
  readonly kind: 'hold-budget';
  readonly requestId: string;
  readonly tenantId: string;
  readonly amount: Money;
}

export function makeHoldBudgetCommand(
  payload: HoldBudgetCommandPayload,
  correlationId: CorrelationId,
  idempotencyKey: IdempotencyKey,
): Envelope<HoldBudgetCommandPayload> {
  if (typeof payload !== 'object' || payload === null || !isMoney(payload.amount)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: 'hold-budget-command payload is not structurally valid',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: paymentsSchemaRef('payments/hold-budget-command'),
    payload,
    correlationId,
    idempotencyKey,
  });
}

/** Parse a hold-budget-command envelope (strict). */
export function parseHoldBudgetCommand(raw: string): Envelope<HoldBudgetCommandPayload> {
  const envelope = parseEnvelopeAs<HoldBudgetCommandPayload>(
    raw,
    paymentsSchemaRef('payments/hold-budget-command'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'payments') {
    throw new PaymentError(PAYMENTS_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `expected a payments schema, got ${envelope.schema}`,
    });
  }
  if (envelope.kind !== 'command') {
    throw new PaymentError(PAYMENTS_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `hold-budget-command must travel in a 'command' envelope, got ${JSON.stringify(envelope.kind)}`,
    });
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// payment-event (the commercial audit projection)
// ---------------------------------------------------------------------------

export function makePaymentEventEnvelope(
  event: CommercialAuditEvent,
  correlationId: CorrelationId,
): Envelope<CommercialAuditEvent> {
  if (!isCommercialAuditEvent(event)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: 'payment-event payload is not a structurally valid CommercialAuditEvent',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: paymentsSchemaRef('payments/payment-event'),
    payload: event,
    correlationId,
    idempotencyKey: toIdempotencyKey(event.operationKey),
  });
}

/** Parse a payment-event envelope (strict). */
export function parsePaymentEventEnvelope(raw: string): Envelope<CommercialAuditEvent> {
  const envelope = parseEnvelopeAs<CommercialAuditEvent>(
    raw,
    paymentsSchemaRef('payments/payment-event'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'payments') {
    throw new PaymentError(PAYMENTS_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `expected a payments schema, got ${envelope.schema}`,
    });
  }
  if (envelope.kind !== 'event') {
    throw new PaymentError(PAYMENTS_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `payment-event must travel in an 'event' envelope, got ${JSON.stringify(envelope.kind)}`,
    });
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// payments-error (the typed failure form)
// ---------------------------------------------------------------------------

export function makePaymentsErrorEnvelope(
  error: WirePaymentsError,
  correlationId: CorrelationId,
): Envelope<WirePaymentsError> {
  return makeEnvelope({
    kind: 'response',
    schema: paymentsSchemaRef('payments/payments-error'),
    payload: error,
    correlationId,
    idempotencyKey: null,
  });
}

/** Parse a payments-error envelope (strict; unknown codes rejected). */
export function parsePaymentsErrorEnvelope(raw: string): Envelope<WirePaymentsError> {
  const envelope = parseEnvelopeAs<WirePaymentsError>(
    raw,
    paymentsSchemaRef('payments/payments-error'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'payments') {
    throw new PaymentError(PAYMENTS_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `expected a payments schema, got ${envelope.schema}`,
    });
  }
  if (envelope.kind !== 'response') {
    throw new PaymentError(PAYMENTS_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `payments-error must travel in a 'response' envelope, got ${JSON.stringify(envelope.kind)}`,
    });
  }
  parseWirePaymentsError(envelope.payload);
  return envelope;
}

export { toCorrelationId };
