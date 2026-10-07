/**
 * Contract parity tests — bind the generated contracts
 * (packages/payments/contracts/*.json, produced by
 * packages/payments/scripts/generate-contracts.mjs) to the TypeScript
 * surface of @arena/payments.
 *
 * If someone edits the TS constants without regenerating contracts (or
 * vice versa), these tests fail — and the drift suite (drift.test.ts)
 * fails when the committed JSON no longer matches the generator. Two
 * independent tripwires for contract drift, exactly like the
 * A001/A015/A025/C001 convention.
 */

import { describe, expect, it } from 'vitest';
import moneyJson from '../contracts/money.v1.json' with { type: 'json' };
import feeScheduleJson from '../contracts/fee-schedule.v1.json' with { type: 'json' };
import feeSplitJson from '../contracts/fee-split.v1.json' with { type: 'json' };
import ledgerEntryJson from '../contracts/escrow-ledger-entry.v1.json' with { type: 'json' };
import auditEventJson from '../contracts/commercial-audit-event.v1.json' with { type: 'json' };
import errorJson from '../contracts/payments-error.v1.json' with { type: 'json' };
import schemaRegistryJson from '../contracts/schema-registry.v1.json' with { type: 'json' };

import {
  LEDGER_STATES,
  LEDGER_TERMINAL_STATES,
  LEDGER_OPERATION_KINDS,
  LEDGER_DENIAL_REASONS,
  PAYMENT_ACCOUNTS,
  REFUND_REASONS,
  OPERATION_LIFECYCLE_ALLOWLISTS,
} from './ledger.js';
import {
  PAYMENT_BOUND_LIFECYCLE_STATES,
  MONEY_TRUTH_LABELS,
  CURRENCY_PATTERN_SOURCE,
} from './shared.js';
import { MINOR_UNITS_PATTERN_SOURCE } from './money.js';
import { PAYMENTS_ERROR_CODES, PAYMENTS_ERROR_CATEGORIES } from './errors.js';
import { COMMERCIAL_AUDIT_EVENT_KINDS } from './audit.js';
import { FEE_SPLIT_INVALID_REASONS } from './fees.js';
import { TRANSFER_DESTINATIONS, TRUTH_LABEL_VIOLATION_REASONS } from './provider.js';
import { PAYMENTS_SCHEMAS, PAYMENTS_SCHEMA_VERSION, paymentsSchemaRef } from './envelopes.js';

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

const moneySchema = moneyJson as unknown as Record<string, unknown>;
const feeScheduleSchema = feeScheduleJson as unknown as Record<string, unknown>;
const feeSplitSchema = feeSplitJson as unknown as Record<string, unknown>;
const ledgerEntrySchema = ledgerEntryJson as unknown as Record<string, unknown>;
const auditEventSchema = auditEventJson as unknown as Record<string, unknown>;
const errorSchema = errorJson as unknown as Record<string, unknown>;
const schemaRegistrySchema = schemaRegistryJson as unknown as Record<string, unknown>;

function asStrings(value: unknown): string[] {
  return (value as readonly unknown[]).map((entry) => String(entry));
}

function propertiesOf(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return schema['properties'] as Record<string, Record<string, unknown>>;
}

