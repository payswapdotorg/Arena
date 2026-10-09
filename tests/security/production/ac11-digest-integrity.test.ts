/**
 * tests/security/production/ac11-digest-integrity.test.ts — AC-11 digest
 * mismatch + A-7 evidence integrity (Work Order P007 integrated pass;
 * issue #159).
 *
 * "digest mismatch" — attacks the tamper-evidence of the REAL durable
 * audit chain and the content-addressed capsule identity over the
 * embedded real Postgres engine:
 *
 *   - audit-chain tamper: modifying one record's payload breaks the
 *     digest linkage (verifyAuditChain fails);
 *   - audit-chain REORDER: swapping two records breaks the chain;
 *   - audit-chain TRUNCATION: removing a middle record breaks the
 *     contiguity;
 *   - the durable jsonb discipline: a record read back through the REAL
 *     engine is canonically IDENTICAL to what the caller wrote (the
 *     key-reordering class P002 hit — canonical comparison, never a
 *     phantom rewrite);
 *   - capsule digest: any content mutation breaks the content-addressed
 *     digest (the tamper detector is recomputation).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '@arena/job-protocol';
import type { AuditRecord } from '@arena/job-protocol';
import { digestCanonical } from '@arena/protocol-core';
import { deriveExpertSessionCapsule } from '@arena/expert-session';
import { makeDeriveCapsuleInput } from '@arena/expert-session/test-support';
import {
  bootAdversarialBattery,
  composeRestartedHost,
  createBody,
  json,
  postJson,
} from './support/adversarial-harness.js';
import type { AdversarialBattery } from './support/adversarial-harness.js';

let battery: AdversarialBattery;

beforeEach(async () => {
  battery = await bootAdversarialBattery();
});

afterEach(async () => {
  await battery.close();
});

function key(tenantId = 'tenant-alpha'): Record<string, string> {
  const issuance = battery.keys.issue({ tenantId });
  return { authorization: `Bearer ${issuance.secret}` };
}

/** Deep-clone with one field path mutated (the tamper surgery). */
function tamper(records: readonly AuditRecord[], mutation: (record: AuditRecord) => void): AuditRecord[] {
  const copy = records.map((record) => JSON.parse(JSON.stringify(record)) as AuditRecord);
  const victim = copy[1] ?? copy[0] as AuditRecord;
  // The digest covers {payload, previousDigest, sequence} — the surgery
  // must mutate the PAYLOAD (a top-level field addition would not be
  // digest-covered and would NOT break the chain).
  mutation(victim);
  return copy;
}

describe('AC-11 — the durable audit chain is tamper-evident', () => {
  it('a chain with real traffic verifies; tamper / reorder / truncate each break it', async () => {
    // Generate real audited traffic through the public transport (3
    // escalations) AND through the durable job runner (the mutations
    // that feed the DurableEventSink audit chain — the sink's chain is
    // the job-mutation audit trail the host exposes).
    const auth = key();
    for (let i = 0; i < 3; i += 1) {
      const created = await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({
          idempotencyKey: `idem-ac11-${i}`,
          correlationId: `corr-ac11-${i}`,
        }),
        auth,
      );
      expect(created.status).toBe(201);
    }
    const ACTOR = Object.freeze({
      type: 'service',
      tenant: 'arena',
      principalId: 'p007-ac11',
    });
    for (let i = 0; i < 3; i += 1) {
      const job = await battery.host.jobs.submitByKind({
        kindName: 'escalation-recompute',
        input: {},
        correlationId: `corr-ac11-job-${i}` as never,
        idempotencyKey: `idem-ac11-job-${i}` as never,
        actor: ACTOR,
      });
      await battery.host.claimWithLease({ jobId: job.jobId, actor: ACTOR });
      await battery.engines.runner.complete({
        jobId: job.jobId,
        actor: ACTOR,
        result: 'done',
      });
    }
    const chain = (await battery.host.auditRecords()) as readonly AuditRecord[];
    expect(chain.length).toBeGreaterThanOrEqual(5);

    // The honest chain verifies (returns the chain head digest).
    await expect(verifyAuditChain({ records: [...chain] })).resolves.toBeTypeOf('string');

    // (1) PAYLOAD TAMPER: mutate one record's audited payload content
    // (the digest-covered view).
    const tampered = tamper(chain, (record) => {
      (record.payload as unknown as Record<string, unknown>)['mutation'] = 'forged';
    });
    await expect(verifyAuditChain({ records: tampered })).rejects.toThrowError();

    // (2) REORDER: swap two adjacent records (sequence discontinuity).
    const reordered = [...chain];
    const swap = reordered[1];
    reordered[1] = reordered[2] as AuditRecord;
    reordered[2] = swap as AuditRecord;
    await expect(verifyAuditChain({ records: reordered })).rejects.toThrowError();

    // (3) TRUNCATION: remove a middle record.
    const truncated = [...chain.slice(0, 1), ...chain.slice(2)];
    await expect(verifyAuditChain({ records: truncated })).rejects.toThrowError();

    // (4) FORGED APPEND: a foreign record appended at the tail.
    const forgedTail = [
      ...chain,
      JSON.parse(
        JSON.stringify({ ...chain[chain.length - 1], sequence: chain.length + 1 }),
      ) as AuditRecord,
    ];
    await expect(verifyAuditChain({ records: forgedTail })).rejects.toThrowError();
  });
});

