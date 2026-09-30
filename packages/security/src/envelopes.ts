/**
 * Envelope wiring for the security protocol (architecture-lock rules
 * 17, 18, 22; Work Order A034 — mirrors @arena/job-protocol's and
 * @arena/certification's envelope patterns exactly).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages
 * carry a correlation id, payloads are canonical-JSON serializable and
 * digest-checkable, and unknown envelope versions are rejected by the
 * core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned SchemaRefs in the `security` namespace
 * (arena:schema/security/<name>@<major.minor.patch>).
 *
 * CONTRACTS DISCLOSURE (A034, following the A019/A022 precedent): Work
 * Order A034 owns NO contracts/ surface (spec/work-items.md:
 * services/security/*, packages/security/*, tests/security/* only).
 * The choice made here: schemas live INSIDE the package as
 * SchemaRef-referenced data — the registry below is the authority for
 * the security namespace, and existing contracts are NOT redeclared.
 * There is deliberately no scripts/generate-contracts.mjs and no
 * contracts/security/ directory (governance G9 auto-discovers
 * package-level generators; this package ships none, so it contributes
 * no contract surface).
 *
 * Wire messages:
 *   - register-policy-bundle-command / policy-bundle-registered-event
 *     (registering a validated, content-addressed policy bundle);
 *   - evaluate-authorization-command / authorization-decided-event
 *     (one authorization evaluation; the event carries the closed
 *     decision AND the audit record the service sealed);
 *   - authorize-learning-command / learning-authorization-decided-event
 *     (one cross-tenant learning gate evaluation).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { SECURITY_ERROR_CODES, SecurityError } from './errors.js';
import { isAuthorizationAction } from './authorization.js';
import type { AuthorizationDecision } from './authorization.js';
import { isTenantScopedRef } from './tenancy.js';
import type { TenantScopedRef } from './tenancy.js';
import { isSecurityPrincipal } from './identity.js';
import type { SecurityPrincipal } from './identity.js';
import { toSecurityAuditEvent } from './audit.js';
import type { SecurityAuditEvent, SecurityAuditRecord } from './audit.js';
import {
  isLearningAuthorizationGrant,
} from './learning-authorization.js';
import type { LearningAuthorizationDecision } from './learning-authorization.js';
import { isDataRightsRecord } from './data-rights.js';

export const SECURITY_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/security (in-package
 * SchemaRef-referenced data — see the contracts disclosure above).
 */
export const SECURITY_SCHEMAS = Object.freeze({
  'security/principal': SECURITY_SCHEMA_VERSION,
  'security/tenant-record': SECURITY_SCHEMA_VERSION,
  'security/tenant-scoped-ref': SECURITY_SCHEMA_VERSION,
  'security/policy-statement': SECURITY_SCHEMA_VERSION,
  'security/policy-bundle': SECURITY_SCHEMA_VERSION,
  'security/authorization-decision': SECURITY_SCHEMA_VERSION,
  'security/data-rights': SECURITY_SCHEMA_VERSION,
  'security/learning-authorization-grant': SECURITY_SCHEMA_VERSION,
  'security/expert-rights': SECURITY_SCHEMA_VERSION,
  'security/model-data-policy': SECURITY_SCHEMA_VERSION,
  'security/security-audit-event': SECURITY_SCHEMA_VERSION,
  'security/security-audit-record': SECURITY_SCHEMA_VERSION,
  'security/register-policy-bundle-command': SECURITY_SCHEMA_VERSION,
  'security/policy-bundle-registered-event': SECURITY_SCHEMA_VERSION,
  'security/evaluate-authorization-command': SECURITY_SCHEMA_VERSION,
  'security/authorization-decided-event': SECURITY_SCHEMA_VERSION,
  'security/authorize-learning-command': SECURITY_SCHEMA_VERSION,
  'security/learning-authorization-decided-event': SECURITY_SCHEMA_VERSION,
  'security/schema-registry': SECURITY_SCHEMA_VERSION,
} as const);

export type SecuritySchemaName = keyof typeof SECURITY_SCHEMAS;