describe('generated contract parity — payments protocol', () => {
  it('every contract is draft 2020-12 with a versioned payments SchemaRef $id', () => {
    const contracts = [
      moneySchema,
      feeScheduleSchema,
      feeSplitSchema,
      ledgerEntrySchema,
      auditEventSchema,
      errorSchema,
      schemaRegistrySchema,
    ];
    expect(contracts).toHaveLength(7);
    for (const contract of contracts) {
      expect(contract['$schema']).toBe(DRAFT);
      expect(String(contract['$id'])).toMatch(/^arena:schema\/payments\/[a-z0-9-]+@1\.0\.0$/);
    }
  });

  it('money contract matches the TS money law', () => {
    const properties = propertiesOf(moneySchema);
    expect(String(properties['minorUnits']?.['pattern'])).toBe(MINOR_UNITS_PATTERN_SOURCE);
    expect(String(properties['currency']?.['pattern'])).toBe(CURRENCY_PATTERN_SOURCE);
  });

  it('escrow ledger entry contract matches the TS machine', () => {
    const properties = propertiesOf(ledgerEntrySchema);
    expect(asStrings(properties['kind']?.['enum'])).toEqual([...LEDGER_OPERATION_KINDS]);
    const lines = properties['lines'] as Record<string, unknown>;
    const lineItem = (lines['items'] as Record<string, unknown>)['properties'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(asStrings(lineItem['account']?.['enum'])).toEqual([...PAYMENT_ACCOUNTS]);
    expect(asStrings(lineItem['side']?.['enum'])).toEqual(['debit', 'credit']);
    expect(asStrings(properties['lifecycleStateAtOperation']?.['enum'])).toEqual([
      ...PAYMENT_BOUND_LIFECYCLE_STATES,
    ]);
    expect(asStrings(properties['truth']?.['enum'])).toEqual([...MONEY_TRUTH_LABELS]);
    expect(asStrings(ledgerEntrySchema['x-ledger-states'])).toEqual([...LEDGER_STATES]);
    expect(asStrings(ledgerEntrySchema['x-ledger-terminal-states'])).toEqual([...LEDGER_TERMINAL_STATES]);
    expect(asStrings(ledgerEntrySchema['x-denial-reasons'])).toEqual([
      ...LEDGER_DENIAL_REASONS,
      'operation_ok',
    ]);
    expect(asStrings(ledgerEntrySchema['x-refund-reasons'])).toEqual([...REFUND_REASONS]);
    const allowlists = ledgerEntrySchema['x-operation-lifecycle-allowlists'] as Record<
      string,
      readonly string[]
    >;
    for (const kind of LEDGER_OPERATION_KINDS) {
      expect([...(allowlists[kind] ?? [])]).toEqual([...OPERATION_LIFECYCLE_ALLOWLISTS[kind]]);
    }
  });

  it('commercial audit event contract matches the TS taxonomy', () => {
    const properties = propertiesOf(auditEventSchema);
    expect(asStrings(properties['kind']?.['enum'])).toEqual([...COMMERCIAL_AUDIT_EVENT_KINDS]);
    expect(asStrings(properties['ledgerStateAfter']?.['enum'])).toEqual([...LEDGER_STATES]);
    expect(asStrings(auditEventSchema['x-transfer-destinations'])).toEqual([...TRANSFER_DESTINATIONS]);
  });

  it('fee split contract matches the TS invalid-reason vocabulary', () => {
    expect(asStrings(feeSplitSchema['x-invalid-reasons'])).toEqual([...FEE_SPLIT_INVALID_REASONS]);
  });

  it('payments error contract matches the TS taxonomy', () => {
    const properties = propertiesOf(errorSchema);
    expect(asStrings(properties['code']?.['enum'])).toEqual(Object.values(PAYMENTS_ERROR_CODES));
    expect(asStrings(properties['category']?.['enum'])).toEqual([...PAYMENTS_ERROR_CATEGORIES]);
  });

  it('schema registry contract matches the TS PAYMENTS_SCHEMAS map', () => {
    const properties = propertiesOf(schemaRegistrySchema);
    expect(properties['namespace']?.['const']).toBe('payments');
    expect(String(properties['schemaVersion']?.['pattern'])).toBe('^\\d+\\.\\d+\\.\\d+$');
    expect(asStrings(schemaRegistrySchema['x-schema-names'])).toEqual([
      ...Object.keys(PAYMENTS_SCHEMAS),
    ]);
    expect(asStrings(schemaRegistrySchema['x-truth-label-violation-reasons'])).toEqual([
      ...TRUTH_LABEL_VIOLATION_REASONS,
    ]);
    expect(asStrings(schemaRegistrySchema['x-schema-names'])).toEqual([
      ...Object.keys(PAYMENTS_SCHEMAS),
    ]);
  });

  it('every schema name resolves to a registered payments SchemaRef', () => {
    for (const name of Object.keys(PAYMENTS_SCHEMAS) as (keyof typeof PAYMENTS_SCHEMAS)[]) {
      const ref = paymentsSchemaRef(name);
      expect(ref.namespace).toBe('payments');
      expect(ref.version).toBe(PAYMENTS_SCHEMA_VERSION);
    }
  });
});
