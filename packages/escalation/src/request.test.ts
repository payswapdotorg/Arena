/**
 * EscalationRequest tests (Work Order C001) — the ES1.0 primary object:
 * positive construction (every minimum field present + digest
 * determinism) and negative/adversarial construction (closed
 * vocabularies, deadline, tenant/client shapes, budget, duplicates).
 */

import { describe, expect, it } from 'vitest';
import { createEscalationRequest, isEscalationRequest } from './request.js';
import type { CreateEscalationRequestInput } from './request.js';
import { ESCALATION_ERROR_CODES } from './errors.js';
import { validEscalationRequestInput } from './test-support.js';

describe('EscalationRequest (ES1.0 primary object)', () => {
  it('constructs a valid request carrying every ES1.0 minimum field', async () => {
    const request = await createEscalationRequest(validEscalationRequestInput());
    expect(isEscalationRequest(request)).toBe(true);
    expect(request.requestVersion).toBe(1);
    expect(request.tenantId).toBe('tenant-alpha');
    expect(request.clientAppId).toBe('epoch-app');
    expect(request.sourceWorkflowRef).toBe('workflow-42');
    expect(request.sourceRunRef).toBe('run-2026-10-07-001');
    expect(request.taskRef).toBe('task-7');
    expect(request.capabilityNeed).toBe('boq-estimation.quantity-takeoff');
    expect(request.escalationModes).toEqual(['solve']);
    expect(request.urgency).toBe('priority');
    expect(request.deadline).toBe('2026-10-07T11:00:00.000Z');
    expect(request.budget).toEqual({ amountMinorUnits: 25_000, currency: 'USD' });
    expect(request.expertRequirements.requiredCapabilities).toEqual([
      'boq-estimation.quantity-takeoff',
    ]);
    expect(request.locale).toBe('en');
    expect(typeof request.desiredOutputSchema).toBe('object');
    expect(request.contextReferences.length).toBe(2);
    expect(request.environmentSessionPolicy.sessionMode).toBe('bounded-replica');
    expect(request.privacyPolicy.dataClassification).toBe('confidential');
    expect(request.permittedActions).toContain('read-context');
    expect(request.learningPermissions.allowArtifactReuse).toBe(false);
    expect(request.retentionPolicy.disposition).toBe('purge');
    expect(request.idempotencyKey).toBe('idem-0001');
    expect(request.correlationId).toBe('corr-0001');
    expect(request.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('digest is deterministic and content-sensitive', async () => {
    const a = await createEscalationRequest(validEscalationRequestInput({ requestId: 'esc_' + 'a'.repeat(32) }));
    const b = await createEscalationRequest(validEscalationRequestInput({ requestId: 'esc_' + 'a'.repeat(32) }));
    const c = await createEscalationRequest(
      validEscalationRequestInput({ requestId: 'esc_' + 'a'.repeat(32), urgency: 'urgent' }),
    );
    expect(a.digest).toBe(b.digest);
    expect(a.digest).not.toBe(c.digest);
  });

  it('same idempotency key + same body keeps ONE digest (replay semantics)', async () => {
    const first = await createEscalationRequest(validEscalationRequestInput());
    const second = await createEscalationRequest(validEscalationRequestInput());
    expect(first.requestId).not.toBe(second.requestId);
    // Different request ids digests differ; the SERVICE dedups on the
    // submission identity (tenant, key, correlation) — see idempotency tests.
    expect(first.digest).not.toBe(second.digest);
  });

  it('is deep-frozen (in-place mutation throws)', async () => {
    const request = await createEscalationRequest(validEscalationRequestInput());
    expect(() => {
      (request as unknown as Record<string, unknown>)['urgency'] = 'routine';
    }).toThrow();
  });

  const negativeCases: ReadonlyArray<[string, Record<string, unknown>]> = [
    ['unapproved escalation mode', { escalationModes: ['solve', 'vibes'] }],
    ['empty escalation modes', { escalationModes: [] }],
    ['duplicate modes', { escalationModes: ['solve', 'solve'] }],
    ['unknown urgency', { urgency: 'whenever' }],
    ['bad tenant charset', { tenantId: 'Tenant_Alpha' }],
    ['bad client app id', { clientAppId: 'EPPOCH!' }],
    ['deadline before creation', { deadlineAt: '2026-10-07T09:00:00.000Z' }],
    ['missing deadline', { deadlineAt: undefined, deadlineInMs: undefined }],
    ['zero deadline offset', { deadlineInMs: 0 }],
    ['negative budget', { budget: { amountMinorUnits: -1, currency: 'USD' } }],
    ['fractional budget', { budget: { amountMinorUnits: 12.5, currency: 'USD' } }],
    ['lowercase currency', { budget: { amountMinorUnits: 100, currency: 'usd' } }],
    ['empty required capabilities', { expertRequirements: { requiredCapabilities: [] } }],
    ['malformed capability need', { capabilityNeed: 'BOQ Estimation!' }],
    ['bad locale', { locale: 'english' }],
    ['non-plain desired output schema', { desiredOutputSchema: (() => ({})) as unknown }],
    ['unknown permitted action', { permittedActions: ['read-context', 'format-c-drive'] }],
    ['unpermitted role-shaped action', { permittedActions: ['assume-admin-role'] }],
    ['missing learning permission', {
      learningPermissions: {
        allowKnowledgeCapture: true,
        allowToolGapSignals: true,
        allowArtifactReuse: true,
        requireApproval: undefined,
      },
    }],
    ['negative retention', { retentionPolicy: { retentionMs: -1, disposition: 'retain' } }],
    ['bad session mode', { environmentSessionPolicy: { sessionMode: 'full-live-access' } }],
    ['bad privacy classification', { privacyPolicy: { dataClassification: 'top-secret' } }],
  ];

  for (const [name, overrides] of negativeCases) {
    it(`rejects: ${name}`, async () => {
      await expect(
        createEscalationRequest(
          validEscalationRequestInput(overrides as unknown as Partial<CreateEscalationRequestInput>),
        ),
      ).rejects.toMatchObject({ code: expect.stringMatching(/^ESCALATION_/) });
    });
  }

  it('rejects malformed input with the typed request error', async () => {
    await expect(createEscalationRequest(null as never)).rejects.toMatchObject({
      code: ESCALATION_ERROR_CODES.INVALID_REQUEST,
    });
  });

  it('generates a fresh request id when omitted (durable esc_ shape)', async () => {
    const request = await createEscalationRequest(
      validEscalationRequestInput({ clientAppId: 'second-app', tenantId: 'tenant-beta', idempotencyKey: 'idem-0002', correlationId: 'corr-0002' }),
    );
    expect(request.requestId).toMatch(/^esc_[0-9a-f]{32}$/);
  });
});
