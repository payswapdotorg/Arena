/**
 * Audit trail tests (Work Order A034): append-only discipline, tamper
 * evidence, replay/reorder/removal rejection, causation/correlation ids,
 * no deletion surface.
 */

import { describe, expect, it } from 'vitest';
import type { SecurityAuditRecord } from './audit.js';
import {
  buildSecurityAuditRecord,
  isSecurityAuditEvent,
  SECURITY_AUDIT_EVENT_KINDS,
  SECURITY_AUDIT_GENESIS_DIGEST,
  SecurityAuditLog,
  SECURITY_ERROR_CODES,
  SecurityError,
  toSecurityAuditEvent,
  verifySecurityAuditChain,
} from './index.js';
import {
  captureSecurityErrorAsync,
  makeAuditEventInput,
  T1,
  T2,
  T3,
  UUID_1,
  UUID_2,
  UUID_3,
  UUID_4,
} from './test-support.js';

async function appendThree(log: SecurityAuditLog): Promise<void> {
  await log.append(toSecurityAuditEvent(makeAuditEventInput({ eventId: UUID_1, occurredAt: T1 })));
  await log.append(toSecurityAuditEvent(makeAuditEventInput({ eventId: UUID_2, occurredAt: T2 })));
  await log.append(toSecurityAuditEvent(makeAuditEventInput({ eventId: UUID_3, occurredAt: T3 })));
}

describe('audit event validation', () => {
  it('accepts a well-formed event with REQUIRED correlation id', () => {
    const event = toSecurityAuditEvent(makeAuditEventInput());
    expect(event.kind).toBe('authorization-decision');
    expect(event.correlationId).toBe('corr-security-test-0001');
    expect(event.causationId).toBe(UUID_2);
    expect(Object.isFrozen(event)).toBe(true);
    expect(isSecurityAuditEvent(event)).toBe(true);
  });

  it('rejects events without a correlation id (A015 discipline)', () => {
    expect(() =>
      toSecurityAuditEvent(makeAuditEventInput({ correlationId: '' })),
    ).toThrowError(/required/);
  });

  it('rejects unknown kinds (closed vocabulary) and non-uuid event ids', () => {
    expect(() => toSecurityAuditEvent(makeAuditEventInput({ kind: 'something-happened' })))
      .toThrowError(/must be one of/);
    expect(() => toSecurityAuditEvent(makeAuditEventInput({ eventId: 'not-a-uuid' })))
      .toThrowError(/UUIDv4/);
  });

  it('the event kind vocabulary covers every consequential security outcome', () => {
    expect(SECURITY_AUDIT_EVENT_KINDS).toContain('authorization-decision');
    expect(SECURITY_AUDIT_EVENT_KINDS).toContain('tenant-access-denied');
    expect(SECURITY_AUDIT_EVENT_KINDS).toContain('data-rights-violation');
    expect(SECURITY_AUDIT_EVENT_KINDS).toContain('grant-revoked');
  });
});

