/**
 * THE A034 ADVERSARIAL BATTERY — audit trail attacks: replayed events,
 * reordered records, removed records, tampered payloads/digests; and
 * the no-deletion surface.
 */

import { describe, expect, it } from 'vitest';
import {
  makeEvaluateAuthorizationCommand,
  makeRegisterPolicyBundleCommand,
  makeTenantScopedRef,
  SecurityAuditLog,
  toSecurityAuditEvent,
  toSecurityPrincipal,
  verifySecurityAuditChain,
} from '@arena/security';
import { serializeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { SecurityService } from '@arena/security-service';

const CORR = 'corr-a034-audit-0001' as CorrelationId;
const IDEM = 'idem-a034-audit-0001' as IdempotencyKey;
const T1 = '2026-09-30T01:00:00.000Z';

const PRINCIPAL = toSecurityPrincipal({
  recordVersion: 1,
  principalId: 'principal-audit-battery',
  kind: 'customer-identity',
  tenantScope: 'tenant-alpha',
  roles: ['tenant-member'],
  label: null,
});

const BUNDLE = {
  recordVersion: 1,
  bundleId: 'bundle-audit-battery',
  version: '1.0.0',
  statements: [
    {
      recordVersion: 1,
      statementId: 'allow-read',
      effect: 'allow',
      tenantId: 'tenant-alpha',
      roles: ['tenant-member'],
      action: 'read',
      boundaryClass: 'dataset',
    },
  ],
};

async function makeService(): Promise<SecurityService> {
  const service = new SecurityService();
  await service.handleRegisterPolicyBundleCommand(
    serializeEnvelope(makeRegisterPolicyBundleCommand({ bundle: BUNDLE }, CORR, IDEM)),
  );
  return new SecurityService({
    registry: service.registry,
    auditLog: service.auditLog,
    defaultBundle: { bundleId: 'bundle-audit-battery', version: '1.0.0' },
  });
}

async function evaluateRead(service: SecurityService, recordId: string) {
  return service.handleEvaluateAuthorizationCommand(
    serializeEnvelope(
      makeEvaluateAuthorizationCommand(
        {
          principal: PRINCIPAL,
          action: 'read',
          resource: makeTenantScopedRef('tenant-alpha', 'dataset', recordId),
          evaluatedAt: T1 as never,
        },
        CORR,
        IDEM,
      ),
    ),
  );
}

describe('REPLAYED audit events', () => {
  it('appending the same event id twice is rejected and nothing is sealed', async () => {
    const service = await makeService();
    const first = await evaluateRead(service, 'dataset-audit-1');
    const replayPayload = first.auditRecord.payload;
    await expect(service.auditLog.append(replayPayload)).rejects.toThrowError(/replayed/);
    expect((await service.auditSnapshot()).length).toBe(2); // register + first
  });

  it('replaying through a fresh log with a stolen event id is ALSO chained, not deduped — but the service log rejects it', async () => {
    const service = await makeService();
    const first = await evaluateRead(service, 'dataset-audit-2');
    const stolen = toSecurityAuditEvent(first.auditRecord.payload);
    await expect(service.auditLog.append(stolen)).rejects.toThrowError();
  });
});

describe('REORDERED audit records', () => {
  it('swapping two records breaks the chain (digest linkage)', async () => {
    const service = await makeService();
    await evaluateRead(service, 'dataset-audit-3');
    await evaluateRead(service, 'dataset-audit-4');
    const records = [...(await service.auditSnapshot())];
    expect(records.length).toBe(3);
    const reordered = [records[0]!, records[2]!, records[1]!];
    await expect(verifySecurityAuditChain(reordered)).rejects.toThrowError(/sequence|linkage|digest/);
  });

  it('the service itself always verifies before snapshotting (reorder is impossible through the API)', async () => {
    const service = await makeService();
    await evaluateRead(service, 'dataset-audit-5');
    const records = await service.auditSnapshot();
    expect(records.map((record) => record.sequence)).toEqual([1, 2]);
    expect(await service.verifyAuditChain()).toBe(true);
  });
});

describe('REMOVED / TAMPERED audit records', () => {
  it('removing a MIDDLE record breaks verification of the presented stream', async () => {
    const service = await makeService();
    await evaluateRead(service, 'dataset-audit-6a');
    await evaluateRead(service, 'dataset-audit-6b'); // 3 sealed records now
    const records = [...(await service.auditSnapshot())];
    expect(records.length).toBe(3);
    await expect(verifySecurityAuditChain([records[0]!, records[2]!])).rejects.toThrowError(
      /sequence discontinuity/,
    );
  });

  it('tampering with a payload field breaks the recomputed digest', async () => {
    const service = await makeService();
    await evaluateRead(service, 'dataset-audit-7');
    const records = [...(await service.auditSnapshot())];
    const tampered = [
      records[0]!,
      {
        ...records[1]!,
        payload: { ...records[1]!.payload, principalId: 'attacker-forged' },
      },
    ];
    await expect(verifySecurityAuditChain(tampered)).rejects.toThrowError(/digest mismatch/);
  });

  it('forging an extra record onto the end breaks linkage', async () => {
    const service = await makeService();
    await evaluateRead(service, 'dataset-audit-8');
    const records = [...(await service.auditSnapshot())];
    const forged = {
      ...records[1]!,
      sequence: 3,
      previousDigest: records[1]!.digest,
      digest: 'a'.repeat(64),
    };
    await expect(verifySecurityAuditChain([...records, forged])).rejects.toThrowError();
  });
});

describe('NO DELETION / REWRITE SURFACE', () => {
  it('the audit log exposes only append/verify/snapshot/at/length', () => {
    const log = new SecurityAuditLog();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(log));
    expect(methods.sort()).toEqual(['append', 'at', 'constructor', 'length', 'snapshot', 'verify']);
  });

  it('frozen sealed records cannot be mutated in place (strict mode throws)', async () => {
    const service = await makeService();
    const outcome = await evaluateRead(service, 'dataset-audit-9');
    expect(() => {
      (outcome.auditRecord as unknown as Record<string, unknown>)['digest'] = '0'.repeat(64);
    }).toThrow();
    expect(() => {
      (outcome.auditRecord.payload as unknown as Record<string, unknown>)['outcome'] = null;
    }).toThrow();
  });

  it('the snapshot is a frozen deep copy — the live chain cannot be poisoned through it', async () => {
    const service = await makeService();
    await evaluateRead(service, 'dataset-audit-10');
    const snapshot = await service.auditSnapshot();
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(() => {
      (snapshot[0] as unknown as Record<string, unknown>)['digest'] = 'x'.repeat(64);
    }).toThrow();
    expect(await service.verifyAuditChain()).toBe(true);
  });
});
