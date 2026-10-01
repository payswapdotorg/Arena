/**
 * Adversarial suite for @arena/billing-service (Work Order A033; universal
 * acceptance criteria: negative paths are engineered, not accidental):
 * quota-exceeded denial, expired / revoked / not-yet-active / absent grant
 * rejection, cross-tenant denial, disabled flags, rate limits, unknown job
 * attribution, malformed envelopes, idempotency conflicts, meter-window
 * violations, locked windows, statement finality and immutability, and
 * fail-closed price lookups. Every denial leaves the ledger untouched.
 */

import { describe, expect, it } from 'vitest';
import { makeEnvelope, ProtocolError, toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { JobError } from '@arena/job-protocol';
import { createQuotaGrant, entitlementSchemaRef, revokeEntitlementGrant } from '@arena/entitlements';
import { BILLING_ERROR_CODES } from './errors.js';
import type { UsageRecord } from './shared.js';
import {
  DAY_WINDOW_START,
  FEATURE_COMPUTE,
  JOB_ALPHA,
  JOB_BETA,
  NEXT_DAY_WINDOW_START,
  T0,
  T1,
  T2,
  T3,
  T4,
  TENANT_ACME,
  TENANT_GLOBEX,
  createBillingHarness,
  makeJobEventEnvelopeRaw,
  makeRecordUsageCommandRaw,
  seedFlagGrant,
  seedQuotaGrant,
  seedRateLimitGrant,
} from './test-support.js';

function rawRecord(overrides: Record<string, unknown> = {}): UsageRecord {
  return {
    recordVersion: 1,
    usageId: 'usage-raw',
    sequence: 1,
    tenantId: TENANT_ACME,
    featureKey: FEATURE_COMPUTE,
    units: 1,
    occurredAt: T0,
    recordedAt: T0,
    source: 'direct-command',
    idempotencyKey: 'key-raw',
    ...overrides,
  } as unknown as UsageRecord;
}

describe('entitlement enforcement fails closed', () => {
  it('rejects usage that would exceed an active quota (and meters nothing)', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 2 });
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });

    harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 1, occurredAt: T0, jobId: JOB_ALPHA, envelopeId: 'env-n1' }),
    );
    harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 2, occurredAt: T1, jobId: JOB_ALPHA, envelopeId: 'env-n2' }),
    );
    expect(() =>
      harness.service.ingestJobEventEnvelope(
        makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 3, occurredAt: T2, jobId: JOB_ALPHA, envelopeId: 'env-n3' }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: BILLING_ERROR_CODES.QUOTA_EXCEEDED,
        details: expect.objectContaining({ limit: 2, usedUnits: 2, attemptedUnits: 1 }),
      }),
    );
    expect(harness.service.listUsageRecords(TENANT_ACME, FEATURE_COMPUTE)).toHaveLength(2);
  });

  it('rejects usage against an expired grant (a grant is expired exactly at its expiry instant)', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100, expiresAt: T2 });
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    expect(() =>
      harness.service.ingestJobEventEnvelope(
        makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 1, occurredAt: T3, jobId: JOB_ALPHA, envelopeId: 'env-exp' }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: BILLING_ERROR_CODES.ENTITLEMENT_DENIED,
        details: expect.objectContaining({ reason: 'grant-expired' }),
      }),
    );
    expect(harness.service.listUsageRecords(TENANT_ACME, FEATURE_COMPUTE)).toHaveLength(0);
  });

  it('rejects usage against a revoked grant (revocation is final)', () => {
    const harness = createBillingHarness();
    const grant = createQuotaGrant({
      grantId: 'grant-quota-revoked',
      tenantId: TENANT_ACME,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      limit: 100,
      window: 'day',
      note: 'revoked quota for billing tests',
    });
    harness.grants.put(revokeEntitlementGrant(grant, T1));
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    expect(() =>
      harness.service.ingestJobEventEnvelope(
        makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 1, occurredAt: T2, jobId: JOB_ALPHA, envelopeId: 'env-rev' }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: BILLING_ERROR_CODES.ENTITLEMENT_DENIED,
        details: expect.objectContaining({ reason: 'grant-revoked' }),
      }),
    );
  });

  it('rejects usage before a grant becomes active', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100, validFrom: T4 });
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    expect(() =>
      harness.service.ingestJobEventEnvelope(
        makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 1, occurredAt: T1, jobId: JOB_ALPHA, envelopeId: 'env-early' }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: BILLING_ERROR_CODES.ENTITLEMENT_DENIED,
        details: expect.objectContaining({ reason: 'grant-not-yet-active' }),
      }),
    );
  });

  it('rejects usage with no grant at all (no grant can never produce an allow)', () => {
    const harness = createBillingHarness();
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    expect(() =>
      harness.service.ingestJobEventEnvelope(
        makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 1, occurredAt: T1, jobId: JOB_ALPHA, envelopeId: 'env-nog' }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: BILLING_ERROR_CODES.ENTITLEMENT_DENIED,
        details: expect.objectContaining({ reason: 'no-matching-feature' }),
      }),
    );
  });

  it('rejects usage when the only existing grant belongs to another tenant', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100, tenantId: TENANT_GLOBEX });
    harness.jobIndex.register(JOB_BETA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    expect(() =>
      harness.service.ingestJobEventEnvelope(
        makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 1, occurredAt: T1, jobId: JOB_BETA, envelopeId: 'env-xten' }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.ENTITLEMENT_DENIED }),
    );
  });

  it('rejects usage of a feature whose active flag is disabled (deny overrides)', () => {
    const harness = createBillingHarness();
    seedFlagGrant(harness, { featureKey: FEATURE_COMPUTE, enabled: false });
    seedQuotaGrant(harness, { limit: 100 });
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    expect(() =>
      harness.service.ingestJobEventEnvelope(
        makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 1, occurredAt: T1, jobId: JOB_ALPHA, envelopeId: 'env-flag' }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.FEATURE_DISABLED }),
    );
  });

  it('rejects usage beyond an active rate limit (trailing window)', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100 });
    seedRateLimitGrant(harness, { limit: 2, durationSeconds: 3600 });
    harness.service.ingestRecordUsageCommand(
      makeRecordUsageCommandRaw({ tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE, units: 1, idempotencyKey: 'rl-1' }),
    );
    harness.clock.advance(30 * 60 * 1000);
    harness.service.ingestRecordUsageCommand(
      makeRecordUsageCommandRaw({ tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE, units: 1, idempotencyKey: 'rl-2' }),
    );
    harness.clock.advance(1000);
    expect(() =>
      harness.service.ingestRecordUsageCommand(
        makeRecordUsageCommandRaw({ tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE, units: 1, idempotencyKey: 'rl-3' }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.RATE_LIMIT_EXCEEDED }),
    );
    expect(harness.service.listUsageRecords(TENANT_ACME, FEATURE_COMPUTE)).toHaveLength(2);
  });
});

