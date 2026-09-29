/**
 * Service tests (Work Order A024) — the reference fabric: register
 * (gate + idempotency + identity binding), supersede/retire
 * projections, publication round trips, envelope wiring.
 */

import { describe, expect, it } from 'vitest';
import {
  makeRegisterReleaseCommand,
  makePublishReleaseCommand,
  parseReleasePublishedEvent,
  parseReleaseRegisteredEvent,
  verifyReleaseRecord,
} from '@arena/body-registry';
import { newCorrelationId, newIdempotencyKey } from '@arena/protocol-core';
import { BodyRegistryEnvelopeService, BodyRegistryService } from './index.js';
import { PUBLISHER, RIGHTS, T1, T2, T3, makeScenario } from './test-support.js';

const REGISTER_BASE = {
  releaseVersion: '2.0.0',
  tags: ['production'],
  recordedAt: T1,
  provenance: { releasedBy: 'release-bot', notes: null },
};

describe('BodyRegistryService — register', () => {
  it('registers an admitted candidate and appends the record', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryService({ stores: scenario.stores });
    const record = await service.register(scenario.candidate, {
      correlationId: 'corr-release-1',
      idempotencyKey: 'idem-release-1',
      ...REGISTER_BASE,
    });
    expect(record.kind).toBe('release-registration');
    expect(record.release!.version).toBe('2.0.0');
    expect(record.gate!.channel).toBe('stable');
    expect(service.getRecord(record.digest)).toBe(record);
    expect(service.listRecords()).toHaveLength(1);
    await expect(verifyReleaseRecord(record)).resolves.toBe(record.digest);
  });

  it('replays identically under the same idempotency key (byte-identical record)', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryService({ stores: scenario.stores });
    const first = await service.register(scenario.candidate, {
      correlationId: 'corr-release-1',
      idempotencyKey: 'idem-release-1',
      ...REGISTER_BASE,
    });
    const replay = await service.register(scenario.candidate, {
      correlationId: 'corr-release-1',
      idempotencyKey: 'idem-release-1',
      ...REGISTER_BASE,
    });
    expect(replay).toBe(first);
    expect(service.listRecords()).toHaveLength(1);
  });

  it('rejects the same key + a different candidate (IDEMPOTENCY_CONFLICT)', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryService({ stores: scenario.stores });
    await service.register(scenario.candidate, {
      correlationId: 'corr-release-1',
      idempotencyKey: 'idem-release-1',
      ...REGISTER_BASE,
    });
    await expect(
      service.register(scenario.candidate, {
        correlationId: 'corr-release-1',
        idempotencyKey: 'idem-release-1',
        releaseVersion: '3.0.0',
        recordedAt: T1,
        provenance: { releasedBy: 'release-bot', notes: null },
      }),
    ).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string }).code === 'BODY_REGISTRY_IDEMPOTENCY_CONFLICT',
    );
  });

  it('rejects re-binding a release identity to different content (IDENTITY_CONFLICT)', async () => {
    const scenarioA = await makeScenario();
    const scenarioB = await makeScenario({ bodyVersion: '1.5.0' });
    // One service seeing both body versions.
    const stores = {
      bodyVersions: (digest: string) =>
        digest === scenarioA.bodyVersion.digest
          ? scenarioA.bodyVersion
          : digest === scenarioB.bodyVersion.digest
            ? scenarioB.bodyVersion
            : null,
      certificationRecords: (digest: string) =>
        digest === scenarioA.certification.digest
          ? scenarioA.certification
          : digest === scenarioB.certification.digest
            ? scenarioB.certification
            : null,
      compatibilityRecords: (digest: string) =>
        digest === scenarioA.compatibility.recordDigest
          ? scenarioA.compatibility
          : digest === scenarioB.compatibility.recordDigest
            ? scenarioB.compatibility
            : null,
    };
    const service = new BodyRegistryService({ stores });
    await service.register(scenarioA.candidate, {
      correlationId: 'corr-release-1',
      idempotencyKey: 'idem-release-1',
      ...REGISTER_BASE,
    });
    // Same release identity (2.0.0), different content (1.5.0 digest).
    await expect(
      service.register(scenarioB.candidate, {
        correlationId: 'corr-release-2',
        idempotencyKey: 'idem-release-2',
        ...REGISTER_BASE,
      }),
    ).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string }).code === 'BODY_REGISTRY_IDENTITY_CONFLICT',
    );
  });

  it('accepts re-registering the same content under a new release version (re-tagging)', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryService({ stores: scenario.stores });
    await service.register(scenario.candidate, {
      correlationId: 'corr-release-1',
      idempotencyKey: 'idem-release-1',
      ...REGISTER_BASE,
    });
    const second = await service.register(scenario.candidate, {
      correlationId: 'corr-release-2',
      idempotencyKey: 'idem-release-2',
      releaseVersion: '2.0.1',
      recordedAt: T1,
      provenance: { releasedBy: 'release-bot', notes: null },
    });
    expect(second.release!.version).toBe('2.0.1');
    expect(service.listRecords()).toHaveLength(2);
  });
});

