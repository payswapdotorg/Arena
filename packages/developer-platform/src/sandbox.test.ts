/**
 * Sandbox + client-app/webhook registration domain tests (Work Order
 * C017): capacity fail-closed (never faked, never a silent paid path),
 * the truth-label law on every sandbox object, webhook secret
 * hygiene, and registration validation.
 */

import { describe, expect, it } from 'vitest';

import { disableWebhookEndpoint, registerClientApp, registerWebhookEndpoint } from './client-apps.js';
import { DEVELOPER_PLATFORM_ERROR_CODES, DeveloperPlatformError } from './errors.js';
import {
  SANDBOX_CAPACITY_FAIL_CLOSED_STATES,
  SANDBOX_SCENARIOS,
  assertSandboxCapacity,
  constantSandboxCapacity,
  recordSandboxRun,
  sandboxScenarioById,
  sandboxRunWire,
} from './sandbox.js';
import { SequentialMaterial, TEST_NOW, deterministicHasher } from './test-support.js';

const deps = { hasher: deterministicHasher, material: new SequentialMaterial() };

describe('sandbox capacity — never faked (free-tier contract FT2.0)', () => {
  it('AVAILABLE and DEGRADED pass the gate', () => {
    expect(() => assertSandboxCapacity('AVAILABLE')).not.toThrow();
    expect(() => assertSandboxCapacity('DEGRADED')).not.toThrow();
  });

  it('EXHAUSTED and DISABLED fail CLOSED with typed errors (no silent paid path)', () => {
    for (const state of SANDBOX_CAPACITY_FAIL_CLOSED_STATES) {
      expect(() => assertSandboxCapacity(state)).toThrowError(DeveloperPlatformError);
    }
    try {
      assertSandboxCapacity('EXHAUSTED');
      expect.unreachable('EXHAUSTED must fail closed');
    } catch (error) {
      expect((error as DeveloperPlatformError).code).toBe(
        DEVELOPER_PLATFORM_ERROR_CODES.SANDBOX_CAPACITY_EXHAUSTED,
      );
    }
  });

  it('the injected probe drives the gate (hosts wire the real quota surface)', () => {
    const probe = constantSandboxCapacity('DISABLED');
    expect(() => assertSandboxCapacity(probe.state())).toThrowError(DeveloperPlatformError);
  });
});

describe('sandbox scenarios — deterministic, closed vocabulary', () => {
  it('exposes the reference canned scenarios', () => {
    expect(SANDBOX_SCENARIOS.length).toBeGreaterThanOrEqual(3);
    for (const scenario of SANDBOX_SCENARIOS) {
      expect(scenario.capabilityNeed).toMatch(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/);
      expect(scenario.budgetMinorUnits).toBeGreaterThan(0);
    }
  });

  it('unknown scenario ids are typed rejections (negative)', () => {
    expect(() => sandboxScenarioById('nope')).toThrowError(DeveloperPlatformError);
  });

  it('every recorded run carries the visible sandbox truth label', () => {
    const run = recordSandboxRun(
      {
        keyId: 'devkey_' + 'a'.repeat(32),
        clientAppId: 'epoch-app',
        tenantId: 'tenant-alpha',
        requestId: 'esc_' + 'b'.repeat(32),
        scenarioId: SANDBOX_SCENARIOS[0]!.scenarioId,
        now: TEST_NOW,
      },
      deps,
    );
    expect(run.environment).toBe('sandbox');
    expect(run.truthLabel).toBe('sandbox');
    expect(run.runId).toMatch(/^sbrun_[0-9a-f]{32}$/);
    expect(sandboxRunWire(run).truthLabel).toBe('sandbox');
  });

  it('runs with unknown scenarios fail closed (negative)', () => {
    expect(() =>
      recordSandboxRun(
        {
          keyId: 'devkey_' + 'a'.repeat(32),
          clientAppId: 'epoch-app',
          tenantId: 'tenant-alpha',
          requestId: 'esc_' + 'b'.repeat(32),
          scenarioId: 'not-a-scenario',
          now: TEST_NOW,
        },
        deps,
      ),
    ).toThrowError(DeveloperPlatformError);
  });
});

