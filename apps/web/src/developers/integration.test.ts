/**
 * Developers-surface HOST-WIRING integration tests (Work Order C017):
 * the REAL DeveloperPlatformService over the REAL C001
 * EscalationApiService through the B2 adapter seam
 * (createDevelopersRuntime — exactly what the routes mount). This is
 * the app-layer composition the service package cannot test itself
 * (boundary rule B2 keeps services from importing each other).
 */

import { describe, expect, it } from 'vitest';

import { DEVELOPER_PLATFORM_ERROR_CODES } from '../../../../packages/developer-platform/src/index.js';

import { createDevelopersRuntime } from './runtime.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');

describe('host wiring: developer portal over the real C001 escalation API', () => {
  it('registers an app, issues keys, runs a sandbox escalation and watches events arrive', async () => {
    const { service } = createDevelopersRuntime(NOW);
    const app = await service.registerClientApp({
      tenantId: 'tenant-host',
      displayName: 'Host-wired app',
      environment: 'sandbox',
    });
    const key = await service.issueKey({
      tenantId: 'tenant-host',
      clientAppId: app.clientAppId,
      environment: 'sandbox',
      scopes: ['sandbox:run', 'escalations:read'],
      label: 'integration key',
    });
    const run = await service.runSandboxEscalation({
      presentedSecret: key.secret,
      tenantId: 'tenant-host',
      scenarioId: 'boq-quantity-takeoff',
    });
    expect(run.run.requestId).toMatch(/^esc_[0-9a-f]{32}$/);
    expect(run.emittedEvents.map((event) => event.eventType)).toContain('escalation.created');
    // The REAL C001 outbox drained through the adapter: the webhook
    // event views arrive for the console stream.
    const dashboard = await service.observabilityDashboard({
      tenantId: 'tenant-host',
      clientAppId: app.clientAppId,
    });
    expect(dashboard.recentWebhookEvents.length).toBeGreaterThan(0);
    expect(dashboard.projections[0]!.truthLabel).toBe('sandbox');
  });

  it('a sandbox key attempting a LIVE escalation fails closed (adversarial)', async () => {
    const { service } = createDevelopersRuntime(NOW);
    const app = await service.registerClientApp({
      tenantId: 'tenant-host',
      displayName: 'Sandbox app',
      environment: 'sandbox',
    });
    const key = await service.issueKey({
      tenantId: 'tenant-host',
      clientAppId: app.clientAppId,
      environment: 'sandbox',
      scopes: ['sandbox:run'],
      label: 'sandbox-only key',
    });
    await expect(
      service.createLiveEscalation({
        presentedSecret: key.secret,
        tenantId: 'tenant-host',
        escalation: {
          clientAppId: app.clientAppId,
          tenantId: 'tenant-host',
          sourceWorkflowRef: 'wf-1',
          sourceRunRef: 'run-1',
          capabilityNeed: 'boq-estimation.quantity-takeoff',
          escalationModes: ['solve'],
          urgency: 'priority',
          now: NOW,
          deadlineInMs: 3_600_000,
          budget: { amountMinorUnits: 25_000, currency: 'USD' },
          expertRequirements: { requiredCapabilities: ['boq-estimation.quantity-takeoff'] },
          locale: 'en',
          desiredOutputSchema: { type: 'object' },
          environmentSessionPolicy: { sessionMode: 'none', sanitization: 'standard' },
          privacyPolicy: { dataClassification: 'public', pii: 'forbid' },
          permittedActions: ['read-context'],
          learningPermissions: {
            allowKnowledgeCapture: false,
            allowToolGapSignals: false,
            allowArtifactReuse: false,
            requireApproval: true,
          },
          retentionPolicy: { retentionMs: 86_400_000, disposition: 'purge' },
          idempotencyKey: 'idem-host-1',
          correlationId: 'corr-host-1',
        } as never,
      }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.ENVIRONMENT_MISMATCH });
  });

  it('a revoked key replay through the HOST wiring fails closed with KEY_REVOKED', async () => {
    const { service } = createDevelopersRuntime(NOW);
    const app = await service.registerClientApp({
      tenantId: 'tenant-host',
      displayName: 'Revocation app',
      environment: 'sandbox',
    });
    const key = await service.issueKey({
      tenantId: 'tenant-host',
      clientAppId: app.clientAppId,
      environment: 'sandbox',
      scopes: ['sandbox:run'],
      label: 'doomed key',
    });
    await service.revokeKey({ keyId: key.record.keyId, tenantId: 'tenant-host' });
    await expect(
      service.runSandboxEscalation({
        presentedSecret: key.secret,
        tenantId: 'tenant-host',
        scenarioId: 'boq-quantity-takeoff',
      }),
    ).rejects.toMatchObject({ code: DEVELOPER_PLATFORM_ERROR_CODES.KEY_REVOKED });
  });
});
