/**
 * EPI1.0 incoming requests (Work Order A026; spec/epoch-integration.md
 * "Incoming requests from Epoch").
 *
 * The spec's five incoming bullets are the PARTS of one request: a
 * CapabilityDevelopmentRequest carries a capability-case seed, failed
 * trajectory refs, evaluation gaps, and capability/domain requirements
 * (the closed loop: Epoch detects a capability failure → capability
 * development request → Arena Capability Case).
 *
 * Validation is fail-closed with closed shapes everywhere: exact field
 * sets, closed pattern vocabularies, tenant-scoped authorization
 * metadata. Deep validation of the capability-case seed is delegated to
 * the A005 constructors (@arena/capability-case) — the authoritative
 * validators, never reimplemented here.
 */

import { isContentDigestValue, isPlainObject, isTenantScope } from '@arena/arena-sdk';
import type { TenantScope } from '@arena/arena-sdk';
import {
  CASE_PRIORITIES,
  CASE_RISK_LEVELS,
  isCasePriority,
  isCaseRisk,
  toEnvironmentRequirements,
  toEvaluationRequirements,
  toExpertRequirements,
  toTaskRequirements,
  toVerificationRequirements,
} from '@arena/capability-case';
import { isReleaseChannel } from '@arena/body-registry';
import type { ReleaseChannel } from '@arena/body-registry';
import { isIdempotencyKey } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { EPOCH_ADAPTER_ERROR_CODES, EpochAdapterError } from './errors.js';

export const EPOCH_REQUEST_VERSION = 1 as const;

export const EPOCH_PRINCIPAL_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,127}$';
const PRINCIPAL_PATTERN = new RegExp(EPOCH_PRINCIPAL_PATTERN_SOURCE);

export const EPOCH_SCOPE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
const SCOPE_PATTERN = new RegExp(EPOCH_SCOPE_PATTERN_SOURCE);

export const EPOCH_REQUEST_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,127}$';
const REQUEST_ID_PATTERN = new RegExp(EPOCH_REQUEST_ID_PATTERN_SOURCE);

export const EPOCH_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$';
const TIMESTAMP_PATTERN = new RegExp(EPOCH_TIMESTAMP_PATTERN_SOURCE);

export const EPOCH_REF_ID_PATTERN_SOURCE = '^[a-z][a-z0-9:._-]{0,127}$';
const REF_ID_PATTERN = new RegExp(EPOCH_REF_ID_PATTERN_SOURCE);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// ---------------------------------------------------------------------------
// Fail-closed field helpers (closed shapes; unknown fields are rejected)
// ---------------------------------------------------------------------------

function expectObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  context: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: `${context} must be a plain object`,
      details: { context, received: typeof value },
    });
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
        message: `${context} carries unknown field ${JSON.stringify(key)} (closed shape)`,
        details: { context, field: key },
      });
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
        message: `${context} is missing required field ${JSON.stringify(key)}`,
        details: { context, field: key },
      });
    }
  }
  return value;
}

function expectNonEmptyString(value: unknown, field: string, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: `${context}.${field} must be a non-empty string`,
      details: { context, field },
    });
  }
  return value;
}

function expectPattern(
  value: unknown,
  pattern: RegExp,
  patternSource: string,
  field: string,
  context: string,
): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: `${context}.${field} does not match the required pattern`,
      details: { context, field, pattern: patternSource, received: value },
    });
  }
  return value;
}

function expectDigest(value: unknown, field: string, context: string): string {
  if (typeof value !== 'string' || !isContentDigestValue(value)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: `${context}.${field} must be a sha256 content digest (64 lowercase hex chars)`,
      details: { context, field, pattern: '^[0-9a-f]{64}$' },
    });
  }
  return value;
}

function expectStringArray(
  value: unknown,
  field: string,
  context: string,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: `${context}.${field} must be an array of strings`,
      details: { context, field },
    });
  }
  const out: string[] = [];
  for (const entry of value) {
    expectNonEmptyString(entry, field, context);
    out.push(entry);
  }
  return Object.freeze(out);
}

// ---------------------------------------------------------------------------
// Authorization metadata (EPI1.0 "authorization metadata")
// ---------------------------------------------------------------------------

export const EPOCH_AUTHORIZATION_VERSION = 1 as const;

export interface EpochAuthorizationMetadata {
  readonly authorizationVersion: typeof EPOCH_AUTHORIZATION_VERSION;
  /** The tenant the request executes for (REQUIRED — no unscoped requests). */
  readonly tenant: TenantScope;
  /** The authenticated principal the request is attributed to. */
  readonly principal: string;
  /** Closed-pattern authorization scopes granted for this request. */
  readonly scopes: readonly string[];
}

