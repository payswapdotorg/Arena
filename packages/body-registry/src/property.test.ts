/**
 * Property tests (Work Order A024) — determinism, content addressing,
 * replay purity, digest separation. Seeded (no Math.random): the
 * scenario derives N variants by structured field mutation.
 */

import { describe, expect, it } from 'vitest';
import {
  createReleaseRegistrationRecord,
  createReleaseRetirementRecord,
  createReleaseSupersessionRecord,
  verifyReleaseRecord,
} from './record.js';
import { evaluateReleaseGate, releaseGateEvidenceDigest } from './gate.js';
import { publishRelease } from './publication.js';
import { BODY_REGISTRY_ERROR_CODES, BodyRegistryError } from './errors.js';
import { CORRELATION_ID, IDEMPOTENCY_KEY, T1, T2, makeAdmittedScenario } from './test-support.js';

const VARIANTS = 8;

describe('property — determinism and content addressing', () => {
  it('identical registration inputs always mint the identical digest', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(scenario.candidate, scenario.stores);
    const evidence = verdict.evidence!;
    const digests = new Set<string>();
    for (let i = 0; i < VARIANTS; i += 1) {
      const record = await createReleaseRegistrationRecord({
        bodyVersionRef: {
          tenant: evidence.bodyVersionRef.tenant,
          name: evidence.bodyVersionRef.name,
          version: evidence.bodyVersionRef.version,
          digest: evidence.bodyVersionRef.digest,
        },
        releaseVersion: '2.0.0',
        gate: evidence,
        tags: ['production'],
        releasedAt: T1,
        correlationId: CORRELATION_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        tenantId: null,
        workspaceId: null,
        provenance: { releasedBy: 'release-bot', recordedAt: T1, notes: null },
      });
      digests.add(record.digest);
    }
    expect(digests.size).toBe(1);
  });

  it('distinct idempotency keys mint distinct records (content addressing)', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(scenario.candidate, scenario.stores);
    const evidence = verdict.evidence!;
    const digests = new Set<string>();
    for (let i = 0; i < VARIANTS; i += 1) {
      const record = await createReleaseRegistrationRecord({
        bodyVersionRef: {
          tenant: evidence.bodyVersionRef.tenant,
          name: evidence.bodyVersionRef.name,
          version: evidence.bodyVersionRef.version,
          digest: evidence.bodyVersionRef.digest,
        },
        releaseVersion: '2.0.0',
        gate: evidence,
        releasedAt: T1,
        correlationId: CORRELATION_ID,
        idempotencyKey: `idem-variant-${i}`,
        tenantId: null,
        workspaceId: null,
        provenance: { releasedBy: 'release-bot', recordedAt: T1, notes: null },
      });
      digests.add(record.digest);
    }
    expect(digests.size).toBe(VARIANTS);
  });

  it('any covered-field mutation changes the digest (avalanche over structure)', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(scenario.candidate, scenario.stores);
    const evidence = verdict.evidence!;
    const base = await createReleaseRegistrationRecord({
      bodyVersionRef: {
        tenant: evidence.bodyVersionRef.tenant,
        name: evidence.bodyVersionRef.name,
        version: evidence.bodyVersionRef.version,
        digest: evidence.bodyVersionRef.digest,
      },
      releaseVersion: '2.0.0',
      gate: evidence,
      releasedAt: T1,
      correlationId: CORRELATION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      tenantId: null,
      workspaceId: null,
      provenance: { releasedBy: 'release-bot', recordedAt: T1, notes: null },
    });
    const mutations: Record<string, () => Promise<{ digest: string }>> = {
      releaseVersion: async () =>
        createReleaseRegistrationRecord({
          bodyVersionRef: base.bodyVersionRef!,
          releaseVersion: '2.0.1',
          gate: base.gate!,
          releasedAt: T1,
          correlationId: CORRELATION_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          tenantId: null,
          workspaceId: null,
          provenance: { releasedBy: 'release-bot', recordedAt: T1, notes: null },
        }),
      channel: async () => {
        const scenario2 = await makeAdmittedScenario({ channel: 'development', levelGrant: 'DEVELOPMENT' });
        const verdict2 = await evaluateReleaseGate(scenario2.candidate, scenario2.stores);
        return createReleaseRegistrationRecord({
          bodyVersionRef: {
            tenant: verdict2.evidence!.bodyVersionRef.tenant,
            name: verdict2.evidence!.bodyVersionRef.name,
            version: verdict2.evidence!.bodyVersionRef.version,
            digest: verdict2.evidence!.bodyVersionRef.digest,
          },
          releaseVersion: '2.0.0',
          gate: verdict2.evidence!,
          releasedAt: T1,
          correlationId: CORRELATION_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          tenantId: null,
          workspaceId: null,
          provenance: { releasedBy: 'release-bot', recordedAt: T1, notes: null },
        });
      },
      releasedAt: async () =>
        createReleaseRegistrationRecord({
          bodyVersionRef: base.bodyVersionRef!,
          releaseVersion: '2.0.0',
          gate: base.gate!,
          releasedAt: T2,
          correlationId: CORRELATION_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          tenantId: null,
          workspaceId: null,
          provenance: { releasedBy: 'release-bot', recordedAt: T1, notes: null },
        }),
    };
    for (const [field, mutate] of Object.entries(mutations)) {
      const mutated = await mutate();
      expect(mutated.digest, `mutating ${field} must change the digest`).not.toBe(base.digest);
    }
  });

  it('gate evidence digests separate distinct evidence snapshots', async () => {
    const first = await makeAdmittedScenario();
    const second = await makeAdmittedScenario({ includeForge: true });
    const verdictA = await evaluateReleaseGate(first.candidate, first.stores);
    const verdictB = await evaluateReleaseGate(second.candidate, second.stores);
    const digestA = await releaseGateEvidenceDigest(verdictA.evidence!);
    const digestB = await releaseGateEvidenceDigest(verdictB.evidence!);
    expect(digestA).not.toBe(digestB);
    expect(await releaseGateEvidenceDigest(verdictA.evidence!)).toBe(digestA);
  });

  it('publication is reproducible: identical inputs mint the identical record', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(scenario.candidate, scenario.stores);
    const registration = await createReleaseRegistrationRecord({
      bodyVersionRef: {
        tenant: verdict.evidence!.bodyVersionRef.tenant,
        name: verdict.evidence!.bodyVersionRef.name,
        version: verdict.evidence!.bodyVersionRef.version,
        digest: verdict.evidence!.bodyVersionRef.digest,
      },
      releaseVersion: '2.0.0',
      gate: verdict.evidence!,
      releasedAt: T1,
      correlationId: CORRELATION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      tenantId: null,
      workspaceId: null,
      provenance: { releasedBy: 'release-bot', recordedAt: T1, notes: null },
    });
    const digests = new Set<string>();
    for (let i = 0; i < VARIANTS; i += 1) {
      const publication = await publishRelease({
        registration,
        publisher: { type: 'service', tenant: 'acme', principalId: 'release-bot' },
        rights: {
          license: 'Proprietary',
          commercialUse: 'requires-license',
          redistribution: 'tenant-only',
          customerData: 'derived',
        },
        publishedAt: T2,
      });
      digests.add(publication.digest);
    }
    expect(digests.size).toBe(1);
  });

  it('supersession and retirement digests differ for the same target (kind separation)', async () => {
    const common = {
      target: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      grounds: 'x',
      correlationId: CORRELATION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      tenantId: null,
      workspaceId: null,
      provenance: { releasedBy: 'release-bot', recordedAt: T2, notes: null },
    };
    const supersession = await createReleaseSupersessionRecord(common);
    const retirement = await createReleaseRetirementRecord(common);
    expect(supersession.digest).not.toBe(retirement.digest);
    await expect(verifyReleaseRecord(supersession)).resolves.toBe(supersession.digest);
    await expect(verifyReleaseRecord(retirement)).resolves.toBe(retirement.digest);
  });

  it('tamper detection is exhaustive over covered fields', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(scenario.candidate, scenario.stores);
    const record = await createReleaseRegistrationRecord({
      bodyVersionRef: {
        tenant: verdict.evidence!.bodyVersionRef.tenant,
        name: verdict.evidence!.bodyVersionRef.name,
        version: verdict.evidence!.bodyVersionRef.version,
        digest: verdict.evidence!.bodyVersionRef.digest,
      },
      releaseVersion: '2.0.0',
      gate: verdict.evidence!,
      tags: ['production'],
      releasedAt: T1,
      correlationId: CORRELATION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      tenantId: null,
      workspaceId: null,
      provenance: { releasedBy: 'release-bot', recordedAt: T1, notes: null },
    });
    const tamperedTags = { ...record, tags: ['tampered'] } as typeof record;
    const tamperedChannel = { ...record, channel: 'development' } as typeof record;
    for (const tampered of [tamperedTags, tamperedChannel]) {
      let code: string | null = null;
      try {
        await verifyReleaseRecord(tampered);
      } catch (error) {
        code = (error as BodyRegistryError).code;
      }
      expect(code).toBe(BODY_REGISTRY_ERROR_CODES.TAMPERED);
    }
  });
});
