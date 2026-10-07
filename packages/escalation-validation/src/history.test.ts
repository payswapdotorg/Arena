/**
 * Validation-history tests (Work Order C009): append-only discipline,
 * sequence contiguity, tenant isolation, tamper resistance and the
 * supersession house pattern.
 */

import { describe, expect, it } from 'vitest';
import {
  appendValidationEntry,
  bindPlan,
  createValidationHistoryEntry,
  createValidationRecord,
  isValidationRecord,
  revisionStateOf,
} from './history.js';
import { createDeclaredValidationCondition, deriveValidationPlan } from './plan.js';
import { createEscalationRequest } from '@arena/escalation';
import { validEscalationRequestInput, validValidationConditionInput } from './test-support.js';
import { newValidationEntryId } from './shared.js';
import { EscalationValidationError } from './errors.js';

const REQUEST_ID = 'esc_00000000000000000000000000000000';
const NOW = '2026-10-07T11:00:00.000Z';

function entry(
  sequence: number,
  overrides: {
    kind?: string;
    occurredAt?: string;
    requestId?: string;
    tenantId?: string;
    actor?: string;
  } = {},
) {
  return createValidationHistoryEntry({
    entryId: newValidationEntryId(),
    requestId: overrides.requestId ?? REQUEST_ID,
    tenantId: overrides.tenantId ?? 'tenant-alpha',
    sequence,
    kind: overrides.kind ?? 'handoff-routed',
    occurredAt: overrides.occurredAt ?? '2026-10-07T11:01:00.000Z',
    ...(overrides.actor !== undefined ? { actor: overrides.actor } : {}),
    payload: { note: 'fixture' },
  });
}

describe('appendValidationEntry (append-only, guarded)', () => {
  it('appends contiguously and never rewrites prior entries', () => {
    let record = createValidationRecord(REQUEST_ID, 'tenant-alpha', NOW);
    record = appendValidationEntry(record, entry(1));
    const firstSnapshot = JSON.stringify(record.entries[0]);
    record = appendValidationEntry(record, entry(2, { occurredAt: '2026-10-07T11:02:00.000Z' }));
    expect(record.entries).toHaveLength(2);
    expect(JSON.stringify(record.entries[0])).toBe(firstSnapshot);
    expect(isValidationRecord(record)).toBe(true);
  });

  it('REJECTS a non-contiguous sequence (gap = tampering)', () => {
    const record = appendValidationEntry(createValidationRecord(REQUEST_ID, 'tenant-alpha', NOW), entry(1));
    expect(() => appendValidationEntry(record, entry(3))).toThrow(/contiguous/u);
  });

  it('REJECTS a backwards timestamp (clock ran backwards)', () => {
    const record = appendValidationEntry(
      createValidationRecord(REQUEST_ID, 'tenant-alpha', NOW),
      entry(1, { occurredAt: '2026-10-07T11:05:00.000Z' }),
    );
    expect(() =>
      appendValidationEntry(record, entry(2, { occurredAt: '2026-10-07T11:00:00.000Z' })),
    ).toThrow(/monotonically non-decreasing/u);
  });

  it('REJECTS a cross-tenant entry (domain-level tenant isolation)', () => {
    const record = createValidationRecord(REQUEST_ID, 'tenant-alpha', NOW);
    expect(() =>
      appendValidationEntry(record, entry(1, { tenantId: 'tenant-beta' })),
    ).toThrow(EscalationValidationError);
  });

  it('entries are deep-frozen — in-place tampering throws', () => {
    const record = appendValidationEntry(createValidationRecord(REQUEST_ID, 'tenant-alpha', NOW), entry(1));
    const stored = record.entries[0];
    if (stored === undefined) throw new Error('unreachable');
    expect(() => {
      (stored as unknown as Record<string, unknown>)['kind'] = 'plan-declared';
    }).toThrow();
  });
});

describe('bindPlan + revision accounting', () => {
  it('binds the derived plan once; a second bind fails closed', async () => {
    const request = await createEscalationRequest(
      validEscalationRequestInput({ requestId: REQUEST_ID }),
    );
    const condition = createDeclaredValidationCondition(validValidationConditionInput());
    const derivation = await deriveValidationPlan(request, condition, NOW);
    if (derivation.outcome !== 'plan-derivable') throw new Error('unreachable');
    let record = createValidationRecord(REQUEST_ID, 'tenant-alpha', NOW);
    record = bindPlan(record, derivation.plan, NOW);
    expect(record.plan?.planId).toBe(derivation.plan.planId);
    expect(() => bindPlan(record, derivation.plan, NOW)).toThrow(/already bound/u);
    expect(revisionStateOf(record)).toEqual({
      attemptNumber: 1,
      maxRevisionAttempts: 2,
    });
  });

  it('bindPlan REJECTS a plan of another escalation/tenant', async () => {
    const request = await createEscalationRequest(validEscalationRequestInput());
    const condition = createDeclaredValidationCondition(validValidationConditionInput());
    const derivation = await deriveValidationPlan(request, condition, NOW);
    if (derivation.outcome !== 'plan-derivable') throw new Error('unreachable');
    const record = createValidationRecord(REQUEST_ID, 'tenant-alpha', NOW);
    expect(() => bindPlan(record, derivation.plan, NOW)).toThrow(EscalationValidationError);
  });
});