export function isEpochAuthorizationMetadata(
  value: unknown,
): value is EpochAuthorizationMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['authorizationVersion'] === EPOCH_AUTHORIZATION_VERSION &&
    isTenantScope(candidate['tenant']) &&
    typeof candidate['principal'] === 'string' &&
    PRINCIPAL_PATTERN.test(candidate['principal']) &&
    Array.isArray(candidate['scopes']) &&
    (candidate['scopes'] as unknown[]).every(
      (scope) =>
        typeof scope === 'string' && SCOPE_PATTERN.test(scope) && scope.length > 0,
    ) &&
    (candidate['scopes'] as unknown[]).length > 0
  );
}

/** Validate and freeze authorization metadata (fail-closed, closed shape). */
export function toEpochAuthorizationMetadata(
  value: unknown,
): EpochAuthorizationMetadata {
  const candidate = expectObject(
    value,
    ['authorizationVersion', 'tenant', 'principal', 'scopes'],
    [],
    'authorization',
  );
  if (candidate['authorizationVersion'] !== EPOCH_AUTHORIZATION_VERSION) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION, {
      message: `authorization metadata version must be ${EPOCH_AUTHORIZATION_VERSION}`,
      details: { context: 'authorization', supported: EPOCH_AUTHORIZATION_VERSION },
    });
  }
  if (typeof candidate['tenant'] !== 'string' || !isTenantScope(candidate['tenant'])) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_AUTHORIZATION, {
      message: `authorization.tenant must match the tenant pattern`,
      details: { context: 'authorization', field: 'tenant', pattern: '^[a-z][a-z0-9-]{1,62}$' },
    });
  }
  const principal = expectPattern(
    candidate['principal'],
    PRINCIPAL_PATTERN,
    EPOCH_PRINCIPAL_PATTERN_SOURCE,
    'principal',
    'authorization',
  );
  const scopes = expectStringArray(candidate['scopes'], 'scopes', 'authorization');
  if (scopes.length === 0) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_AUTHORIZATION, {
      message: 'authorization metadata requires at least one authorization scope',
      details: { context: 'authorization', field: 'scopes' },
    });
  }
  for (const scope of scopes) {
    if (!SCOPE_PATTERN.test(scope)) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_AUTHORIZATION, {
        message: `authorization scope ${JSON.stringify(scope)} does not match the scope pattern`,
        details: { context: 'authorization', pattern: EPOCH_SCOPE_PATTERN_SOURCE },
      });
    }
  }
  const metadata: EpochAuthorizationMetadata = {
    authorizationVersion: EPOCH_AUTHORIZATION_VERSION,
    tenant: candidate['tenant'],
    principal,
    scopes,
  };
  return Object.freeze(metadata);
}

// ---------------------------------------------------------------------------
// Failed trajectory refs / evaluation gaps / capability-domain requirements
// ---------------------------------------------------------------------------

export interface FailedTrajectoryRef {
  /** sha256 content digest of the failed Arena trajectory record. */
  readonly digest: string;
  readonly observedAt: string;
}

function toFailedTrajectoryRef(value: unknown): FailedTrajectoryRef {
  const candidate = expectObject(
    value,
    ['digest', 'observedAt'],
    [],
    'failedTrajectoryRefs[]',
  );
  const digest = expectDigest(candidate['digest'], 'digest', 'failedTrajectoryRefs[]');
  const observedAt = expectPattern(
    candidate['observedAt'],
    TIMESTAMP_PATTERN,
    EPOCH_TIMESTAMP_PATTERN_SOURCE,
    'observedAt',
    'failedTrajectoryRefs[]',
  );
  return Object.freeze({ digest, observedAt });
}

export interface EvaluationGap {
  readonly capability: string;
  readonly summary: string;
  readonly evidenceDigest: string;
}

function toEvaluationGap(value: unknown): EvaluationGap {
  const candidate = expectObject(
    value,
    ['capability', 'summary', 'evidenceDigest'],
    [],
    'evaluationGaps[]',
  );
  const capability = expectPattern(
    candidate['capability'],
    REF_ID_PATTERN,
    EPOCH_REF_ID_PATTERN_SOURCE,
    'capability',
    'evaluationGaps[]',
  );
  const summary = expectNonEmptyString(candidate['summary'], 'summary', 'evaluationGaps[]');
  const evidenceDigest = expectDigest(
    candidate['evidenceDigest'],
    'evidenceDigest',
    'evaluationGaps[]',
  );
  return Object.freeze({ capability, summary, evidenceDigest });
}

