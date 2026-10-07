/**
 * ADVERSARIAL suite (Work Order C006) — the work order's adversarial
 * minimum, exercised against the full service stack:
 *
 *   1. SESSION ESCAPE ATTEMPT — an expert action reaching for
 *      live-world / tenant-boundary resources must FAIL CLOSED
 *      (ESCAPE_ATTEMPT);
 *   2. SECRET LEAKAGE through the observation stream — redacted fields
 *      never reach the originating agent (screened at append AND at
 *      projection);
 *   3. UNPERMITTED MODE ESCALATION — a session mode outside the
 *      EscalationRequest's derived allowance is rejected;
 *   4. REPLAY-MASQUERADING-AS-LIVE-MUTATION — replay traces are
 *      observational and can never be applied as live mutations;
 *   plus: unallowlisted actions, restricted export channels,
 *   private-reasoning payloads, undeclared tools.
 */

import { describe, expect, it } from 'vitest';
import { ExpertSessionError, EXPERT_SESSION_ERROR_CODES, asLiveMutation } from '@arena/expert-session';
import { ExpertSessionService } from './service.js';
import { DefaultCapsuleMaterializer, InMemoryEscalationSessionPort, InMemorySessionStore } from './fabric.js';
import { acceptedEscalation, capsuleSource } from './test-support.js';
import { T0, T1, T2, TENANT_A } from './test-support.js';

async function activeSession() {
  const escalationPort = new InMemoryEscalationSessionPort();
  const service = new ExpertSessionService({
    escalationPort,
    store: new InMemorySessionStore(),
    materializer: new DefaultCapsuleMaterializer(),
  });
  const escalation = await acceptedEscalation();
  await escalationPort.seed(escalation);
  const opened = await service.openSession({
    requestId: escalation.request.requestId,
    tenantId: TENANT_A,
    source: capsuleSource(),
    now: T0,
  });
  await service.beginSession({ sessionId: opened.capsule.sessionId, tenantId: TENANT_A, expertRef: 'expert-alice', now: T1 });
  return { service, sessionId: opened.capsule.sessionId, escalation };
}

describe('ADVERSARIAL — session escape attempts fail closed', () => {
  it('an expert action reaching for a LIVE-WORLD resource is an escape attempt', async () => {
    const { service, sessionId } = await activeSession();
    for (const liveRef of ['live:prod-db/invoices', 'prod:billing/write-off', 'ws://live.core/api']) {
      await expect(
        service.recordSessionEvent({
          sessionId,
          tenantId: TENANT_A,
          kind: 'human-action',
          payload: { action: 'fetch', target: liveRef },
          now: T2,
          actor: 'expert-alice',
        }),
      ).rejects.toThrowError(ExpertSessionError);
    }
    try {
      await service.recordSessionEvent({
        sessionId,
        tenantId: TENANT_A,
        kind: 'human-action',
        payload: { target: 'live:prod-db/invoices' },
        now: T2,
      });
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.ESCAPE_ATTEMPT);
    }
  });

  it('an expert action reaching for a resource OUTSIDE the capsule fails closed', async () => {
    const { service, sessionId } = await activeSession();
    await expect(
      service.recordSessionEvent({
        sessionId,
        tenantId: TENANT_A,
        kind: 'human-action',
        payload: { resourceRef: '/etc/passwd', mode: 'read' },
        now: T2,
      }),
    ).rejects.toThrowError(ExpertSessionError);
  });

  it('an expert action reaching for an UNDECLARED tool fails closed', async () => {
    const { service, sessionId } = await activeSession();
    await expect(
      service.recordSessionEvent({
        sessionId,
        tenantId: TENANT_A,
        kind: 'tool-invocation',
        payload: { toolName: 'shell-exec', command: 'cat /etc/passwd' },
        now: T2,
        actor: 'expert-alice',
      }),
    ).rejects.toThrowError(ExpertSessionError);
    try {
      await service.recordSessionEvent({
        sessionId,
        tenantId: TENANT_A,
        kind: 'tool-invocation',
        payload: { toolName: 'shell-exec' },
        now: T2,
      });
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.ESCAPE_ATTEMPT);
    }
  });

  it('restricted export channels (download/clipboard/screenshot) are denied', async () => {
    const { service, sessionId } = await activeSession();
    for (const channel of ['download', 'clipboard', 'screenshot']) {
      await expect(
        service.recordSessionEvent({
          sessionId,
          tenantId: TENANT_A,
          kind: 'human-action',
          payload: { action: 'export', what: 'everything' },
          exportChannel: channel,
          now: T2,
        }),
      ).rejects.toThrowError(ExpertSessionError);
    }
  });
});

