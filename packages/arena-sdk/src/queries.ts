/**
 * The Arena API query vocabulary (Work Order A025) — the closed set of
 * read/query paths the public/private API exposes over the platform
 * core, and the per-kind parameter/result shapes.
 *
 * Every query kind addresses one read projection of the completed
 * platform core (A002 artifact/provenance refs, A003 body versions,
 * A023 certification records/suites/statements, A022 compatibility
 * verdicts, A024 release records/publications):
 *
 *   - registry reads: get/list release records, body-version
 *     registrations, release publications, certification suites;
 *   - certification statement reads: certification records (the
 *     derived statement travels INSIDE the record — never supplied by
 *     the caller), current certification for a composition;
 *   - compatibility verdict reads: latest verdict for a body-version ×
 *     substrate pair, records by digest / list;
 *   - compound projections: resolve-active-release, release status
 *     (lifecycle state + publication visibility).
 *
 * The vocabulary is CLOSED: `API_QUERY_KINDS` is the single frozen
 * enumeration; the request constructor validates per-kind params with
 * strict closed-shape checks; results are validated against the owning
 * sibling packages' structural guards (isReleaseRecord,
 * isCertificationRecord, isCompatibilityRecord, isCertificationSuite,
 * isBodyVersion, isReleasePublicationRecord) before any caller sees
 * them — fail-closed at every hop.
 */

import type {
  BodyVersion,
} from '@arena/agent-body';
import {
  isBodyVersion,
} from '@arena/agent-body';
import type {
  CertificationRecord,
  CertificationSubject,
  CertificationSuite,
} from '@arena/certification';
import {
  isCertificationRecord,
  isCertificationSubject,
  isCertificationSuite,
} from '@arena/certification';
import type {
  CompatibilityRecord,
} from '@arena/compatibility';
import {
  isCompatibilityRecord,
} from '@arena/compatibility';
import type {
  ReleasePublicationRecord,
  ReleaseRecord,
} from '@arena/body-registry';
import {
  isReleaseChannel,
  isReleasePublicationRecord,
  isReleaseRecord,
} from '@arena/body-registry';
import { ARENA_API_ERROR_CODES, ArenaApiError } from './errors.js';
import {
  ARENA_API_NAMESPACE_PATTERN_SOURCE,
  ARENA_API_SEMVER_PATTERN_SOURCE,
  ARENA_API_TENANT_PATTERN_SOURCE,
  PUBLIC_TENANT,
  RELEASE_CHANNELS,
  deepFreeze,
  expectEnumMember,
  expectFields,
  isContentDigestValue,
  isPlainObject,
  isTenantScope,
  toContentDigest,
  toSemver,
  toTenantScope,
  type TenantScope,
} from './shared.js';