describe('ingestion fails closed', () => {
  it('rejects job events of unattributed jobs', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100 });
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    expect(() =>
      harness.service.ingestJobEventEnvelope(
        makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 1, occurredAt: T1, jobId: 'job-unknown-999', envelopeId: 'env-unk' }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.INVALID_EVENT }),
    );
  });

  it('propagates core ProtocolError for malformed envelopes', () => {
    const harness = createBillingHarness();
    expect(() => harness.service.ingestJobEventEnvelope('{not-an-envelope')).toThrowError(ProtocolError);
  });

  it('propagates JobError for structurally invalid job event payloads', () => {
    const harness = createBillingHarness();
    const raw = makeJobEventEnvelopeRaw({
      kind: 'job-completed',
      sequence: 1,
      occurredAt: T1,
      jobId: JOB_ALPHA,
      envelopeId: 'env-badts',
    });
    const tampered = JSON.parse(raw) as { payload: { occurredAt: string } };
    tampered.payload.occurredAt = '2026-02-01T00:00:00Z';
    expect(() => harness.service.ingestJobEventEnvelope(JSON.stringify(tampered))).toThrowError(JobError);
  });

  it('rejects record-usage commands with structurally invalid payloads', () => {
    const harness = createBillingHarness();
    const envelope = makeEnvelope({
      kind: 'command',
      schema: entitlementSchemaRef('entitlements/record-usage-command'),
      correlationId: toCorrelationId('corr-neg'),
      idempotencyKey: toIdempotencyKey('idem-neg'),
      payload: { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE, units: 0 },
    });
    expect(() => harness.service.ingestRecordUsageCommand(JSON.stringify(envelope))).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.INVALID_COMMAND }),
    );
  });

  it('rejects an idempotency key rebound to a different usage shape', () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100 });
    harness.service.ingestRecordUsageCommand(
      makeRecordUsageCommandRaw({ tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE, units: 3, idempotencyKey: 'conflict-1' }),
    );
    expect(() =>
      harness.service.ingestRecordUsageCommand(
        makeRecordUsageCommandRaw({ tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE, units: 5, idempotencyKey: 'conflict-1' }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.IDEMPOTENCY_CONFLICT }),
    );
    expect(harness.service.listUsageRecords(TENANT_ACME, FEATURE_COMPUTE)).toHaveLength(1);
  });
});