describe('ADVERSARIAL — secret leakage through the observation stream', () => {
  it('redacted fields never reach the stream (screened at append AND at projection)', async () => {
    const { service, sessionId } = await activeSession();
    await service.recordSessionEvent({
      sessionId,
      tenantId: TENANT_A,
      kind: 'environment-observation',
      payload: {
        customerEmail: 'acme-buyer@example.com',
        accountNumber: '1234567890',
        nested: { customerEmail: 'x@example.com', safe: 'visible' },
      },
      now: T2,
    });
    const stream = (await service.getObservationStream({ sessionId, tenantId: TENANT_A })) as readonly {
      payload: Record<string, unknown>;
    }[];
    expect(stream).toHaveLength(1);
    expect(JSON.stringify(stream)).not.toContain('acme-buyer@example.com');
    expect(JSON.stringify(stream)).not.toContain('1234567890');
    expect(stream[0]?.payload).toEqual({
      customerEmail: '[REDACTED]',
      accountNumber: '[REDACTED]',
      nested: { customerEmail: '[REDACTED]', safe: 'visible' },
    });
  });

  it('private chain-of-thought is never captured (typed PRIVATE_REASONING)', async () => {
    const { service, sessionId } = await activeSession();
    await expect(
      service.recordSessionEvent({
        sessionId,
        tenantId: TENANT_A,
        kind: 'annotation',
        payload: { note: 'ok', chainOfThought: 'first I would reason about...' },
        now: T2,
      }),
    ).rejects.toThrowError(ExpertSessionError);
    try {
      await service.recordSessionEvent({
        sessionId,
        tenantId: TENANT_A,
        kind: 'annotation',
        payload: { internalMonologue: '...' },
        now: T2,
      });
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.PRIVATE_REASONING);
    }
  });
});

describe('ADVERSARIAL — unpermitted mode escalation', () => {
  it('a session mode outside the EscalationRequest allowance is rejected at open time', async () => {
    const escalationPort = new InMemoryEscalationSessionPort();
    const service = new ExpertSessionService({ escalationPort });
    // escalationModes: ['teach'] ⇒ allowed session modes {observe, teach}.
    const escalation = await acceptedEscalation();
    await escalationPort.seed(escalation);
    await expect(
      service.openSession({
        requestId: escalation.request.requestId,
        tenantId: TENANT_A,
        source: capsuleSource(),
        sessionMode: 'takeover', // NOT in the derived allowance
        now: T0,
      }),
    ).rejects.toThrowError(ExpertSessionError);
    try {
      await service.openSession({
        requestId: escalation.request.requestId,
        tenantId: TENANT_A,
        source: capsuleSource(),
        sessionMode: 'takeover',
        now: T0,
      });
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.UNPERMITTED_MODE);
    }
  });

  it('a mode that forbids an action rejects that action (unblock cannot edit artifacts)', async () => {
    const escalationPort = new InMemoryEscalationSessionPort();
    const service = new ExpertSessionService({ escalationPort });
    const escalation = await acceptedEscalation({ escalationModes: ['unblock'], idempotencyKey: 'idem-unblock' });
    await escalationPort.seed(escalation);
    const opened = await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
    });
    expect(opened.capsule.sessionMode).toBe('unblock');
    await service.beginSession({ sessionId: opened.capsule.sessionId, tenantId: TENANT_A, expertRef: 'expert-alice', now: T1 });
    await expect(
      service.recordSessionEvent({
        sessionId: opened.capsule.sessionId,
        tenantId: TENANT_A,
        kind: 'artifact-change',
        payload: { artifact: 'reconciliation.md', change: 'patch' },
        now: T2,
      }),
    ).rejects.toThrowError(ExpertSessionError);
    try {
      await service.recordSessionEvent({
        sessionId: opened.capsule.sessionId,
        tenantId: TENANT_A,
        kind: 'artifact-change',
        payload: { change: 'patch' },
        now: T2,
      });
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.UNPERMITTED_MODE);
    }
  });

  it('an observe-only session cannot submit a result', async () => {
    const escalationPort = new InMemoryEscalationSessionPort();
    const service = new ExpertSessionService({ escalationPort });
    // 'tool_gap' escalation mode ⇒ observe only.
    const escalation = await acceptedEscalation({ escalationModes: ['tool_gap'], idempotencyKey: 'idem-observe' });
    await escalationPort.seed(escalation);
    const opened = await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
    });
    expect(opened.capsule.sessionMode).toBe('observe');
    await service.beginSession({ sessionId: opened.capsule.sessionId, tenantId: TENANT_A, expertRef: 'expert-alice', now: T1 });
    await expect(
      service.submitSession({
        sessionId: opened.capsule.sessionId,
        tenantId: TENANT_A,
        result: { ok: true },
        evidence: [{ kind: 'event-ref', ref: 'esevt_00000000000000000000000000000000' }],
        consentRightsStatement: { granted: false, statement: 'no reuse' },
        now: T2,
      }),
    ).rejects.toThrowError(ExpertSessionError);
  });
});

describe('ADVERSARIAL — replay masquerading as a live mutation', () => {
  it('a replay trace can never be applied as a live mutation (REPLAY_AS_LIVE)', async () => {
    const { service, sessionId } = await activeSession();
    await service.recordSessionEvent({
      sessionId,
      tenantId: TENANT_A,
      kind: 'environment-observation',
      payload: { step: 's1' },
      now: T2,
    });
    await service.recordSessionEvent({
      sessionId,
      tenantId: TENANT_A,
      kind: 'human-action',
      payload: { action: 'queried registry' },
      now: T2,
    });
    const replay = await service.getSessionReplay({ sessionId, tenantId: TENANT_A, now: T2 });
    expect(replay.liveMutation).toBe(false);
    expect(() => asLiveMutation(replay)).toThrowError(ExpertSessionError);
    try {
      asLiveMutation(replay);
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.REPLAY_AS_LIVE);
    }
  });
});
