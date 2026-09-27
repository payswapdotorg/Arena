/**
 * Audit chain — positive AND negative tests (gates 7, 12): append-only
 * sha256 chain where each digest includes the previous event's digest;
 * broken chains (tampered payload, tampered digest, removed record,
 * reordered records, sequence drift) fail verification.
 */

import { describe, expect, it } from 'vitest';
import {
  appendAuditRecord,
  auditChainHead,
  AUDIT_GENESIS_DIGEST,
  buildAuditRecord,
  EMPTY_AUDIT_LOG,
  lastAuditRecord,
  verifyAuditChain,
} from './audit.js';
import { makeMutationAuditedEvent } from './events.js';
import { JOB_ERROR_CODES } from './errors.js';

const T0 = '2026-01-15T09:30:00.000Z';
const T1 = '2026-01-15T09:30:30.000Z';
const T2 = '2026-01-15T09:31:00.000Z';
const ACTOR = { type: 'service', tenant: 'arena', principalId: 'job-orchestrator' } as const;

function auditEvent(sequence: number, mutation: string, occurredAt: string, envelopeId: string) {
  return makeMutationAuditedEvent({
    sequence,
    occurredAt,
    jobId: 'job-0001',
    mutation,
    actor: ACTOR,
    correlationId: 'corr-42',
    envelopeId,
  });
}

const UUID_A = '110e8400-e29b-41d4-a716-446655440000';
const UUID_B = '220e8400-e29b-41d4-a716-446655440000';
const UUID_C = '330e8400-e29b-41d4-a716-446655440000';

async function chainOfThree() {
  let log = EMPTY_AUDIT_LOG;
  log = await appendAuditRecord(log, auditEvent(1, 'job.submit', T0, UUID_A));
  log = await appendAuditRecord(log, auditEvent(2, 'job.claim', T1, UUID_B));
  log = await appendAuditRecord(log, auditEvent(3, 'job.complete', T2, UUID_C));
  return log;
}

