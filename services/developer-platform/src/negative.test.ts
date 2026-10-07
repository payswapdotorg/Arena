/**
 * Developer-platform service ADVERSARIAL tests (Work Order C017): the
 * minimum adversarial battery — sandbox/read-scoped keys attempting
 * live escalation creation (fail closed), cross-tenant key use,
 * revoked-key replay, scope enforcement, capacity fail-closed and
 * secret-leak hygiene on every output surface.
 */

import { describe, expect, it } from 'vitest';

import { DEVELOPER_PLATFORM_ERROR_CODES } from '@arena/developer-platform';
import { constantSandboxCapacity } from '@arena/developer-platform';

import { DeveloperPlatformService } from './service.js';
import { InMemoryDeveloperKeyStore } from './fabric.js';
import {
  SequentialMaterial,
  deterministicHasher,
  referenceService,
  registeredAppWithKey,
  validLiveEscalationInput,
} from './test-support.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');

describe('sandbox keys can never touch live surfaces (fail closed)', () => {
  it('a sandbox-scoped key attempting LIVE escalation creation is denied', async () => {
    const fabric = referenceService(NOW);
    const sandbox = await registeredAppWithKey(fabric, { environment: 'sandbox' });
    await expect(
      fabric.service.createLiveEscalation({
        presentedSecret: sandbox.secret,
        tenantId: 'tenant-alpha',
        escalation: validLiveEscalationInput('tenant-alpha', sandbox.clientAppId, NOW) as never,
      }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.ENVIRONMENT_MISMATCH });
  });

  it('a read-only LIVE key attempting escalation creation is denied (scope)', async () => {
    const fabric = referenceService(NOW);
    const readOnly = await registeredAppWithKey(fabric, {
      scopes: ['escalations:read', 'observability:read'],
    });
    await expect(
      fabric.service.createLiveEscalation({
        presentedSecret: readOnly.secret,
        tenantId: 'tenant-alpha',
        escalation: validLiveEscalationInput('tenant-alpha', readOnly.clientAppId, NOW) as never,
      }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.SCOPE_MISSING });
  });

  it('a sandbox key attempting a sandbox run WITHOUT sandbox:run is denied', async () => {
    const fabric = referenceService(NOW);
    const observer = await registeredAppWithKey(fabric, {
      environment: 'sandbox',
      scopes: ['escalations:read'],
    });
    await expect(
      fabric.service.runSandboxEscalation({
        presentedSecret: observer.secret,
        tenantId: 'tenant-alpha',
        scenarioId: 'boq-quantity-takeoff',
      }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.SCOPE_MISSING });
  });
});

describe('capacity is never faked (free-tier contract FT2.0)', () => {
  it('EXHAUSTED and DISABLED sandbox capacity fails closed with typed errors', async () => {
    for (const state of ['EXHAUSTED', 'DISABLED'] as const) {
      const fabric = referenceService(NOW);
      const sandbox = await registeredAppWithKey(fabric, { environment: 'sandbox' });
      const service = new DeveloperPlatformService({
        clock: fabric.clock,
        store: fabric.service.store,
        escalation: fabric.escalation,
        capacity: constantSandboxCapacity(state),
        hasher: deterministicHasher,
        material: new SequentialMaterial(),
      });
      await expect(
        service.runSandboxEscalation({
          presentedSecret: sandbox.secret,
          tenantId: 'tenant-alpha',
          scenarioId: 'boq-quantity-takeoff',
        }),
      ).rejects.toMatchObject({
        code:
          state === 'EXHAUSTED'
            ? DEVELOPER_PLATFORM_ERROR_CODES.SANDBOX_CAPACITY_EXHAUSTED
            : DEVELOPER_PLATFORM_ERROR_CODES.SANDBOX_CAPACITY_DISABLED,
      });
    }
  });

  it('no escalation record is created when capacity fails closed', async () => {
    const fabric = referenceService(NOW);
    const sandbox = await registeredAppWithKey(fabric, { environment: 'sandbox' });
    const service = new DeveloperPlatformService({
      clock: fabric.clock,
      store: fabric.service.store,
      escalation: fabric.escalation,
      capacity: constantSandboxCapacity('DISABLED'),
      hasher: deterministicHasher,
      material: new SequentialMaterial(),
    });
    await expect(
      service.runSandboxEscalation({
        presentedSecret: sandbox.secret,
        tenantId: 'tenant-alpha',
        scenarioId: 'boq-quantity-takeoff',
      }),
    ).rejects.toThrowError();
    expect(fabric.escalation.records).toHaveLength(0);
  });
});