describe('AC-11 — the durable round-trip is canonically exact (no phantom rewrite)', () => {
  it('a record read back through the REAL engine is canonically identical across a restart boundary', async () => {
    const auth = key();
    const created = await postJson(
      `${battery.baseUrl}/v1/escalations`,
      createBody({ idempotencyKey: 'idem-ac11-rt', correlationId: 'corr-ac11-rt' }),
      auth,
    );
    expect(created.status).toBe(201);
    const requestId = json(created.body)['requestId'] as string;

    const before = await battery.host.escalations.status('tenant-alpha', requestId);
    const historyBefore = before.record.history;

    // Restart: a NEW composition over the same durable store.
    const restarted = await composeRestartedHost(battery);
    try {
      const after = await restarted.escalations.status('tenant-alpha', requestId);
      // Canonical equality (jsonb reorders object keys; values, nesting
      // and append ORDER are preserved exactly — the P002 discipline).
      expect(canonicalJson(after.record.history)).toBe(canonicalJson(historyBefore));
      expect(canonicalJson(after.record.request)).toBe(canonicalJson(before.record.request));
      // And the audit chain grew monotonically (append-only across the
      // boundary) while still verifying as ONE chain.
      const chainAfter = (await restarted.auditRecords()) as readonly AuditRecord[];
      expect(chainAfter.length).toBeGreaterThanOrEqual(
        (await battery.host.auditRecords()).length,
      );
      await expect(verifyAuditChain({ records: [...chainAfter] })).resolves.toBeTypeOf(
        'string',
      );
    } finally {
      await restarted.stop();
    }
  });
});

describe('AC-11 — the capsule identity is content-addressed (tamper detection by recomputation)', () => {
  it('any capsule content mutation breaks the digest', async () => {
    const capsule = await deriveExpertSessionCapsule(makeDeriveCapsuleInput());
    const { digest, ...view } = capsule as unknown as {
      digest: string;
      [key: string]: unknown;
    };
    // The honest capsule self-verifies.
    expect(await digestCanonical(view)).toBe(digest);

    // TAMPER VARIANTS: every content mutation changes the recomputed
    // digest (world-state injection, expiry extension, tool injection,
    // authority marker forgery).
    const variants = [
      { ...view, worldState: { injected: 'foreign-observation' } },
      { ...view, expiresAt: '2026-10-08T13:00:00.000Z' },
      { ...view, tools: [...(view['tools'] as string[]), 'admin-console'] },
      { ...view, authority: 'authoritative' },
    ];
    for (const variant of variants) {
      const recomputed = await digestCanonical(variant);
      expect(recomputed).not.toBe(digest);
    }
  });
});

/** Canonical JSON (sorted keys; the jsonb key-reorder discipline). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${canonicalJson(entryValue)}`)
      .sort();
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
