/**
 * Unit tests for the Arena API envelope wiring (Work Order A025) —
 * the first consumer of the protocol-core `query` / `response`
 * envelope kinds.
 */

import { describe, expect, it } from 'vitest';
import {
  makeEnvelope,
  newCorrelationId,
  serializeEnvelope,
  toCorrelationId,
  toIdempotencyKey,
} from '@arena/protocol-core';
import {
  API_SCHEMAS,
  API_SCHEMA_VERSION,
  apiEnvelopeDigest,
  apiSchemaRef,
  isKnownApiSchema,
  makeApiQueryRequest,
  makeApiQueryResponse,
  parseApiQueryRequest,
  parseApiQueryResponse,
  parseApiQueryResponseFor,
} from './envelopes.js';
import { apiQueryRequest, apiQueryResponse, toApiReadScope } from './queries.js';
import { ArenaApiError } from './errors.js';
import { makeScenario } from './test-support.js';

const DIGEST = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CORR = toCorrelationId('corr-envelope-1');

describe('schema registry', () => {
  it('owns the api namespace schemas at the registered version', () => {
    expect(Object.isFrozen(API_SCHEMAS)).toBe(true);
    expect(Object.keys(API_SCHEMAS)).toHaveLength(7);
    expect(apiSchemaRef('api/api-query-request')).toEqual({
      namespace: 'api',
      name: 'api-query-request',
      version: API_SCHEMA_VERSION,
    });
    expect(
      isKnownApiSchema({ namespace: 'api', name: 'api-query-request', version: '1.0.0' }),
    ).toBe(true);
    expect(
      isKnownApiSchema({ namespace: 'api', name: 'api-query-request', version: '2.0.0' }),
    ).toBe(false);
    expect(
      isKnownApiSchema({ namespace: 'certification', name: 'api-query-request', version: '1.0.0' }),
    ).toBe(false);
    expect(() => apiSchemaRef('api/not-a-schema' as never)).toThrow(ArenaApiError);
  });
});

describe('api-query-request envelopes', () => {
  it('round-trips through the canonical wire form (kind `query`, NULL idempotency key)', () => {
    const payload = apiQueryRequest('get-release-record', { digest: DIGEST }, toApiReadScope('acme'));
    const envelope = makeApiQueryRequest(payload, CORR);
    expect(envelope.kind).toBe('query');
    expect(envelope.idempotencyKey).toBeNull();
    expect(envelope.schema).toBe('arena:schema/api/api-query-request@1.0.0');
    const wire = serializeEnvelope(envelope);
    const parsed = parseApiQueryRequest(wire);
    expect(parsed.correlationId).toBe(CORR);
    expect(parsed.payload.kind).toBe('get-release-record');
    expect(parsed.payload.scope.tenant).toBe('acme');
  });

  it('rejects structurally invalid payloads (fail-closed)', () => {
    expect(() => makeApiQueryRequest({ kind: 'nope' } as never, CORR)).toThrow(ArenaApiError);
    expect(() => parseApiQueryRequest('not json')).toThrow();
    expect(() => parseApiQueryRequest(JSON.stringify({ nope: true }))).toThrow();
  });

  it('rejects a well-formed payload travelling in the WRONG envelope kind', () => {
    const payload = apiQueryRequest('get-release-record', { digest: DIGEST }, toApiReadScope('acme'));
    const asCommand = makeEnvelope({
      kind: 'command',
      schema: apiSchemaRef('api/api-query-request'),
      payload,
      correlationId: CORR,
      idempotencyKey: toIdempotencyKey('idem-envelope-1'),
    });
    expect(() => parseApiQueryRequest(serializeEnvelope(asCommand))).toThrow(
      /must travel in a 'query' envelope/,
    );
  });

  it('rejects a query envelope carrying an idempotency-key-shaped payload discipline break', () => {
    const payload = apiQueryRequest('get-release-record', { digest: DIGEST }, toApiReadScope('acme'));
    const envelope = makeApiQueryRequest(payload, CORR);
    const tampered = {
      ...envelope,
      kind: 'response' as const,
    };
    expect(() => parseApiQueryRequest(serializeEnvelope(tampered))).toThrow(
      /must travel in a 'query' envelope/,
    );
  });
});

