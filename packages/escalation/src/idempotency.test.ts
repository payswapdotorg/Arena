/**
 * Idempotency + correlation tests (Work Order C001) — duplicate
 * submissions REPLAY the original; conflicting key+body is a typed
 * rejection; submission identity keys are stable and tenant-scoped.
 */

import { describe, expect, it } from 'vitest';
import { createEscalationRequest } from './request.js';
import {
  escalationSubmissionIdentity,
  escalationSubmissionKey,
  requestSubmissionKey,
  resolveEscalationIdempotency,
} from './idempotency.js';
import { createEscalationRecord } from './lifecycle.js';
import { validEscalationRequestInput } from './test-support.js';

const NOW = '2026-10-07T10:00:00.000Z';

describe('escalation idempotency + correlation semantics', () => {
  it('first submission resolves as created', async () => {
    const request = await createEscalationRequest(
      validEscalationRequestInput({ requestId: 'esc_' + '1'.repeat(32) }),
    );
    const resolution = resolveEscalationIdempotency(request, undefined);
    expect(resolution.outcome).toBe('created');
    if (resolution.outcome === 'created') {
      expect(resolution.record.state).toBe('created');
    }
  });

  it('duplicate submission (same key + same body) REPLAYS the original', async () => {
    const original = await createEscalationRequest(
      validEscalationRequestInput({ requestId: 'esc_' + '2'.repeat(32) }),
    );
    const existing = createEscalationRecord(original, NOW);
    const duplicate = await createEscalationRequest(
      validEscalationRequestInput({ requestId: 'esc_' + '2'.repeat(32) }),
    );
    const resolution = resolveEscalationIdempotency(duplicate, existing);
    expect(resolution.outcome).toBe('replay');
    if (resolution.outcome === 'replay') {
      expect(resolution.originalRequestId).toBe(original.requestId);
      expect(resolution.record.request.requestId).toBe(original.requestId);
    }
  });

  it('conflicting key + different body is a typed CONFLICT (never silently rebound)', async () => {
    const original = await createEscalationRequest(
      validEscalationRequestInput({ requestId: 'esc_' + '3'.repeat(32) }),
    );
    const existing = createEscalationRecord(original, NOW);
    const conflicting = await createEscalationRequest(
      validEscalationRequestInput({ requestId: 'esc_' + '3'.repeat(32), urgency: 'urgent' }),
    );
    const resolution = resolveEscalationIdempotency(conflicting, existing);
    expect(resolution.outcome).toBe('conflict');
    if (resolution.outcome === 'conflict') {
      expect(resolution.existingRequestId).toBe(original.requestId);
      expect(resolution.existingDigest).toBe(original.digest);
      expect(resolution.submittedDigest).toBe(conflicting.digest);
      expect(resolution.submittedDigest).not.toBe(resolution.existingDigest);
    }
  });

  it('submission keys are stable composites and tenant-scoped', async () => {
    const request = await createEscalationRequest(validEscalationRequestInput());
    const identity = escalationSubmissionIdentity(request);
    expect(identity.tenantId).toBe('tenant-alpha');
    expect(escalationSubmissionKey(identity)).toBe('tenant-alpha:idem-0001:corr-0001');
    expect(requestSubmissionKey(request)).toBe('tenant-alpha:idem-0001:corr-0001');
    const otherTenant = await createEscalationRequest(
      validEscalationRequestInput({
        tenantId: 'tenant-beta',
        clientAppId: 'other-app',
        idempotencyKey: 'idem-0001',
        correlationId: 'corr-0001',
      }),
    );
    expect(requestSubmissionKey(otherTenant)).toBe('tenant-beta:idem-0001:corr-0001');
    expect(requestSubmissionKey(otherTenant)).not.toBe(requestSubmissionKey(request));
  });
});
