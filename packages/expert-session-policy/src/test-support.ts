/**
 * Test support (Work Order C018) — deterministic fixtures for the
 * expert-session-policy domain and service tests, mirroring the sibling
 * packages' test-support.ts convention. Builds ONE canonical
 * EscalationRequest through C001's exported factory (the request fields
 * mirror @arena/escalation's own fixture values).
 */

import { createEscalationRecord, createEscalationRequest } from '@arena/escalation';
import type { CreateEscalationRequestInput, EscalationRecord } from '@arena/escalation';
import { toNeutralText, toTenantId } from '@arena/security';
import type { DataRightsRecord } from '@arena/security';
import { createPolicyPack } from './pack.js';
import type { PolicyPack } from './pack.js';
import { toRetentionSchedule } from './retention.js';

export const TENANT_A = 'tenant-alpha';
export const TENANT_B = 'tenant-beta';
export const T0 = '2026-10-07T10:00:00.000Z';
export const T1 = '2026-11-06T10:00:00.000Z'; // +30 days
export const T2 = '2027-01-04T10:00:00.000Z'; // +89/90 days

/** A fixed, valid ES1.0 request input (deterministic ids / timestamps). */
export function validEscalationRequestInput(
  overrides: Partial<CreateEscalationRequestInput> = {},
): CreateEscalationRequestInput {
  return {
    clientAppId: 'epoch-app',
    tenantId: TENANT_A,
    sourceWorkflowRef: 'workflow-42',
    sourceRunRef: 'run-2026-10-07-001',
    taskRef: 'task-7',
    capabilityNeed: 'boq-estimation.quantity-takeoff',
    escalationModes: ['solve'],
    urgency: 'priority',
    now: T0,
    deadlineInMs: 3_600_000,
    budget: { amountMinorUnits: 25_000, currency: 'USD' },
    expertRequirements: {
      requiredCapabilities: ['boq-estimation.quantity-takeoff'],
      preferredLocales: ['en-GH'],
      jurisdictions: ['GH'],
    },
    locale: 'en',
    desiredOutputSchema: { type: 'object', required: ['total'], properties: { total: { type: 'number' } } },
    contextReferences: [
      { kind: 'task-ref', ref: 'task-7' },
      { kind: 'trajectory-ref', ref: 'trajectory/run-2026-10-07-001' },
    ],
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

/** A deterministic escalation record bound to the canonical request. */
export async function validEscalationRecord(
  overrides: Partial<CreateEscalationRequestInput> = {},
): Promise<EscalationRecord> {
  const input = validEscalationRequestInput(overrides);
  const request = await createEscalationRequest(input);
  return createEscalationRecord(request, input.now);
}

/** A fixed, valid retention schedule (30/30/25/20 days — within the request purge window). */
export function validRetentionSchedule() {
  return toRetentionSchedule({
    entries: [
      { artifactClass: 'session-transcript', retentionDays: 30, disposition: 'ANONYMIZE' },
      { artifactClass: 'observation-stream', retentionDays: 30, disposition: 'DELETE' },
      { artifactClass: 'artifacts', retentionDays: 25, disposition: 'DELETE' },
      { artifactClass: 'annotations', retentionDays: 20, disposition: 'ANONYMIZE' },
    ],
  });
}

/** A retention schedule that OUTLIVES the request's purge window (adversarial). */
export function overlongRetentionSchedule() {
  return toRetentionSchedule({
    entries: [
      { artifactClass: 'session-transcript', retentionDays: 90, disposition: 'ANONYMIZE' },
      { artifactClass: 'observation-stream', retentionDays: 30, disposition: 'DELETE' },
      { artifactClass: 'artifacts', retentionDays: 25, disposition: 'DELETE' },
      { artifactClass: 'annotations', retentionDays: 20, disposition: 'ANONYMIZE' },
    ],
  });
}

/** A fixed, valid control bundle (EES1.0 control vocabulary). */
export function validControls(tenantId: string): readonly unknown[] {
  return [
    { controlVersion: 1, kind: 'tenant-boundary', tenantId, payload: { kind: 'tenant-boundary', tenantId } },
    { controlVersion: 1, kind: 'field-redaction', tenantId, payload: { kind: 'field-redaction', fields: ['iban', 'taxId'] } },
    { controlVersion: 1, kind: 'tool-exclusion', tenantId, payload: { kind: 'tool-exclusion', tools: ['secret-vault', 'payment-console'] } },
    { controlVersion: 1, kind: 'identity-masking', tenantId, payload: { kind: 'identity-masking', maskIdentity: true } },
    { controlVersion: 1, kind: 'download-restriction', tenantId, payload: { kind: 'download-restriction', restricted: true } },
  ];
}

/** A fixed, valid data-rights record for a tenant (branded fields via @arena/security). */
export function makeDataRights(tenantId: string, recordedAt: string): DataRightsRecord {
  return {
    recordVersion: 1,
    owner: toTenantId(tenantId, 'fixture.owner'),
    source: toNeutralText('tenant-policy-pack', 'fixture.source'),
    permittedUse: 'tenant-internal',
    contractRef: toNeutralText('dpa-2026-04', 'fixture.contractRef'),
    retention: { recordVersion: 1, mode: 'fixed-days' as const, retentionDays: 90, expiresAt: null },
    publicationStatus: 'private' as const,
    recordedAt,
  };
}

/** A fixed, valid tenant-scoped pack for the escalation fixture's tenant. */
export async function validPolicyPack(
  overrides: {
    tenantId?: string;
    version?: number;
    packId?: string;
    retention?: ReturnType<typeof validRetentionSchedule>;
    controls?: readonly unknown[];
    dataRights?: DataRightsRecord;
  } = {},
): Promise<PolicyPack> {
  const tenantId = overrides.tenantId ?? TENANT_A;
  const escalation = await validEscalationRecord();
  return createPolicyPack({
    packId: overrides.packId ?? 'pack-enterprise-eu',
    version: overrides.version ?? 1,
    tenantId,
    displayName: 'Enterprise EU baseline',
    description: 'EU residency pack: PII redaction, secret/tool exclusion, 30d purge',
    controls: overrides.controls ?? validControls(tenantId),
    retention: overrides.retention ?? validRetentionSchedule(),
    dataRights: overrides.dataRights ?? makeDataRights(tenantId, escalation.request.createdAt),
    jurisdictions: ['EU', 'GH'],
    residencyRegions: ['eu-central-1'],
    now: escalation.request.createdAt,
  });
}
