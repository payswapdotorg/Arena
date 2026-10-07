/**
 * Developer API key domain (Work Order C017) — the authentication
 * surface for EXTERNAL CLIENT APPLICATIONS (ES1.0's client_app_id
 * holders: AI apps like Epoch integrating with the Arena escalation
 * API).
 *
 * THE LAW (spec/roles-and-contexts.md + architecture lock rule 9):
 * an API key AUTHENTICATES a client application — it NEVER confers
 * role authority. Scopes below are client-application capabilities
 * over the PUBLIC escalation boundary only; every human-role decision
 * (expert matching, validation verdicts, payment operations) stays in
 * the domain cores behind the boundary. Key management itself is a
 * PORTAL (authenticated session) operation — there is deliberately NO
 * `keys:manage` scope: a key can never mint another key.
 *
 * Lifecycle: `active` → (`rotated` | `revoked`) — both are APPEND-ONLY
 * status transitions; the full history is retained on the record and
 * records are never deleted. Rotation mints a successor key (new id +
 * new secret, `rotatedFrom` chain); revocation is terminal.
 *
 * Secrets: `dak_<environment>_<64 hex>` — shown ONCE at issuance /
 * rotation, stored ONLY as a sha256 hash (SecretHasher port; secrets
 * never enter generic trajectories, never appear in wire forms).
 */

import { isClientAppId, isTenantId } from '@arena/escalation';

import {
  DEVELOPER_PLATFORM_ERROR_CODES,
  DeveloperPlatformError,
} from './errors.js';
import {
  isDeveloperKeySecret,
  newDeveloperKeyId,
  newDeveloperKeySecret,
} from './shared.js';
import type {
  ClientAppId,
  DeveloperKeyEnvironment,
  DeveloperKeyId,
  DeveloperKeySecret,
  DeveloperTimestamp,
  SecretHasher,
  SecretMaterialGenerator,
  TenantId,
} from './shared.js';

// ---------------------------------------------------------------------------
// Scopes — closed vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed client-application scope vocabulary. `escalations:create`
 * authorizes LIVE escalation creation; `sandbox:run` authorizes
 * deterministic sandbox escalations only. There is no `keys:manage`
 * scope BY DESIGN (see module law).
 */
export const DEVELOPER_KEY_SCOPES = Object.freeze([
  'escalations:create',
  'escalations:read',
  'sandbox:run',
  'webhooks:manage',
  'observability:read',
] as const);
export type DeveloperKeyScope = (typeof DEVELOPER_KEY_SCOPES)[number];

export function isDeveloperKeyScope(value: unknown): value is DeveloperKeyScope {
  return (
    typeof value === 'string' &&
    (DEVELOPER_KEY_SCOPES as readonly string[]).includes(value)
  );
}

const LIVE_SCOPES: readonly DeveloperKeyScope[] = Object.freeze([
  'escalations:create',
  'escalations:read',
  'webhooks:manage',
  'observability:read',
]);
const SANDBOX_SCOPES: readonly DeveloperKeyScope[] = Object.freeze([
  'sandbox:run',
  'escalations:read',
  'webhooks:manage',
  'observability:read',
]);

/** Scopes valid for each environment (sandbox keys can never touch live surfaces). */
export const ENVIRONMENT_SCOPE_ALLOWLIST: Readonly<
  Record<DeveloperKeyEnvironment, readonly DeveloperKeyScope[]>
> = Object.freeze({ live: LIVE_SCOPES, sandbox: SANDBOX_SCOPES });

// ---------------------------------------------------------------------------
// Key record + append-only status history
// ---------------------------------------------------------------------------

export const DEVELOPER_KEY_RECORD_VERSION = 1 as const;

export const DEVELOPER_KEY_STATUSES = Object.freeze(['active', 'rotated', 'revoked'] as const);
export type DeveloperKeyStatus = (typeof DEVELOPER_KEY_STATUSES)[number];

/** One append-only status transition entry (history is retained forever). */
export interface DeveloperKeyStatusHistoryEntry {
  readonly status: DeveloperKeyStatus;
  readonly at: DeveloperTimestamp;
  /** Why the transition happened (closed vocabulary below). */
  readonly reason: DeveloperKeyTransitionReason;
  /** The key this one was rotated INTO (rotation entries only). */
  readonly rotatedTo?: DeveloperKeyId;
}