const ARENA_API_NAMESPACE_PATTERN = new RegExp(ARENA_API_NAMESPACE_PATTERN_SOURCE);
const ARENA_API_SEMVER_PATTERN = new RegExp(ARENA_API_SEMVER_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Query kinds — the closed vocabulary
// ---------------------------------------------------------------------------

export const API_QUERY_KINDS = Object.freeze([
  'get-release-record',
  'list-release-records',
  'list-body-registrations',
  'resolve-active-release',
  'resolve-release-status',
  'get-release-publication',
  'get-certification-record',
  'list-certification-records',
  'list-certifications-by-suite',
  'current-certification',
  'get-certification-suite',
  'list-certification-suites',
  'get-compatibility-record',
  'list-compatibility-records',
  'latest-compatibility-verdict',
  'get-body-version',
] as const);

export type ApiQueryKind = (typeof API_QUERY_KINDS)[number];

export function isApiQueryKind(value: unknown): value is ApiQueryKind {
  return (
    typeof value === 'string' &&
    (API_QUERY_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Read scope (public/private visibility)
// ---------------------------------------------------------------------------

/**
 * The tenant scope every query executes under. `tenant` is the reading
 * tenant (or the reserved `public` namespace, which sees only
 * explicitly public records) — mirroring @arena/expert-registry's
 * ExpertReadScope / @arena/capability-case's CaseReadScope (lock
 * rule 11: no silent cross-tenant reads).
 */
export interface ApiReadScope {
  readonly tenant: TenantScope;
}

export const API_READ_SCOPE_FIELDS = Object.freeze(['tenant'] as const) as readonly string[];

export function isApiReadScope(value: unknown): value is ApiReadScope {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === 'tenant' && isTenantScope(value['tenant']);
}

export function toApiReadScope(tenant: string): ApiReadScope {
  return { tenant: toTenantScope(tenant, 'api read scope') };
}

/**
 * True iff a query param tenant is addressable from the given read
 * scope: the scope's own tenant, or the reserved public namespace.
 */
export function isTenantAddressable(paramTenant: string, scope: ApiReadScope): boolean {
  return paramTenant === scope.tenant || paramTenant === PUBLIC_TENANT;
}

// ---------------------------------------------------------------------------
// Per-kind query parameters
// ---------------------------------------------------------------------------

/** The closed empty parameter shape (list queries take no params). */
export type EmptyQueryParams = Readonly<Record<string, never>>;

export interface GetReleaseRecordParams {
  readonly digest: string;
}
export type ListReleaseRecordsParams = EmptyQueryParams;
export interface ListBodyRegistrationsParams {
  readonly tenant: string;
  readonly name: string;
}
export interface ResolveActiveReleaseParams {
  readonly tenant: string;
  readonly name: string;
  readonly channel: string;
}
export interface ResolveReleaseStatusParams {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
}
export interface GetReleasePublicationParams {
  readonly digest: string;
}
export interface GetCertificationRecordParams {
  readonly digest: string;
}
export type ListCertificationRecordsParams = EmptyQueryParams;
export interface ListCertificationsBySuiteParams {
  readonly suiteRef: string;
}
export interface CurrentCertificationParams {
  readonly subject: CertificationSubject;
}
export interface GetCertificationSuiteParams {
  readonly suiteRef: string;
}
export type ListCertificationSuitesParams = EmptyQueryParams;
export interface GetCompatibilityRecordParams {
  readonly digest: string;
}
export type ListCompatibilityRecordsParams = EmptyQueryParams;
export interface LatestCompatibilityVerdictParams {
  readonly bodyVersionRef: string;
  readonly substrateRef: string;
}
export interface GetBodyVersionParams {
  readonly digest: string;
}

export type ApiQueryParams =
  | GetReleaseRecordParams
  | ListReleaseRecordsParams
  | ListBodyRegistrationsParams
  | ResolveActiveReleaseParams
  | ResolveReleaseStatusParams
  | GetReleasePublicationParams
  | GetCertificationRecordParams
  | ListCertificationRecordsParams
  | ListCertificationsBySuiteParams
  | CurrentCertificationParams
  | GetCertificationSuiteParams
  | ListCertificationSuitesParams
  | GetCompatibilityRecordParams
  | ListCompatibilityRecordsParams
  | LatestCompatibilityVerdictParams
  | GetBodyVersionParams;

/** Stable field list per query kind (contracts mirror these). */
export const API_QUERY_PARAMS_FIELDS: Readonly<Record<ApiQueryKind, readonly string[]>> =
  Object.freeze({
    'get-release-record': Object.freeze(['digest']),
    'list-release-records': Object.freeze([]),
    'list-body-registrations': Object.freeze(['tenant', 'name']),
    'resolve-active-release': Object.freeze(['tenant', 'name', 'channel']),
    'resolve-release-status': Object.freeze(['namespace', 'name', 'version']),
    'get-release-publication': Object.freeze(['digest']),
    'get-certification-record': Object.freeze(['digest']),
    'list-certification-records': Object.freeze([]),
    'list-certifications-by-suite': Object.freeze(['suiteRef']),
    'current-certification': Object.freeze(['subject']),
    'get-certification-suite': Object.freeze(['suiteRef']),
    'list-certification-suites': Object.freeze([]),
    'get-compatibility-record': Object.freeze(['digest']),
    'list-compatibility-records': Object.freeze([]),
    'latest-compatibility-verdict': Object.freeze(['bodyVersionRef', 'substrateRef']),
    'get-body-version': Object.freeze(['digest']),
  });

/** Structural (non-throwing) per-kind parameter check. */
export function isApiQueryParamsFor(kind: ApiQueryKind, value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  const expected = API_QUERY_PARAMS_FIELDS[kind];
  if (keys.length !== expected.length) return false;
  for (const key of expected) {
    if (!(key in value)) return false;
  }
  switch (kind) {
    case 'get-release-record':
    case 'get-release-publication':
    case 'get-certification-record':
    case 'get-compatibility-record':
    case 'get-body-version':
      return isContentDigestValue(value['digest']);
    case 'list-release-records':
    case 'list-certification-records':
    case 'list-certification-suites':
    case 'list-compatibility-records':
      return keys.length === 0;
    case 'list-body-registrations':
      return (
        typeof value['tenant'] === 'string' && isTenantScope(value['tenant']) &&
        typeof value['name'] === 'string'
      );
    case 'resolve-active-release':
      return (
        typeof value['tenant'] === 'string' && isTenantScope(value['tenant']) &&
        typeof value['name'] === 'string' && isReleaseChannel(value['channel'])
      );
    case 'resolve-release-status':
      return (
        typeof value['namespace'] === 'string' &&
        ARENA_API_NAMESPACE_PATTERN.test(value['namespace']) &&
        typeof value['name'] === 'string' &&
        typeof value['version'] === 'string' &&
        ARENA_API_SEMVER_PATTERN.test(value['version'])
      );
    case 'list-certifications-by-suite':
    case 'get-certification-suite':
      return isContentDigestValue(value['suiteRef']);
    case 'current-certification':
      return isCertificationSubject(value['subject']);
    case 'latest-compatibility-verdict':
      return (
        typeof value['bodyVersionRef'] === 'string' && value['bodyVersionRef'].length > 0 &&
        typeof value['substrateRef'] === 'string' && value['substrateRef'].length > 0
      );
  }
}

// ---------------------------------------------------------------------------
// Query request payload
// ---------------------------------------------------------------------------

export const API_QUERY_REQUEST_VERSION = 1 as const;

/**
 * The query request payload — one closed envelope over every read path.
 * `scope` is REQUIRED (fail-closed: there is no unscoped read).
 */
export interface ApiQueryRequest {
  readonly requestVersion: typeof API_QUERY_REQUEST_VERSION;
  readonly kind: ApiQueryKind;
  readonly params: ApiQueryParams;
  readonly scope: ApiReadScope;
}

export const API_QUERY_REQUEST_FIELDS = Object.freeze([
  'requestVersion',
  'kind',
  'params',
  'scope',
] as const) as readonly string[];

/** Structural (non-throwing) check for the query request payload. */
export function isApiQueryRequest(value: unknown): value is ApiQueryRequest {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== API_QUERY_REQUEST_FIELDS.length) return false;
  for (const key of API_QUERY_REQUEST_FIELDS) {
    if (!(key in value)) return false;
  }
  if (value['requestVersion'] !== API_QUERY_REQUEST_VERSION) return false;
  if (!isApiQueryKind(value['kind'])) return false;
  if (!isApiReadScope(value['scope'])) return false;
  return isApiQueryParamsFor(value['kind'], value['params']);
}

/**
 * Construct (and validate) a query request payload. Any invalid input —
 * unknown kind, malformed params, missing scope — throws a typed
 * ArenaApiError (fail-closed).
 */
export function apiQueryRequest(
  kind: ApiQueryKind,
  params: ApiQueryParams,
  scope: ApiReadScope,
): ApiQueryRequest {
  if (!isApiQueryKind(kind)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_QUERY_KIND, {
      message: `unknown arena api query kind: ${JSON.stringify(String(kind))}`,
      details: { known: [...API_QUERY_KINDS] },
    });
  }
  if (!isApiReadScope(scope)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.SCOPE_REQUIRED, {
      message: 'every arena api query requires a valid read scope { tenant } (there is no unscoped read)',
      details: { pattern: ARENA_API_TENANT_PATTERN_SOURCE },
    });
  }
  if (!isApiQueryParamsFor(kind, params)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_PARAMS, {
      message: `invalid params for arena api query ${JSON.stringify(kind)}`,
      details: { kind, expectedFields: [...API_QUERY_PARAMS_FIELDS[kind]] },
    });
  }
  return deepFreeze({
    requestVersion: API_QUERY_REQUEST_VERSION,
    kind,
    params: deepFreeze({ ...(params as object) }),
    scope: deepFreeze({ ...scope }),
  }) as ApiQueryRequest;
}

