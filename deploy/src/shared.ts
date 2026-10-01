/**
 * Deployment schema primitives (Work Order A036, DEP1.0).
 *
 * House style: closed vocabularies, frozen record types, fail-closed
 * validation with typed errors. No clock, no randomness, no ambient
 * state — everything here is a pure, deterministic function of its
 * inputs.
 */

/** Wire version of every deployment record. */
export const DEPLOYMENT_SCHEMA_VERSION = 1 as const;

/** Closed environment-tier vocabulary (promotion order, see ops/). */
export const DEPLOY_TIERS = Object.freeze(['dev', 'staging', 'production'] as const);
export type DeployTier = (typeof DEPLOY_TIERS)[number];

export function isDeployTier(value: unknown): value is DeployTier {
  return typeof value === 'string' && (DEPLOY_TIERS as readonly string[]).includes(value);
}

/** Tier rank — promotion may only move upward one tier at a time. */
export const TIER_RANK: Readonly<Record<DeployTier, number>> = Object.freeze({
  dev: 0,
  staging: 1,
  production: 2,
});

/** Closed security-gate vocabulary (A034 gates the pipeline enforces). */
export const SECURITY_GATE_KINDS = Object.freeze([
  'artifact-signature-verified',
  'audit-chain-intact',
  'tenant-isolation-verified',
  'isolation-boundary-approved',
] as const);
export type SecurityGateKind = (typeof SECURITY_GATE_KINDS)[number];

export function isSecurityGateKind(value: unknown): value is SecurityGateKind {
  return (
    typeof value === 'string' &&
    (SECURITY_GATE_KINDS as readonly string[]).includes(value)
  );
}

/** Closed health-gate failure policies. 'fail-closed' is the default. */
export const HEALTH_GATE_POLICIES = Object.freeze(['fail-closed', 'fail-open'] as const);
export type HealthGatePolicy = (typeof HEALTH_GATE_POLICIES)[number];

export function isHealthGatePolicy(value: unknown): value is HealthGatePolicy {
  return (
    typeof value === 'string' &&
    (HEALTH_GATE_POLICIES as readonly string[]).includes(value)
  );
}

/** Closed deployment error codes. */
export const DEPLOY_ERROR_CODES = Object.freeze({
  INVALID_TOPOLOGY: 'DEP_INVALID_TOPOLOGY',
  INVALID_SERVICE_DEPLOYMENT: 'DEP_INVALID_SERVICE_DEPLOYMENT',
  UNKNOWN_SLO: 'DEP_UNKNOWN_SLO',
  SLO_SERVICE_MISMATCH: 'DEP_SLO_SERVICE_MISMATCH',
  MISSING_HEALTH_GATE: 'DEP_MISSING_HEALTH_GATE',
  GATE_FAILED: 'DEP_GATE_FAILED',
  GATE_NO_DATA: 'DEP_GATE_NO_DATA',
} as const);
export type DeployErrorCode =
  (typeof DEPLOY_ERROR_CODES)[keyof typeof DEPLOY_ERROR_CODES];

/** Typed, fail-closed deployment error. */
export class DeployError extends Error {
  readonly code: DeployErrorCode;
  constructor(code: DeployErrorCode, detail: string) {
    super(`[${code}] ${detail}`);
    this.name = 'DeployError';
    this.code = code;
  }
}

const NEUTRAL_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function isDeployId(value: unknown): value is string {
  return typeof value === 'string' && NEUTRAL_ID_PATTERN.test(value);
}

/** Content digests are sha256-hex (digestCanonical output). */
export function isDigestHex(value: unknown): value is string {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