describe('audit — chain construction (positive)', () => {
  it('the genesis record chains from the all-zero digest', async () => {
    const first = await buildAuditRecord(null, auditEvent(1, 'job.submit', T0, UUID_A));
    expect(first.sequence).toBe(1);
    expect(first.previousDigest).toBe(AUDIT_GENESIS_DIGEST);
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.digest).not.toBe(AUDIT_GENESIS_DIGEST);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('each record includes the previous record\u2019s digest', async () => {
    const log = await chainOfThree();
    expect(log.records).toHaveLength(3);
    expect(log.records[1]?.previousDigest).toBe(log.records[0]?.digest);
    expect(log.records[2]?.previousDigest).toBe(log.records[1]?.digest);
    expect(log.records.map((record) => record.sequence)).toEqual([1, 2, 3]);
    expect(auditChainHead(log)).toBe(log.records[2]?.digest);
    expect(lastAuditRecord(log)?.payload.mutation).toBe('job.complete');
    expect(lastAuditRecord(EMPTY_AUDIT_LOG)).toBeNull();
    expect(auditChainHead(EMPTY_AUDIT_LOG)).toBe(AUDIT_GENESIS_DIGEST);
  });

  it('appendAuditRecord is pure: the input log never changes', async () => {
    const before = await appendAuditRecord(EMPTY_AUDIT_LOG, auditEvent(1, 'job.submit', T0, UUID_A));
    const after = await appendAuditRecord(before, auditEvent(2, 'job.claim', T1, UUID_B));
    expect(before.records).toHaveLength(1);
    expect(after.records).toHaveLength(2);
    expect(Object.isFrozen(after.records)).toBe(true);
  });

  it('a clean chain verifies; the head digest is returned', async () => {
    const log = await chainOfThree();
    await expect(verifyAuditChain(log)).resolves.toBe(log.records[2]?.digest);
  });

  it('chains are deterministic: same payloads ⇒ same digests', async () => {
    const a = await chainOfThree();
    const b = await chainOfThree();
    expect(a.records.map((record) => record.digest)).toEqual(
      b.records.map((record) => record.digest),
    );
  });
});

describe('audit — chain construction (negative)', () => {
  it('append rejects a sequence that does not continue the chain', async () => {
    await expect(
      appendAuditRecord(EMPTY_AUDIT_LOG, auditEvent(2, 'job.claim', T1, UUID_B)),
    ).rejects.toMatchObject({ code: JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN });
    const log = await appendAuditRecord(EMPTY_AUDIT_LOG, auditEvent(1, 'job.submit', T0, UUID_A));
    await expect(
      appendAuditRecord(log, auditEvent(1, 'job.submit', T1, UUID_B)),
    ).rejects.toMatchObject({ code: JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN });
    await expect(
      appendAuditRecord(log, auditEvent(3, 'job.claim', T1, UUID_B)),
    ).rejects.toMatchObject({ code: JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN });
  });

  it('append rejects non-audit payloads', async () => {
    await expect(
      appendAuditRecord(EMPTY_AUDIT_LOG, {
        eventVersion: 1,
        kind: 'job-submitted',
        sequence: 1,
        occurredAt: T0,
        jobId: 'job-0001',
        definitionDigest: 'ab'.repeat(32),
        input: null,
      } as unknown as Parameters<typeof appendAuditRecord>[1]),
    ).rejects.toMatchObject({ code: JOB_ERROR_CODES.INVALID_EVENT });
    await expect(
      buildAuditRecord(
        null,
        {
          eventVersion: 2,
          kind: 'mutation-audited',
          sequence: 1,
          occurredAt: T0,
          jobId: 'job-0001',
          mutation: 'job.submit',
          actor: ACTOR,
          correlationId: 'corr-42',
          envelopeId: UUID_A,
        } as unknown as Parameters<typeof buildAuditRecord>[1],
      ),
    ).rejects.toMatchObject({ code: JOB_ERROR_CODES.INVALID_EVENT });
  });
});

describe('audit — tamper evidence (a broken chain FAILS verification)', () => {
  /** Deep-clone a chain into a mutable forged copy (simulated attacker). */
  const mutable = <T>(value: readonly T[]): T[] =>
    JSON.parse(JSON.stringify(value)) as T[];

  it('tampering with a PAYLOAD field breaks the chain', async () => {
    const log = await chainOfThree();
    const forged = mutable(log.records);
    (forged[1] as { payload: { mutation: string } }).payload.mutation = 'job.cancel';
    await expect(verifyAuditChain({ records: forged })).rejects.toMatchObject({
      code: JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN,
    });
  });

  it('tampering with a DIGEST breaks the chain (and the next linkage)', async () => {
    const log = await chainOfThree();
    const forged = mutable(log.records);
    (forged[0] as { digest: string }).digest = 'ff'.repeat(32);
    await expect(verifyAuditChain({ records: forged })).rejects.toMatchObject({
      code: JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN,
    });
  });

  it('REMOVING a middle record breaks the chain', async () => {
    const log = await chainOfThree();
    const forged = mutable(log.records);
    forged.splice(1, 1);
    await expect(verifyAuditChain({ records: forged })).rejects.toMatchObject({
      code: JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN,
    });
  });

  it('REORDERING records breaks the chain', async () => {
    const log = await chainOfThree();
    const forged = mutable(log.records);
    forged.reverse();
    await expect(verifyAuditChain({ records: forged })).rejects.toMatchObject({
      code: JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN,
    });
  });

  it('swapping a record for a valid-looking forged one breaks the chain', async () => {
    const log = await chainOfThree();
    const forged = mutable(log.records);
    // forge record #2 with correct linkage but a DIFFERENT payload
    const replacement = await buildAuditRecord(
      forged[0] as never,
      auditEvent(2, 'job.fail', T1, UUID_B),
    );
    forged[1] = replacement;
    await expect(verifyAuditChain({ records: forged })).rejects.toMatchObject({
      code: JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN,
    });
  });

  it('a sequence drift inside the chain breaks verification', async () => {
    const log = await chainOfThree();
    const forged = mutable(log.records);
    (forged[2] as { sequence: number }).sequence = 4;
    await expect(verifyAuditChain({ records: forged })).rejects.toMatchObject({
      code: JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN,
    });
  });

  it('the empty chain verifies to the genesis digest', async () => {
    await expect(verifyAuditChain(EMPTY_AUDIT_LOG)).resolves.toBe(AUDIT_GENESIS_DIGEST);
  });
});
