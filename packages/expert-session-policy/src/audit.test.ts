/**
 * Policy audit trail tests (Work Order C018) — the A015/A034 chain
 * discipline: contiguous sequencing, digest chaining via
 * @arena/protocol-core, replay rejection, tamper detection.
 */

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  PolicyAuditLog,
  toPolicyAuditEvent,
  verifyPolicyAuditChain,
} from './audit.js';
import type { PolicyAuditEvent, PolicyAuditRecord } from './audit.js';
import { ExpertSessionPolicyError } from './errors.js';
import { T0, T1 } from './test-support.js';

function event(overrides: Partial<PolicyAuditEvent> = {}): PolicyAuditEvent {
  return toPolicyAuditEvent({
    recordVersion: 1,
    eventId: randomUUID(),
    kind: 'policy-resolved',
    tenantId: 'tenant-alpha',
    principalId: null,
    action: 'resolve-effective-policy',
    boundaryClass: 'environments',
    outcome: { effect: 'allow', reason: 'pack-valid' },
    correlationId: 'corr-0001',
    causationId: null,
    occurredAt: T0,
    ...overrides,
  });
}

describe('the append-only audit log', () => {
  it('appends sealed, digest-chained records in contiguous sequence', async () => {
    const log = new PolicyAuditLog();
    await log.append(event());
    await log.append(event({ kind: 'retention-transition', occurredAt: T1 }));
    expect(log.length).toBe(2);
    const snapshot = await log.verify();
    expect(snapshot.verified).toBe(true);
    expect(snapshot.records[0]?.sequence).toBe(1);
    expect(snapshot.records[1]?.previousDigest).toBe(snapshot.records[0]?.digest);
  });

  it('REJECTS replayed event ids (the trail is append-only)', async () => {
    const log = new PolicyAuditLog();
    const first = event();
    await log.append(first);
    await expect(log.append(first)).rejects.toMatchObject({
      code: 'EXPERT_SESSION_POLICY_AUDIT_REPLAY',
    });
  });

  it('has NO deletion or rewrite surface', () => {
    const log = new PolicyAuditLog();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(log))
      .filter((name) => name !== 'constructor')
      .sort();
    expect(surface).toEqual(['append', 'at', 'length', 'snapshot', 'verify'].sort());
  });
});

describe('tamper evidence (fail-closed)', () => {
  it('a tampered payload fails chain verification', async () => {
    const log = new PolicyAuditLog();
    await log.append(event());
    await log.append(event({ kind: 'pack-rejected', occurredAt: T1 }));
    const records: PolicyAuditRecord[] = log.snapshot().records.map((record) => ({ ...record })) as PolicyAuditRecord[];
    const tampered = {
      ...records[0]!,
      payload: { ...records[0]!.payload, action: 'tampered-action' },
    };
    await expect(verifyPolicyAuditChain([tampered, records[1]!])).rejects.toMatchObject({
      code: 'EXPERT_SESSION_POLICY_AUDIT_CHAIN_BROKEN',
    });
  });

  it('reordered and removed record lists fail closed', async () => {
    const log = new PolicyAuditLog();
    await log.append(event());
    await log.append(event({ kind: 'retention-duplicate', occurredAt: T1 }));
    const records = log.snapshot().records;
    await expect(verifyPolicyAuditChain([...records].reverse())).rejects.toBeInstanceOf(ExpertSessionPolicyError);
    await expect(verifyPolicyAuditChain(records.slice(1))).rejects.toBeInstanceOf(ExpertSessionPolicyError);
  });
});

describe('event validation (strict, closed vocabularies)', () => {
  it('rejects unknown kinds, bad correlation ids and malformed outcomes', () => {
    expect(() => event({ kind: 'not-a-kind' as never })).toThrow(ExpertSessionPolicyError);
    expect(() => event({ correlationId: '' as never })).toThrow(ExpertSessionPolicyError);
    expect(() =>
      toPolicyAuditEvent({
        recordVersion: 1,
        eventId: randomUUID(),
        kind: 'policy-resolved',
        tenantId: null,
        principalId: null,
        action: null,
        boundaryClass: null,
        outcome: { effect: 'maybe' as never, reason: 'x' },
        correlationId: 'corr-1',
        causationId: null,
        occurredAt: T0,
      }),
    ).toThrow(ExpertSessionPolicyError);
  });
});
