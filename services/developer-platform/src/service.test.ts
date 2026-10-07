/**
 * Developer-platform service tests (Work Order C017) — positive flows
 * over the reference fabric: client-app registration, key lifecycle,
 * key-authorized LIVE escalation creation, deterministic sandbox runs
 * (watching lifecycle events arrive), webhook registration and the
 * observability dashboard projections.
 */

import { describe, expect, it } from 'vitest';

import { DEVELOPER_PLATFORM_ERROR_CODES } from '@arena/developer-platform';

import {
  referenceService,
  registeredAppWithKey,
  validLiveEscalationInput,
} from './test-support.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');

describe('client-app registration + key lifecycle (positive)', () => {
  it('registers a client app and issues a key whose secret is shown once', async () => {
    const fabric = referenceService(NOW);
    const app = await fabric.service.registerClientApp({
      tenantId: 'tenant-alpha',
      displayName: 'Epoch — AI build planning',
      environment: 'live',
    });
    expect(app.clientAppId).toMatch(/^app-[0-9a-f]{8}$/);
    expect(app.tenantId).toBe('tenant-alpha');

    const issuance = await fabric.service.issueKey({
      tenantId: 'tenant-alpha',
      clientAppId: app.clientAppId,
      environment: 'live',
      scopes: ['escalations:create', 'escalations:read'],
      label: 'production key',
    });
    expect(issuance.secret).toMatch(/^dak_live_[0-9a-f]{64}$/);
    expect(issuance.record.status).toBe('active');

    const keys = await fabric.service.listKeys({
      tenantId: 'tenant-alpha',
      clientAppId: app.clientAppId,
    });
    expect(keys).toHaveLength(1);
    // The list projection never carries the secret or its hash.
    expect(JSON.stringify(keys)).not.toContain(issuance.secret);
  });

  it('rotates and revokes keys through the service (append-only history)', async () => {
    const fabric = referenceService(NOW);
    const { clientAppId, keyId, secret } = await registeredAppWithKey(fabric);

    const rotated = await fabric.service.rotateKey({ keyId, tenantId: 'tenant-alpha' });
    expect(rotated.secret).not.toBe(secret);
    const keysAfterRotation = await fabric.service.listKeys({
      tenantId: 'tenant-alpha',
      clientAppId,
    });
    expect(keysAfterRotation).toHaveLength(2);
    expect(keysAfterRotation.map((key) => key['status'])).toEqual(
      expect.arrayContaining(['rotated', 'active']),
    );

    const revoked = await fabric.service.revokeKey({
      keyId: rotated.record.keyId,
      tenantId: 'tenant-alpha',
    });
    expect(revoked.status).toBe('revoked');
    expect(revoked.history.length).toBeGreaterThanOrEqual(2);
  });
});

describe('key-authorized LIVE escalation creation (the ES1.0 first path)', () => {
  it('creates a live escalation through the C001 seam and projects it', async () => {
    const fabric = referenceService(NOW);
    const { clientAppId, secret } = await registeredAppWithKey(fabric);
    const outcome = await fabric.service.createLiveEscalation({
      presentedSecret: secret,
      tenantId: 'tenant-alpha',
      escalation: validLiveEscalationInput('tenant-alpha', clientAppId, NOW) as never,
    });
    expect(outcome.requestId).toMatch(/^esc_[0-9a-f]{32}$/);
    expect(outcome.record.state).toBe('triaged');
    expect(outcome.projection.environment).toBe('live');
    expect(outcome.projection.truthLabel).toBe('live');
    expect(outcome.projection.clientAppId).toBe(clientAppId);
  });

  it('the key is stamped last-used after a successful authorization', async () => {
    const fabric = referenceService(NOW);
    const { clientAppId, secret } = await registeredAppWithKey(fabric);
    await fabric.service.createLiveEscalation({
      presentedSecret: secret,
      tenantId: 'tenant-alpha',
      escalation: validLiveEscalationInput('tenant-alpha', clientAppId, NOW) as never,
    });
    const keys = await fabric.service.listKeys({
      tenantId: 'tenant-alpha',
      clientAppId,
    });
    expect(keys[0]!['lastUsedAt']).toBeTypeOf('string');
  });
});