describe('api-query-response envelopes', () => {
  it('round-trips through the canonical wire form (kind `response`)', async () => {
    const scenario = await makeScenario();
    const payload = apiQueryResponse('get-release-record', scenario.registration);
    const envelope = makeApiQueryResponse(payload, CORR);
    expect(envelope.kind).toBe('response');
    expect(envelope.idempotencyKey).toBeNull();
    const parsed = parseApiQueryResponse(serializeEnvelope(envelope));
    expect(parsed.payload.result).toStrictEqual(scenario.registration);
  });

  it('parseApiQueryResponseFor asserts correlation + echoed kind (fail-closed)', async () => {
    const scenario = await makeScenario();
    const request = makeApiQueryRequest(
      apiQueryRequest('get-release-record', { digest: DIGEST }, toApiReadScope('acme')),
      CORR,
    );
    const good = makeApiQueryResponse(apiQueryResponse('get-release-record', scenario.registration), CORR);
    expect(parseApiQueryResponseFor(serializeEnvelope(good), request).payload.kind).toBe(
      'get-release-record',
    );

    const otherCorrelation = makeApiQueryResponse(
      apiQueryResponse('get-release-record', scenario.registration),
      toCorrelationId('corr-envelope-2'),
    );
    expect(() => parseApiQueryResponseFor(serializeEnvelope(otherCorrelation), request)).toThrow(
      ArenaApiError,
    );

    const otherKind = makeApiQueryResponse(
      apiQueryResponse('get-certification-record', scenario.certification),
      CORR,
    );
    expect(() => parseApiQueryResponseFor(serializeEnvelope(otherKind), request)).toThrow(
      /echoes query kind/,
    );
  });

  it('rejects responses travelling in the wrong envelope kind', async () => {
    const scenario = await makeScenario();
    const payload = apiQueryResponse('get-certification-record', scenario.certification);
    const asEvent = makeEnvelope({
      kind: 'event',
      schema: apiSchemaRef('api/api-query-response'),
      payload,
      correlationId: CORR,
      idempotencyKey: null,
    });
    expect(() => parseApiQueryResponse(serializeEnvelope(asEvent))).toThrow(
      /must travel in a 'response' envelope/,
    );
  });

  it('rejects foreign-namespace schemas (fail-closed)', async () => {
    const scenario = await makeScenario();
    const payload = apiQueryResponse('get-certification-record', scenario.certification);
    const foreign = makeEnvelope({
      kind: 'response',
      schema: 'arena:schema/certification/certification-record@1.0.0',
      payload,
      correlationId: CORR,
      idempotencyKey: null,
    });
    expect(() => parseApiQueryResponse(serializeEnvelope(foreign))).toThrow();
  });
});

describe('envelope digests', () => {
  it('envelope digests are stable for a fixed envelope and payload-sensitive', async () => {
    const scenario = await makeScenario();
    const payload = apiQueryRequest('get-release-record', { digest: DIGEST }, toApiReadScope('acme'));
    const one = makeApiQueryRequest(payload, CORR);
    // digesting the same envelope twice is stable (canonical JSON)
    expect(await apiEnvelopeDigest(one)).toBe(await apiEnvelopeDigest(one));
    // two envelopes that share id + issuedAt differ ONLY through their payloads
    const fixed = { id: '0f0e0d0c-0b0a-4000-8000-000000000001', issuedAt: '2026-09-30T08:00:00.000Z' };
    const base = makeEnvelope({
      kind: 'query',
      schema: apiSchemaRef('api/api-query-request'),
      payload,
      correlationId: CORR,
      idempotencyKey: null,
      ...fixed,
    });
    const sameInputs = makeEnvelope({
      kind: 'query',
      schema: apiSchemaRef('api/api-query-request'),
      payload: apiQueryRequest('get-release-record', { digest: DIGEST }, toApiReadScope('acme')),
      correlationId: CORR,
      idempotencyKey: null,
      ...fixed,
    });
    expect(await apiEnvelopeDigest(base)).toBe(await apiEnvelopeDigest(sameInputs));
    const mutated = makeEnvelope({
      kind: 'query',
      schema: apiSchemaRef('api/api-query-request'),
      payload: apiQueryRequest('get-release-record', { digest: 'b'.repeat(64) }, toApiReadScope('acme')),
      correlationId: CORR,
      idempotencyKey: null,
      ...fixed,
    });
    expect(await apiEnvelopeDigest(mutated)).not.toBe(await apiEnvelopeDigest(base));
    void scenario;
    void newCorrelationId;
  });
});
