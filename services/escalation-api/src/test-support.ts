/**
 * Test support (Work Order C001) — the reference fabric wiring used by
 * the escalation-api test suites AND by adapters/escalation tests.
 */

import type { QualifiedExpertView } from './ports.js';
import { EscalationApiService } from './service.js';
import type { EscalationApiServiceConfig } from './service.js';
import { FixedClock } from './fabric.js';

/** A deterministic qualified-expert directory (A007 read surface stub).
 * The reference directory is tenant-agnostic; real deployments wire the
 * A007-scoped read surface here. */
export function staticExpertDirectory(experts: readonly QualifiedExpertView[]): {
  listQualifiedExperts: (tenantId: string) => Promise<readonly QualifiedExpertView[]>;
} {
  return {
    async listQualifiedExperts(_tenantId: string): Promise<readonly QualifiedExpertView[]> {
      return experts;
    },
  };
}

export const REFERENCE_EXPERTS: readonly QualifiedExpertView[] = Object.freeze([
  Object.freeze({
    expertRef: 'expert-kwame',
    qualifiedCapabilities: Object.freeze(['boq-estimation.quantity-takeoff']),
    locale: 'en-GH',
  }),
  Object.freeze({
    expertRef: 'expert-ama',
    qualifiedCapabilities: Object.freeze(['boq-estimation.quantity-takeoff', 'boq-estimation.rates']),
    locale: 'en',
  }),
]);

/** A fresh service on the reference fabric with a fixed clock. */
export function referenceService(atMs = Date.parse('2026-10-07T10:00:00.000Z'), config: EscalationApiServiceConfig = {}): {
  service: EscalationApiService;
  clock: FixedClock;
} {
  const clock = new FixedClock(atMs);
  const service = new EscalationApiService({
    clock,
    directory: { listQualifiedExperts: async () => REFERENCE_EXPERTS },
    ...config,
  });
  return { service, clock };
}

/** A valid ES1.0 create input (mirrors the domain test-support factory). */
export function validCreateInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientAppId: 'epoch-app',
    tenantId: 'tenant-alpha',
    sourceWorkflowRef: 'workflow-42',
    sourceRunRef: 'run-2026-10-07-001',
    taskRef: 'task-7',
    capabilityNeed: 'boq-estimation.quantity-takeoff',
    escalationModes: ['solve'],
    urgency: 'priority',
    deadlineInMs: 3_600_000,
    budget: { amountMinorUnits: 25_000, currency: 'USD' },
    expertRequirements: {
      requiredCapabilities: ['boq-estimation.quantity-takeoff'],
      preferredLocales: ['en-GH'],
    },
    locale: 'en',
    desiredOutputSchema: { type: 'object', required: ['total'], properties: { total: { type: 'number' } } },
    contextReferences: [{ kind: 'task-ref', ref: 'task-7' }],
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
    idempotencyKey: 'idem-0001',
    correlationId: 'corr-0001',
    ...overrides,
  };
}