describe('deterministic sandbox runs (watch the lifecycle events arrive)', () => {
  it('runs a canned escalation end-to-end with visible sandbox labels', async () => {
    const fabric = referenceService(NOW);
    const { secret } = await registeredAppWithKey(fabric, { environment: 'sandbox' });
    const run = await fabric.service.runSandboxEscalation({
      presentedSecret: secret,
      tenantId: 'tenant-alpha',
      scenarioId: 'boq-quantity-takeoff',
    });
    expect(run.run.environment).toBe('sandbox');
    expect(run.run.truthLabel).toBe('sandbox');
    expect(run.projection.truthLabel).toBe('sandbox');
    expect(run.projection.state).toBe('triaged');
    // The lifecycle events the portal console watches arriving.
    expect(run.emittedEvents.map((event) => event.eventType)).toEqual([
      'escalation.created',
      'escalation.progressed',
    ]);
    expect(run.emittedEvents[0]!.eventId).toMatch(/^evt_[0-9a-f]+$/);
  });

  it('exposes the scenario catalogue for the sandbox console', () => {
    const fabric = referenceService(NOW);
    const scenarios = fabric.service.sandboxScenarios();
    expect(scenarios.map((scenario) => scenario.scenarioId)).toContain('rates-gap');
  });
});

describe('webhook registration (the C001 delivery pairing)', () => {
  it('registers an endpoint with a one-time signing secret via a webhooks:manage key', async () => {
    const fabric = referenceService(NOW);
    const { secret } = await registeredAppWithKey(fabric, {
      scopes: ['escalations:read', 'webhooks:manage'],
    });
    const registration = await fabric.service.registerWebhookEndpoint({
      presentedSecret: secret,
      tenantId: 'tenant-alpha',
      url: 'https://epoch.example/hooks/arena',
    });
    expect(registration.signingSecret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(registration.signingKeyId).toMatch(/^whsign_[0-9a-f]{32}$/);
    // The app projection lists the endpoint without secret material.
    expect(JSON.stringify(registration.app)).not.toContain(registration.signingSecret);
  });
});

describe('observability dashboard (projections of C001 records + C010 fees)', () => {
  it('projects live + sandbox escalations with state, validation, SLA and cost', async () => {
    const fabric = referenceService(NOW);
    const live = await registeredAppWithKey(fabric);
    await fabric.service.createLiveEscalation({
      presentedSecret: live.secret,
      tenantId: 'tenant-alpha',
      escalation: validLiveEscalationInput('tenant-alpha', live.clientAppId, NOW) as never,
    });
    const dashboard = await fabric.service.observabilityDashboard({
      tenantId: 'tenant-alpha',
      clientAppId: live.clientAppId,
    });
    expect(dashboard.projections).toHaveLength(1);
    expect(dashboard.summary.total).toBe(1);
    expect(dashboard.summary.byState['triaged']).toBe(1);
    expect(dashboard.summary.validationPending).toBe(1);
    expect(dashboard.summary.truthLabel).toBe('live');
    // The fake C001 seam emitted the created + progressed lifecycle
    // events — the dashboard projects them (the console event stream).
    expect(dashboard.recentWebhookEvents.map((event) => event.eventType)).toEqual([
      'escalation.created',
      'escalation.progressed',
    ]);
  });

  it('escalation detail is tenant-scoped and client-app-scoped', async () => {
    const fabric = referenceService(NOW);
    const { clientAppId, secret } = await registeredAppWithKey(fabric);
    const created = await fabric.service.createLiveEscalation({
      presentedSecret: secret,
      tenantId: 'tenant-alpha',
      escalation: validLiveEscalationInput('tenant-alpha', clientAppId, NOW) as never,
    });
    const detail = await fabric.service.escalationDetail({
      tenantId: 'tenant-alpha',
      requestId: created.requestId,
      clientAppId,
    });
    expect(detail.requestId).toBe(created.requestId);
    await expect(
      fabric.service.escalationDetail({
        tenantId: 'tenant-beta',
        requestId: created.requestId,
        clientAppId,
      }),
    ).rejects.toThrowError();
  });

  it('unknown client apps fail closed with the typed CLIENT_APP_NOT_FOUND', async () => {
    const fabric = referenceService(NOW);
    await expect(
      fabric.service.observabilityDashboard({
        tenantId: 'tenant-alpha',
        clientAppId: 'app-00000000',
      }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.CLIENT_APP_NOT_FOUND });
  });
});
