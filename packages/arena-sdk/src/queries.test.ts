/**
 * Unit tests for the Arena API query vocabulary (Work Order A025) —
 * closed kinds, per-kind params, read scope, result vocabulary.
 */

import { describe, expect, it } from 'vitest';
import {
  API_QUERY_KINDS,
  API_QUERY_PARAMS_FIELDS,
  API_QUERY_REQUEST_FIELDS,
  API_QUERY_RESPONSE_FIELDS,
  API_RELEASE_LIFECYCLE_STATES,
  API_RELEASE_VISIBILITIES,
  apiQueryRequest,
  apiQueryResponse,
  isApiQueryKind,
  isApiQueryParamsFor,
  isApiQueryRequest,
  isApiQueryResponse,
  isApiQueryResultFor,
  isApiReadScope,
  isTenantAddressable,
  toApiReadScope,
} from './queries.js';
import { ArenaApiError, ARENA_API_ERROR_CODES } from './errors.js';
import { PUBLIC_TENANT, isTenantVisible } from './shared.js';
import { makeScenario } from './test-support.js';

const DIGEST = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BAD_DIGEST = 'not-a-digest';

describe('query kinds — the closed vocabulary', () => {
  it('is frozen, unique, and covers the platform read surface', () => {
    expect(Object.isFrozen(API_QUERY_KINDS)).toBe(true);
    expect(new Set(API_QUERY_KINDS).size).toBe(API_QUERY_KINDS.length);
    expect(API_QUERY_KINDS).toHaveLength(16);
    for (const required of [
      'get-release-record',
      'list-release-records',
      'resolve-active-release',
      'resolve-release-status',
      'get-certification-record',
      'current-certification',
      'get-certification-suite',
      'get-compatibility-record',
      'latest-compatibility-verdict',
      'get-body-version',
    ]) {
      expect(API_QUERY_KINDS).toContain(required);
    }
  });

  it('isApiQueryKind accepts members, rejects everything else', () => {
    expect(isApiQueryKind('get-release-record')).toBe(true);
    expect(isApiQueryKind('drop-table')).toBe(false);
    expect(isApiQueryKind(null)).toBe(false);
    expect(isApiQueryKind(42)).toBe(false);
  });

  it('every kind declares its params field list', () => {
    for (const kind of API_QUERY_KINDS) {
      expect(API_QUERY_PARAMS_FIELDS[kind]).toBeDefined();
    }
    expect(API_QUERY_PARAMS_FIELDS['get-release-record']).toEqual(['digest']);
    expect(API_QUERY_PARAMS_FIELDS['resolve-active-release']).toEqual([
      'tenant',
      'name',
      'channel',
    ]);
    expect(API_QUERY_PARAMS_FIELDS['list-release-records']).toEqual([]);
  });
});

describe('read scope (public/private visibility)', () => {
  it('accepts valid tenant scopes and rejects malformed ones', () => {
    expect(isApiReadScope({ tenant: 'acme' })).toBe(true);
    expect(isApiReadScope({ tenant: PUBLIC_TENANT })).toBe(true);
    expect(isApiReadScope({})).toBe(false);
    expect(isApiReadScope({ tenant: 'Bad_Tenant' })).toBe(false);
    expect(isApiReadScope({ tenant: 'acme', extra: 'no' })).toBe(false);
    expect(isApiReadScope(null)).toBe(false);
    expect(toApiReadScope('acme').tenant).toBe('acme');
    expect(() => toApiReadScope('NOPE')).toThrow(ArenaApiError);
  });

  it('visibility: same tenant or public; everything else fails closed', () => {
    expect(isTenantVisible('acme', 'acme')).toBe(true);
    expect(isTenantVisible('acme', 'globex')).toBe(false);
    expect(isTenantVisible(PUBLIC_TENANT, 'globex')).toBe(true);
    const scope = toApiReadScope('acme');
    expect(isTenantAddressable('acme', scope)).toBe(true);
    expect(isTenantAddressable(PUBLIC_TENANT, scope)).toBe(true);
    expect(isTenantAddressable('globex', scope)).toBe(false);
  });
});

