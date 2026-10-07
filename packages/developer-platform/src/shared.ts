/**
 * Developer-platform shared vocabulary (Work Order C017): branded
 * identifiers, patterns, environments, the secret-hasher port and the
 * truth-label law labels.
 *
 * Reuses the C001 escalation domain's client-app / tenant identity
 * vocabulary (same identifiers — never a second identity model) and the
 * protocol-core canonical conventions.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ClientAppId, TenantId } from '@arena/escalation';

// ---------------------------------------------------------------------------
// Branded identifiers + patterns (house style: pattern sources exported)
// ---------------------------------------------------------------------------

/** Developer API key id (the NON-secret handle: `devkey_<32 hex>`). */
export type DeveloperKeyId = string & { readonly __brand: 'DeveloperKeyId' };
/** Developer webhook endpoint id: `devhook_<32 hex>`. */
export type WebhookEndpointId = string & { readonly __brand: 'WebhookEndpointId' };
/** Sandbox run id: `sbrun_<32 hex>`. */
export type SandboxRunId = string & { readonly __brand: 'SandboxRunId' };

export const DEVELOPER_KEY_ID_PATTERN_SOURCE = '^devkey_[0-9a-f]{32}$';
export const WEBHOOK_ENDPOINT_ID_PATTERN_SOURCE = '^devhook_[0-9a-f]{32}$';
export const SANDBOX_RUN_ID_PATTERN_SOURCE = '^sbrun_[0-9a-f]{32}$';

/** API key SECRET wire form: `dak_<environment>_<32 bytes hex>`. Never persisted in the clear. */
export const DEVELOPER_KEY_SECRET_PATTERN_SOURCE = '^dak_(sandbox|live)_[0-9a-f]{64}$';
/** Webhook SIGNING secret wire form: `whsec_<32 bytes hex>`. Shown once at registration. */
export const WEBHOOK_SIGNING_SECRET_PATTERN_SOURCE = '^whsec_[0-9a-f]{64}$';

const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function isDeveloperKeyId(value: unknown): value is DeveloperKeyId {
  return typeof value === 'string' && /^devkey_[0-9a-f]{32}$/.test(value);
}
export function isWebhookEndpointId(value: unknown): value is WebhookEndpointId {
  return typeof value === 'string' && /^devhook_[0-9a-f]{32}$/.test(value);
}
export function isSandboxRunId(value: unknown): value is SandboxRunId {
  return typeof value === 'string' && /^sbrun_[0-9a-f]{32}$/.test(value);
}
export function isDeveloperKeySecret(value: unknown): value is DeveloperKeySecret {
  return typeof value === 'string' && /^dak_(sandbox|live)_[0-9a-f]{64}$/.test(value);
}
export function isWebhookSigningSecret(value: unknown): value is WebhookSigningSecret {
  return typeof value === 'string' && /^whsec_[0-9a-f]{64}$/.test(value);
}

export function toDeveloperKeyId(value: string): DeveloperKeyId {
  if (!isDeveloperKeyId(value)) {
    throw new TypeError(`not a DeveloperKeyId: ${JSON.stringify(value)} (${DEVELOPER_KEY_ID_PATTERN_SOURCE})`);
  }
  return value;
}
export function toWebhookEndpointId(value: string): WebhookEndpointId {
  if (!isWebhookEndpointId(value)) {
    throw new TypeError(`not a WebhookEndpointId: ${JSON.stringify(value)} (${WEBHOOK_ENDPOINT_ID_PATTERN_SOURCE})`);
  }
  return value;
}
export function toSandboxRunId(value: string): SandboxRunId {
  if (!isSandboxRunId(value)) {
    throw new TypeError(`not a SandboxRunId: ${JSON.stringify(value)} (${SANDBOX_RUN_ID_PATTERN_SOURCE})`);
  }
  return value;
}

/** Branded API key secret (presentation-only type — value is the wire string). */
export type DeveloperKeySecret = string & { readonly __brand: 'DeveloperKeySecret' };
/** Branded webhook signing secret. */
export type WebhookSigningSecret = string & { readonly __brand: 'WebhookSigningSecret' };

export type { ClientAppId, TenantId };

// ---------------------------------------------------------------------------
// Environments + truth labels (the C010/C001 truth-label law)
// ---------------------------------------------------------------------------

/** The two key/escalation environments. A sandbox key NEVER authorizes live surface use. */
export const DEVELOPER_KEY_ENVIRONMENTS = Object.freeze(['sandbox', 'live'] as const);
export type DeveloperKeyEnvironment = (typeof DEVELOPER_KEY_ENVIRONMENTS)[number];

