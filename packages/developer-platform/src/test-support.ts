/**
 * Test support (Work Order C017) — deterministic fixtures for the
 * developer-platform test suites: a fixed material generator, a fixed
 * hasher, deterministic key/app fixtures. Mirrors the C001/C010
 * package test-support convention.
 */

import { createHash } from 'node:crypto';

import type { ClientAppRecord } from './client-apps.js';
import { registerClientApp } from './client-apps.js';
import type { DeveloperKeyIssuance } from './api-keys.js';
import { issueDeveloperKey } from './api-keys.js';
import type { SecretHasher, SecretMaterialGenerator } from './shared.js';

/** Deterministic sequential material (test-only; NEVER production). */
export class SequentialMaterial implements SecretMaterialGenerator {
  private counter = 0;
  constructor(private readonly prefix = 'a1b2c3d4e5f6') {}
  /** Deterministic 32 bytes (64 lowercase hex chars): prefix + counter + padding. */
  bytes32Hex(): string {
    this.counter += 1;
    const suffix = String(this.counter).padStart(6, '0');
    return `${this.prefix}${'0'.repeat(64 - this.prefix.length - suffix.length)}${suffix}`;
  }
}

/** Deterministic sha256 hasher (test-only; same algorithm as production). */
export const deterministicHasher: SecretHasher = {
  hash: (secret) => createHash('sha256').update(secret, 'utf8').digest('hex'),
  matches: (secret, storedHash) =>
    createHash('sha256').update(secret, 'utf8').digest('hex') === storedHash,
};

export const TEST_NOW = '2026-10-07T12:00:00.000Z' as const;
export const TEST_TENANT = 'tenant-alpha' as const;
export const TEST_CLIENT_APP = 'epoch-app' as const;

/** A deterministic live key issuance for tests. */
export function testLiveKeyIssuance(
  overrides: Record<string, unknown> = {},
): DeveloperKeyIssuance {
  return issueDeveloperKey(
    {
      clientAppId: TEST_CLIENT_APP,
      tenantId: TEST_TENANT,
      environment: 'live',
      scopes: ['escalations:create', 'escalations:read', 'observability:read'],
      label: 'epoch production key',
      now: TEST_NOW,
      ...(overrides as Record<string, never>),
    } as Parameters<typeof issueDeveloperKey>[0],
    { hasher: deterministicHasher, material: new SequentialMaterial() },
  );
}

/** A deterministic sandbox key issuance for tests. */
export function testSandboxKeyIssuance(
  overrides: Record<string, unknown> = {},
): DeveloperKeyIssuance {
  return issueDeveloperKey(
    {
      clientAppId: TEST_CLIENT_APP,
      tenantId: TEST_TENANT,
      environment: 'sandbox',
      scopes: ['sandbox:run', 'escalations:read', 'observability:read'],
      label: 'epoch sandbox key',
      now: TEST_NOW,
      ...(overrides as Record<string, never>),
    } as Parameters<typeof issueDeveloperKey>[0],
    { hasher: deterministicHasher, material: new SequentialMaterial() },
  );
}

/** A deterministic client-app record for tests. */
export function testClientApp(overrides: Record<string, unknown> = {}): ClientAppRecord {
  return registerClientApp({
    clientAppId: TEST_CLIENT_APP,
    tenantId: TEST_TENANT,
    displayName: 'Epoch — AI build planning',
    environment: 'live',
    now: TEST_NOW,
    ...(overrides as Record<string, never>),
  } as Parameters<typeof registerClientApp>[0]);
}
