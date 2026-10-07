/**
 * Wiring suite (Work Order C007) — every dependency is an INJECTED
 * port; the reference fabric supplies in-process defaults; the C009
 * validation seam is the clearly-labelled deterministic stub.
 */

import { describe, expect, it } from 'vitest';
import { InterventionService } from './service.js';
import {
  InMemoryEscalationEventSink,
  InMemoryEscalationPort,
  InMemoryInterventionStore,
  InMemorySessionPort,
  InMemoryTrajectoryPort,
  STUB_VALIDATION_CONDITION_POLICY,
  STUB_VALIDATION_CONDITION_SOURCE,
  StubValidationHandoff,
} from './fabric.js';
import type { ValidationHandoffCommand } from './ports.js';
import { T1, TENANT_A, expertSessionRecord, sessionReadyEscalation } from './test-support.js';

describe('dependency injection — ports over services', () => {
  it('constructs with the reference fabric defaults (no config)', () => {
    const service = new InterventionService();
    expect(service).toBeInstanceOf(InterventionService);
  });

  it('accepts every port injected explicitly', async () => {
    const escalationPort = new InMemoryEscalationPort();
    const sessionPort = new InMemorySessionPort();
    const service = new InterventionService({
      escalationPort,
      sessionPort,
      trajectoryPort: new InMemoryTrajectoryPort(),
      store: new InMemoryInterventionStore(),
      eventSink: new InMemoryEscalationEventSink(),
      validationHandoff: new StubValidationHandoff(),
      clock: { now: () => Date.parse(T1) },
    });
    const escalation = await sessionReadyEscalation();
    await escalationPort.seed(escalation);
    await sessionPort.seed(await expertSessionRecord(escalation));
    const record = await service.beginIntervention({
      sessionId: 'session-boq-teach-1',
      tenantId: TENANT_A,
      expertRef: 'expert-alice',
      idempotencyKey: 'idem-ivn-wiring',
      mode: 'teach',
    });
    expect(record.mode).toBe('teach');
  });
});

describe('the C009 validation seam — deterministic, idempotent, labelled stub', () => {
  const command = (mode: string): ValidationHandoffCommand => ({
    requestId: 'esc_11111111111111111111111111111111',
    tenantId: TENANT_A,
    correlationId: 'corr-0001',
    mode,
    resultKind: 'evidence-bundle',
    contract: {
      contractVersion: 1,
      mode: mode as 'teach',
      kind: 'teach-demonstration',
      requestId: 'esc_11111111111111111111111111111111',
      sessionId: 'session-boq-teach-1',
      producedAt: T1,
      summary: 'stub wiring test',
      demonstration: [
        {
          stateRef: 'capsule/s0',
          humanAction: 'acted',
          consequenceRef: 'artifact/c0',
          evidenceRefs: ['artifact/e0'],
        },
      ],
      trajectoryRef: { trajectoryId: 'ivn-traj-1', chainHead: 'c'.repeat(64) },
    } as ValidationHandoffCommand['contract'],
    submittedAt: T1,
  });

  it('labels every receipt as a stub with the declared reference policy', async () => {
    const stub = new StubValidationHandoff();
    const receipt = await stub.route(command('teach'));
    expect(receipt.stub).toBe(true);
    expect(receipt.status).toBe('routed');
    expect(receipt.validationCondition.source).toBe(STUB_VALIDATION_CONDITION_SOURCE);
    expect(receipt.validationCondition.policy).toBe(STUB_VALIDATION_CONDITION_POLICY);
  });

  it('routes evaluative modes to the A012 evaluation fabric; the rest to A013 verification', async () => {
    const stub = new StubValidationHandoff();
    expect((await stub.route(command('review'))).routedTo).toBe('evaluation-fabric');
    expect((await stub.route(command('evaluate'))).routedTo).toBe('evaluation-fabric');
    expect((await stub.route(command('teach'))).routedTo).toBe('verification-fabric');
    expect((await stub.route(command('correct'))).routedTo).toBe('verification-fabric');
    expect((await stub.route(command('solve'))).routedTo).toBe('verification-fabric');
    expect((await stub.route(command('unblock'))).routedTo).toBe('verification-fabric');
  });

  it('is idempotent per request + mode (deterministic receipt id)', async () => {
    const stub = new StubValidationHandoff();
    const first = await stub.route(command('teach'));
    const second = await stub.route(command('teach'));
    expect(second.receiptId).toBe(first.receiptId);
  });
});