export function isDeveloperKeyEnvironment(value: unknown): value is DeveloperKeyEnvironment {
  return value === 'sandbox' || value === 'live';
}

/**
 * The truth label attached to every developer-platform projection
 * (UX state vocabulary: demo/sandbox data is never presented as
 * customer-authoritative data). `demo` marks portal demo corpora;
 * `sandbox` marks deterministic sandbox runs; `live` marks real traffic.
 */
export const DEVELOPER_TRUTH_LABELS = Object.freeze(['live', 'sandbox', 'demo'] as const);
export type DeveloperTruthLabel = (typeof DEVELOPER_TRUTH_LABELS)[number];

// ---------------------------------------------------------------------------
// Timestamps (injected-time only — never a wall clock)
// ---------------------------------------------------------------------------

/** ISO-8601 UTC instant (the house wire timestamp form). */
export type DeveloperTimestamp = string;

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isDeveloperTimestamp(value: unknown): value is DeveloperTimestamp {
  return typeof value === 'string' && TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

export function toDeveloperTimestamp(input: number | string | Date): DeveloperTimestamp {
  const date = input instanceof Date ? input : new Date(input);
  const iso = date.toISOString();
  if (Number.isNaN(Date.parse(iso))) {
    throw new TypeError(`not a developer timestamp: ${JSON.stringify(String(input))}`);
  }
  return iso;
}

// ---------------------------------------------------------------------------
// Secret hashing port (secrets never enter generic trajectories)
// ---------------------------------------------------------------------------

/** Deterministic secret material generator (sync; injected in tests). */
export interface SecretMaterialGenerator {
  /** 32 random bytes as lowercase hex (64 chars). */
  readonly bytes32Hex: () => string;
}

/** Secret hashing port — sha256-at-rest + constant-time comparison. */
export interface SecretHasher {
  /** The at-rest hash of a secret (the ONLY thing persisted). */
  readonly hash: (secret: string) => string;
  /** Constant-time secret comparison against a stored hash. */
  readonly matches: (secret: string, storedHash: string) => boolean;
}

/** Reference hasher: sha256 hex, constant-time compare (node:crypto). */
export function createNodeSecretHasher(): SecretHasher {
  return {
    hash: (secret) => createHash('sha256').update(secret, 'utf8').digest('hex'),
    matches: (secret, storedHash) => {
      const candidate = createHash('sha256').update(secret, 'utf8').digest('hex');
      const a = Buffer.from(candidate, 'utf8');
      const b = Buffer.from(storedHash, 'utf8');
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}

/** Reference generator: node:crypto random bytes (sync). */
export function createNodeSecretMaterialGenerator(): SecretMaterialGenerator {
  return { bytes32Hex: () => randomBytes(32).toString('hex') };
}

function requireHex64(material: SecretMaterialGenerator): string {
  const hex = material.bytes32Hex();
  if (!HEX64.test(hex)) {
    throw new TypeError('secret material generator must produce 32 bytes as 64 hex chars');
  }
  return hex;
}

/** A new non-secret key id over injected material (first half of 32 bytes). */
export function newDeveloperKeyId(material: SecretMaterialGenerator): DeveloperKeyId {
  const hex = requireHex64(material).slice(0, 32);
  return `devkey_${hex}` as DeveloperKeyId;
}

/** A new webhook endpoint id over injected material. */
export function newWebhookEndpointId(material: SecretMaterialGenerator): WebhookEndpointId {
  const hex = requireHex64(material).slice(0, 32);
  return `devhook_${hex}` as WebhookEndpointId;
}

/** A new sandbox run id over injected material. */
export function newSandboxRunId(material: SecretMaterialGenerator): SandboxRunId {
  const hex = requireHex64(material).slice(0, 32);
  return `sbrun_${hex}` as SandboxRunId;
}

/** A new key secret for an environment over injected material. */
export function newDeveloperKeySecret(
  environment: DeveloperKeyEnvironment,
  material: SecretMaterialGenerator,
): DeveloperKeySecret {
  return `dak_${environment}_${requireHex64(material)}` as DeveloperKeySecret;
}

/** A new webhook signing secret over injected material. */
export function newWebhookSigningSecret(material: SecretMaterialGenerator): WebhookSigningSecret {
  return `whsec_${requireHex64(material)}` as WebhookSigningSecret;
}