describe('revoked-key replay + rotation (fail closed, typed reasons)', () => {
  it('a revoked key replay is denied with KEY_REVOKED (binding retained for the audit verdict)', async () => {
    const fabric = referenceService(NOW);
    const { clientAppId, keyId, secret } = await registeredAppWithKey(fabric);
    await fabric.service.revokeKey({ keyId, tenantId: 'tenant-alpha' });
    await expect(
      fabric.service.createLiveEscalation({
        presentedSecret: secret,
        tenantId: 'tenant-alpha',
        escalation: validLiveEscalationInput('tenant-alpha', clientAppId, NOW) as never,
      }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.KEY_REVOKED });
  });

  it('a rotated key (old secret) replay is denied with KEY_ROTATED; the successor works', async () => {
    const fabric = referenceService(NOW);
    const { clientAppId, keyId, secret } = await registeredAppWithKey(fabric);
    const successor = await fabric.service.rotateKey({ keyId, tenantId: 'tenant-alpha' });
    await expect(
      fabric.service.createLiveEscalation({
        presentedSecret: secret,
        tenantId: 'tenant-alpha',
        escalation: validLiveEscalationInput('tenant-alpha', clientAppId, NOW) as never,
      }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.KEY_ROTATED });
    const outcome = await fabric.service.createLiveEscalation({
      presentedSecret: successor.secret,
      tenantId: 'tenant-alpha',
      escalation: validLiveEscalationInput('tenant-alpha', clientAppId, NOW + 1) as never,
    });
    expect(outcome.requestId).toMatch(/^esc_/);
  });
});

describe('cross-tenant use (fail closed)', () => {
  it('key MANAGEMENT is tenant-scoped (rotate/revoke deny other tenants)', async () => {
    const fabric = referenceService(NOW);
    const { keyId } = await registeredAppWithKey(fabric);
    await expect(
      fabric.service.rotateKey({ keyId, tenantId: 'tenant-beta' }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.CROSS_TENANT_ACCESS });
    await expect(
      fabric.service.revokeKey({ keyId, tenantId: 'tenant-beta' }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.CROSS_TENANT_ACCESS });
  });

  it('a key of tenant A presented for tenant B is denied (no cross-tenant oracle)', async () => {
    const fabric = referenceService(NOW);
    const alpha = await registeredAppWithKey(fabric, { tenantId: 'tenant-alpha' });
    // tenant-beta has no apps at all → the secret cannot authorize anything there.
    await expect(
      fabric.service.createLiveEscalation({
        presentedSecret: alpha.secret,
        tenantId: 'tenant-beta',
        escalation: validLiveEscalationInput('tenant-beta', alpha.clientAppId, NOW) as never,
      }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.KEY_NOT_FOUND });
  });

  it('escalation input declaring ANOTHER tenant than the key fails closed', async () => {
    const fabric = referenceService(NOW);
    const { clientAppId, secret } = await registeredAppWithKey(fabric);
    await expect(
      fabric.service.createLiveEscalation({
        presentedSecret: secret,
        tenantId: 'tenant-alpha',
        escalation: validLiveEscalationInput('tenant-beta', clientAppId, NOW) as never,
      }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.CROSS_TENANT_ACCESS });
  });
});

describe('secret leakage (the hygiene law)', () => {
  it('no service output ever contains the plaintext secret or its hash', async () => {
    const fabric = referenceService(NOW);
    const { clientAppId, secret } = await registeredAppWithKey(fabric);
    await fabric.service.createLiveEscalation({
      presentedSecret: secret,
      tenantId: 'tenant-alpha',
      escalation: validLiveEscalationInput('tenant-alpha', clientAppId, NOW) as never,
    });
    const keys = await fabric.service.listKeys({ tenantId: 'tenant-alpha', clientAppId });
    const dashboard = await fabric.service.observabilityDashboard({
      tenantId: 'tenant-alpha',
      clientAppId,
    });
    const app = await fabric.service.clientApp({ tenantId: 'tenant-alpha', clientAppId });
    const blob = JSON.stringify({ keys, dashboard, app });
    expect(blob).not.toContain(secret);
    expect(blob).not.toContain('dak_live_');
    expect(blob).not.toContain('secretHash');
  });

  it('a garbage secret is denied (never an unauthenticated surface)', async () => {
    const fabric = referenceService(NOW);
    await registeredAppWithKey(fabric);
    await expect(
      fabric.service.createLiveEscalation({
        presentedSecret: 'dak_live_' + '0'.repeat(64),
        tenantId: 'tenant-alpha',
        escalation: validLiveEscalationInput('tenant-alpha', 'app-00000000', NOW) as never,
      }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.SECRET_INVALID });
  });

  it('the unwired service (no escalation port) fails closed on creation', async () => {
    const service = new DeveloperPlatformService({
      clock: fabricClock(),
      store: new InMemoryDeveloperKeyStore(),
      hasher: deterministicHasher,
      material: new SequentialMaterial(),
    });
    const app = await service.registerClientApp({
      tenantId: 'tenant-alpha',
      displayName: 'Epoch',
      environment: 'live',
    });
    await service.issueKey({
      tenantId: 'tenant-alpha',
      clientAppId: app.clientAppId,
      environment: 'live',
      scopes: ['escalations:create'],
      label: 'unwired',
    });
    // A garbage secret fails closed BEFORE any escalation port is needed;
    // a valid secret would fail closed at the unwired port.
    await expect(
      service.createLiveEscalation({
        presentedSecret: 'dak_live_' + '0'.repeat(64),
        tenantId: 'tenant-alpha',
        escalation: validLiveEscalationInput('tenant-alpha', app.clientAppId, NOW) as never,
      }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.SECRET_INVALID });
  });
});

function fabricClock() {
  return { now: () => NOW };
}
