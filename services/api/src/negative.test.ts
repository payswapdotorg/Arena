/**
 * Negative / adversarial tests for @arena/api-fabric (Work Order A025)
 * — malformed ingest, malformed wire queries, scope violations,
 * envelope-kind discipline breaks, tamper probes. Every failure must
 * surface as a typed ArenaApiError (fail-closed; nothing partial).
 */

import { describe, expect, it } from 'vitest';
import {
  apiQueryRequest,
  toApiReadScope,
  ArenaApiError,
} from '@arena/arena-sdk';
import { makeEnvelope, serializeEnvelope, toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { ApiFabric } from './fabric.js';
import { ApiService } from './service.js';
import { makeScenario, BODY_NAME, TENANT, OTHER_TENANT } from './test-support.js';

const DIGEST = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function populatedService(): Promise<ApiService> {
  const scenario = await makeScenario();
  const fabric = new ApiFabric();
  fabric.putBodyVersion(scenario.bodyVersion);
  fabric.putCertificationSuite(scenario.suite);
  fabric.putCertificationRecord(scenario.certification);
  fabric.putCompatibilityRecord(scenario.compatibility);
  fabric.putReleaseRecord(scenario.registration);
  fabric.putReleasePublication(scenario.publication);
  return new ApiService({ fabric });
}

describe('adversarial ingest — foreign or malformed records are rejected', () => {
  it('rejects non-records of every kind', () => {
    const fabric = new ApiFabric();
    for (const put of [
      () => fabric.putReleaseRecord({ nope: true }),
      () => fabric.putReleaseRecord(null),
      () => fabric.putReleaseRecord('string'),
      () => fabric.putReleasePublication(42),
      () => fabric.putCertificationRecord({ digest: DIGEST }),
      () => fabric.putCertificationSuite([]),
      () => fabric.putCompatibilityRecord({ recordDigest: DIGEST }),
      () => fabric.putBodyVersion({ body: { tenant: 'acme' } }),
    ]) {
      expect(put).toThrow(ArenaApiError);
      expect(put).toThrow(/not a structurally valid/);
    }
    // a validly-shaped record with a TAMPERED digest is still structurally
    // rejected by the owning guard (record integrity is the sibling's law)
    expect(() => fabric.putReleaseRecord({ digest: 'not-hex' })).toThrow(ArenaApiError);
  });
});

describe('adversarial query dispatch — closed vocabulary, strict params', () => {
  it('rejects structurally invalid query payloads', async () => {
    const fabric = new ApiFabric();
    await expect(fabric.handleQueryRequest(null as never)).rejects.toThrow(ArenaApiError);
    await expect(fabric.handleQueryRequest({ kind: 'nope' } as never)).rejects.toThrow(
      ArenaApiError,
    );
  });

  it('rejects per-kind param violations at the constructor (bad digests, bad channels, bad tenants)', () => {
    const fabric = new ApiFabric();
    void fabric;
    const scope = toApiReadScope(TENANT);
    expect(() =>
      apiQueryRequest('get-release-record', { digest: 'nope' } as never, scope),
    ).toThrow(/invalid params/);
    expect(() =>
      apiQueryRequest(
        'resolve-active-release',
        { tenant: TENANT, name: BODY_NAME, channel: 'beta' } as never,
        scope,
      ),
    ).toThrow(ArenaApiError);
    expect(() =>
      apiQueryRequest('list-body-registrations', { tenant: 'NOPE', name: BODY_NAME } as never, scope),
    ).toThrow(ArenaApiError);
    expect(() =>
      apiQueryRequest('current-certification', { subject: null } as never, scope),
    ).toThrow(ArenaApiError);
  });

  it('the fabric itself rejects invalid payloads that bypass the constructor (fail-closed)', async () => {
    const fabric = new ApiFabric();
    const scope = toApiReadScope(TENANT);
    await expect(
      fabric.handleQueryRequest({
        requestVersion: 1,
        kind: 'get-release-record',
        params: { digest: 'nope' },
        scope,
      } as never),
    ).rejects.toThrow(ArenaApiError);
    await expect(
      fabric.handleQueryRequest({
        requestVersion: 1,
        kind: 'exfiltrate-everything',
        params: {},
        scope,
      } as never),
    ).rejects.toThrow(ArenaApiError);
  });

  it('rejects unknown query kinds BEFORE dispatch (closed vocabulary)', () => {
    const scope = toApiReadScope(TENANT);
    expect(() =>
      apiQueryRequest('exfiltrate-everything' as never, {}, scope),
    ).toThrow(/unknown arena api query kind/);
  });
});

describe('adversarial wire queries — the envelope-wired facade', () => {
  it('rejects malformed JSON and non-envelope payloads', async () => {
    const service = await populatedService();
    await expect(service.handleQueryRequest('not json at all')).rejects.toThrow(ArenaApiError);
    await expect(service.handleQueryRequest(JSON.stringify({ nope: true }))).rejects.toThrow(
      ArenaApiError,
    );
    await expect(service.handleQueryRequest('')).rejects.toThrow(ArenaApiError);
  });

  it('rejects a valid payload in a COMMAND envelope (reads are not commands)', async () => {
    const service = await populatedService();
    const payload = apiQueryRequest('get-release-record', { digest: DIGEST }, toApiReadScope(TENANT));
    const asCommand = makeEnvelope({
      kind: 'command',
      schema: 'arena:schema/api/api-query-request@1.0.0',
      payload,
      correlationId: toCorrelationId('corr-adversarial-1'),
      idempotencyKey: toIdempotencyKey('idem-adversarial-1'),
    });
    await expect(service.handleQueryRequest(serializeEnvelope(asCommand))).rejects.toThrow(
      /must travel in a 'query' envelope/,
    );
  });

  it('rejects a foreign-namespace schema (schema pinning)', async () => {
    const service = await populatedService();
    const payload = apiQueryRequest('get-release-record', { digest: DIGEST }, toApiReadScope(TENANT));
    const foreign = makeEnvelope({
      kind: 'query',
      schema: 'arena:schema/certification/run-certification-command@1.0.0',
      payload,
      correlationId: toCorrelationId('corr-adversarial-2'),
      idempotencyKey: null,
    });
    await expect(service.handleQueryRequest(serializeEnvelope(foreign))).rejects.toThrow(
      ArenaApiError,
    );
  });

  it('cross-tenant wire queries fail closed with the typed scope error', async () => {
    const service = await populatedService();
    const scenario = await makeScenario();
    const request = service.makeQuery(
      apiQueryRequest('get-release-record', { digest: scenario.registration.digest }, toApiReadScope(OTHER_TENANT)),
      'corr-adversarial-3',
    );
    await expect(service.handleQueryRequest(serializeEnvelope(request))).rejects.toThrow(
      /cross-tenant/,
    );
  });

  it('consumer-side parsing rejects wrong-kind response envelopes', async () => {
    const service = await populatedService();
    const payload = { responseVersion: 1, kind: 'get-release-record', result: null };
    const asEvent = makeEnvelope({
      kind: 'event',
      schema: 'arena:schema/api/api-query-response@1.0.0',
      payload,
      correlationId: toCorrelationId('corr-adversarial-4'),
      idempotencyKey: null,
    });
    expect(() => service.readQueryResponse(serializeEnvelope(asEvent))).toThrow(
      /must travel in a 'response' envelope/,
    );
  });

  it('a tampered response body (extra field) is rejected by the strict payload guard', async () => {
    const service = await populatedService();
    const payload = { responseVersion: 1, kind: 'get-release-record', result: null, extra: 'nope' };
    const tampered = makeEnvelope({
      kind: 'response',
      schema: 'arena:schema/api/api-query-response@1.0.0',
      payload,
      correlationId: toCorrelationId('corr-adversarial-5'),
      idempotencyKey: null,
    });
    expect(() => service.readQueryResponse(serializeEnvelope(tampered))).toThrow(ArenaApiError);
  });
});

describe('scope discipline — the public/private boundary', () => {
  it('unscoped reads are unrepresentable (scope is required by construction)', () => {
    expect(() => apiQueryRequest('list-release-records', {}, {} as never)).toThrow(
      /requires a valid read scope/,
    );
  });

  it('a foreign tenant cannot resolve another tenant active release', async () => {
    const fabric = new ApiFabric();
    const scenario = await makeScenario();
    fabric.putReleaseRecord(scenario.registration);
    await expect(
      fabric.handleQueryRequest(
        apiQueryRequest('resolve-active-release', { tenant: TENANT, name: BODY_NAME, channel: 'stable' }, toApiReadScope(OTHER_TENANT)),
      ),
    ).rejects.toThrow(/not addressable/);
  });

  it('a foreign tenant cannot read another tenant body version', async () => {
    const fabric = new ApiFabric();
    const scenario = await makeScenario();
    fabric.putBodyVersion(scenario.bodyVersion);
    await expect(
      fabric.handleQueryRequest(
        apiQueryRequest('get-body-version', { digest: scenario.bodyVersion.digest }, toApiReadScope(OTHER_TENANT)),
      ),
    ).rejects.toThrow(/cross-tenant/);
  });

  it('compatibility records scoped to a tenant are invisible to others', async () => {
    const fabric = new ApiFabric();
    const scenario = await makeScenario();
    const scopedRecord = { ...scenario.compatibility, tenantId: TENANT, workspaceId: 'ws-main' };
    fabric.putCompatibilityRecord(scopedRecord);
    await expect(
      fabric.handleQueryRequest(
        apiQueryRequest('get-compatibility-record', { digest: scenario.compatibility.recordDigest }, toApiReadScope(OTHER_TENANT)),
      ),
    ).rejects.toThrow(/cross-tenant/);
    const own = await fabric.handleQueryRequest(
      apiQueryRequest('get-compatibility-record', { digest: scenario.compatibility.recordDigest }, toApiReadScope(TENANT)),
    );
    expect(own.result).not.toBeNull();
  });
});
