/**
 * Client-app + webhook registration (Work Order C017) — the ES1.0
 * `client_app_id` registration surface: the record that says "this
 * external AI application may integrate with the Arena escalation
 * API", plus the webhook endpoint/signing-secret pairing the C001
 * delivery seam (adapters/escalation drains the durable outbox to
 * registered endpoints, signing with the endpoint's material).
 *
 * Tenancy: a client app belongs to EXACTLY ONE tenant. Webhook
 * registration requires the `webhooks:manage` capability of an
 * authenticated API key (checked at the SERVICE seam — the domain
 * object itself stays pure).
 *
 * Secrets: the webhook signing secret is generated once, hashed at
 * rest via the SecretHasher port, and identified by `signingKeyId`
 * (the value the C001 WebhookEndpoint port consumes).
 */

import { isClientAppId, isTenantId } from '@arena/escalation';

import { DEVELOPER_PLATFORM_ERROR_CODES, DeveloperPlatformError } from './errors.js';
import {
  newWebhookEndpointId,
  newWebhookSigningSecret,
  toDeveloperTimestamp,
} from './shared.js';
import type {
  ClientAppId,
  DeveloperKeyEnvironment,
  DeveloperTimestamp,
  SecretHasher,
  SecretMaterialGenerator,
  TenantId,
  WebhookEndpointId,
  WebhookSigningSecret,
} from './shared.js';

export const CLIENT_APP_RECORD_VERSION = 1 as const;

/** A registered external client application (the ES1.0 client_app_id). */
export interface ClientAppRecord {
  readonly appVersion: typeof CLIENT_APP_RECORD_VERSION;
  readonly clientAppId: ClientAppId;
  readonly tenantId: TenantId;
  readonly displayName: string;
  readonly environment: DeveloperKeyEnvironment;
  readonly registeredAt: DeveloperTimestamp;
  /** Registered webhook endpoints (append-only list; disabled, never deleted). */
  readonly webhookEndpoints: readonly WebhookEndpointRecord[];
}

export const WEBHOOK_ENDPOINT_STATUSES = Object.freeze(['active', 'disabled'] as const);
export type WebhookEndpointStatus = (typeof WEBHOOK_ENDPOINT_STATUSES)[number];

export const WEBHOOK_URL_PATTERN_SOURCE =
  '^https://[a-z0-9][a-z0-9.-]*\\.[a-z]{2,}(/[A-Za-z0-9._~/-]*)?$';

function isWebhookUrl(value: string): boolean {
  return new RegExp(WEBHOOK_URL_PATTERN_SOURCE).test(value);
}

/** A registered webhook endpoint for C001 event delivery. */
export interface WebhookEndpointRecord {
  readonly endpointId: WebhookEndpointId;
  readonly url: string;
  /** Identifier of the endpoint's signing material (C001 WebhookEndpoint.signingKeyId). */
  readonly signingKeyId: string;
  readonly status: WebhookEndpointStatus;
  readonly createdAt: DeveloperTimestamp;
  readonly disabledAt?: DeveloperTimestamp;
}

/** The at-rest signing material binding — hash only, never the secret. */
export interface WebhookSigningBinding {
  readonly endpointId: WebhookEndpointId;
  readonly signingKeyId: string;
  /** sha256 hash of the signing secret (SecretHasher port). */
  readonly secretHash: string;
  readonly createdAt: DeveloperTimestamp;
}

/** One-time webhook registration outcome. */
export interface WebhookRegistration {
  readonly app: ClientAppRecord;
  readonly endpoint: WebhookEndpointRecord;
  readonly binding: WebhookSigningBinding;
  /** The plaintext signing secret. Shown once, never persisted. */
  readonly signingSecret: WebhookSigningSecret;
}

