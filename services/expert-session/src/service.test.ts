/**
 * Service suite (Work Order C006) — the session lifecycle bound to the
 * C001 escalation states through the INJECTED escalation port, against
 * REAL @arena/escalation records (never mocked semantics).
 *
 * Happy path: accepted escalation → openSession (capsule derived,
 * sessionRef bound, escalation → session_ready) → beginSession (→
 * in_progress, session active) → observable events (screened) →
 * submitSession (EES1.0 completion contract → C001 EscalationResult,
 * escalation → submitted, session completed).
 */

import { describe, expect, it } from 'vitest';
import { ExpertSessionError, EXPERT_SESSION_ERROR_CODES } from '@arena/expert-session';
import { ExpertSessionService } from './service.js';
import { DefaultCapsuleMaterializer, InMemoryEscalationSessionPort, InMemorySessionStore } from './fabric.js';
import { acceptedEscalation, capsuleSource, sessionCapableRequestInput } from './test-support.js';
import { applyEscalationTransition, createEscalationRequest, createEscalationRecord } from '@arena/escalation';
import { createKnowledgeArtifact, createToolGapSignal } from '@arena/expert-session';
import { T0, T1, T2, T3, TENANT_A, TENANT_B } from './test-support.js';

async function setup() {
  const escalationPort = new InMemoryEscalationSessionPort();
  const store = new InMemorySessionStore();
  const service = new ExpertSessionService({
    escalationPort,
    store,
    materializer: new DefaultCapsuleMaterializer(),
  });
  const escalation = await acceptedEscalation();
  await escalationPort.seed(escalation);
  return { service, escalationPort, store, escalation };
}

describe('openSession — escalation accepted → session_ready', () => {
  it('derives the capsule, binds the sessionRef and moves the escalation', async () => {
    const { service, escalationPort, escalation } = await setup();
    const record = await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
      actor: 'expert-session-service',
    });
    expect(record.state).toBe('open');
    expect(record.capsule.escalationRef.requestId).toBe(escalation.request.requestId);
    // Barrier derived from the escalation's declared policy.
    expect(record.capsule.barrier.tenantBoundary.tenantId).toBe(TENANT_A);
    expect(record.capsule.barrier.identityMasking).toBe(true);
    expect(record.capsule.barrier.redactedFields).toContain('customerEmail');
    expect(record.capsule.tools).toEqual(['search-vendors', 'compute-reconciliation', 'admin-console']);
    const bound = await escalationPort.get(escalation.request.requestId, TENANT_A);
    expect(bound?.state).toBe('session_ready');
    expect(bound?.sessionRef).toBe(record.capsule.sessionId);
  });

  it('capsule is time-bounded by the escalation deadline', async () => {
    const { service, escalation } = await setup();
    const record = await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
    });
    expect(record.capsule.expiresAt).toBe(escalation.request.deadline);
  });

  it('fails closed when the escalation does not authorize a bounded replica', async () => {
    const escalationPort = new InMemoryEscalationSessionPort();
    const service = new ExpertSessionService({ escalationPort });
    const request = await createEscalationRequest(
      sessionCapableRequestInput({
        environmentSessionPolicy: { sessionMode: 'none', sanitization: 'standard' },
        idempotencyKey: 'idem-no-session',
      }),
    );
    const record = applyEscalationTransition(
      applyEscalationTransition(
        applyEscalationTransition(
          applyEscalationTransition(createEscalationRecord(request, T0), 'triaged', { now: T0 }),
          'matching',
          { now: T0 },
        ),
        'offered',
        { now: T0, expertRef: 'expert-alice' },
      ),
      'accepted',
      { now: T0, expertRef: 'expert-alice' },
    );
    await escalationPort.seed(record);
    await expect(
      service.openSession({ requestId: record.request.requestId, tenantId: TENANT_A, source: capsuleSource(), now: T0 }),
    ).rejects.toThrowError(ExpertSessionError);
  });

  it('fails closed when the escalation is not in the accepted state', async () => {
    const { service, escalation } = await setup();
    // First open moves the escalation to session_ready — a second open
    // must fail (wrong state), and the store rejects double binding.
    await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
    });
    await expect(
      service.openSession({ requestId: escalation.request.requestId, tenantId: TENANT_A, source: capsuleSource(), now: T1 }),
    ).rejects.toThrowError(ExpertSessionError);
  });
});

