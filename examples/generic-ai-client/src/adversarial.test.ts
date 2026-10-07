/**
 * The C019 adversarial battery (FINAL-HANDOFF §18 external-client E2E +
 * adversarial cases): cross-tenant escalation, webhook signature
 * forgery, duplicate webhook, idempotency-key conflict, live-world
 * mutation attempts, unpermitted expert actions.
 */

import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { runBoqEscalationLoop, boqEscalationInput, SCENARIO } from './loop.js';
import { createGenericAiApplicationClient } from './client.js';
import type { ReceivedWebhook } from './client.js';
import { createReferenceArena } from './fabric.js';
import { boqEscalationInput as scenarioInput } from './loop.js';
import {
  attemptEpochAuthoritativeWrite,
  parseEpochEscalationTrigger,
  parseEpochIntegrationPosture,
  EpochEscalationAdapter,
} from '@arena/epoch-escalation-adapter';
import { EPOCH_POSTURE, epochTriggerWire } from './epoch-loop.js';

describe('C019 adversarial battery', () => {
  it('cross-tenant escalation: a foreign tenant cannot read another tenant’s escalation', async () => {
    const receipt = await runBoqEscalationLoop();
    // The generic client (tenant-beta) asks for tenant-alpha's request:
    // the 404 path is the ONLY thing it learns (no cross-tenant leak).
    const foreign = createGenericAiApplicationClient({
      clientAppId: 'other-app',
      tenantId: 'tenant-delta',
      transport: receipt.arena.transport,
      webhookSigner: {
        signingKeyId: 'irrelevant',
        sign: () => '0'.repeat(64),
      },
      now: () => receipt.arena.clock.now(),
    });
    await expect(foreign.pollStatus(receipt.requestId)).rejects.toThrowError(/invalid escalation-response envelope|did not carry/i);
  });

  it('webhook signature FORGERY: a tampered signature is rejected, never silently accepted', async () => {
    const arena = createReferenceArena({
      clientAppId: SCENARIO.clientAppId,
      tenantId: SCENARIO.tenantId,
      webhookUrl: SCENARIO.webhookUrl,
    });
    const client = createGenericAiApplicationClient({
      clientAppId: SCENARIO.clientAppId,
      tenantId: SCENARIO.tenantId,
      transport: arena.transport,
      webhookSigner: {
        signingKeyId: arena.webhookSigningKeyId,
        sign: (timestamp: number, payload: string) =>
          createHmac('sha256', arena.webhookSigningSecret)
            .update(`${timestamp}.${payload}`)
            .digest('hex'),
      },
      now: () => arena.clock.now(),
    });
    await client.submitEscalation(boqEscalationInput());
    const sink = { receive: () => undefined };
    await arena.deliverPendingWebhooks(sink);
    expect(arena.lastDeliveries.length).toBeGreaterThan(0);

    // Replay a REAL delivery with a FORGED signature header.
    const genuine: ReceivedWebhook = arena.lastDeliveries[0] as ReceivedWebhook;
    const forged: ReceivedWebhook = {
      headers: { ...genuine.headers, 'x-arena-signature': `v1=${'f'.repeat(64)}` },
      body: genuine.body,
    };
    const verdict = client.receiveWebhook(forged);
    expect(verdict.outcome).toBe('rejected');
    expect(verdict.outcome === 'rejected' ? verdict.reason : '').toBe('signature-mismatch');

    // The genuine delivery still verifies + dedupes (duplicate rejected).
    const genuineVerdict = client.receiveWebhook(genuine);
    expect(genuineVerdict.outcome).toBe('accepted');
    const duplicate = client.receiveWebhook(genuine);
    expect(duplicate.outcome === 'rejected' ? duplicate.reason : '').toBe('duplicate-event');
  });

  it('idempotency-key conflict: the same key with a DIFFERENT body is a typed conflict (never a silent rebind)', async () => {
    const arena = createReferenceArena({
      clientAppId: SCENARIO.clientAppId,
      tenantId: SCENARIO.tenantId,
      webhookUrl: SCENARIO.webhookUrl,
    });
    await arena.transport.postEscalation(boqEscalationInput());
    // Same idempotency key + correlation id, different capability need.
    const conflicting = boqEscalationInput();
    const mutated: typeof conflicting = {
      ...conflicting,
      capabilityNeed: 'boq-estimation.rates',
    };
    await expect(arena.transport.postEscalation(mutated)).rejects.toThrowError(
      /already bound to a different request digest|identity conflict/i,
    );
  });

  it('idempotency-key REPLAY: the same key with the SAME body replays the original', async () => {
    const arena = createReferenceArena({
      clientAppId: SCENARIO.clientAppId,
      tenantId: SCENARIO.tenantId,
      webhookUrl: SCENARIO.webhookUrl,
    });
    const first = await arena.transport.postEscalation(boqEscalationInput());
    const replay = await arena.transport.postEscalation(boqEscalationInput());
    expect(replay.body).not.toBe(first.body); // a NEW serialized envelope…
    // …but the SAME durable request id and the duplicate marker.
    expect(replay.body).toContain(first.body.includes('escalation-created') ? 'replayed' : 'created');
    expect(JSON.parse(replay.body).payload.duplicate).toBe(true);
  });

  it('live-world mutation: Arena-side replay/write-back paths fail closed (both clients)', async () => {
    const receipt = await runBoqEscalationLoop();
    // The generic client's replay trace is observational only.
    expect(receipt.replay.liveMutation).toBe(false);
    // The Epoch adapter's write-back denial surface.
    for (const store of ['world-model', 'action-gateway', 'constraint-engine', 'approved-baselines', 'delivery-state'] as const) {
      expect(() =>
        attemptEpochAuthoritativeWrite({
          attemptKind: 'epoch-authoritative-write-attempt',
          store,
        }),
      ).toThrowError(/forbidden/i);
    }
  });

  it('unpermitted expert actions fail closed with a typed error (audit trail)', async () => {
    const arena = createReferenceArena({
      clientAppId: SCENARIO.clientAppId,
      tenantId: SCENARIO.tenantId,
      webhookUrl: SCENARIO.webhookUrl,
    });
    const input = scenarioInput();
    const submission = await arena.transport.postEscalation(input);
    const requestId: string = JSON.parse(submission.body).payload.requestId;
    await expect(
      arena.escalationService.recordExpertAction(requestId, SCENARIO.tenantId, 'escalate-privileges'),
    ).rejects.toThrowError(/permitted actions/i);
    // The ATTEMPT was recorded (audit trail).
    const log = arena.escalationService.actionLog(requestId);
    expect(log.some((entry) => entry.action === 'escalate-privileges' && !entry.allowed)).toBe(true);
  });

  it('Epoch cross-tenant authorization mismatch fails closed at the adapter boundary', async () => {
    const posture = parseEpochIntegrationPosture(EPOCH_POSTURE);
    const adapter = new EpochEscalationAdapter(posture);
    const foreignTrigger = parseEpochEscalationTrigger(
      epochTriggerWire({
        authorization: { clientAppId: 'somebody-else', tenantId: 'tenant-gamma' },
      }),
    );
    await expect(adapter.buildEscalationRequest(foreignTrigger)).rejects.toThrowError(
      /does not match the declared posture/i,
    );
  });
});