// ---------------------------------------------------------------------------
// Query response payload + per-kind result shapes
// ---------------------------------------------------------------------------

export const API_QUERY_RESPONSE_VERSION = 1 as const;

/**
 * The compound release status projection (mirrors the A024
 * services/body-registry ReleaseStatus projection vocabulary —
 * re-declared here because services are not importable from a domain
 * package; the vocabulary is identical by construction and
 * parity-tested).
 */
export const API_RELEASE_LIFECYCLE_STATES = Object.freeze([
  'registered',
  'superseded',
  'retired',
  'unknown',
] as const);
export type ApiReleaseLifecycleState = (typeof API_RELEASE_LIFECYCLE_STATES)[number];

export const API_RELEASE_VISIBILITIES = Object.freeze([
  'published',
  'unpublished',
] as const);
export type ApiReleaseVisibility = (typeof API_RELEASE_VISIBILITIES)[number];

export interface ApiReleaseStatus {
  readonly state: ApiReleaseLifecycleState;
  readonly visibility: ApiReleaseVisibility;
  readonly registration: ReleaseRecord | null;
  readonly publication: ReleasePublicationRecord | null;
}

export const API_RELEASE_STATUS_FIELDS = Object.freeze([
  'state',
  'visibility',
  'registration',
  'publication',
] as const) as readonly string[];