describe('client-app + webhook registration', () => {
  it('registers a client app bound to exactly one tenant (positive)', () => {
    const app = registerClientApp({
      clientAppId: 'epoch-app',
      tenantId: 'tenant-alpha',
      displayName: 'Epoch — AI build planning',
      environment: 'live',
      now: TEST_NOW,
    });
    expect(app.tenantId).toBe('tenant-alpha');
    expect(app.webhookEndpoints).toHaveLength(0);
  });

  it('invalid ids / names fail closed (negative)', () => {
    expect(() =>
      registerClientApp({
        clientAppId: 'Bad_Id',
        tenantId: 'tenant-alpha',
        displayName: 'x',
        environment: 'live',
        now: TEST_NOW,
      }),
    ).toThrowError(DeveloperPlatformError);
    expect(() =>
      registerClientApp({
        clientAppId: 'epoch-app',
        tenantId: 'tenant-alpha',
        displayName: '',
        environment: 'live',
        now: TEST_NOW,
      }),
    ).toThrowError(DeveloperPlatformError);
  });

  it('registers a webhook endpoint with a one-time signing secret, hash at rest', () => {
    const app = registerClientApp({
      clientAppId: 'epoch-app',
      tenantId: 'tenant-alpha',
      displayName: 'Epoch',
      environment: 'live',
      now: TEST_NOW,
    });
    const registration = registerWebhookEndpoint(
      app,
      { url: 'https://epoch.example/hooks/arena', now: TEST_NOW },
      deps,
    );
    expect(registration.signingSecret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(registration.binding.secretHash).not.toContain(registration.signingSecret);
    expect(registration.endpoint.status).toBe('active');
    expect(registration.endpoint.signingKeyId).toMatch(/^whsign_[0-9a-f]{32}$/);
    expect(registration.app.webhookEndpoints).toHaveLength(1);
    // The wire form of the app carries NO signing secret.
    expect(JSON.stringify(registration.app)).not.toContain(registration.signingSecret);
  });

  it('non-https and duplicate webhook urls are typed rejections (negative)', () => {
    const app = registerClientApp({
      clientAppId: 'epoch-app',
      tenantId: 'tenant-alpha',
      displayName: 'Epoch',
      environment: 'live',
      now: TEST_NOW,
    });
    expect(() =>
      registerWebhookEndpoint(app, { url: 'http://insecure.example/hook', now: TEST_NOW }, deps),
    ).toThrowError(DeveloperPlatformError);
    const registered = registerWebhookEndpoint(
      app,
      { url: 'https://epoch.example/hooks/arena', now: TEST_NOW },
      deps,
    );
    expect(() =>
      registerWebhookEndpoint(
        registered.app,
        { url: 'https://epoch.example/hooks/arena', now: TEST_NOW },
        deps,
      ),
    ).toThrowError(DeveloperPlatformError);
  });

  it('disabling is append-only (never deleted) and idempotency fails closed', () => {
    const app = registerClientApp({
      clientAppId: 'epoch-app',
      tenantId: 'tenant-alpha',
      displayName: 'Epoch',
      environment: 'live',
      now: TEST_NOW,
    });
    const registration = registerWebhookEndpoint(
      app,
      { url: 'https://epoch.example/hooks/arena', now: TEST_NOW },
      deps,
    );
    const disabled = disableWebhookEndpoint(registration.app, registration.endpoint.endpointId, {
      now: TEST_NOW,
    });
    expect(disabled.webhookEndpoints[0]).toMatchObject({ status: 'disabled' });
    expect(disabled.webhookEndpoints).toHaveLength(1);
    expect(() =>
      disableWebhookEndpoint(disabled, registration.endpoint.endpointId, { now: TEST_NOW }),
    ).toThrowError(DeveloperPlatformError);
    expect(() => disableWebhookEndpoint(disabled, 'devhook_' + 'c'.repeat(32), { now: TEST_NOW })).toThrowError(
      DeveloperPlatformError,
    );
  });
});