describe('BodyRegistryService — lifecycle + publication projections', () => {
  async function makeRegisteredService() {
    const scenario = await makeScenario();
    const service = new BodyRegistryService({ stores: scenario.stores });
    const record = await service.register(scenario.candidate, {
      correlationId: 'corr-release-1',
      idempotencyKey: 'idem-release-1',
      ...REGISTER_BASE,
    });
    return { scenario, service, record };
  }

  it('a fresh release is registered and unpublished', async () => {
    const { service, record } = await makeRegisteredService();
    const status = service.resolveReleaseStatus(record.release!);
    expect(status.state).toBe('registered');
    expect(status.visibility).toBe('unpublished');
    expect(status.registration?.digest).toBe(record.digest);
  });

  it('publish → published; retract → unpublished (append-only)', async () => {
    const { service, record } = await makeRegisteredService();
    const publication = await service.publish(record.digest, {
      publisher: PUBLISHER,
      rights: RIGHTS,
      publishedAt: T2,
    });
    expect(publication.action).toBe('publish');
    expect(service.resolveReleaseStatus(record.release!).visibility).toBe('published');

    const retraction = await service.retract(publication.digest, {
      publisher: PUBLISHER,
      retractedAt: T3,
    });
    expect(retraction.action).toBe('retract');
    expect(service.resolveReleaseStatus(record.release!).visibility).toBe('unpublished');
  });

  it('publishing is idempotent: the identical publication replays', async () => {
    const { service, record } = await makeRegisteredService();
    const first = await service.publish(record.digest, {
      publisher: PUBLISHER,
      rights: RIGHTS,
      publishedAt: T2,
    });
    const second = await service.publish(record.digest, {
      publisher: PUBLISHER,
      rights: RIGHTS,
      publishedAt: T2,
    });
    expect(second.digest).toBe(first.digest);
    expect(service.getPublicationLedger().records).toHaveLength(1);
  });

  it('supersession moves the active release and records grounds', async () => {
    const { scenario, service } = await makeRegisteredService();
    const successor = await service.register(scenario.candidate, {
      correlationId: 'corr-release-2',
      idempotencyKey: 'idem-release-2',
      releaseVersion: '2.1.0',
      recordedAt: T2,
      provenance: { releasedBy: 'release-bot', notes: null },
    });
    const prior = service.listRegistrations('acme', 'structural-engineer-body')[0]!;
    const supersession = await service.supersede(prior.digest, {
      correlationId: 'corr-release-3',
      idempotencyKey: 'idem-release-3',
      grounds: 'superseded by release 2.1.0 (security refresh)',
      recordedAt: T3,
      provenance: { releasedBy: 'release-bot', notes: null },
    });
    expect(supersession.kind).toBe('release-supersession');
    expect(service.projectLifecycle(prior.digest)).toBe('superseded');
    expect(service.projectLifecycle(successor.digest)).toBe('registered');
    expect(service.resolveActiveRelease('acme', 'structural-engineer-body', 'stable')?.digest).toBe(
      successor.digest,
    );
  });

  it('retirement ends the release lifecycle (append-only, terminal)', async () => {
    const { service, record } = await makeRegisteredService();
    const retirement = await service.retire(record.digest, {
      correlationId: 'corr-release-3',
      idempotencyKey: 'idem-release-3',
      grounds: 'end-of-life: substrate family retired',
      recordedAt: T3,
      provenance: { releasedBy: 'release-bot', notes: null },
    });
    expect(retirement.kind).toBe('release-retirement');
    expect(service.projectLifecycle(record.digest)).toBe('retired');
    expect(service.resolveActiveRelease('acme', 'structural-engineer-body', 'stable')).toBeNull();
    // Terminal: a retired release cannot be superseded afterwards.
    await expect(
      service.supersede(record.digest, {
        correlationId: 'corr-release-4',
        idempotencyKey: 'idem-release-4',
        grounds: 'late supersession attempt',
        recordedAt: T3,
        provenance: { releasedBy: 'release-bot', notes: null },
      }),
    ).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string }).code === 'BODY_REGISTRY_LINEAGE_VIOLATION',
    );
  });

  it('publishing an UNKNOWN record digest fails closed', async () => {
    const { service } = await makeRegisteredService();
    await expect(
      service.publish('deadbeef'.repeat(8), { publisher: PUBLISHER, rights: RIGHTS, publishedAt: T2 }),
    ).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string }).code === 'BODY_REGISTRY_NOT_FOUND',
    );
  });

  it('queries: registrations by body + channel projection', async () => {
    const { scenario, service } = await makeRegisteredService();
    const devRelease = await service.register(
      { ...scenario.candidate, channel: 'development' },
      {
        correlationId: 'corr-release-dev',
        idempotencyKey: 'idem-release-dev',
        releaseVersion: '2.0.0-dev',
        recordedAt: T2,
        provenance: { releasedBy: 'release-bot', notes: null },
      },
    );
    expect(devRelease.channel).toBe('development');
    expect(service.listRegistrations('acme', 'structural-engineer-body')).toHaveLength(2);
    expect(
      service.resolveActiveRelease('acme', 'structural-engineer-body', 'development')?.digest,
    ).toBe(devRelease.digest);
  });
});

