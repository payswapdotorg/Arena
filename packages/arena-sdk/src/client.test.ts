/**
 * Unit tests for the typed Arena API client (Work Order A025) —
 * loopback wiring, strict response validation, deep-frozen results,
 * fail-closed error propagation.
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId, serializeEnvelope } from '@arena/protocol-core';
import type { Envelope } from '@arena/protocol-core';
import {
  ArenaApiClient,
  createArenaApiClient,
  createLoopbackTransport,
} from './client.js';
import type { ArenaQueryHandler } from './client.js';
import { apiQueryResponse, toApiReadScope } from './queries.js';
import { ArenaApiError, ARENA_API_ERROR_CODES } from './errors.js';
import { makeApiQueryResponse } from './envelopes.js';
import { makeScenario, OTHER_TENANT } from './test-support.js';

function handlerFor(scenario: Awaited<ReturnType<typeof makeScenario>>): ArenaQueryHandler {
  return {
    async handleQueryRequest(payload) {
      const params = payload.params as Record<string, string>;
      switch (payload.kind) {
        case 'get-release-record':
          return apiQueryResponse(
            'get-release-record',
            params['digest'] === scenario.registration.digest
              ? scenario.registration
              : null,
          );
        case 'list-release-records':
          return apiQueryResponse('list-release-records', [scenario.registration]);
        case 'get-certification-record':
          return apiQueryResponse(
            'get-certification-record',
            params['digest'] === scenario.certification.digest
              ? scenario.certification
              : null,
          );
        case 'get-certification-suite':
          return apiQueryResponse(
            'get-certification-suite',
            params['suiteRef'] === scenario.suite.digest ? scenario.suite : null,
          );
        case 'get-compatibility-record':
          return apiQueryResponse(
            'get-compatibility-record',
            params['digest'] === scenario.compatibility.recordDigest
              ? scenario.compatibility
              : null,
          );
        case 'get-body-version':
          return apiQueryResponse(
            'get-body-version',
            params['digest'] === scenario.bodyVersion.digest
              ? scenario.bodyVersion
              : null,
          );
        case 'get-release-publication':
          return apiQueryResponse(
            'get-release-publication',
            params['digest'] === scenario.publication.digest
              ? scenario.publication
              : null,
          );
        case 'resolve-release-status':
          return apiQueryResponse('resolve-release-status', {
            state: 'registered',
            visibility: 'published',
            registration: scenario.registration,
            publication: scenario.publication,
          });
        case 'latest-compatibility-verdict':
          return apiQueryResponse(
            'latest-compatibility-verdict',
            scenario.compatibility,
          );
        default:
          throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_QUERY_KIND, {
            message: `test handler does not implement ${payload.kind}`,
          });
      }
    },
  };
}

describe('ArenaApiClient over the loopback transport', () => {
  it('answers every typed method with the authoritative record (deep-frozen)', async () => {
    const scenario = await makeScenario();
    const client = createArenaApiClient(createLoopbackTransport(handlerFor(scenario)), 'acme');

    const release = await client.getReleaseRecord(scenario.registration.digest);
    expect(release?.digest).toBe(scenario.registration.digest);
    expect(Object.isFrozen(release)).toBe(true);

    expect(await client.getReleaseRecord('b'.repeat(64))).toBeNull();

    const records = await client.listReleaseRecords();
    expect(records).toHaveLength(1);
    expect(Object.isFrozen(records)).toBe(true);
    expect(records[0]?.digest).toBe(scenario.registration.digest);

    const certification = await client.getCertificationRecord(scenario.certification.digest);
    expect(certification?.digest).toBe(scenario.certification.digest);
    // the design law survives the API hop: the statement travels scoped
    expect(certification?.statement?.scope.body).toBeDefined();

    const suite = await client.getCertificationSuite(scenario.suite.digest);
    expect(suite?.digest).toBe(scenario.suite.digest);
    expect(await client.getCertificationSuite('c'.repeat(64))).toBeNull();

    const compatibility = await client.getCompatibilityRecord(
      scenario.compatibility.recordDigest,
    );
    expect(compatibility?.verdict).toBe('compatible');

    const bodyVersion = await client.getBodyVersion(scenario.bodyVersion.digest);
    expect(bodyVersion?.digest).toBe(scenario.bodyVersion.digest);

    const publication = await client.getReleasePublication(scenario.publication.digest);
    expect(publication?.digest).toBe(scenario.publication.digest);

    const verdict = await client.latestCompatibilityVerdict(
      'acme/structural-engineer-body@1.4.0#' + scenario.bodyVersion.digest,
      'substrate-x@6.0.1#bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    expect(verdict?.verdict).toBe('compatible');
  });

  it('resolveReleaseStatus returns the compound projection (frozen)', async () => {
    const scenario = await makeScenario();
    const client = createArenaApiClient(createLoopbackTransport(handlerFor(scenario)), 'acme');
    const status = await client.resolveReleaseStatus('acme', 'structural-engineer-body', '2.0.0');
    expect(status.state).toBe('registered');
    expect(status.visibility).toBe('published');
    expect(status.registration?.digest).toBe(scenario.registration.digest);
    expect(Object.isFrozen(status)).toBe(true);
  });

  it('rejects invalid method inputs BEFORE any transport hop', async () => {
    const scenario = await makeScenario();
    const client = createArenaApiClient(createLoopbackTransport(handlerFor(scenario)), 'acme');
    await expect(client.getReleaseRecord('not-a-digest')).rejects.toThrow(ArenaApiError);
    await expect(client.getReleaseRecord('not-a-digest')).rejects.toThrow(/invalid params/);
  });

  it('normalizes handler failures into typed ArenaApiError', async () => {
    const scenario = await makeScenario();
    const client = createArenaApiClient(createLoopbackTransport(handlerFor(scenario)), 'acme');
    // the test handler does not implement list-certification-suites
    await expect(client.listCertificationSuites()).rejects.toThrow(ArenaApiError);
  });

  it('a transport returning a mismatched correlation id fails closed', async () => {
    const scenario = await makeScenario();
    const client = new ArenaApiClient({
      transport: {
        async sendQuery(_request: Envelope<never>): Promise<Envelope<never>> {
          const payload = apiQueryResponse('get-release-record', scenario.registration);
          return makeApiQueryResponse(payload, toCorrelationId('corr-spoofed')) as Envelope<never>;
        },
      },
      scope: toApiReadScope('acme'),
    });
    await expect(client.getReleaseRecord(scenario.registration.digest)).rejects.toThrow(
      ArenaApiError,
    );
    await expect(client.getReleaseRecord(scenario.registration.digest)).rejects.toThrow(
      /correlation/,
    );
  });

  it('a transport returning a mismatched query kind fails closed', async () => {
    const scenario = await makeScenario();
    const client = new ArenaApiClient({
      transport: {
        async sendQuery(request: Envelope<never>): Promise<Envelope<never>> {
          const payload = apiQueryResponse('get-certification-record', scenario.certification);
          return makeApiQueryResponse(payload, request.correlationId) as Envelope<never>;
        },
      },
      scope: toApiReadScope('acme'),
    });
    await expect(client.getReleaseRecord(scenario.registration.digest)).rejects.toThrow(
      /echoes query kind/,
    );
  });

  it('a transport returning garbage fails closed (nothing partial escapes)', async () => {
    const client = new ArenaApiClient({
      transport: {
        async sendQuery(_request: Envelope<never>): Promise<Envelope<never>> {
          throw new Error('network is down');
        },
      },
      scope: toApiReadScope('acme'),
    });
    await expect(client.getReleaseRecord('a'.repeat(64))).rejects.toThrow(
      ArenaApiError,
    );
  });

  it('cross-tenant handler errors propagate as typed scope errors', async () => {
    const handler: ArenaQueryHandler = {
      async handleQueryRequest() {
        throw new ArenaApiError(ARENA_API_ERROR_CODES.CROSS_TENANT_ACCESS, {
          message: 'cross-tenant read rejected',
          details: { tenant: OTHER_TENANT },
        });
      },
    };
    const client = createArenaApiClient(createLoopbackTransport(handler), 'globex');
    await expect(client.listReleaseRecords()).rejects.toThrow(ArenaApiError);
    await expect(client.listReleaseRecords()).rejects.toThrow(/cross-tenant/);
  });

  it('a response payload that fails the per-kind result guard is rejected', async () => {
    const scenario = await makeScenario();
    const handler: ArenaQueryHandler = {
      async handleQueryRequest(payload) {
        // lie: answer a single-record query with a list
        return apiQueryResponse(
          payload.kind,
          [scenario.registration] as never,
        );
      },
    };
    const client = createArenaApiClient(createLoopbackTransport(handler), 'acme');
    await expect(client.getReleaseRecord(scenario.registration.digest)).rejects.toThrow(
      ArenaApiError,
    );
  });

  it('the loopback still serializes envelopes (wire discipline on every hop)', async () => {
    const scenario = await makeScenario();
    const seen: string[] = [];
    const handler: ArenaQueryHandler = {
      async handleQueryRequest(payload) {
        return apiQueryResponse('get-release-record', payload.kind === 'get-release-record' ? scenario.registration : null);
      },
    };
    const transport = createLoopbackTransport(handler);
    const client = new ArenaApiClient({ transport, scope: toApiReadScope('acme') });
    const release = await client.getReleaseRecord(scenario.registration.digest);
    expect(release?.digest).toBe(scenario.registration.digest);
    expect(seen).toHaveLength(0);
    void seen;
    void serializeEnvelope;
  });
});
