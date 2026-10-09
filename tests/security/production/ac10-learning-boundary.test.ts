/**
 * tests/security/production/ac10-learning-boundary.test.ts — AC-10
 * learning rights/scope (Work Order P007 integrated pass; issue #159).
 *
 * "no silent promotion of task-specific advice to global knowledge" +
 * the C022 boundary wall (lock rules 31/32). Attacks the two REAL
 * surfaces the integrated path exposes:
 *
 *   1. the HOST-SIDE projection seam (the exact place the threat model
 *      says "a projector/sink wiring bug … is exactly where a silent
 *      promotion could hide"): a `learning-candidate-projection` job
 *      submitted through the REAL host with ADVERSARIAL input claiming
 *      to be a rights-cleared cross-tenant candidate batch must produce
 *      the honest STUB verdict — never a fabricated candidate, never a
 *      promotion. The closed job-kind registry also refuses any
 *      smuggled 'learning-promotion'-style kind.
 *
 *   2. the cross-tenant learning consent gate (the REAL
 *      services/security SecurityService through its REAL wire command):
 *      no grant → denied; revoked grant → denied; expired grant →
 *      denied; rights downgraded → denied; and every decision (allow OR
 *      deny) is AUDITED (the audit trail is the evidence).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecurityService } from '@arena/security-service';
import { toTenantScopedRef } from '@arena/security';
import {
  bootAdversarialBattery,
} from './support/adversarial-harness.js';
import type { AdversarialBattery } from './support/adversarial-harness.js';

let battery: AdversarialBattery;

beforeEach(async () => {
  battery = await bootAdversarialBattery();
});

afterEach(async () => {
  await battery.close();
});

const ACTOR = Object.freeze({
  type: 'service',
  tenant: 'arena',
  principalId: 'p007-adversarial-battery',
});

describe('AC-10 — the host-side learning projection seam cannot be talked into promoting', () => {
  it('an adversarial learning-candidate-projection job produces the HONEST stub verdict, never a fabricated candidate', async () => {
    // THE ATTACK: input claiming to be a fully rights-cleared,
    // cross-tenant, globally-reusable candidate batch — exactly the
    // payload a confused-deputy projector bug would trust.
    const attackInput = {
      records: [
        {
          tenantId: 'tenant-alpha',
          sourceTenant: 'tenant-beta', // cross-tenant claim
          rightsCleared: true, // self-asserted rights
          globalReuse: true, // the silent-promotion payload
          trajectoryDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        {
          tenantId: 'tenant-gamma',
          sourceTenant: 'tenant-gamma',
          rightsCleared: true,
          globalReuse: true,
          trajectoryDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      ],
      assertAdoption: true,
      destination: 'global-knowledge',
    };
    const submitted = await battery.host.jobs.submitByKind({
      kindName: 'learning-candidate-projection',
      input: attackInput,
      correlationId: 'corr-ac10-projection' as never,
      idempotencyKey: 'idem-ac10-projection' as never,
      actor: ACTOR,
    });
    // The claiming discipline: a claimed job is the running state the
    // executor's completion path requires (claimWithLease → execute).
    await battery.host.claimWithLease({ jobId: submitted.jobId, actor: ACTOR });
    const executed = await battery.host.executeClaimed({
      jobId: submitted.jobId,
      actor: ACTOR,
    });
    expect(executed.status).toBe('succeeded');
    const result = executed.result as Record<string, unknown>;

    // The seam's honest posture: the stub verdict is unmistakable and
    // NEVER fabricates candidates (ADR-P001-06 rule 3).
    expect(result['kind']).toBe('learning-candidate-projection');
    expect(result['disposition']).toBe('stub-not-implemented');
    expect(result['inputEchoDigestKeys']).toBe(2);
    // The result carries NO candidate, NO adoption, NO destination —
    // the adversarial assertions in the input are simply not echoed.
    expect(result['candidate']).toBeUndefined();
    expect(result['adopted']).toBeUndefined();
    expect(result['destination']).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('global-knowledge');
    expect(JSON.stringify(result)).not.toContain('rightsCleared');
  });

  it('the closed job-kind registry refuses smuggled promotion kinds (typed)', async () => {
    for (const smuggled of [
      'learning-promotion',
      'learning-candidate-adopt',
      'webhook-delivery',
      'tenant-merge',
    ]) {
      let refused = false;
      let code = '';
      try {
        await battery.host.jobs.submitByKind({
          kindName: smuggled,
          input: {},
          correlationId: 'corr-ac10-smuggle' as never,
          idempotencyKey: `idem-ac10-smuggle-${smuggled}` as never,
          actor: ACTOR,
        });
      } catch (error) {
        refused = true;
        code = (error as { code?: string }).code ?? '';
      }
      expect(refused).toBe(true);
      expect(code).toBe('RUNTIME_UNKNOWN_JOB_KIND');
    }
  });
});

describe('AC-10 — the cross-tenant learning consent gate (the REAL security service)', () => {
  const T0 = '2026-10-09T12:00:00.000Z';
  const GRANTOR = 'tenant-beta';
  const CONSUMER = 'tenant-alpha';
  const DATASET_ID = 'dataset-77';
  // The typed tenant-scoped dataset ref (the wire command's dataset
  // argument — TenantScopedRef with recordVersion + branded tenant).
  const datasetRef = toTenantScopedRef({
    recordVersion: 1,
    tenantId: GRANTOR,
    boundaryClass: 'dataset',
    recordId: DATASET_ID,
  });
  const dataset = {
    recordVersion: 1,
    recordId: DATASET_ID,
    tenantId: GRANTOR,
    boundaryClass: 'dataset' as const,
  };
  const rights = (overrides: Record<string, unknown> = {}) => ({
    recordVersion: 1,
    owner: GRANTOR,
    source: 'upload://dataset-77',
    permittedUse: 'cross-tenant-learning',
    contractRef: 'contract://cla-77',
    retention: { recordVersion: 1, mode: 'none', retentionDays: null, expiresAt: null },
    publicationStatus: 'tenant-internal',
    recordedAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  });
  const grant = (overrides: Record<string, unknown> = {}) => ({
    recordVersion: 1,
    grantId: 'grant-77',
    grantor: GRANTOR,
    datasets: [dataset],
    grantedAt: '2026-10-01T08:00:00.000Z',
    expiresAt: '2026-11-01T08:00:00.000Z',
    status: 'active',
    revokedAt: null,
    ...overrides,
  });

  /** Run one authorize-learning-command through the REAL service. */
  async function authorize(
    grants: readonly unknown[],
    dataRights: Readonly<Record<string, unknown>>,
    consumerTenant = CONSUMER,
  ) {
    const service = new SecurityService();
    const command = service.makeLearningCommand(
      consumerTenant,
      [datasetRef],
      grants,
      dataRights,
      T0,
      'corr-ac10-learning',
      'idem-ac10-learning',
    );
    return {
      outcome: await service.handleAuthorizeLearningCommand(JSON.stringify(command)),
      audit: await service.auditSnapshot(),
    };
  }

  it('NO grant → denied grant-missing, and the denial is AUDITED', async () => {
    const { outcome, audit } = await authorize([], {});
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.reason).toBe('grant-missing');
    // The audit trail records the DENIAL (machine-readable evidence).
    const entry = audit.find((record) => record.payload.kind === 'learning-authorization');
    expect(entry).toBeDefined();
    expect(entry?.payload.outcome?.effect).toBe('deny');
    // Cross-tenant learning WITHOUT consent is denied — the
    // rights-free-global-learning class is not reachable through the gate.
  });

  it('a REVOKED grant → denied grant-revoked (revocation beats everything)', async () => {
    const { outcome } = await authorize(
      [grant({ status: 'revoked', revokedAt: '2026-10-05T08:00:00.000Z' })],
      { [DATASET_ID]: rights() },
    );
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.reason).toBe('grant-revoked');
  });

  it('an EXPIRED grant → denied grant-expired', async () => {
    const { outcome } = await authorize(
      [grant({ expiresAt: '2026-10-05T08:00:00.000Z' })],
      { [DATASET_ID]: rights() },
    );
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.reason).toBe('grant-expired');
  });

  it('downgraded permitted-use → denied (rights must present cross-tenant-learning exactly)', async () => {
    const { outcome } = await authorize(
      [grant()],
      { [DATASET_ID]: rights({ permittedUse: 'learning-in-tenant' }) },
    );
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.reason).toBe('permitted-use-excluded');
  });

  it('missing rights record → denied rights-missing; withdrawn publication → denied', async () => {
    const missing = await authorize([grant()], {});
    expect(missing.outcome.decision.allowed).toBe(false);
    expect(missing.outcome.decision.reason).toBe('rights-missing');

    const withdrawn = await authorize(
      [grant()],
      { [DATASET_ID]: rights({ publicationStatus: 'withdrawn' }) },
    );
    expect(withdrawn.outcome.decision.allowed).toBe(false);
  });

  it('the FULLY authorized path allows and audits the ALLOW (the gate is not a blanket deny)', async () => {
    const { outcome, audit } = await authorize([grant()], { [DATASET_ID]: rights() });
    expect(outcome.decision.allowed).toBe(true);
    expect(outcome.decision.reason).toBe('grant-authorized');
    const entry = audit.find((record) => record.payload.kind === 'learning-authorization');
    expect(entry?.payload.outcome?.effect).toBe('allow');
    // The audit chain verifies (tamper-evident decisions).
    const service = new SecurityService();
    await expect(service.verifyAuditChain()).resolves.toBe(true);
  });

  it('the GRANTOR cannot use a self-grant to consume its OWN data through the cross-tenant gate', async () => {
    // The no-op self-consumption attack: grantor as consumer.
    const { outcome } = await authorize([grant()], { [DATASET_ID]: rights() }, GRANTOR);
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.reason).toBe('dataset-tenant-mismatch');
  });
});
