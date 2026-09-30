/**
 * Positive tests for @arena/api-fabric (Work Order A025) — ingest,
 * envelope-wired round trips and the tenant-scoped query projections.
 */

import { describe, expect, it } from 'vitest';
import {
  apiQueryRequest,
  createArenaApiClient,
  createLoopbackTransport,
  toApiReadScope,
} from '@arena/arena-sdk';
import { serializeEnvelope, toCorrelationId } from '@arena/protocol-core';
import { ApiFabric } from './fabric.js';
import { ApiService } from './service.js';
import {
  makeScenario,
  makeSupersession,
  makeRetirement,
  makeRevocation,
  makeBodyVersion,
  makeSuite,
  makeCertification,
  makeCompatibility,
  makeReleaseRegistration,
  BODY_NAME,
  OTHER_TENANT,
  TENANT,
} from './test-support.js';

async function populatedFabric(): Promise<{ fabric: ApiFabric; scenario: Awaited<ReturnType<typeof makeScenario>> }> {
  const scenario = await makeScenario();
  const fabric = new ApiFabric();
  fabric.putBodyVersion(scenario.bodyVersion);
  fabric.putCertificationSuite(scenario.suite);
  fabric.putCertificationRecord(scenario.certification);
  fabric.putCompatibilityRecord(scenario.compatibility);
  fabric.putReleaseRecord(scenario.registration);
  fabric.putReleasePublication(scenario.publication);
  return { fabric, scenario };
}

describe('ingest — guard-validated, idempotent by digest', () => {
  it('accepts the authoritative sibling records and counts them', async () => {
    const { fabric } = await populatedFabric();
    expect(fabric.counts()).toEqual({
      releaseRecords: 1,
      publications: 1,
      certificationRecords: 1,
      suites: 1,
      compatibilityRecords: 1,
      bodyVersions: 1,
    });
  });

  it('re-ingesting the same record is a no-op (content-addressed idempotency)', async () => {
    const { fabric, scenario } = await populatedFabric();
    fabric.putReleaseRecord(scenario.registration);
    fabric.putCertificationRecord(scenario.certification);
    expect(fabric.counts()['releaseRecords']).toBe(1);
    expect(fabric.counts()['certificationRecords']).toBe(1);
  });
});

describe('fabric dispatch — the closed query vocabulary, scoped', () => {
  it('answers every registry read with the authoritative record', async () => {
    const { fabric, scenario } = await populatedFabric();
    const scope = toApiReadScope(TENANT);

    const release = await fabric.handleQueryRequest(
      apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, scope),
    );
    expect(release.kind).toBe('get-release-record');
    expect(release.result).toStrictEqual(scenario.registration);

    const certification = await fabric.handleQueryRequest(
      apiQueryRequest('get-certification-record', { digest: scenario.certification.digest }, scope),
    );
    expect(certification.result).toStrictEqual(scenario.certification);

    const suite = await fabric.handleQueryRequest(
      apiQueryRequest('get-certification-suite', { suiteRef: scenario.suite.digest }, scope),
    );
    expect(suite.result).toStrictEqual(scenario.suite);

    const compatibility = await fabric.handleQueryRequest(
      apiQueryRequest('get-compatibility-record', { digest: scenario.compatibility.recordDigest }, scope),
    );
    expect(compatibility.result).toStrictEqual(scenario.compatibility);

    const bodyVersion = await fabric.handleQueryRequest(
      apiQueryRequest('get-body-version', { digest: scenario.bodyVersion.digest }, scope),
    );
    expect(bodyVersion.result).toStrictEqual(scenario.bodyVersion);

    const publication = await fabric.handleQueryRequest(
      apiQueryRequest('get-release-publication', { digest: scenario.publication.digest }, scope),
    );
    expect(publication.result).toStrictEqual(scenario.publication);
  });

  it('answers unknown digests with null (not-found is a value, not an error)', async () => {
    const { fabric } = await populatedFabric();
    const scope = toApiReadScope(TENANT);
    const miss = await fabric.handleQueryRequest(
      apiQueryRequest('get-release-record', { digest: 'e'.repeat(64) }, scope),
    );
    expect(miss.result).toBeNull();
  });

  it('lists scoped records and body registrations', async () => {
    const { fabric, scenario } = await populatedFabric();
    const scope = toApiReadScope(TENANT);
    const releases = await fabric.handleQueryRequest(
      apiQueryRequest('list-release-records', {}, scope),
    );
    expect(releases.result).toHaveLength(1);

    const registrations = await fabric.handleQueryRequest(
      apiQueryRequest('list-body-registrations', { tenant: TENANT, name: BODY_NAME }, scope),
    );
    expect(registrations.result).toHaveLength(1);

    const bySuite = await fabric.handleQueryRequest(
      apiQueryRequest('list-certifications-by-suite', { suiteRef: scenario.suite.digest }, scope),
    );
    expect(bySuite.result).toHaveLength(1);
  });

  it('resolves the active release and the compound release status', async () => {
    const { fabric, scenario } = await populatedFabric();
    const scope = toApiReadScope(TENANT);

    const active = await fabric.handleQueryRequest(
      apiQueryRequest('resolve-active-release', { tenant: TENANT, name: BODY_NAME, channel: 'stable' }, scope),
    );
    expect(active.result).toStrictEqual(scenario.registration);

    const status = await fabric.handleQueryRequest(
      apiQueryRequest(
        'resolve-release-status',
        { namespace: TENANT, name: BODY_NAME, version: scenario.registration.release?.version ?? '2.0.0' },
        scope,
      ),
    );
    const statusValue = status.result as { state: string; visibility: string };
    expect(statusValue.state).toBe('registered');
    expect(statusValue.visibility).toBe('published');
  });

  it('resolves the current certification of a composition under test', async () => {
    const { fabric, scenario } = await populatedFabric();
    const scope = toApiReadScope(TENANT);
    const subject = scenario.certification.subject!;
    const current = await fabric.handleQueryRequest(
      apiQueryRequest('current-certification', { subject }, scope),
    );
    expect(current.result).toStrictEqual(scenario.certification);
  });

  it('resolves the latest compatibility verdict for a body × substrate pair', async () => {
    const { fabric, scenario } = await populatedFabric();
    const scope = toApiReadScope(TENANT);
    const verdict = await fabric.handleQueryRequest(
      apiQueryRequest(
        'latest-compatibility-verdict',
        {
          bodyVersionRef: `${TENANT}/${BODY_NAME}@${scenario.bodyVersion.version}#${scenario.bodyVersion.digest}`,
          substrateRef: 'substrate-x@6.0.1#bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
        scope,
      ),
    );
    expect(verdict.result).toStrictEqual(scenario.compatibility);
  });
});