export const DEVELOPER_KEY_TRANSITION_REASONS = Object.freeze([
  'issued',
  'rotated-by-owner',
  'revoked-by-owner',
] as const);
export type DeveloperKeyTransitionReason =
  (typeof DEVELOPER_KEY_TRANSITION_REASONS)[number];

/**
 * The PUBLIC key projection — carries NO secret material (the hash
 * lives separately in the store's secret binding).
 */
export interface DeveloperKeyRecord {
  readonly keyVersion: typeof DEVELOPER_KEY_RECORD_VERSION;
  readonly keyId: DeveloperKeyId;
  readonly clientAppId: ClientAppId;
  readonly tenantId: TenantId;
  readonly environment: DeveloperKeyEnvironment;
  readonly scopes: readonly DeveloperKeyScope[];
  readonly label: string;
  readonly status: DeveloperKeyStatus;
  readonly createdAt: DeveloperTimestamp;
  readonly updatedAt: DeveloperTimestamp;
  /** Last successful authorization (observability; never a secret). */
  readonly lastUsedAt?: DeveloperTimestamp;
  /** Successor key (set when this key was rotated). */
  readonly rotatedTo?: DeveloperKeyId;
  /** Predecessor key (set on keys minted by rotation). */
  readonly rotatedFrom?: DeveloperKeyId;
  /** Append-only, frozen, contiguous 1..n. */
  readonly history: readonly DeveloperKeyStatusHistoryEntry[];
}

/** The at-rest secret binding — hash only, never the secret. */
export interface DeveloperKeySecretBinding {
  readonly keyId: DeveloperKeyId;
  /** sha256 hash of the wire secret (SecretHasher port). */
  readonly secretHash: string;
  readonly createdAt: DeveloperTimestamp;
}

/** The one-time issuance outcome: record + at-rest binding + the secret shown exactly once. */
export interface DeveloperKeyIssuance {
  readonly record: DeveloperKeyRecord;
  readonly binding: DeveloperKeySecretBinding;
  /** The plaintext secret. Shown once, never persisted, never logged. */
  readonly secret: DeveloperKeySecret;
}

// ---------------------------------------------------------------------------
// Issuance / rotation / revocation (append-only transitions)
// ---------------------------------------------------------------------------

export interface IssueDeveloperKeyInput {
  readonly clientAppId: string;
  readonly tenantId: string;
  readonly environment: DeveloperKeyEnvironment;
  readonly scopes: readonly string[];
  readonly label: string;
  readonly now: number | string | Date;
}

function assertIdShapes(clientAppId: string, tenantId: string): void {
  if (!isClientAppId(clientAppId)) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_CLIENT_APP, {
      message: `clientAppId must match the ES1.0 client-app pattern: ${JSON.stringify(clientAppId)}`,
      details: { clientAppId },
    });
  }
  if (!isTenantId(tenantId)) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
      message: `tenantId must match the tenant pattern: ${JSON.stringify(tenantId)}`,
      details: { tenantId },
    });
  }
}

function assertScopes(
  environment: DeveloperKeyEnvironment,
  scopes: readonly string[],
): asserts scopes is readonly DeveloperKeyScope[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_SCOPE, {
      message: 'a developer key requires at least one scope',
      details: { scopes },
    });
  }
  const allowlist = ENVIRONMENT_SCOPE_ALLOWLIST[environment];
  for (const scope of scopes) {
    if (!isDeveloperKeyScope(scope)) {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_SCOPE, {
        message: `unknown developer key scope: ${JSON.stringify(scope)}`,
        details: { scope, valid: DEVELOPER_KEY_SCOPES },
      });
    }
    if (!allowlist.includes(scope)) {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.ENVIRONMENT_MISMATCH, {
        message: `scope ${scope} is not valid for a ${environment} key (sandbox keys can never touch live surfaces and live keys never run sandbox escalations)`,
        details: { scope, environment, allowlist },
      });
    }
  }
  if (new Set(scopes).size !== scopes.length) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_SCOPE, {
      message: 'duplicate scopes in key issuance',
      details: { scopes },
    });
  }
}

function toTimestamp(input: number | string | Date): DeveloperTimestamp {
  const date = input instanceof Date ? input : new Date(input);
  const iso = date.toISOString();
  if (Number.isNaN(Date.parse(iso))) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
      message: `not a timestamp: ${JSON.stringify(String(input))}`,
    });
  }
  return iso;
}