describe('meter-window discipline', () => {
  it('rejects non-canonical window starts (bounds are derived, never chosen)', () => {
    const harness = createBillingHarness();
    expect(() =>
      harness.service.summarizeWindow(TENANT_ACME, FEATURE_COMPUTE, 'day', T1),
    ).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.WINDOW_VIOLATION }),
    );
  });

  it('rejects ledger sequence gaps, duplicates, regressions and bad records', () => {
    const harness = createBillingHarness();
    harness.ledger.append(rawRecord());
    expect(() =>
      harness.ledger.append(rawRecord({ usageId: 'usage-gap', idempotencyKey: 'key-gap', sequence: 3 })),
    ).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.SEQUENCE_GAP }),
    );
    expect(() =>
      harness.ledger.append(rawRecord({ usageId: 'usage-dup', idempotencyKey: 'key-dup', sequence: 1 })),
    ).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.SEQUENCE_DUPLICATE }),
    );
    expect(() =>
      harness.ledger.append(
        rawRecord({ usageId: 'usage-reg', idempotencyKey: 'key-reg', sequence: 2, occurredAt: '2026-01-31T00:00:00.000Z' }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.WINDOW_VIOLATION }),
    );
    expect(() =>
      harness.ledger.append(rawRecord({ usageId: 'usage-ver', idempotencyKey: 'key-ver', recordVersion: 2 })),
    ).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.INVALID_RECORD }),
    );
    expect(harness.ledger.listForTenantFeature(TENANT_ACME, FEATURE_COMPUTE)).toHaveLength(1);
  });

  it('refuses to draft statements over empty windows', async () => {
    const harness = createBillingHarness();
    await expect(
      harness.service.draftStatement({
        tenantId: TENANT_ACME,
        featureKey: FEATURE_COMPUTE,
        window: 'day',
        windowStart: NEXT_DAY_WINDOW_START,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.INVALID_STATEMENT }),
    );
  });

  it('fails closed on unpriced features (integer micros price book)', async () => {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { grantId: 'grant-quota-unpriced', featureKey: 'storage.write', limit: 100 });
    harness.jobIndex.register(JOB_BETA, { tenantId: TENANT_ACME, featureKey: 'storage.write' });
    harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 1, occurredAt: T1, jobId: JOB_BETA, envelopeId: 'env-unpriced' }),
    );
    await expect(
      harness.service.draftStatement({
        tenantId: TENANT_ACME,
        featureKey: 'storage.write',
        window: 'day',
        windowStart: DAY_WINDOW_START,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.INVALID_INPUT }),
    );
  });

  it('rejects invalid tenants and features on every surface', () => {
    const harness = createBillingHarness();
    expect(() => harness.service.summarizeWindow('NOT_A_TENANT', FEATURE_COMPUTE, 'day', DAY_WINDOW_START)).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.INVALID_INPUT }),
    );
    expect(() => harness.service.summarizeWindow(TENANT_ACME, 'not a feature!', 'day', DAY_WINDOW_START)).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.INVALID_INPUT }),
    );
    expect(() => harness.service.listUsageRecords(TENANT_ACME, 'not a feature!')).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.INVALID_INPUT }),
    );
  });
});

describe('statement finality and immutability', () => {
  async function statedHarness() {
    const harness = createBillingHarness();
    seedQuotaGrant(harness, { limit: 100 });
    harness.jobIndex.register(JOB_ALPHA, { tenantId: TENANT_ACME, featureKey: FEATURE_COMPUTE });
    harness.service.ingestJobEventEnvelope(
      makeJobEventEnvelopeRaw({ kind: 'job-completed', sequence: 1, occurredAt: T1, jobId: JOB_ALPHA, envelopeId: 'env-fin1' }),
    );
    const draft = await harness.service.draftStatement({
      tenantId: TENANT_ACME,
      featureKey: FEATURE_COMPUTE,
      window: 'day',
      windowStart: DAY_WINDOW_START,
    });
    const issued = await harness.service.issueStatement(draft.statementId);
    return { harness, draft, issued };
  }

  it('a window is stated at most once (re-draft fails closed)', async () => {
    const { harness } = await statedHarness();
    await expect(
      harness.service.draftStatement({
        tenantId: TENANT_ACME,
        featureKey: FEATURE_COMPUTE,
        window: 'day',
        windowStart: DAY_WINDOW_START,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.WINDOW_LOCKED }),
    );
  });

  it('issued statements are final (re-issue fails closed)', async () => {
    const { harness, issued } = await statedHarness();
    await expect(harness.service.issueStatement(issued.statementId)).rejects.toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.STATEMENT_FINAL }),
    );
  });

  it('cross-tenant statement reads fail closed', async () => {
    const { harness, issued } = await statedHarness();
    expect(() => harness.service.getStatementForTenant(TENANT_GLOBEX, issued.statementId)).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.TENANT_MISMATCH }),
    );
  });

  it('unknown statement ids fail closed', async () => {
    const { harness } = await statedHarness();
    expect(() => harness.service.getStatementForTenant(TENANT_ACME, 'statement-does-not-exist')).toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.INVALID_STATEMENT }),
    );
    await expect(harness.service.issueStatement('statement-does-not-exist')).rejects.toThrowError(
      expect.objectContaining({ code: BILLING_ERROR_CODES.INVALID_STATEMENT }),
    );
  });

  it('tampered statements fail digest verification', async () => {
    const { harness, issued } = await statedHarness();
    const tamperedUnits = { ...issued, unitsTotal: issued.unitsTotal + 1 };
    const tamperedAmount = { ...issued, amountMicros: issued.amountMicros + 1 };
    const tamperedStatus = { ...issued, status: 'draft' as const };
    await expect(harness.service.verifyStatement(tamperedUnits)).resolves.toBe(false);
    await expect(harness.service.verifyStatement(tamperedAmount)).resolves.toBe(false);
    await expect(harness.service.verifyStatement(tamperedStatus)).resolves.toBe(false);
    await expect(harness.service.verifyStatement(issued)).resolves.toBe(true);
  });
});