/** Register a client application (idempotent-safe: re-registration is a typed failure). */
export function registerClientApp(input: {
  readonly clientAppId: string;
  readonly tenantId: string;
  readonly displayName: string;
  readonly environment: DeveloperKeyEnvironment;
  readonly now: number | string | Date;
}): ClientAppRecord {
  if (!isClientAppId(input.clientAppId)) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_CLIENT_APP, {
      message: `clientAppId must match the ES1.0 pattern: ${JSON.stringify(input.clientAppId)}`,
      details: { clientAppId: input.clientAppId },
    });
  }
  if (!isTenantId(input.tenantId)) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
      message: `tenantId must match the tenant pattern: ${JSON.stringify(input.tenantId)}`,
      details: { tenantId: input.tenantId },
    });
  }
  if (
    typeof input.displayName !== 'string' ||
    input.displayName.length === 0 ||
    input.displayName.length > 120
  ) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
      message: 'client app displayName must be a non-empty string (<= 120 chars)',
      details: { displayName: input.displayName },
    });
  }
  return Object.freeze({
    appVersion: CLIENT_APP_RECORD_VERSION,
    clientAppId: input.clientAppId as ClientAppId,
    tenantId: input.tenantId as TenantId,
    displayName: input.displayName,
    environment: input.environment,
    registeredAt: toDeveloperTimestamp(input.now),
    webhookEndpoints: Object.freeze([]),
  });
}

/** Register a webhook endpoint on a client app (signing secret returned exactly once). */
export function registerWebhookEndpoint(
  app: ClientAppRecord,
  input: {
    readonly url: string;
    readonly now: number | string | Date;
  },
  deps: { readonly hasher: SecretHasher; readonly material: SecretMaterialGenerator },
): WebhookRegistration {
  if (!isWebhookUrl(input.url)) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_WEBHOOK, {
      message: `webhook url must be an https URL: ${JSON.stringify(input.url)}`,
      details: { url: input.url, pattern: WEBHOOK_URL_PATTERN_SOURCE },
    });
  }
  if (app.webhookEndpoints.some((endpoint) => endpoint.url === input.url)) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_WEBHOOK, {
      message: `webhook url already registered for ${app.clientAppId} (disable it or rotate its secret instead)`,
      details: { url: input.url, clientAppId: app.clientAppId },
    });
  }
  const at = toDeveloperTimestamp(input.now);
  const endpointId = newWebhookEndpointId(deps.material);
  const signingSecret = newWebhookSigningSecret(deps.material);
  const signingKeyId = `whsign_${endpointId.slice('devhook_'.length)}`;
  const endpoint: WebhookEndpointRecord = Object.freeze({
    endpointId,
    url: input.url,
    signingKeyId,
    status: 'active',
    createdAt: at,
  });
  const binding: WebhookSigningBinding = Object.freeze({
    endpointId,
    signingKeyId,
    secretHash: deps.hasher.hash(signingSecret),
    createdAt: at,
  });
  const updatedApp: ClientAppRecord = Object.freeze({
    ...app,
    webhookEndpoints: Object.freeze([...app.webhookEndpoints, endpoint]),
  });
  return { app: updatedApp, endpoint, binding, signingSecret };
}

/** Disable a webhook endpoint (append-only — never deleted; re-enable by re-registration). */
export function disableWebhookEndpoint(
  app: ClientAppRecord,
  endpointId: string,
  options: { readonly now: number | string | Date },
): ClientAppRecord {
  const at = toDeveloperTimestamp(options.now);
  let found = false;
  const endpoints = app.webhookEndpoints.map((endpoint) => {
    if (endpoint.endpointId !== endpointId) return endpoint;
    found = true;
    if (endpoint.status === 'disabled') {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_WEBHOOK, {
        message: `webhook endpoint ${endpointId} is already disabled`,
        details: { endpointId },
      });
    }
    return Object.freeze({ ...endpoint, status: 'disabled' as const, disabledAt: at });
  });
  if (!found) {
    throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_WEBHOOK, {
      message: `no webhook endpoint ${JSON.stringify(endpointId)} on ${app.clientAppId}`,
      details: { endpointId, clientAppId: app.clientAppId },
    });
  }
  return Object.freeze({ ...app, webhookEndpoints: Object.freeze(endpoints) });
}

/** Wire projection of a client app — never secret material. */
export function clientAppWire(app: ClientAppRecord): Record<string, unknown> {
  return Object.freeze({
    appVersion: app.appVersion,
    clientAppId: app.clientAppId,
    tenantId: app.tenantId,
    displayName: app.displayName,
    environment: app.environment,
    registeredAt: app.registeredAt,
    webhookEndpoints: app.webhookEndpoints,
  });
}