/** Issue a NEW key (fail-closed validation; secret returned exactly once). */
export function issueDeveloperKey(
  input: IssueDeveloperKeyInput,
  deps: { readonly hasher: SecretHasher; readonly material: SecretMaterialGenerator },
): DeveloperKeyIssuance {
  assertIdShapes(input.clientAppId, input.tenantId);
  assertScopes(input.environment, input.scopes);
  if (typeof input.label !== 'string' || input.label.length === 0 || input.label.length > 120) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
      message: 'key label must be a non-empty string (<= 120 chars)',
      details: { label: input.label },
    });
  }
  const at = toTimestamp(input.now);
  const keyId = newDeveloperKeyId(deps.material);
  const secret = newDeveloperKeySecret(input.environment, deps.material);
  const record: DeveloperKeyRecord = Object.freeze({
    keyVersion: DEVELOPER_KEY_RECORD_VERSION,
    keyId,
    clientAppId: input.clientAppId as ClientAppId,
    tenantId: input.tenantId as TenantId,
    environment: input.environment,
    scopes: Object.freeze([...input.scopes]),
    label: input.label,
    status: 'active',
    createdAt: at,
    updatedAt: at,
    history: Object.freeze([
      Object.freeze({ status: 'active' as const, at, reason: 'issued' as const }),
    ]),
  });
  const binding: DeveloperKeySecretBinding = Object.freeze({
    keyId,
    secretHash: deps.hasher.hash(secret),
    createdAt: at,
  });
  return { record, binding, secret };
}

/**
 * Rotate a key: the old record becomes `rotated` (append-only history,
 * `rotatedTo` pointer) and a successor key + secret is minted.
 * Revoked keys are terminal — rotation of a revoked key fails closed.
 */
export function rotateDeveloperKey(
  record: DeveloperKeyRecord,
  deps: { readonly hasher: SecretHasher; readonly material: SecretMaterialGenerator },
  options: { readonly now: number | string | Date },
): { readonly successor: DeveloperKeyIssuance; readonly rotated: DeveloperKeyRecord } {
  if (record.status === 'revoked') {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.KEY_REVOKED, {
      message: `key ${record.keyId} is revoked — revocation is terminal; issue a fresh key instead`,
      details: { keyId: record.keyId },
    });
  }
  if (record.status === 'rotated') {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.KEY_ROTATED, {
      message: `key ${record.keyId} was already rotated (successor ${record.rotatedTo ?? 'unknown'})`,
      details: { keyId: record.keyId, rotatedTo: record.rotatedTo },
    });
  }
  const at = toTimestamp(options.now);
  const successor = issueDeveloperKey(
    {
      clientAppId: record.clientAppId,
      tenantId: record.tenantId,
      environment: record.environment,
      scopes: record.scopes,
      label: record.label,
      now: at,
    },
    deps,
  );
  const successorRecord: DeveloperKeyRecord = Object.freeze({
    ...successor.record,
    rotatedFrom: record.keyId,
  });
  const rotated: DeveloperKeyRecord = Object.freeze({
    ...record,
    status: 'rotated',
    updatedAt: at,
    rotatedTo: successor.record.keyId,
    history: Object.freeze([
      ...record.history,
      Object.freeze({
        status: 'rotated' as const,
        at,
        reason: 'rotated-by-owner' as const,
        rotatedTo: successor.record.keyId,
      }),
    ]),
  });
  return {
    successor: { record: successorRecord, binding: successor.binding, secret: successor.secret },
    rotated,
  };
}

/** Revoke a key (append-only, terminal, history retained). Idempotent-safe: revoking an already-revoked key is a typed failure. */
export function revokeDeveloperKey(
  record: DeveloperKeyRecord,
  options: { readonly now: number | string | Date },
): DeveloperKeyRecord {
  if (record.status === 'revoked') {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.KEY_REVOKED, {
      message: `key ${record.keyId} is already revoked (revocation at ${record.updatedAt})`,
      details: { keyId: record.keyId },
    });
  }
  const at = toTimestamp(options.now);
  return Object.freeze({
    ...record,
    status: 'revoked',
    updatedAt: at,
    history: Object.freeze([
      ...record.history,
      Object.freeze({ status: 'revoked' as const, at, reason: 'revoked-by-owner' as const }),
    ]),
  });
}

/** Record a successful authorization (observability stamp — never secret material). */
export function stampDeveloperKeyUsed(
  record: DeveloperKeyRecord,
  options: { readonly now: number | string | Date },
): DeveloperKeyRecord {
  const at = toTimestamp(options.now);
  return Object.freeze({ ...record, lastUsedAt: at });
}