describe('per-kind params guards', () => {
  it('digest params require lowercase sha256 hex', () => {
    for (const kind of [
      'get-release-record',
      'get-release-publication',
      'get-certification-record',
      'get-compatibility-record',
      'get-body-version',
    ] as const) {
      expect(isApiQueryParamsFor(kind, { digest: DIGEST })).toBe(true);
      expect(isApiQueryParamsFor(kind, { digest: BAD_DIGEST })).toBe(false);
      expect(isApiQueryParamsFor(kind, {})).toBe(false);
      expect(isApiQueryParamsFor(kind, { digest: DIGEST, extra: 1 })).toBe(false);
    }
  });

  it('list params are the closed empty shape', () => {
    for (const kind of [
      'list-release-records',
      'list-certification-records',
      'list-certification-suites',
      'list-compatibility-records',
    ] as const) {
      expect(isApiQueryParamsFor(kind, {})).toBe(true);
      expect(isApiQueryParamsFor(kind, { digest: DIGEST })).toBe(false);
      expect(isApiQueryParamsFor(kind, null)).toBe(false);
    }
  });

  it('list-body-registrations params require a tenant-scope-shaped tenant', () => {
    expect(isApiQueryParamsFor('list-body-registrations', { tenant: 'acme', name: 'body-1' })).toBe(true);
    expect(isApiQueryParamsFor('list-body-registrations', { tenant: 'ACME', name: 'body-1' })).toBe(false);
    expect(isApiQueryParamsFor('list-body-registrations', { tenant: 'acme' })).toBe(false);
  });

  it('resolve-active-release params require a closed channel', () => {
    expect(
      isApiQueryParamsFor('resolve-active-release', { tenant: 'acme', name: 'body-1', channel: 'stable' }),
    ).toBe(true);
    expect(
      isApiQueryParamsFor('resolve-active-release', { tenant: 'acme', name: 'body-1', channel: 'beta' }),
    ).toBe(false);
  });

  it('resolve-release-status params require semver version', () => {
    expect(
      isApiQueryParamsFor('resolve-release-status', { namespace: 'acme', name: 'body-1', version: '2.0.0' }),
    ).toBe(true);
    expect(
      isApiQueryParamsFor('resolve-release-status', { namespace: 'ACME', name: 'body-1', version: '2.0.0' }),
    ).toBe(false);
    expect(
      isApiQueryParamsFor('resolve-release-status', { namespace: 'acme', name: 'body-1', version: 'latest' }),
    ).toBe(false);
  });

  it('suite refs require digests; compatibility addresses require non-empty strings', () => {
    expect(isApiQueryParamsFor('get-certification-suite', { suiteRef: DIGEST })).toBe(true);
    expect(isApiQueryParamsFor('get-certification-suite', { suiteRef: 'suite-1' })).toBe(false);
    expect(
      isApiQueryParamsFor('latest-compatibility-verdict', {
        bodyVersionRef: 'acme/body@1.0.0#aaaa',
        substrateRef: 'substrate-x@6.0.1#bbbb',
      }),
    ).toBe(true);
    expect(
      isApiQueryParamsFor('latest-compatibility-verdict', {
        bodyVersionRef: '',
        substrateRef: 'substrate-x@6.0.1#bbbb',
      }),
    ).toBe(false);
  });

  it('current-certification params require a structurally valid CertificationSubject', async () => {
    const scenario = await makeScenario();
    const subject = scenario.certification.subject;
    expect(subject).not.toBeNull();
    expect(isApiQueryParamsFor('current-certification', { subject })).toBe(true);
    expect(isApiQueryParamsFor('current-certification', { subject: null })).toBe(false);
    expect(isApiQueryParamsFor('current-certification', { subject: { tenant: 'acme' } })).toBe(false);
  });
});

