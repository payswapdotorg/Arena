/**
 * Negative/adversarial tests (Work Order A024) — the service surfaces
 * gate rejections as TYPED structured errors, fails closed on
 * malformed envelopes and store failures, and never admits partially.
 */

import { describe, expect, it } from 'vitest';
import { makePublishReleaseCommand, makeRegisterReleaseCommand } from '@arena/body-registry';
import { newCorrelationId, newIdempotencyKey } from '@arena/protocol-core';
import { BodyRegistryEnvelopeService, BodyRegistryService } from './index.js';
import { PUBLISHER, RIGHTS, T1, T2, makeScenario } from './test-support.js';

const REGISTER_BASE = {
  releaseVersion: '2.0.0',
  recordedAt: T1,
  provenance: { releasedBy: 'release-bot', notes: null },
};

describe('negative — gate rejections surface typed + structured', () => {
  it('a gate rejection carries the structured rejections in details', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryService({ stores: scenario.stores });
    let code = '';
    let rejections: unknown[] = [];
    try {
      await service.register(
        { ...scenario.candidate, certificationRefs: ['a'.repeat(64)] },
        { correlationId: 'corr-release-1', idempotencyKey: 'idem-release-1', ...REGISTER_BASE },
      );
      expect.fail('register must reject');
    } catch (error) {
      const typed = error as { code: string; details?: { rejections?: unknown[] } };
      code = typed.code;
      rejections = typed.details?.rejections ?? [];
    }
    expect(code).toBe('BODY_REGISTRY_REGISTRATION_REJECTED');
    expect(rejections.length).toBeGreaterThan(0);
    expect((rejections[0] as { reason: string }).reason).toBe('certification-unresolved');
  });

  it('an unresolvable body version rejects registration', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryService({ stores: scenario.stores });
    await expect(
      service.register(
        { ...scenario.candidate, bodyVersionRef: { ...scenario.candidate.bodyVersionRef, version: '9.9.9' } },
        { correlationId: 'corr-release-1', idempotencyKey: 'idem-release-1', ...REGISTER_BASE },
      ),
    ).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string }).code === 'BODY_REGISTRY_REGISTRATION_REJECTED',
    );
  });

  it('a store that throws fails registration CLOSED (nothing recorded)', async () => {
    const scenario = await makeScenario();
    const stores = {
      ...scenario.stores,
      bodyVersions: () => {
        throw new Error('store down');
      },
    };
    const service = new BodyRegistryService({ stores });
    await expect(
      service.register(scenario.candidate, {
        correlationId: 'corr-release-1',
        idempotencyKey: 'idem-release-1',
        ...REGISTER_BASE,
      }),
    ).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string }).code === 'BODY_REGISTRY_EVIDENCE_UNRESOLVABLE',
    );
    expect(service.listRecords()).toHaveLength(0);
  });

  it('invalid correlation/idempotency keys are rejected before any work', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryService({ stores: scenario.stores });
    await expect(
      service.register(scenario.candidate, {
        correlationId: '',
        idempotencyKey: 'idem-release-1',
        ...REGISTER_BASE,
      }),
    ).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string }).code === 'BODY_REGISTRY_INVALID_IDENTITY',
    );
    await expect(
      service.register(scenario.candidate, {
        correlationId: 'corr-release-1',
        idempotencyKey: '',
        ...REGISTER_BASE,
      }),
    ).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string }).code === 'BODY_REGISTRY_INVALID_IDENTITY',
    );
  });
});

describe('negative — envelope facade fails closed', () => {
  it('malformed JSON fails closed', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryEnvelopeService({
      fabric: new BodyRegistryService({ stores: scenario.stores }),
    });
    await expect(
      service.handleRegisterReleaseCommand('not json', {
        recordedAt: T1,
        provenance: { releasedBy: 'release-bot', notes: null },
      }),
    ).rejects.toSatisfy((error: unknown) => (error as { name?: string }).name === 'BodyRegistryError');
  });

  it('a foreign-schema envelope fails closed', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryEnvelopeService({
      fabric: new BodyRegistryService({ stores: scenario.stores }),
    });
    const command = makeRegisterReleaseCommand(
      {
        bodyVersionRef: {
          tenant: scenario.bodyVersion.body.tenant,
          name: scenario.bodyVersion.body.name,
          version: scenario.bodyVersion.version,
          digest: String(scenario.bodyVersion.digest),
        },
        releaseVersion: '2.0.0',
        channel: 'stable',
        tags: [],
        certificationRefs: [scenario.certification.digest],
        compatibilityRefs: [scenario.compatibility.recordDigest],
        forgeRecordDigest: null,
      },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    const raw = JSON.stringify({
      ...command,
      schema: 'arena:schema/certification/certification-record@1.0.0',
    });
    await expect(
      service.handleRegisterReleaseCommand(raw, {
        recordedAt: T1,
        provenance: { releasedBy: 'release-bot', notes: null },
      }),
    ).rejects.toSatisfy((error: unknown) => (error as { name?: string }).name === 'BodyRegistryError');
  });

  it('publishing an unknown release through the facade fails closed', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryEnvelopeService({
      fabric: new BodyRegistryService({ stores: scenario.stores }),
    });
    await expect(
      service.handlePublishReleaseCommand(
        JSON.stringify(
          makePublishReleaseCommand(
            { releaseRecordDigest: 'a'.repeat(64), publisher: PUBLISHER, rights: RIGHTS, publishedAt: T2 },
            { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
          ),
        ),
      ),
    ).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string }).code === 'BODY_REGISTRY_NOT_FOUND',
    );
  });

  it('publication with invalid rights fails closed', async () => {
    const scenario = await makeScenario();
    const fabric = new BodyRegistryService({ stores: scenario.stores });
    const record = await fabric.register(scenario.candidate, {
      correlationId: 'corr-release-1',
      idempotencyKey: 'idem-release-1',
      ...REGISTER_BASE,
    });
    await expect(
      fabric.publish(record.digest, { publisher: PUBLISHER, rights: { license: '' }, publishedAt: T2 }),
    ).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string }).code === 'BODY_REGISTRY_INVALID_RIGHTS',
    );
  });
});