describe('lineage projections (append-only supersession / retirement / revocation)', () => {
  it('supersession ends the active release but keeps history addressable', async () => {
    const { fabric, scenario } = await populatedFabric();
    const scope = toApiReadScope(TENANT);
    const supersession = await makeSupersession(scenario.registration);
    fabric.putReleaseRecord(supersession);

    const active = await fabric.handleQueryRequest(
      apiQueryRequest('resolve-active-release', { tenant: TENANT, name: BODY_NAME, channel: 'stable' }, scope),
    );
    expect(active.result).toBeNull();

    const status = await fabric.handleQueryRequest(
      apiQueryRequest(
        'resolve-release-status',
        { namespace: TENANT, name: BODY_NAME, version: scenario.registration.release?.version ?? '2.0.0' },
        scope,
      ),
    );
    expect((status.result as { state: string }).state).toBe('superseded');
    // append-only: the superseded registration stays addressable forever
    const stillAddressable = await fabric.handleQueryRequest(
      apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, scope),
    );
    expect(stillAddressable.result).toStrictEqual(scenario.registration);
  });

  it('retirement projects the retired state', async () => {
    const { fabric, scenario } = await populatedFabric();
    const scope = toApiReadScope(TENANT);
    const retirement = await makeRetirement(scenario.registration);
    fabric.putReleaseRecord(retirement);

    const status = await fabric.handleQueryRequest(
      apiQueryRequest(
        'resolve-release-status',
        { namespace: TENANT, name: BODY_NAME, version: scenario.registration.release?.version ?? '2.0.0' },
        scope,
      ),
    );
    expect((status.result as { state: string }).state).toBe('retired');
  });

  it('revocation ends the current certification (revoked dominates)', async () => {
    const { fabric, scenario } = await populatedFabric();
    const scope = toApiReadScope(TENANT);
    const revocation = await makeRevocation(scenario.certification);
    fabric.putCertificationRecord(revocation);

    const current = await fabric.handleQueryRequest(
      apiQueryRequest('current-certification', { subject: scenario.certification.subject! }, scope),
    );
    expect(current.result).toBeNull();
    // append-only: the revoked run stays addressable
    const stillAddressable = await fabric.handleQueryRequest(
      apiQueryRequest('get-certification-record', { digest: scenario.certification.digest }, scope),
    );
    expect(stillAddressable.result).toStrictEqual(scenario.certification);
  });

  it('a NEWER registration becomes the active release', async () => {
    const { fabric, scenario } = await populatedFabric();
    const scope = toApiReadScope(TENANT);
    const supersession = await makeSupersession(scenario.registration);
    fabric.putReleaseRecord(supersession);

    const bodyV2 = await makeBodyVersion('1.5.0');
    const suite = await makeSuite();
    const certification2 = await makeCertification(bodyV2, suite, '2');
    const compatibility2 = await makeCompatibility(bodyV2);
    const registration2 = await makeReleaseRegistration(
      bodyV2,
      certification2,
      compatibility2,
      { releaseVersion: '2.1.0', suffix: '2', releasedAt: '2026-09-30T08:20:00.000Z' },
    );
    fabric.putReleaseRecord(registration2);

    const active = await fabric.handleQueryRequest(
      apiQueryRequest('resolve-active-release', { tenant: TENANT, name: BODY_NAME, channel: 'stable' }, scope),
    );
    expect(active.result).toStrictEqual(registration2);
  });
});