/** Resolve a security schema name to its SchemaRef. */
export function securitySchemaRef(name: SecuritySchemaName): SchemaRef {
  const version = SECURITY_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: `unknown security protocol schema: ${String(name)}`,
      details: { known: Object.keys(SECURITY_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a security schema at the registered version. */
export function isKnownSecuritySchema(ref: SchemaRef): boolean {
  const registered = (SECURITY_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface RegisterPolicyBundleCommandPayload {
  readonly bundle: unknown;
}

export interface PolicyBundleRegisteredEventPayload {
  readonly bundleId: string;
  readonly version: string;
  readonly digest: string;
  readonly statementCount: number;
}

export interface EvaluateAuthorizationCommandPayload {
  readonly principal: SecurityPrincipal;
  readonly action: string;
  readonly resource: TenantScopedRef;
  readonly evaluatedAt: string;
}

export interface AuthorizationDecidedEventPayload {
  readonly decision: AuthorizationDecision;
  readonly auditRecord: SecurityAuditRecord;
}

export interface AuthorizeLearningCommandPayload {
  readonly consumerTenant: string;
  readonly datasets: readonly TenantScopedRef[];
  readonly grants: readonly unknown[];
  readonly dataRights: Readonly<Record<string, unknown>>;
  readonly asOf: string;
}

export interface LearningAuthorizationDecidedEventPayload {
  readonly decision: LearningAuthorizationDecision;
  readonly auditRecord: SecurityAuditRecord;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

function schemaRefString(name: SecuritySchemaName): string {
  const ref = securitySchemaRef(name);
  return `arena:schema/${ref.namespace}/${ref.name}@${ref.version}`;
}

void schemaRefString;

/** Build a register-policy-bundle-command envelope. */
export function makeRegisterPolicyBundleCommand(
  payload: RegisterPolicyBundleCommandPayload,
  correlationId: CorrelationId,
  idempotencyKey: IdempotencyKey,
): Envelope<RegisterPolicyBundleCommandPayload> {
  if (typeof payload !== 'object' || payload === null || !('bundle' in payload)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_POLICY, {
      message: 'register-policy-bundle-command payload must carry the raw bundle',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: schemaRefString('security/register-policy-bundle-command'),
    correlationId,
    idempotencyKey,
    payload,
  });
}

/** Build a policy-bundle-registered-event envelope. */
export function makePolicyBundleRegisteredEvent(
  payload: PolicyBundleRegisteredEventPayload,
  correlationId: CorrelationId,
): Envelope<PolicyBundleRegisteredEventPayload> {
  return makeEnvelope({
    kind: 'event',
    schema: schemaRefString('security/policy-bundle-registered-event'),
    correlationId,
    idempotencyKey: null,
    payload,
  });
}

/**
 * Build an evaluate-authorization-command envelope. The principal,
 * action and resource are strictly validated BEFORE the envelope is
 * built — malformed commands never reach the wire.
 */
export function makeEvaluateAuthorizationCommand(
  payload: EvaluateAuthorizationCommandPayload,
  correlationId: CorrelationId,
  idempotencyKey: IdempotencyKey,
): Envelope<EvaluateAuthorizationCommandPayload> {
  if (!isSecurityPrincipal(payload.principal)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_PRINCIPAL, {
      message: 'evaluate-authorization-command payload.principal must be a validated SecurityPrincipal',
    });
  }
  if (!isAuthorizationAction(payload.action)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_ACTION, {
      message: `evaluate-authorization-command payload.action must be a closed-vocabulary action, got: ${String(payload.action)}`,
      details: { known: [...(isAuthorizationAction(payload.action) ? [] : [])] },
    });
  }
  if (!isTenantScopedRef(payload.resource)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_RESOURCE, {
      message: 'evaluate-authorization-command payload.resource must be a validated TenantScopedRef',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: schemaRefString('security/evaluate-authorization-command'),
    correlationId,
    idempotencyKey,
    payload: { ...payload, action: payload.action },
  });
}

/** Build an authorization-decided-event envelope. */
export function makeAuthorizationDecidedEvent(
  payload: AuthorizationDecidedEventPayload,
  correlationId: CorrelationId,
): Envelope<AuthorizationDecidedEventPayload> {
  return makeEnvelope({
    kind: 'event',
    schema: schemaRefString('security/authorization-decided-event'),
    correlationId,
    idempotencyKey: null,
    payload,
  });
}

/** Build an authorize-learning-command envelope. */
export function makeAuthorizeLearningCommand(
  payload: AuthorizeLearningCommandPayload,
  correlationId: CorrelationId,
  idempotencyKey: IdempotencyKey,
): Envelope<AuthorizeLearningCommandPayload> {
  for (const dataset of payload.datasets) {
    if (!isTenantScopedRef(dataset)) {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_RESOURCE, {
        message: 'authorize-learning-command payload.datasets entries must be validated TenantScopedRefs',
      });
    }
  }
  for (const grant of payload.grants) {
    if (grant !== null && grant !== undefined && !isLearningAuthorizationGrant(grant)) {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_GRANT, {
        message: 'authorize-learning-command payload.grants entries must be validated LearningAuthorizationGrants',
      });
    }
  }
  for (const rights of Object.values(payload.dataRights)) {
    if (rights !== null && rights !== undefined && !isDataRightsRecord(rights)) {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_DATA_RIGHTS, {
        message: 'authorize-learning-command payload.dataRights values must be validated DataRightsRecords',
      });
    }
  }
  return makeEnvelope({
    kind: 'command',
    schema: schemaRefString('security/authorize-learning-command'),
    correlationId,
    idempotencyKey,
    payload,
  });
}

/** Build a learning-authorization-decided-event envelope. */
export function makeLearningAuthorizationDecidedEvent(
  payload: LearningAuthorizationDecidedEventPayload,
  correlationId: CorrelationId,
): Envelope<LearningAuthorizationDecidedEventPayload> {
  return makeEnvelope({
    kind: 'event',
    schema: schemaRefString('security/learning-authorization-decided-event'),
    correlationId,
    idempotencyKey: null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsers (fail-closed: unknown schemas, malformed payloads rejected)
// ---------------------------------------------------------------------------

function parseSecurityEnvelope<T>(raw: string, name: SecuritySchemaName): Envelope<T> {
  return parseEnvelopeAs<T>(raw, securitySchemaRef(name));
}

function invalidPayload(message: string): never {
  throw new SecurityError(SECURITY_ERROR_CODES.INVALID_DECISION, {
    message,
  });
}

/** Parse + validate a register-policy-bundle-command envelope. */
export function parseRegisterPolicyBundleCommand(
  raw: string,
): Envelope<RegisterPolicyBundleCommandPayload> {
  const envelope = parseSecurityEnvelope<RegisterPolicyBundleCommandPayload>(
    raw,
    'security/register-policy-bundle-command',
  );
  if (
    typeof envelope.payload !== 'object' ||
    envelope.payload === null ||
    !('bundle' in envelope.payload)
  ) {
    invalidPayload('register-policy-bundle-command payload must carry the raw bundle');
  }
  return envelope;
}

/** Parse + validate a policy-bundle-registered-event envelope. */
export function parsePolicyBundleRegisteredEvent(
  raw: string,
): Envelope<PolicyBundleRegisteredEventPayload> {
  const envelope = parseSecurityEnvelope<PolicyBundleRegisteredEventPayload>(
    raw,
    'security/policy-bundle-registered-event',
  );
  const payload = envelope.payload;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload['bundleId'] !== 'string' ||
    typeof payload['digest'] !== 'string' ||
    typeof payload['statementCount'] !== 'number'
  ) {
    invalidPayload('policy-bundle-registered-event payload is malformed');
  }
  return envelope;
}

/** Parse + validate an evaluate-authorization-command envelope. */
export function parseEvaluateAuthorizationCommand(
  raw: string,
): Envelope<EvaluateAuthorizationCommandPayload> {
  const envelope = parseSecurityEnvelope<EvaluateAuthorizationCommandPayload>(
    raw,
    'security/evaluate-authorization-command',
  );
  const payload = envelope.payload;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !isSecurityPrincipal(payload['principal']) ||
    !isAuthorizationAction(payload['action']) ||
    !isTenantScopedRef(payload['resource'])
  ) {
    invalidPayload(
      'evaluate-authorization-command payload must carry a validated principal, a closed-vocabulary action and a validated tenant-scoped resource',
    );
  }
  return envelope;
}

/** Parse + validate an authorization-decided-event envelope. */
export function parseAuthorizationDecidedEvent(
  raw: string,
): Envelope<AuthorizationDecidedEventPayload> {
  const envelope = parseSecurityEnvelope<AuthorizationDecidedEventPayload>(
    raw,
    'security/authorization-decided-event',
  );
  const payload = envelope.payload;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('decision' in payload) ||
    !('auditRecord' in payload)
  ) {
    invalidPayload('authorization-decided-event payload must carry the decision and the audit record');
  }
  return envelope;
}

/** Parse + validate an authorize-learning-command envelope. */
export function parseAuthorizeLearningCommand(
  raw: string,
): Envelope<AuthorizeLearningCommandPayload> {
  const envelope = parseSecurityEnvelope<AuthorizeLearningCommandPayload>(
    raw,
    'security/authorize-learning-command',
  );
  const payload = envelope.payload;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload['consumerTenant'] !== 'string' ||
    !Array.isArray(payload['datasets'])
  ) {
    invalidPayload('authorize-learning-command payload is malformed');
  }
  return envelope;
}

/** Parse + validate a learning-authorization-decided-event envelope. */
export function parseLearningAuthorizationDecidedEvent(
  raw: string,
): Envelope<LearningAuthorizationDecidedEventPayload> {
  const envelope = parseSecurityEnvelope<LearningAuthorizationDecidedEventPayload>(
    raw,
    'security/learning-authorization-decided-event',
  );
  const payload = envelope.payload;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('decision' in payload) ||
    !('auditRecord' in payload)
  ) {
    invalidPayload('learning-authorization-decided-event payload must carry the decision and the audit record');
  }
  return envelope;
}

/** Digest helper (delegated to the core — never reimplemented). */
export async function securityEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/** Re-exported strict audit-event parser for envelope payload paths. */
export function parseAuditEventPayload(value: unknown): SecurityAuditEvent {
  return toSecurityAuditEvent(value);
}