describe('BodyRegistryEnvelopeService — wire round trips', () => {
  it('register-release-command → release-registered-event', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryEnvelopeService({
      fabric: new BodyRegistryService({ stores: scenario.stores }),
    });
    const correlationId = newCorrelationId();
    const idempotencyKey = newIdempotencyKey();
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
        tags: ['production'],
        certificationRefs: [scenario.certification.digest],
        compatibilityRefs: [scenario.compatibility.recordDigest],
        forgeRecordDigest: null,
      },
      { correlationId, idempotencyKey },
    );
    const outcome = await service.handleRegisterReleaseCommand(JSON.stringify(command), {
      recordedAt: T1,
      provenance: { releasedBy: 'release-bot', notes: null },
    });
    expect(outcome.record.release!.version).toBe('2.0.0');
    const parsed = parseReleaseRegisteredEvent(outcome.serializedEvent);
    expect(parsed.payload.releaseRecordDigest).toBe(outcome.record.digest);
    expect(parsed.correlationId).toBe(correlationId);
  });

  it('publish-release-command → release-published-event', async () => {
    const scenario = await makeScenario();
    const fabric = new BodyRegistryService({ stores: scenario.stores });
    const record = await fabric.register(scenario.candidate, {
      correlationId: 'corr-release-1',
      idempotencyKey: 'idem-release-1',
      ...REGISTER_BASE,
    });
    const service = new BodyRegistryEnvelopeService({ fabric });
    const command = makePublishReleaseCommand(
      { releaseRecordDigest: record.digest, publisher: PUBLISHER, rights: RIGHTS, publishedAt: T2 },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    const outcome = await service.handlePublishReleaseCommand(JSON.stringify(command));
    expect(outcome.publication.action).toBe('publish');
    const parsed = parseReleasePublishedEvent(outcome.serializedEvent);
    expect(parsed.payload.publicationRecordDigest).toBe(outcome.publication.digest);
  });

  it('the wire round trip is idempotent end-to-end (replay returns the stored record)', async () => {
    const scenario = await makeScenario();
    const service = new BodyRegistryEnvelopeService({
      fabric: new BodyRegistryService({ stores: scenario.stores }),
    });
    const correlationId = newCorrelationId();
    const idempotencyKey = newIdempotencyKey();
    const payload = {
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
    };
    const command = JSON.stringify(
      makeRegisterReleaseCommand(payload, { correlationId, idempotencyKey }),
    );
    const first = await service.handleRegisterReleaseCommand(command, {
      recordedAt: T1,
      provenance: { releasedBy: 'release-bot', notes: null },
    });
    const replay = await service.handleRegisterReleaseCommand(command, {
      recordedAt: T1,
      provenance: { releasedBy: 'release-bot', notes: null },
    });
    expect(replay.record.digest).toBe(first.record.digest);
    expect(service.fabric.listRecords()).toHaveLength(1);
  });
});