describe('public/private visibility', () => {
  it('tenant-scoped records are invisible to other tenants (lists filter, gets fail closed)', async () => {
    const { fabric, scenario } = await populatedFabric();
    const foreignScope = toApiReadScope(OTHER_TENANT);

    const releases = await fabric.handleQueryRequest(
      apiQueryRequest('list-release-records', {}, foreignScope),
    );
    expect(releases.result).toHaveLength(0);

    await expect(
      fabric.handleQueryRequest(
        apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, foreignScope),
      ),
    ).rejects.toThrow(/cross-tenant/);
  });

  it('records with a NULL tenant are globally visible (public records)', async () => {
    const scenario = await makeScenario({ tenantId: null });
    const fabric = new ApiFabric();
    fabric.putReleaseRecord(scenario.registration);
    const foreignScope = toApiReadScope(OTHER_TENANT);
    const release = await fabric.handleQueryRequest(
      apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, foreignScope),
    );
    expect(release.result).toStrictEqual(scenario.registration);
  });

  it('the reserved public scope sees only public records', async () => {
    const { fabric, scenario } = await populatedFabric();
    const publicScope = toApiReadScope('public');
    const releases = await fabric.handleQueryRequest(
      apiQueryRequest('list-release-records', {}, publicScope),
    );
    expect(releases.result).toHaveLength(0);
    await expect(
      fabric.handleQueryRequest(
        apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, publicScope),
      ),
    ).rejects.toThrow(/cross-tenant/);
  });

  it('listing another tenant body registrations fails closed', async () => {
    const { fabric } = await populatedFabric();
    const scope = toApiReadScope(OTHER_TENANT);
    await expect(
      fabric.handleQueryRequest(
        apiQueryRequest('list-body-registrations', { tenant: TENANT, name: BODY_NAME }, scope),
      ),
    ).rejects.toThrow(/not addressable/);
  });
});

describe('ApiService — the envelope-wired facade', () => {
  it('handles a wire query end-to-end and emits a paired response envelope', async () => {
    const { fabric, scenario } = await populatedFabric();
    const service = new ApiService({ fabric });
    const request = service.makeQuery(
      apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, toApiReadScope(TENANT)),
      'corr-service-1',
    );
    const outcome = await service.handleQueryRequest(serializeEnvelope(request));
    expect(outcome.request.correlationId).toBe(toCorrelationId('corr-service-1'));
    expect(outcome.response.correlationId).toBe(toCorrelationId('corr-service-1'));
    expect(outcome.response.kind).toBe('response');
    expect(outcome.result).toStrictEqual(scenario.registration);
    // consumer-side pairing guard accepts the emitted response
    expect(service.readQueryResponseFor(outcome.serializedResponse, request)).toStrictEqual(
      scenario.registration,
    );
  });

  it('a response answering a DIFFERENT request is rejected by the pairing guard', async () => {
    const { fabric, scenario } = await populatedFabric();
    const service = new ApiService({ fabric });
    const requestOne = service.makeQuery(
      apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, toApiReadScope(TENANT)),
      'corr-one',
    );
    const requestTwo = service.makeQuery(
      apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, toApiReadScope(TENANT)),
      'corr-two',
    );
    const outcome = await service.handleQueryRequest(serializeEnvelope(requestOne));
    expect(() =>
      service.readQueryResponseFor(outcome.serializedResponse, requestTwo),
    ).toThrow();
  });

  it('the SDK client runs against the fabric through the loopback transport (full stack)', async () => {
    const { fabric, scenario } = await populatedFabric();
    const client = createArenaApiClient(createLoopbackTransport(fabric), TENANT);
    const release = await client.getReleaseRecord(scenario.registration.digest);
    expect(release?.digest).toBe(scenario.registration.digest);
    const status = await client.resolveReleaseStatus(
      TENANT,
      BODY_NAME,
      scenario.registration.release?.version ?? '2.0.0',
    );
    expect(status.state).toBe('registered');
    expect(status.visibility).toBe('published');
  });
});