// ---------------------------------------------------------------------------
// Authorization — the machine-readable verdict (never a bare boolean)
// ---------------------------------------------------------------------------

export const DEVELOPER_KEY_DENIAL_REASONS = Object.freeze([
  'key-not-found',
  'secret-invalid',
  'key-revoked',
  'key-rotated',
  'tenant-mismatch',
  'environment-mismatch',
  'scope-missing',
] as const);
export type DeveloperKeyDenialReason = (typeof DEVELOPER_KEY_DENIAL_REASONS)[number];

export type DeveloperKeyAuthorization =
  | { readonly outcome: 'authorized'; readonly record: DeveloperKeyRecord }
  | { readonly outcome: 'denied'; readonly reason: DeveloperKeyDenialReason };

/**
 * The fail-closed authorization verdict for ONE key request:
 * secret check → status check → tenancy check → environment check →
 * scope check, in that order, each denial carrying a closed reason.
 */
export function authorizeDeveloperKey(
  input: {
    readonly record: DeveloperKeyRecord | undefined;
    readonly binding: DeveloperKeySecretBinding | undefined;
    readonly presentedSecret: string;
    readonly tenantId: string;
    readonly environment: DeveloperKeyEnvironment;
    readonly scope: DeveloperKeyScope;
  },
  deps: { readonly hasher: SecretHasher },
): DeveloperKeyAuthorization {
  if (input.record === undefined || input.binding === undefined) {
    return { outcome: 'denied', reason: 'key-not-found' };
  }
  if (!isDeveloperKeySecret(input.presentedSecret)) {
    return { outcome: 'denied', reason: 'secret-invalid' };
  }
  if (!deps.hasher.matches(input.presentedSecret, input.binding.secretHash)) {
    return { outcome: 'denied', reason: 'secret-invalid' };
  }
  if (input.record.status === 'revoked') {
    return { outcome: 'denied', reason: 'key-revoked' };
  }
  if (input.record.status === 'rotated') {
    return { outcome: 'denied', reason: 'key-rotated' };
  }
  if (input.record.tenantId !== input.tenantId) {
    return { outcome: 'denied', reason: 'tenant-mismatch' };
  }
  if (input.record.environment !== input.environment) {
    return { outcome: 'denied', reason: 'environment-mismatch' };
  }
  if (!input.record.scopes.includes(input.scope)) {
    return { outcome: 'denied', reason: 'scope-missing' };
  }
  return { outcome: 'authorized', record: input.record };
}

/** Denial reason → typed error code (the service seam maps verdicts to errors). */
export const DENIAL_ERROR_CODES: Readonly<
  Record<DeveloperKeyDenialReason, (typeof DEVELOPER_PLATFORM_ERROR_CODES)[keyof typeof DEVELOPER_PLATFORM_ERROR_CODES]>
> = Object.freeze({
  'key-not-found': DEVELOPER_PLATFORM_ERROR_CODES.KEY_NOT_FOUND,
  'secret-invalid': DEVELOPER_PLATFORM_ERROR_CODES.SECRET_INVALID,
  'key-revoked': DEVELOPER_PLATFORM_ERROR_CODES.KEY_REVOKED,
  'key-rotated': DEVELOPER_PLATFORM_ERROR_CODES.KEY_ROTATED,
  'tenant-mismatch': DEVELOPER_PLATFORM_ERROR_CODES.CROSS_TENANT_ACCESS,
  'environment-mismatch': DEVELOPER_PLATFORM_ERROR_CODES.ENVIRONMENT_MISMATCH,
  'scope-missing': DEVELOPER_PLATFORM_ERROR_CODES.SCOPE_MISSING,
});

/** Wire projection of a key for portal lists — never secret material. */
export function developerKeyWire(record: DeveloperKeyRecord): Record<string, unknown> {
  return Object.freeze({
    keyVersion: record.keyVersion,
    keyId: record.keyId,
    clientAppId: record.clientAppId,
    tenantId: record.tenantId,
    environment: record.environment,
    scopes: record.scopes,
    label: record.label,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.lastUsedAt !== undefined ? { lastUsedAt: record.lastUsedAt } : {}),
    ...(record.rotatedTo !== undefined ? { rotatedTo: record.rotatedTo } : {}),
    ...(record.rotatedFrom !== undefined ? { rotatedFrom: record.rotatedFrom } : {}),
    history: record.history,
  });
}