export interface CapabilityDomainRequirements {
  readonly capability: readonly string[];
  readonly domain: readonly string[];
}

function toCapabilityDomainRequirements(value: unknown): CapabilityDomainRequirements {
  const candidate = expectObject(
    value,
    ['capability', 'domain'],
    [],
    'requirements',
  );
  const capability = expectStringArray(candidate['capability'], 'capability', 'requirements');
  const domain = expectStringArray(candidate['domain'], 'domain', 'requirements');
  if (capability.length === 0) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'capability requirements require at least one capability statement',
      details: { context: 'requirements', field: 'capability' },
    });
  }
  if (domain.length === 0) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'capability requirements require at least one domain statement',
      details: { context: 'requirements', field: 'domain' },
    });
  }
  return Object.freeze({ capability, domain });
}

// ---------------------------------------------------------------------------
// Capability case seed (typed through the A005 requirement input contracts)
// ---------------------------------------------------------------------------

/** Content-addressed reference to a capability or domain node (A004 family). */
export interface CapabilitySeedRef {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

function toCapabilitySeedRef(value: unknown, context: string): CapabilitySeedRef {
  const candidate = expectObject(
    value,
    ['kind', 'id', 'version', 'digest'],
    [],
    context,
  );
  const kind = expectPattern(
    candidate['kind'],
    /^[a-z][a-z0-9-]{0,63}$/,
    '^[a-z][a-z0-9-]{0,63}$',
    'kind',
    context,
  );
  const id = expectPattern(
    candidate['id'],
    REF_ID_PATTERN,
    EPOCH_REF_ID_PATTERN_SOURCE,
    'id',
    context,
  );
  const version = expectPattern(
    candidate['version'],
    /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/,
    '^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$',
    'version',
    context,
  );
  const digest = expectDigest(candidate['digest'], 'digest', context);
  return Object.freeze({ kind, id, version, digest });
}

export interface CapabilityCaseSeed {
  readonly problemStatement: string;
  readonly context: string;
  readonly desiredOutcome: string;
  readonly targetCapability: CapabilitySeedRef;
  readonly domain: CapabilitySeedRef;
  readonly observedFailure: {
    readonly summary: string;
    readonly observedAt: string;
    readonly reproduction?: string;
  };
  readonly evidence: readonly { digest: string; description: string }[];
  readonly unknowns: readonly string[];
  readonly priority: string;
  readonly risk: string;
  readonly expertRequirements: Parameters<typeof toExpertRequirements>[0];
  readonly environmentRequirements: Parameters<typeof toEnvironmentRequirements>[0];
  readonly taskRequirements: Parameters<typeof toTaskRequirements>[0];
  readonly evaluationRequirements: Parameters<typeof toEvaluationRequirements>[0];
  readonly verificationRequirements: Parameters<typeof toVerificationRequirements>[0];
}

function toObservedFailure(
  value: unknown,
): CapabilityCaseSeed['observedFailure'] {
  const candidate = expectObject(
    value,
    ['summary', 'observedAt'],
    ['reproduction'],
    'caseSeed.observedFailure',
  );
  const summary = expectNonEmptyString(
    candidate['summary'],
    'summary',
    'caseSeed.observedFailure',
  );
  const observedAt = expectPattern(
    candidate['observedAt'],
    TIMESTAMP_PATTERN,
    EPOCH_TIMESTAMP_PATTERN_SOURCE,
    'observedAt',
    'caseSeed.observedFailure',
  );
  const reproduction =
    typeof candidate['reproduction'] === 'string' &&
    candidate['reproduction'].length > 0
      ? candidate['reproduction']
      : undefined;
  return Object.freeze({
    summary,
    observedAt,
    ...(reproduction !== undefined ? { reproduction } : {}),
  });
}

/**
 * Validate the capability-case seed. The requirement blocks are validated
 * AUTHORITATIVELY by the A005 constructors when the adapter provisions the
 * case (createCapabilityCase → to*Requirements) — this layer only checks
 * the closed carrier shape and delegates the domain discipline.
 */
export function toCapabilityCaseSeed(value: unknown): CapabilityCaseSeed {
  const candidate = expectObject(
    value,
    [
      'problemStatement',
      'context',
      'desiredOutcome',
      'targetCapability',
      'domain',
      'observedFailure',
      'evidence',
      'unknowns',
      'priority',
      'risk',
      'expertRequirements',
      'environmentRequirements',
      'taskRequirements',
      'evaluationRequirements',
      'verificationRequirements',
    ],
    [],
    'caseSeed',
  );
  const problemStatement = expectNonEmptyString(
    candidate['problemStatement'],
    'problemStatement',
    'caseSeed',
  );
  const context = expectNonEmptyString(candidate['context'], 'context', 'caseSeed');
  const desiredOutcome = expectNonEmptyString(
    candidate['desiredOutcome'],
    'desiredOutcome',
    'caseSeed',
  );
  const targetCapability = toCapabilitySeedRef(
    candidate['targetCapability'],
    'caseSeed.targetCapability',
  );
  const domain = toCapabilitySeedRef(candidate['domain'], 'caseSeed.domain');
  const observedFailure = toObservedFailure(candidate['observedFailure']);
  if (!Array.isArray(candidate['evidence'])) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'caseSeed.evidence must be an array of digest-addressed refs',
      details: { context: 'caseSeed', field: 'evidence' },
    });
  }
  const evidence: { digest: string; description: string }[] = [];
  for (const entry of candidate['evidence']) {
    const refCandidate = expectObject(
      entry,
      ['digest', 'description'],
      [],
      'caseSeed.evidence[]',
    );
    evidence.push(
      Object.freeze({
        digest: expectDigest(refCandidate['digest'], 'digest', 'caseSeed.evidence[]'),
        description: expectNonEmptyString(
          refCandidate['description'],
          'description',
          'caseSeed.evidence[]',
        ),
      }),
    );
  }
  const unknowns = expectStringArray(candidate['unknowns'], 'unknowns', 'caseSeed');
  const priority = candidate['priority'];
  if (typeof priority !== 'string' || !isCasePriority(priority)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: `caseSeed.priority must be one of the A005 case priorities`,
      details: { context: 'caseSeed', field: 'priority', supported: CASE_PRIORITIES },
    });
  }
  const risk = candidate['risk'];
  if (typeof risk !== 'string' || !isCaseRisk(risk)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'caseSeed.risk must be one of the A005 case risk levels',
      details: { context: 'caseSeed', field: 'risk', supported: CASE_RISK_LEVELS },
    });
  }
  for (const block of [
    'expertRequirements',
    'environmentRequirements',
    'taskRequirements',
    'evaluationRequirements',
    'verificationRequirements',
  ] as const) {
    if (!isPlainObject(candidate[block])) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
        message: `caseSeed.${block} must be a plain object (validated by the A005 requirement constructors)`,
        details: { context: 'caseSeed', field: block },
      });
    }
  }
  const seed: CapabilityCaseSeed = {
    problemStatement,
    context,
    desiredOutcome,
    targetCapability,
    domain,
    observedFailure,
    evidence: Object.freeze(evidence),
    unknowns,
    priority,
    risk,
    expertRequirements: candidate['expertRequirements'] as CapabilityCaseSeed['expertRequirements'],
    environmentRequirements:
      candidate['environmentRequirements'] as CapabilityCaseSeed['environmentRequirements'],
    taskRequirements: candidate['taskRequirements'] as CapabilityCaseSeed['taskRequirements'],
    evaluationRequirements:
      candidate['evaluationRequirements'] as CapabilityCaseSeed['evaluationRequirements'],
    verificationRequirements:
      candidate['verificationRequirements'] as CapabilityCaseSeed['verificationRequirements'],
  };
  return Object.freeze(seed);
}