export function isApiReleaseStatus(value: unknown): value is ApiReleaseStatus {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== API_RELEASE_STATUS_FIELDS.length) return false;
  for (const key of API_RELEASE_STATUS_FIELDS) {
    if (!(key in value)) return false;
  }
  if (
    !(
      typeof value['state'] === 'string' &&
      (API_RELEASE_LIFECYCLE_STATES as readonly string[]).includes(value['state'])
    )
  ) {
    return false;
  }
  if (
    !(
      typeof value['visibility'] === 'string' &&
      (API_RELEASE_VISIBILITIES as readonly string[]).includes(value['visibility'])
    )
  ) {
    return false;
  }
  const registration = value['registration'];
  if (registration !== null && !isReleaseRecord(registration)) return false;
  const publication = value['publication'];
  return publication === null || isReleasePublicationRecord(publication);
}

/** The per-kind result value (discriminated by the echoed query kind). */
export type ApiQueryResultValue =
  | ReleaseRecord
  | readonly ReleaseRecord[]
  | ReleasePublicationRecord
  | CertificationRecord
  | readonly CertificationRecord[]
  | CertificationSuite
  | readonly CertificationSuite[]
  | CompatibilityRecord
  | readonly CompatibilityRecord[]
  | BodyVersion
  | ApiReleaseStatus
  | null;

/** The query response payload. `kind` echoes the request; `result` is per-kind. */
export interface ApiQueryResponse {
  readonly responseVersion: typeof API_QUERY_RESPONSE_VERSION;
  readonly kind: ApiQueryKind;
  readonly result: ApiQueryResultValue;
}

export const API_QUERY_RESPONSE_FIELDS = Object.freeze([
  'responseVersion',
  'kind',
  'result',
] as const) as readonly string[];

/**
 * Structural per-kind result check — the closed vocabulary of results.
 * A response whose result does not match its echoed kind is invalid
 * (fail-closed; the client rejects it with ARENA_API_INVALID_RESPONSE).
 */
export function isApiQueryResultFor(kind: ApiQueryKind, value: unknown): boolean {
  if (!isApiQueryKind(kind)) return false;
  switch (kind) {
    case 'get-release-record':
    case 'resolve-active-release':
      return value === null || isReleaseRecord(value);
    case 'list-release-records':
    case 'list-body-registrations':
      return (
        Array.isArray(value) && (value as unknown[]).every((entry) => isReleaseRecord(entry))
      );
    case 'get-release-publication':
      return value === null || isReleasePublicationRecord(value);
    case 'resolve-release-status':
      return isApiReleaseStatus(value);
    case 'get-certification-record':
    case 'current-certification':
      return value === null || isCertificationRecord(value);
    case 'list-certification-records':
    case 'list-certifications-by-suite':
      return (
        Array.isArray(value) &&
        (value as unknown[]).every((entry) => isCertificationRecord(entry))
      );
    case 'get-certification-suite':
      return value === null || isCertificationSuite(value);
    case 'list-certification-suites':
      return (
        Array.isArray(value) && (value as unknown[]).every((entry) => isCertificationSuite(entry))
      );
    case 'get-compatibility-record':
    case 'latest-compatibility-verdict':
      return value === null || isCompatibilityRecord(value);
    case 'list-compatibility-records':
      return (
        Array.isArray(value) &&
        (value as unknown[]).every((entry) => isCompatibilityRecord(entry))
      );
    case 'get-body-version':
      return value === null || isBodyVersion(value);
  }
}