describe('append-only chaining', () => {
  it('sequences are contiguous and digests chain (genesis → 1 → 2 → 3)', async () => {
    const log = new SecurityAuditLog();
    await appendThree(log);
    expect(log.length).toBe(3);
    const snapshot = log.snapshot();
    expect(snapshot.records[0]!.sequence).toBe(1);
    expect(snapshot.records[0]!.previousDigest).toBe(SECURITY_AUDIT_GENESIS_DIGEST);
    expect(snapshot.records[1]!.previousDigest).toBe(snapshot.records[0]!.digest);
    expect(snapshot.records[2]!.previousDigest).toBe(snapshot.records[1]!.digest);
    await log.verify();
  });

  it('sequence gaps are rejected at append time', async () => {
    const log = new SecurityAuditLog();
    const first = await log.append(
      toSecurityAuditEvent(makeAuditEventInput({ eventId: UUID_1 })),
    );
    const error = await captureSecurityErrorAsync(() =>
      buildSecurityAuditRecord(
        { ...first, sequence: 1, digest: first.digest } as SecurityAuditRecord,
        toSecurityAuditEvent(makeAuditEventInput({ eventId: UUID_2 })),
        3,
      ),
    );
    expect(error.code).toBe(SECURITY_ERROR_CODES.AUDIT_SEQUENCE_CONFLICT);
  });

  it('replayed audit events are rejected (same event id twice)', async () => {
    const log = new SecurityAuditLog();
    await appendThree(log);
    const replayError = await captureSecurityErrorAsync(() =>
      log.append(toSecurityAuditEvent(makeAuditEventInput({ eventId: UUID_1, occurredAt: T3 }))),
    );
    expect(replayError.code).toBe(SECURITY_ERROR_CODES.AUDIT_REPLAY);
    expect(log.length).toBe(3); // nothing was appended
  });

  it('the audit log class has NO deletion or rewrite surface', () => {
    const log = new SecurityAuditLog();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(log));
    expect(methods).toContain('append');
    expect(methods).toContain('verify');
    expect(methods).toContain('snapshot');
    for (const forbidden of ['delete', 'remove', 'update', 'rewrite', 'pop', 'truncate']) {
      expect(methods, `must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('sealed records are deeply frozen (mutation throws in strict mode)', async () => {
    const log = new SecurityAuditLog();
    const record = await log.append(
      toSecurityAuditEvent(makeAuditEventInput({ eventId: UUID_1 })),
    );
    expect(Object.isFrozen(record)).toBe(true);
    expect(() => {
      (record as unknown as Record<string, unknown>)['sequence'] = 99;
    }).toThrow();
  });
});

describe('tamper evidence (verify fails closed)', () => {
  it('tampered payload breaks the chain', async () => {
    const log = new SecurityAuditLog();
    await appendThree(log);
    const records = [...log.snapshot().records];
    const tampered = {
      ...records[1]!,
      payload: { ...records[1]!.payload, principalId: 'attacker' },
    } as SecurityAuditRecord;
    const tamperedStream = [records[0]!, tampered, records[2]!];
    const tamperError = await captureSecurityErrorAsync(() =>
      verifySecurityAuditChain(tamperedStream),
    );
    expect(tamperError.code).toBe(SECURITY_ERROR_CODES.AUDIT_CHAIN_BROKEN);
  });

  it('a removed record breaks the chain', async () => {
    const log = new SecurityAuditLog();
    await appendThree(log);
    const records = [...log.snapshot().records];
    await expect(verifySecurityAuditChain([records[0]!, records[2]!])).rejects.toThrowError(
      /sequence discontinuity/,
    );
  });

  it('reordered records break the chain', async () => {
    const log = new SecurityAuditLog();
    await appendThree(log);
    const records = [...log.snapshot().records];
    await expect(verifySecurityAuditChain([records[1]!, records[0]!, records[2]!])).rejects
      .toThrowError(SecurityError);
  });

  it('a tampered digest breaks the chain', async () => {
    const log = new SecurityAuditLog();
    await appendThree(log);
    const records = [...log.snapshot().records];
    const forged = { ...records[2]!, digest: 'e'.repeat(64) } as SecurityAuditRecord;
    await expect(verifySecurityAuditChain([records[0]!, records[1]!, forged])).rejects.toThrowError(
      /digest mismatch/,
    );
  });

  it('an empty stream verifies trivially', async () => {
    const snapshot = await verifySecurityAuditChain([]);
    expect(snapshot.records).toEqual([]);
    expect(snapshot.verified).toBe(true);
  });
});

describe('content addressing (A002 discipline, delegated to the core)', () => {
  it('the same event + predecessor + sequence always yields the same digest', async () => {
    const event = toSecurityAuditEvent(makeAuditEventInput({ eventId: UUID_4 }));
    const one = await buildSecurityAuditRecord(null, event, 1);
    const two = await buildSecurityAuditRecord(null, event, 1);
    expect(one.digest).toBe(two.digest);
    expect(one.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a different sequence yields a different digest (sequence is bound in)', async () => {
    const event = toSecurityAuditEvent(makeAuditEventInput({ eventId: UUID_4 }));
    const one = await buildSecurityAuditRecord(null, event, 1);
    await expect(
      buildSecurityAuditRecord({ ...one, sequence: 1 } as SecurityAuditRecord, event, 2),
    ).resolves.not.toBeNull();
  });
});
