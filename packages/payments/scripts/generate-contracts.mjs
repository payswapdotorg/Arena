#!/usr/bin/env node
/**
 * Arena payments domain contract generator (Work Order C010).
 *
 * Follows the A001 generated-contracts convention
 * (scripts/generate-contracts.mjs) and the package-level convention
 * (packages/escalation/scripts/generate-contracts.mjs — the C001
 * sibling):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the C010
 *     surfaces ONLY — it emits every schema for @arena/payments into
 *     packages/payments/contracts/ (the C010-owned in-package contract
 *     location; the root contracts/ tree stays untouched — C010's owned
 *     surfaces do not include it).
 *   - Generated files are committed, deterministic (sorted keys,
 *     2-space indent, trailing newline) and carry a versioned SchemaRef
 *     $id in the `payments` namespace.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and
 *     exits non-zero. The drift suite (src/drift.test.ts) runs this
 *     check as part of `pnpm test`, the package script `contracts:check`
 *     runs it directly, and the governance G9 check auto-discovers this
 *     generator through its packages/.../generate-contracts.mjs glob
 *     (the root manifest itself needs no edit — no root-surface
 *     modification required).
 *   - The deterministic serializer is duplicated from the A001
 *     generator (10 lines) instead of imported, because importing that
 *     module executes its CLI main() as an import side effect.
 *
 * Usage:
 *   node scripts/generate-contracts.mjs                    # regenerate in place
 *   node scripts/generate-contracts.mjs --output DIR       # write under DIR
 *   node scripts/generate-contracts.mjs --check [--against DIR]
 *   node scripts/generate-contracts.mjs --list
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// ---------------------------------------------------------------------------
// Shared payments constants — MUST match the TypeScript surfaces
// (packages/payments/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = '1.0.0';
const TENANT_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const REQUEST_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const OPERATION_KEY_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const CORRELATION_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const LEDGER_OPERATION_ID_PATTERN = '^payop_[0-9a-f]{32}$';
const AUDIT_EVENT_ID_PATTERN = '^cevt_[0-9a-f]{32}$';
const CURRENCY_PATTERN = '^[A-Z]{3}$';
const MINOR_UNITS_PATTERN = '^(0|[1-9][0-9]{0,15})$';
const TIMESTAMP_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$';
const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const FEE_SCHEDULE_ID_PATTERN = '^[a-z][a-z0-9-]{1,62}$';

const LEDGER_STATES = [
  'opened',
  'held',
  'offered',
  'accepted',
  'captured',
  'released',
  'refunded',
];
const LEDGER_TERMINAL_STATES = ['released', 'refunded'];
const LEDGER_OPERATION_KINDS = ['hold', 'offer', 'acceptance', 'capture', 'release', 'refund'];
const LEDGER_DENIAL_REASONS = [
  'ledger_not_adjacent',
  'ledger_terminal_state',
  'lifecycle_state_not_allowed',
  'tenant_mismatch',
  'currency_mismatch',
  'amount_exceeds_held',
  'capture_must_be_full',
  'amount_exceeds_available',
  'amount_not_positive',
  'offer_sequence_unknown',
  'split_mismatch',
  'timestamp_not_monotonic',
  'operation_key_conflict',
  'invalid_payload',
  'operation_ok',
];
const PAYMENT_ACCOUNTS = [
  'customer-source',
  'escrow',
  'payable',
  'platform-fee',
  'expert-payout',
  'refunds',
];
const REFUND_REASONS = [
  'revision_required',
  'result_rejected',
  'cancelled',
  'timed_out',
  'dispute_resolved',
];
const BOUND_LIFECYCLE_STATES = [
  'created',
  'triaged',
  'matching',
  'offered',
  'accepted',
  'session_ready',
  'in_progress',
  'submitted',
  'validating',
  'result_accepted',
  'revision_required',
  'result_rejected',
  'paid',
  'learning_captured',
  'expert_replaced',
  'closed',
  'cancelled',
  'timed_out',
];
const OPERATION_LIFECYCLE_ALLOWLISTS = {
  hold: ['created', 'triaged', 'matching', 'offered', 'expert_replaced'],
  offer: ['offered'],
  acceptance: ['accepted'],
  capture: ['accepted'],
  release: ['result_accepted'],
  refund: ['revision_required', 'result_rejected', 'cancelled', 'timed_out'],
};
const MONEY_TRUTH_LABELS = ['demo', 'customer'];
const COMMERCIAL_AUDIT_EVENT_KINDS = [
  'payment.hold.recorded',
  'payment.offer.recorded',
  'payment.acceptance.recorded',
  'payment.capture.recorded',
  'payment.release.recorded',
  'payment.refund.recorded',
];
const TRANSFER_DESTINATIONS = ['platform', 'expert'];
const PAYMENTS_ERROR_CODES = [
  'PAYMENTS_INVALID_REQUEST',
  'PAYMENTS_INVALID_MONEY',
  'PAYMENTS_CURRENCY_MISMATCH',
  'PAYMENTS_INVALID_STATE',
  'PAYMENTS_INVALID_TRANSITION',
  'PAYMENTS_TERMINAL_STATE',
  'PAYMENTS_LIFECYCLE_STATE_NOT_ALLOWED',
  'PAYMENTS_IDENTITY_CONFLICT',
  'PAYMENTS_CROSS_TENANT_ACCESS',
  'PAYMENTS_INSUFFICIENT_FUNDS',
  'PAYMENTS_SPLIT_MISMATCH',
  'PAYMENTS_TRUTH_LABEL_VIOLATION',
  'PAYMENTS_TAMPERED',
  'PAYMENTS_SCHEMA_MISMATCH',
  'PAYMENTS_UNSUPPORTED_VERSION',
  'PAYMENTS_PROVIDER_FAILURE',
  'PAYMENTS_UNKNOWN_ERROR',
];
const PAYMENTS_ERROR_CATEGORIES = [
  'validation',
  'state',
  'scope',
  'idempotency',
  'integrity',
  'versioning',
  'unknown',
];
const FEE_SPLIT_INVALID_REASONS = [
  'split_wrong_schedule',
  'split_currency_mismatch',
  'split_gross_mismatch',
  'split_sum_mismatch',
  'split_negative',
];
const TRUTH_LABEL_VIOLATION_REASONS = [
  'customer_ledger_on_demo_provider',
  'demo_ledger_on_customer_provider',
  'instruction_truth_mismatch',
];
const PAYMENTS_SCHEMA_NAMES = [
  'payments/hold-budget-command',
  'payments/payment-event',
  'payments/payments-error',
  'payments/money',
  'payments/fee-schedule',
  'payments/fee-split',
  'payments/commercial-audit-event',
  'payments/escrow-ledger-entry',
  'payments/payments-error-code',
  'payments/schema-registry',
];

const ref = (name) => `arena:schema/payments/${name}@${SCHEMA_VERSION}`;

// ---------------------------------------------------------------------------
// Contract manifest
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'payments/money',
    output: 'packages/payments/contracts/money.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('money'),
        title: 'Arena money value v1',
        description:
          'Currency + amount as ONE typed value. Amounts are string-scaled minor units ' +
          '(BigInt arithmetic — floating point never touches money). Multi-currency is ' +
          'representation only: conversion is a provider concern, explicitly out of scope; ' +
          'mixing currencies is a typed PAYMENTS_CURRENCY_MISMATCH failure.',
        type: 'object',
        additionalProperties: false,
        required: ['minorUnits', 'currency'],
        properties: {
          minorUnits: {
            type: 'string',
            pattern: MINOR_UNITS_PATTERN,
            description: 'Canonical decimal string of minor units (<= 2^53-1, no leading zeros).',
          },
          currency: { type: 'string', pattern: CURRENCY_PATTERN, description: 'ISO-4217-shaped code, as declared.' },
        },
      };
    },
  },
  {
    id: 'payments/fee-schedule',
    output: 'packages/payments/contracts/fee-schedule.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('fee-schedule'),
        title: 'Arena fee schedule v1',
        description:
          'The versioned, deterministic platform-fee rule: fee = clamp(floor(gross * bps / ' +
          '10000), min, max); expert payout = gross - fee. The reference schedule is ' +
          "arena-reference v1 (10%). Splits record the schedule used so audits reproduce it.",
        type: 'object',
        additionalProperties: false,
        required: ['scheduleId', 'version', 'platformFeeBps', 'minPlatformFeeMinorUnits'],
        properties: {
          scheduleId: { type: 'string', pattern: FEE_SCHEDULE_ID_PATTERN },
          version: { type: 'integer', minimum: 1 },
          platformFeeBps: { type: 'integer', minimum: 0, maximum: 10000 },
          minPlatformFeeMinorUnits: { type: 'string', pattern: MINOR_UNITS_PATTERN },
          maxPlatformFeeMinorUnits: {
            anyOf: [{ type: 'string', pattern: MINOR_UNITS_PATTERN }, { type: 'null' }],
            description: 'null = uncapped.',
          },
        },
      };
    },
  },
  {
    id: 'payments/fee-split',
    output: 'packages/payments/contracts/fee-split.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('fee-split'),
        title: 'Arena fee split v1',
        description:
          'The exhaustive platform-fee + expert-payout split of a gross amount. The legs ' +
          'always sum back to the gross. Caller-supplied splits are recomputed and any ' +
          'divergence is a typed PAYMENTS_SPLIT_MISMATCH (fee-split tampering fails closed).',
        type: 'object',
        additionalProperties: false,
        required: [
          'scheduleId',
          'scheduleVersion',
          'currency',
          'grossMinorUnits',
          'platformFeeMinorUnits',
          'expertPayoutMinorUnits',
        ],
        properties: {
          scheduleId: { type: 'string', pattern: FEE_SCHEDULE_ID_PATTERN },
          scheduleVersion: { type: 'integer', minimum: 1 },
          currency: { type: 'string', pattern: CURRENCY_PATTERN },
          grossMinorUnits: { type: 'string', pattern: MINOR_UNITS_PATTERN },
          platformFeeMinorUnits: { type: 'string', pattern: MINOR_UNITS_PATTERN },
          expertPayoutMinorUnits: { type: 'string', pattern: MINOR_UNITS_PATTERN },
        },
        'x-invalid-reasons': FEE_SPLIT_INVALID_REASONS,
      };
    },
  },
  {
    id: 'payments/escrow-ledger-entry',
    output: 'packages/payments/contracts/escrow-ledger-entry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('escrow-ledger-entry'),
        title: 'Arena escrow ledger entry v1',
        description:
          'One append-only, digest-chained entry of the per-escalation escrow/hold ledger: ' +
          'budget HOLD at creation, offer/acceptance markers, CAPTURE at ACCEPTED, RELEASE ' +
          '(platform fee + expert payout) on completion, REFUND on revision/rejection/' +
          'cancellation/timeout. Entries are contiguous 1..n; each digest covers the previous ' +
          'digest (silent mutation of a committed money record is detectable).',
        type: 'object',
        additionalProperties: false,
        required: [
          'entryVersion',
          'sequence',
          'operationId',
          'operationKey',
          'kind',
          'currency',
          'lines',
          'payload',
          'occurredAt',
          'correlationId',
          'lifecycleStateAtOperation',
          'truth',
          'prevDigest',
          'digest',
        ],
        properties: {
          entryVersion: { const: 1 },
          sequence: { type: 'integer', minimum: 1 },
          operationId: { type: 'string', pattern: LEDGER_OPERATION_ID_PATTERN },
          operationKey: { type: 'string', pattern: OPERATION_KEY_PATTERN },
          kind: { enum: LEDGER_OPERATION_KINDS },
          currency: { type: 'string', pattern: CURRENCY_PATTERN },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['account', 'side', 'minorUnits'],
              properties: {
                account: { enum: PAYMENT_ACCOUNTS },
                side: { enum: ['debit', 'credit'] },
                minorUnits: { type: 'string', pattern: MINOR_UNITS_PATTERN },
              },
            },
          },
          payload: {
            type: 'object',
            description: 'Discriminated operation payload (kind-matched).',
            required: ['kind'],
            properties: {
              kind: { enum: LEDGER_OPERATION_KINDS },
            },
          },
          occurredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          actor: { type: 'string' },
          correlationId: { type: 'string', pattern: CORRELATION_ID_PATTERN },
          lifecycleStateAtOperation: {
            enum: BOUND_LIFECYCLE_STATES,
            description: 'The observed C001 escalation lifecycle state at operation time.',
          },
          truth: { enum: MONEY_TRUTH_LABELS },
          providerTransferIds: { type: 'array', items: { type: 'string' } },
          prevDigest: { anyOf: [{ type: 'string', pattern: DIGEST_PATTERN }, { type: 'null' }] },
          digest: { type: 'string', pattern: DIGEST_PATTERN },
        },
        'x-ledger-states': LEDGER_STATES,
        'x-ledger-terminal-states': LEDGER_TERMINAL_STATES,
        'x-denial-reasons': LEDGER_DENIAL_REASONS,
        'x-refund-reasons': REFUND_REASONS,
        'x-operation-lifecycle-allowlists': OPERATION_LIFECYCLE_ALLOWLISTS,
      };
    },
  },
  {
    id: 'payments/commercial-audit-event',
    output: 'packages/payments/contracts/commercial-audit-event.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('commercial-audit-event'),
        title: 'Arena commercial audit event v1',
        description:
          'One audit event per APPLIED money operation (the commercial audit surface). ' +
          'Duplicates append nothing — they replay the recorded event verbatim.',
        type: 'object',
        additionalProperties: false,
        required: [
          'eventVersion',
          'eventId',
          'kind',
          'requestId',
          'tenantId',
          'correlationId',
          'operationKey',
          'sequence',
          'occurredAt',
          'ledgerStateAfter',
          'truth',
          'summary',
        ],
        properties: {
          eventVersion: { const: 1 },
          eventId: { type: 'string', pattern: AUDIT_EVENT_ID_PATTERN },
          kind: { enum: COMMERCIAL_AUDIT_EVENT_KINDS },
          requestId: { type: 'string', pattern: REQUEST_ID_PATTERN },
          tenantId: { type: 'string', pattern: TENANT_PATTERN },
          correlationId: { type: 'string', pattern: CORRELATION_ID_PATTERN },
          operationKey: { type: 'string', pattern: OPERATION_KEY_PATTERN },
          sequence: { type: 'integer', minimum: 1 },
          occurredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          ledgerStateAfter: { enum: LEDGER_STATES },
          truth: { enum: MONEY_TRUTH_LABELS },
          summary: {
            type: 'object',
            description: 'Machine-readable account deltas + amounts (plain JSON).',
          },
        },
        'x-transfer-destinations': TRANSFER_DESTINATIONS,
      };
    },
  },
  {
    id: 'payments/payments-error',
    output: 'packages/payments/contracts/payments-error.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('payments-error'),
        title: 'Arena payments error v1',
        description:
          'Structured, serializable form of the payments error taxonomy. Unknown codes are ' +
          'rejected when parsing (fail-closed).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: PAYMENTS_ERROR_CODES },
          category: { enum: PAYMENTS_ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object', description: 'Structured, JSON-serializable context.' },
          correlationId: { type: 'string', pattern: CORRELATION_ID_PATTERN },
        },
      };
    },
  },
  {
    id: 'payments/schema-registry',
    output: 'packages/payments/contracts/schema-registry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-registry'),
        title: 'Arena payments schema registry v1',
        description:
          'The versioned schema registry of the payments domain (the payments SchemaRef ' +
          'namespace). Mirrors PAYMENTS_SCHEMAS in packages/payments/src/envelopes.ts; parity ' +
          'is asserted by contracts.parity.test.ts.',
        type: 'object',
        additionalProperties: false,
        required: ['namespace', 'schemaVersion', 'schemas'],
        properties: {
          namespace: { const: 'payments' },
          schemaVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
          schemas: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'version'],
              properties: {
                name: { type: 'string' },
                version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
              },
            },
          },
        },
        'x-truth-label-violation-reasons': TRUTH_LABEL_VIOLATION_REASONS,
        'x-schema-names': PAYMENTS_SCHEMA_NAMES,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Deterministic serializer (duplicated from the A001 generator)
// ---------------------------------------------------------------------------

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortObjectKeys(value[key]);
    }
    return sorted;
  }
  return value;
}

export function serializeDeterministic(value) {
  return `${JSON.stringify(sortObjectKeys(value), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Output / check (duplicated from the A001 generator)
// ---------------------------------------------------------------------------

function listFilesRecursive(dir, prefix = '') {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFilesRecursive(join(dir, entry.name), rel));
    else files.push(rel);
  }
  return files;
}

function writeContracts(outputDir) {
  for (const contract of CONTRACTS) {
    const target = join(outputDir, contract.output);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, serializeDeterministic(contract.build()), 'utf-8');
    console.log(`[contracts] wrote ${contract.output} (${contract.id})`);
  }
}

function checkContracts(againstDir) {
  const tempDir = join(tmpdir(), `arena-payments-contracts-${process.pid}-${Date.now()}`);
  try {
    writeContracts(tempDir);
    const generatedFiles = listFilesRecursive(tempDir);
    const drift = [];

    for (const rel of generatedFiles) {
      const againstPath = join(againstDir, rel);
      let committed;
      try {
        committed = readFileSync(againstPath, 'utf-8');
      } catch {
        drift.push(`missing generated contract: ${rel}`);
        continue;
      }
      const generated = readFileSync(join(tempDir, rel), 'utf-8');
      if (committed !== generated) drift.push(`drifted generated contract: ${rel}`);
    }

    // Extra-file check scoped to this generator's output directory only.
    const contractDirs = [...new Set(CONTRACTS.map((c) => dirname(c.output)))];
    const generatedSet = new Set(generatedFiles);
    for (const contractDir of contractDirs) {
      const committedDir = join(againstDir, contractDir);
      if (!statSync(committedDir, { throwIfNoEntry: false })?.isDirectory()) continue;
      for (const rel of listFilesRecursive(committedDir, contractDir)) {
        if (!generatedSet.has(rel)) drift.push(`unexpected extra contract file: ${rel}`);
      }
    }

    if (drift.length > 0) {
      console.error(`[contracts] DRIFT DETECTED (${drift.length} problem(s)):`);
      for (const d of drift) console.error(`  - ${d}`);
      console.error('[contracts] run: node scripts/generate-contracts.mjs   then commit the result');
      return 1;
    }
    console.log(`[contracts] drift check clean (${generatedFiles.length} contract file(s) match)`);
    return 0;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const contract of CONTRACTS) {
      console.log(`${contract.id} -> ${contract.output}`);
    }
    process.exit(0);
  }
  if (args.includes('--check')) {
    const againstIndex = args.indexOf('--against');
    const againstDir =
      againstIndex !== -1 && args[againstIndex + 1]
        ? resolve(args[againstIndex + 1])
        : REPO_ROOT;
    process.exit(checkContracts(againstDir));
  }
  const outputIndex = args.indexOf('--output');
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    writeContracts(resolve(args[outputIndex + 1]));
    process.exit(0);
  }
  if (args.length > 0) {
    console.error(`unknown arguments: ${args.join(' ')}`);
    process.exit(2);
  }
  writeContracts(REPO_ROOT);
  console.log('[contracts] regenerate committed with: git add packages/payments/contracts');
}

main();