// ---------------------------------------------------------------------------
// The EPI1.0 CapabilityDevelopmentRequest
// ---------------------------------------------------------------------------

export interface CapabilityDevelopmentRequest {
  readonly requestVersion: typeof EPOCH_REQUEST_VERSION;
  readonly requestId: string;
  readonly requestedAt: string;
  readonly tenant: TenantScope;
  readonly idempotencyKey: IdempotencyKey;
  readonly correlationId?: CorrelationId;
  readonly causationId?: string;
  readonly authorization: EpochAuthorizationMetadata;
  readonly targetReleaseChannel: ReleaseChannel;
  readonly caseSeed: CapabilityCaseSeed;
  readonly failedTrajectoryRefs: readonly FailedTrajectoryRef[];
  readonly evaluationGaps: readonly EvaluationGap[];
  readonly requirements: CapabilityDomainRequirements;
}

export function isCapabilityDevelopmentRequest(
  value: unknown,
): value is CapabilityDevelopmentRequest {
  try {
    toCapabilityDevelopmentRequest(value);
    return true;
  } catch {
    return false;
  }
}

/** Strict, fail-closed parse of an incoming EPI1.0 request (closed shape). */
export function toCapabilityDevelopmentRequest(
  value: unknown,
): CapabilityDevelopmentRequest {
  const candidate = expectObject(
    value,
    [
      'requestVersion',
      'requestId',
      'requestedAt',
      'tenant',
      'idempotencyKey',
      'authorization',
      'targetReleaseChannel',
      'caseSeed',
      'failedTrajectoryRefs',
      'evaluationGaps',
      'requirements',
    ],
    ['correlationId', 'causationId'],
    'capabilityDevelopmentRequest',
  );
  if (candidate['requestVersion'] !== EPOCH_REQUEST_VERSION) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION, {
      message: `capability development request version must be ${EPOCH_REQUEST_VERSION}`,
      details: { supported: EPOCH_REQUEST_VERSION },
    });
  }
  const requestId = expectPattern(
    candidate['requestId'],
    REQUEST_ID_PATTERN,
    EPOCH_REQUEST_ID_PATTERN_SOURCE,
    'requestId',
    'capabilityDevelopmentRequest',
  );
  const requestedAt = expectPattern(
    candidate['requestedAt'],
    TIMESTAMP_PATTERN,
    EPOCH_TIMESTAMP_PATTERN_SOURCE,
    'requestedAt',
    'capabilityDevelopmentRequest',
  );
  if (typeof candidate['tenant'] !== 'string' || !isTenantScope(candidate['tenant'])) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'capability development request tenant must match the tenant pattern',
      details: { field: 'tenant', pattern: '^[a-z][a-z0-9-]{1,62}$' },
    });
  }
  if (
    typeof candidate['idempotencyKey'] !== 'string' ||
    !isIdempotencyKey(candidate['idempotencyKey'])
  ) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.IDEMPOTENCY_REQUIRED, {
      message:
        'capability development requests REQUIRE an idempotency key (architecture-lock rule 17: commands carry idempotency keys)',
      details: { field: 'idempotencyKey', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
    });
  }
  if (
    candidate['correlationId'] !== undefined &&
    (typeof candidate['correlationId'] !== 'string' ||
      !IDENTIFIER_PATTERN.test(candidate['correlationId']))
  ) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'capability development request correlationId must match the identifier charset',
      details: { field: 'correlationId', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
    });
  }
  if (
    candidate['causationId'] !== undefined &&
    (typeof candidate['causationId'] !== 'string' ||
      !IDENTIFIER_PATTERN.test(candidate['causationId']))
  ) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'capability development request causationId must match the identifier charset',
      details: { field: 'causationId', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
    });
  }
  const authorization = toEpochAuthorizationMetadata(candidate['authorization']);
  const targetReleaseChannel = candidate['targetReleaseChannel'];
  if (
    typeof targetReleaseChannel !== 'string' ||
    !isReleaseChannel(targetReleaseChannel)
  ) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'capability development request targetReleaseChannel must be an A024 release channel',
      details: { field: 'targetReleaseChannel', supported: 'development|candidate|stable' },
    });
  }
  const caseSeed = toCapabilityCaseSeed(candidate['caseSeed']);
  if (!Array.isArray(candidate['failedTrajectoryRefs'])) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'capability development request failedTrajectoryRefs must be an array',
      details: { field: 'failedTrajectoryRefs' },
    });
  }
  const failedTrajectoryRefs = Object.freeze(
    candidate['failedTrajectoryRefs'].map((entry) => toFailedTrajectoryRef(entry)),
  );
  if (!Array.isArray(candidate['evaluationGaps'])) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'capability development request evaluationGaps must be an array',
      details: { field: 'evaluationGaps' },
    });
  }
  const evaluationGaps = Object.freeze(
    candidate['evaluationGaps'].map((entry) => toEvaluationGap(entry)),
  );
  const requirements = toCapabilityDomainRequirements(candidate['requirements']);
  const request: CapabilityDevelopmentRequest = {
    requestVersion: EPOCH_REQUEST_VERSION,
    requestId,
    requestedAt,
    tenant: candidate['tenant'],
    idempotencyKey: candidate['idempotencyKey'] as IdempotencyKey,
    ...(candidate['correlationId'] !== undefined
      ? { correlationId: candidate['correlationId'] as CorrelationId }
      : {}),
    ...(candidate['causationId'] !== undefined
      ? { causationId: candidate['causationId'] as string }
      : {}),
    authorization,
    targetReleaseChannel,
    caseSeed,
    failedTrajectoryRefs,
    evaluationGaps,
    requirements,
  };
  return Object.freeze(request);
}