describe('query request payload', () => {
  it('constructs and validates a well-formed request (deep-frozen)', () => {
    const scope = toApiReadScope('acme');
    const request = apiQueryRequest('get-release-record', { digest: DIGEST }, scope);
    expect(request.requestVersion).toBe(1);
    expect(request.kind).toBe('get-release-record');
    expect(request.scope.tenant).toBe('acme');
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.params)).toBe(true);
    expect(isApiQueryRequest(request)).toBe(true);
    expect(API_QUERY_REQUEST_FIELDS).toEqual(['requestVersion', 'kind', 'params', 'scope']);
  });

  it('rejects unknown kinds, missing scope, malformed params (fail-closed)', () => {
    const scope = toApiReadScope('acme');
    expect(() =>
      apiQueryRequest('steal-secrets' as never, {}, scope),
    ).toThrow(ArenaApiError);
    expect(() =>
      apiQueryRequest('get-release-record', { digest: BAD_DIGEST }, scope),
    ).toThrow(/invalid params/);
    let thrown: unknown;
    try {
      apiQueryRequest('get-release-record', { digest: DIGEST }, {} as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArenaApiError);
    expect((thrown as ArenaApiError).code).toBe(ARENA_API_ERROR_CODES.SCOPE_REQUIRED);
    expect(isApiQueryRequest({ requestVersion: 2, kind: 'get-release-record', params: { digest: DIGEST }, scope })).toBe(false);
    expect(isApiQueryRequest('nope')).toBe(false);
  });
});

describe('query response payload + result vocabulary', () => {
  it('constructs per-kind results and rejects mismatches (fail-closed)', async () => {
    const scenario = await makeScenario();
    const ok = apiQueryResponse('get-release-record', scenario.registration);
    expect(ok.responseVersion).toBe(1);
    expect(ok.kind).toBe('get-release-record');
    expect(Object.isFrozen(ok)).toBe(true);
    expect(isApiQueryResponse(ok)).toBe(true);
    expect(API_QUERY_RESPONSE_FIELDS).toEqual(['responseVersion', 'kind', 'result']);

    // null is a valid single-kind miss
    expect(isApiQueryResultFor('get-release-record', null)).toBe(true);
    expect(isApiQueryResultFor('get-certification-record', scenario.certification)).toBe(true);
    // cross-kind contamination is rejected
    expect(isApiQueryResultFor('get-release-record', scenario.certification)).toBe(false);
    expect(isApiQueryResultFor('get-certification-record', scenario.registration)).toBe(false);
    expect(() => apiQueryResponse('get-release-record', scenario.certification)).toThrow(ArenaApiError);
    expect(() => apiQueryResponse('get-compatibility-record', 42 as never)).toThrow(ArenaApiError);
  });

  it('list results require arrays of the owning record kind', async () => {
    const scenario = await makeScenario();
    expect(isApiQueryResultFor('list-release-records', [scenario.registration])).toBe(true);
    expect(isApiQueryResultFor('list-release-records', [scenario.certification])).toBe(false);
    expect(isApiQueryResultFor('list-release-records', scenario.registration)).toBe(false);
    expect(isApiQueryResultFor('list-certification-records', [scenario.certification])).toBe(true);
    expect(isApiQueryResultFor('list-certification-suites', [scenario.suite])).toBe(true);
    expect(isApiQueryResultFor('list-compatibility-records', [scenario.compatibility])).toBe(true);
  });

  it('the compound release status vocabulary is closed and structurally checked', () => {
    expect(Object.isFrozen(API_RELEASE_LIFECYCLE_STATES)).toBe(true);
    expect(Object.isFrozen(API_RELEASE_VISIBILITIES)).toBe(true);
    expect([...API_RELEASE_LIFECYCLE_STATES]).toEqual([
      'registered',
      'superseded',
      'retired',
      'unknown',
    ]);
    const status = {
      state: 'registered',
      visibility: 'published',
      registration: null,
      publication: null,
    };
    expect(isApiQueryResultFor('resolve-release-status', status)).toBe(true);
    expect(
      isApiQueryResultFor('resolve-release-status', {
        state: 'deleted',
        visibility: 'published',
        registration: null,
        publication: null,
      }),
    ).toBe(false);
    expect(isApiQueryResultFor('resolve-release-status', null)).toBe(false);
  });
});