/** Structural (non-throwing) check for the query response payload. */
export function isApiQueryResponse(value: unknown): value is ApiQueryResponse {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== API_QUERY_RESPONSE_FIELDS.length) return false;
  for (const key of API_QUERY_RESPONSE_FIELDS) {
    if (!(key in value)) return false;
  }
  if (value['responseVersion'] !== API_QUERY_RESPONSE_VERSION) return false;
  if (!isApiQueryKind(value['kind'])) return false;
  return isApiQueryResultFor(value['kind'], value['result']);
}

/**
 * Construct (and validate) a query response payload — the
 * server-side/fabric constructor. The result MUST match the echoed
 * kind (fail-closed).
 */
export function apiQueryResponse(kind: ApiQueryKind, result: ApiQueryResultValue): ApiQueryResponse {
  if (!isApiQueryKind(kind)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_QUERY_KIND, {
      message: `unknown arena api query kind: ${JSON.stringify(String(kind))}`,
      details: { known: [...API_QUERY_KINDS] },
    });
  }
  if (!isApiQueryResultFor(kind, result)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RESPONSE, {
      message: `result does not match the closed result vocabulary of arena api query ${JSON.stringify(kind)}`,
      details: { kind },
    });
  }
  return deepFreeze({
    responseVersion: API_QUERY_RESPONSE_VERSION,
    kind,
    result,
  }) as ApiQueryResponse;
}

/**
 * Validate strict per-kind params with typed failure detail (used by
 * the fabric's adversarial parse path and the envelope constructors).
 */
export function expectApiQueryParams(kind: ApiQueryKind, value: unknown): ApiQueryParams {
  if (!isApiQueryKind(kind)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_QUERY_KIND, {
      message: `unknown arena api query kind: ${JSON.stringify(String(kind))}`,
      details: { known: [...API_QUERY_KINDS] },
    });
  }
  const record = expectFields(
    value,
    API_QUERY_PARAMS_FIELDS[kind],
    [],
    ARENA_API_ERROR_CODES.INVALID_PARAMS,
    `arena api query ${JSON.stringify(kind)} params`,
  );
  switch (kind) {
    case 'get-release-record':
    case 'get-release-publication':
    case 'get-certification-record':
    case 'get-compatibility-record':
    case 'get-body-version':
      toContentDigest(String(record['digest']), `${kind} params.digest`);
      break;
    case 'list-body-registrations':
    case 'resolve-active-release':
      toTenantScope(String(record['tenant']), `${kind} params.tenant`);
      if (typeof record['name'] !== 'string' || record['name'].length === 0) {
        throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_PARAMS, {
          message: `${kind} params.name must be a non-empty string`,
        });
      }
      break;
    case 'resolve-release-status':
      for (const field of ['namespace', 'name'] as const) {
        if (typeof record[field] !== 'string' || (record[field] as string).length === 0) {
          throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_PARAMS, {
            message: `${kind} params.${field} must be a non-empty string`,
          });
        }
      }
      toSemver(String(record['version']), 'resolve-release-status params.version');
      break;
    case 'list-certifications-by-suite':
    case 'get-certification-suite':
      toContentDigest(String(record['suiteRef']), `${kind} params.suiteRef`);
      break;
    case 'current-certification':
      if (!isCertificationSubject(record['subject'])) {
        throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_PARAMS, {
          message: 'current-certification params.subject must be a structurally valid CertificationSubject (all five scope components)',
        });
      }
      break;
    case 'latest-compatibility-verdict':
      for (const field of ['bodyVersionRef', 'substrateRef'] as const) {
        if (typeof record[field] !== 'string' || (record[field] as string).length === 0) {
          throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_PARAMS, {
            message: `latest-compatibility-verdict params.${field} must be a non-empty string address`,
          });
        }
      }
      break;
    default:
      break;
  }
  if (kind === 'resolve-active-release') {
    expectEnumMember(
      record['channel'],
      RELEASE_CHANNELS,
      'channel',
      ARENA_API_ERROR_CODES.INVALID_CHANNEL,
      'resolve-active-release params',
    );
  }
  return value as ApiQueryParams;
}
