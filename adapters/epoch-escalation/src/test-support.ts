/**
 * Test support (Work Order C019) — deterministic factories for the
 * Epoch escalation adapter suites. Every timestamp/seed/key is fixed.
 */

import type { EpochEscalationTrigger, EpochIntegrationPosture } from './index.js';

/** A fixed sha256 hex digest (deterministic; content is irrelevant here). */
const FIXED_DIGEST_A =
  '1111111111111111111111111111111111111111111111111111111111111111';
const FIXED_DIGEST_B =
  '2222222222222222222222222222222222222222222222222222222222222222';

/** Epoch's declared integration posture for the reference scenario. */
export const REFERENCE_POSTURE: Readonly<Record<string, unknown>> = Object.freeze({
  postureVersion: 1,
  clientAppId: 'epoch-app',
  tenantId: 'tenant-alpha',
  locale: 'en',
  environmentSessionPolicy: { sessionMode: 'bounded-replica', sanitization: 'strict' },
  privacyPolicy: { dataClassification: 'confidential', pii: 'redact' },
  permittedActions: ['read-context', 'propose-patch', 'signal-tool-gap'],
  learningPermissions: {
    allowKnowledgeCapture: true,
    allowToolGapSignals: true,
    allowArtifactReuse: false,
    requireApproval: true,
  },
  retentionPolicy: { retentionMs: 2_592_000_000, disposition: 'purge' },
});

/** A valid Epoch escalation trigger (the Accra BOQ reference scenario). */
export function validTrigger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    triggerVersion: 1,
    triggerType: 'uncertainty-boundary',
    epochJobId: 'epoch-job-2026-10-07-001',
    correlationId: 'epoch-corr-0001',
    causationId: 'epoch-cause-0009',
    idempotencyKey: 'epoch-idem-0001',
    authorization: { clientAppId: 'epoch-app', tenantId: 'tenant-alpha' },
    source: {
      workflowRef: 'boq-accra-house-draft',
      runRef: 'run-2026-10-07-042',
      taskRef: 'quantity-takeoff-block-c',
    },
    capabilityNeed: 'boq-estimation.quantity-takeoff',
    uncertaintyNotes:
      'Local construction convention for block C foundation depth is unverified; the BOQ quantity assumption is questionable.',
    escalationModes: ['solve', 'unblock'],
    urgency: 'priority',
    deadlineAt: '2026-10-07T12:00:00.000Z',
    occurredAt: '2026-10-07T10:00:00.000Z',
    budget: { amountMinorUnits: 25_000, currency: 'USD' },
    requiredExpertCapabilities: ['boq-estimation.quantity-takeoff'],
    preferredLocales: ['en-GH'],
    desiredOutputSchema: {
      type: 'object',
      required: ['blockCQuantity'],
      properties: { blockCQuantity: { type: 'number' } },
    },
    artifactDigests: [
      { kind: 'trajectory', digest: FIXED_DIGEST_A, ref: 'epoch-traj-042' },
      { kind: 'environment', digest: FIXED_DIGEST_B, ref: 'epoch-env-block-c' },
    ],
    ...overrides,
  };
}

/** Convenience: the typed trigger (parsed once). */
export { validTrigger as validTriggerWire };

export type { EpochEscalationTrigger, EpochIntegrationPosture };