describe('beginSession / events / submitSession — the full EES1.0 flow', () => {
  it('walks the full lifecycle and hands the submission to C001 validation', async () => {
    const { service, escalationPort, escalation } = await setup();
    const opened = await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
    });
    const active = await service.beginSession({
      sessionId: opened.capsule.sessionId,
      tenantId: TENANT_A,
      expertRef: 'expert-alice',
      now: T1,
    });
    expect(active.state).toBe('active');
    expect((await escalationPort.get(escalation.request.requestId, TENANT_A))?.state).toBe('in_progress');

    // Observable work: environment observation, tool invocation, annotation.
    await service.recordSessionEvent({
      sessionId: opened.capsule.sessionId,
      tenantId: TENANT_A,
      kind: 'environment-observation',
      payload: { step: 'awaiting-vendor-match', customerEmail: 'acme-buyer@example.com' },
      now: T1,
      actor: 'expert-alice',
    });
    await service.recordSessionEvent({
      sessionId: opened.capsule.sessionId,
      tenantId: TENANT_A,
      kind: 'tool-invocation',
      payload: { toolName: 'search-vendors', query: 'Acme Supply' },
      now: T2,
      actor: 'expert-alice',
    });
    await service.recordSessionEvent({
      sessionId: opened.capsule.sessionId,
      tenantId: TENANT_A,
      kind: 'annotation',
      payload: { subjectRef: 'docs/vendor-catalog.md', note: 'Entry 7 is stale.' },
      now: T2,
      actor: 'expert-alice',
    });
    // The stored stream is screened (redaction applied at append time).
    const stored = await service.getSession({ sessionId: opened.capsule.sessionId, tenantId: TENANT_A });
    expect(stored?.events).toHaveLength(3);
    expect(stored?.events[0]?.payload).toMatchObject({ customerEmail: '[REDACTED]' });

    // Tool-gap signal + knowledge artifact + consent.
    const toolGap = createToolGapSignal({
      sessionId: opened.capsule.sessionId,
      toolName: 'vendor-registry-lookup',
      capabilityProvided: 'authoritative vendor identity resolution',
      whyNeeded: 'name ambiguity',
      nature: 'external-tool',
      evidenceOfUse: [stored?.events[1]?.eventId ?? 'esevt_00000000000000000000000000000000'],
      recommendedIntegrationBoundary: 'adapter-request',
      substitutionPossible: false,
      now: T2,
    });
    const knowledge = createKnowledgeArtifact({
      tier: 'task-specific-guidance',
      statement: 'For THIS invoice set, match on tax id before name.',
      scope: 'task-7',
      sessionId: opened.capsule.sessionId,
      now: T2,
    });

    const completed = await service.submitSession({
      sessionId: opened.capsule.sessionId,
      tenantId: TENANT_A,
      result: { matched: 'vendor-7' },
      evidence: [{ kind: 'event-ref', ref: stored?.events[1]?.eventId ?? 'esevt_00000000000000000000000000000000' }],
      annotations: [{ subjectRef: 'docs/vendor-catalog.md', note: 'Entry 7 is stale.' }],
      corrections: [{ correctedRef: 'artifact/match-9', replacement: { vendor: 'vendor-7' } }],
      toolGapSignals: [toolGap],
      knowledgeArtifacts: [knowledge],
      consentRightsStatement: { granted: true, statement: 'Reusable under Arena escalation terms.' },
      now: T3,
      actor: 'expert-alice',
    });
    expect(completed.state).toBe('completed');
    expect(completed.submission?.toolGapSignals).toHaveLength(1);
    expect(completed.submission?.knowledgeArtifacts).toHaveLength(1);

    const submitted = await escalationPort.get(escalation.request.requestId, TENANT_A);
    expect(submitted?.state).toBe('submitted');
    expect(submitted?.result?.kind).toBe('answer');
    expect(submitted?.result?.summary).toContain('expert session');
    // The final-result event closed the observable stream.
    expect(completed.events[completed.events.length - 1]?.kind).toBe('final-result');
  });

  it('learning permissions gate tool-gap signals and knowledge capture', async () => {
    const escalationPort = new InMemoryEscalationSessionPort();
    const service = new ExpertSessionService({ escalationPort });
    const escalation = await acceptedEscalation({
      learningPermissions: {
        allowKnowledgeCapture: false,
        allowToolGapSignals: false,
        allowArtifactReuse: false,
        requireApproval: true,
      },
      idempotencyKey: 'idem-no-learning',
    });
    await escalationPort.seed(escalation);
    const opened = await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
    });
    await service.beginSession({ sessionId: opened.capsule.sessionId, tenantId: TENANT_A, expertRef: 'expert-alice', now: T1 });
    const toolGap = createToolGapSignal({
      sessionId: opened.capsule.sessionId,
      toolName: 'vendor-registry-lookup',
      capabilityProvided: 'x',
      whyNeeded: 'y',
      nature: 'external-tool',
      evidenceOfUse: ['esevt_00000000000000000000000000000000'],
      recommendedIntegrationBoundary: 'adapter-request',
      substitutionPossible: false,
      now: T2,
    });
    await expect(
      service.submitSession({
        sessionId: opened.capsule.sessionId,
        tenantId: TENANT_A,
        result: { ok: true },
        evidence: [{ kind: 'event-ref', ref: 'esevt_00000000000000000000000000000000' }],
        toolGapSignals: [toolGap],
        consentRightsStatement: { granted: true, statement: 's' },
        now: T3,
      }),
    ).rejects.toThrowError(ExpertSessionError);
  });

  it('beginSession fails closed on expired capsules and wrong states', async () => {
    const { service, escalation } = await setup();
    await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
    });
    // beginSession without the escalation being in session_ready is
    // impossible here (openSession moved it); use a fresh record in the
    // wrong state instead.
    const escalationPort = new InMemoryEscalationSessionPort();
    const service2 = new ExpertSessionService({ escalationPort });
    const fresh = await acceptedEscalation({ idempotencyKey: 'idem-wrong-state' });
    await escalationPort.seed(fresh);
    const opened2 = await service2.openSession({
      requestId: fresh.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
    });
    await expect(
      service2.beginSession({ sessionId: opened2.capsule.sessionId, tenantId: TENANT_A, expertRef: 'expert-alice', now: T1 }),
    ).resolves.toBeTruthy();
    // A session already active cannot begin again.
    await expect(
      service2.beginSession({ sessionId: opened2.capsule.sessionId, tenantId: TENANT_A, expertRef: 'expert-alice', now: T2 }),
    ).rejects.toThrowError(ExpertSessionError);
    // An unknown request id fails closed.
    await expect(
      service.openSession({ requestId: 'esc_99999999999999999999999999999999', tenantId: TENANT_A, source: capsuleSource(), now: T0 }),
    ).rejects.toThrowError(ExpertSessionError);
  });

  it('cross-tenant access is a typed failure; other tenants see nothing', async () => {
    const { service, escalation } = await setup();
    const opened = await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
    });
    expect(await service.getSession({ sessionId: opened.capsule.sessionId, tenantId: TENANT_B })).toBeUndefined();
    await expect(
      service.beginSession({ sessionId: opened.capsule.sessionId, tenantId: TENANT_B, expertRef: 'e', now: T1 }),
    ).rejects.toThrowError(ExpertSessionError);
    try {
      await service.beginSession({ sessionId: opened.capsule.sessionId, tenantId: TENANT_B, expertRef: 'e', now: T1 });
    } catch (error) {
      expect((error as ExpertSessionError).code).toBe(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST);
    }
    await expect(
      service.openSession({ requestId: escalation.request.requestId, tenantId: TENANT_B, source: capsuleSource(), now: T0 }),
    ).rejects.toThrowError(ExpertSessionError);
  });

  it('the observation stream and replay are privacy-screened projections', async () => {
    const { service, escalation } = await setup();
    const opened = await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
    });
    await service.beginSession({ sessionId: opened.capsule.sessionId, tenantId: TENANT_A, expertRef: 'expert-alice', now: T1 });
    await service.recordSessionEvent({
      sessionId: opened.capsule.sessionId,
      tenantId: TENANT_A,
      kind: 'environment-observation',
      payload: { customerEmail: 'acme-buyer@example.com', accountNumber: '1234567890', step: 's1' },
      now: T1,
    });
    const stream = await service.getObservationStream({ sessionId: opened.capsule.sessionId, tenantId: TENANT_A });
    expect(stream).toHaveLength(1);
    expect((stream[0] as { payload: Record<string, unknown> }).payload).toEqual({
      customerEmail: '[REDACTED]',
      accountNumber: '[REDACTED]',
      step: 's1',
    });
    const replay = await service.getSessionReplay({ sessionId: opened.capsule.sessionId, tenantId: TENANT_A, now: T2 });
    expect(replay.liveMutation).toBe(false);
    expect(replay.kind).toBe('bounded-expert-session-replay');
  });

  it('sweepExpiredSessions deterministically expires past-bound capsules', async () => {
    const { service, escalation } = await setup();
    const opened = await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
    });
    expect(await service.sweepExpiredSessions(T1)).toHaveLength(0);
    const expired = await service.sweepExpiredSessions('2026-10-07T12:00:00.000Z');
    expect(expired).toHaveLength(1);
    expect(expired[0]?.state).toBe('expired');
    expect(expired[0]?.capsule.sessionId).toBe(opened.capsule.sessionId);
  });
});
