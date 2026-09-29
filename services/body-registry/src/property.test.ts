/**
 * Property tests for the service (Work Order A024) — deterministic
 * replay, ledger purity, publication reproducibility through the
 * service surface.
 */

import { describe, expect, it } from 'vitest';
import { verifyReleaseRecord } from '@arena/body-registry';
import { BodyRegistryService } from './index.js';
import { PUBLISHER, RIGHTS, T1, T2, makeScenario } from './test-support.js';

const REGISTER_BASE = {
  releaseVersion: '2.0.0',
  recordedAt: T1,
  provenance: { releasedBy: 'release-bot', notes: null },
};

const VARIANTS = 6;

describe('property — service determinism', () => {
  it('identical registrations through the service are byte-identical', async () => {
    const scenario = await makeScenario();
    const digests = new Set<string>();
    for (let i = 0; i < VARIANTS; i += 1) {
      const service = new BodyRegistryService({ stores: scenario.stores });
      const record = await service.register(scenario.candidate, {
        correlationId: 'corr-release-1',
        idempotencyKey: 'idem-release-1',
        ...REGISTER_BASE,
      });
      digests.add(record.digest);
    }
    expect(digests.size).toBe(1);
  });

  it('distinct idempotency keys mint distinct registrations', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryService({ stores: scenario.stores });
    const digests = new Set<string>();
    for (let i = 0; i < VARIANTS; i += 1) {
      const record = await service.register(scenario.candidate, {
        correlationId: `corr-release-${i}`,
        idempotencyKey: `idem-release-${i}`,
        ...REGISTER_BASE,
      });
      digests.add(record.digest);
    }
    expect(digests.size).toBe(VARIANTS);
  });

  it('every stored record passes tamper verification (belt and braces)', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryService({ stores: scenario.stores });
    await service.register(scenario.candidate, {
      correlationId: 'corr-release-1',
      idempotencyKey: 'idem-release-1',
      ...REGISTER_BASE,
    });
    await service.register(scenario.candidate, {
      correlationId: 'corr-release-2',
      idempotencyKey: 'idem-release-2',
      releaseVersion: '2.0.1',
      recordedAt: T2,
      provenance: { releasedBy: 'release-bot', notes: null },
    });
    for (const record of service.listRecords()) {
      await expect(verifyReleaseRecord(record)).resolves.toBe(record.digest);
    }
  });

  it('publication through the service is reproducible and idempotent', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryService({ stores: scenario.stores });
    const record = await service.register(scenario.candidate, {
      correlationId: 'corr-release-1',
      idempotencyKey: 'idem-release-1',
      ...REGISTER_BASE,
    });
    const digests = new Set<string>();
    for (let i = 0; i < VARIANTS; i += 1) {
      const publication = await service.publish(record.digest, {
        publisher: PUBLISHER,
        rights: RIGHTS,
        publishedAt: T2,
      });
      digests.add(publication.digest);
    }
    expect(digests.size).toBe(1);
    expect(service.getPublicationLedger().records).toHaveLength(1);
  });
});
