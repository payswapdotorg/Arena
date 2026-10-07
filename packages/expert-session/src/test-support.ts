/**
 * Deterministic test fixtures for @arena/expert-session (Work Order
 * C006) — mirrors the sibling packages' test-support.ts discipline.
 */

import type { ComposePrivacyBarrierInput } from './barrier.js';
import type { DeriveCapsuleInput, ExecutionCapsuleSource } from './capsule.js';
import type { OpenExpertSessionCommand } from './envelopes.js';

export const TENANT_A = 'tenant-alpha';
export const TENANT_B = 'tenant-beta';
export const REQUEST_ID_A = 'esc_11111111111111111111111111111111';
export const REQUEST_ID_B = 'esc_22222222222222222222222222222222';
export const EXPERT_REF_A = 'expert-alice';
export const T0 = '2026-10-07T12:00:00.000Z';
export const T1 = '2026-10-07T12:10:00.000Z';
export const T2 = '2026-10-07T12:20:00.000Z';
export const T3 = '2026-10-07T12:30:00.000Z';
export const EXPIRY = '2026-10-07T13:00:00.000Z';
export const PAST = '2026-10-07T14:00:00.000Z';
export const ENV_DIGEST_A =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const ENV_DIGEST_B =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

export const DEFAULT_ACTION_ALLOWLIST = [
  'observe-state',
  'annotate',
  'edit-artifact',
  'invoke-tool',
  'supply-information',
  'submit-result',
  'signal-tool-gap',
  'capture-checkpoint',
] as const;

export function makeBarrierInput(overrides: Partial<ComposePrivacyBarrierInput> = {}): ComposePrivacyBarrierInput {
  return {
    tenantId: TENANT_A,
    actionAllowlist: [...DEFAULT_ACTION_ALLOWLIST],
    redactedFields: ['customerEmail', 'accountNumber'],
    redactedDocuments: ['docs/confidential-notes.md'],
    excludedTools: ['admin-console'],
    identityMasking: true,
    timeLimitedCredentials: true,
    credentialsExpiresAt: EXPIRY,
    readOnlyResources: ['logs/agent-trace.jsonl'],
    restrictions: { download: true, clipboard: true, screenshot: true },
    ...overrides,
  };
}

export function makeCapsuleSourceInput(): ExecutionCapsuleSource {
  return {
    taskRef: 'task/invoice-reconciliation-42',
    worldState: {
      step: 'awaiting-vendor-match',
      customerEmail: 'acme-buyer@example.com',
      accountNumber: '1234567890',
      customerName: 'Acme Buyer',
      openItems: [
        { invoice: 'INV-001', amount: 12000 },
        { invoice: 'INV-002', amount: 8000 },
      ],
    },
    files: [
      { path: 'logs/agent-trace.jsonl', readOnly: true },
      { path: 'docs/vendor-catalog.md' },
      { path: 'docs/confidential-notes.md' },
    ],
    toolAvailability: ['search-vendors', 'compute-reconciliation', 'admin-console'],
    policy: { privacyClassification: 'confidential', pii: 'redact', sanitization: 'standard' },
    relevantHistory: ['trajectory/run-42', 'artifact/eval-9'],
    environmentDigest: ENV_DIGEST_A,
  };
}

export function makeDeriveCapsuleInput(overrides: Record<string, unknown> = {}): DeriveCapsuleInput {
  return {
    escalationRef: { requestId: REQUEST_ID_A, tenantId: TENANT_A },
    sessionMode: 'teach',
    allowedModes: ['observe', 'teach'],
    barrier: makeBarrierInput(),
    source: makeCapsuleSourceInput(),
    now: T0,
    expiresAt: EXPIRY,
    sessionId: 'session-test-capsule-1',
    ...overrides,
  } as DeriveCapsuleInput;
}

export function makeOpenCommandPayload(overrides: Record<string, unknown> = {}): OpenExpertSessionCommand {
  return {
    commandVersion: 1,
    escalationRef: { requestId: REQUEST_ID_A, tenantId: TENANT_A },
    sessionMode: 'teach',
    allowedModes: ['observe', 'teach'],
    barrier: makeBarrierInput(),
    source: makeCapsuleSourceInput(),
    now: T0,
    expiresAt: EXPIRY,
    sessionId: 'session-test-capsule-1',
    ...overrides,
  } as OpenExpertSessionCommand;
}
