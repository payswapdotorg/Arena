/**
 * Shared deterministic fixtures for the escalation-routing SERVICE test
 * battery (Work Order C002). NOT exported from index.ts.
 */

import { createEscalationRecord, createEscalationRequest } from '@arena/escalation';
import type { EscalationRecord } from '@arena/escalation';
import { createRoutingCandidate } from '@arena/escalation-routing';
import type { RoutingCandidate } from '@arena/escalation-routing';
import type { CreateRoutingCandidateInput } from '@arena/escalation-routing';
import {
  appendEdge,
  appendNode,
  createCapabilityEdge,
  createCapabilityNode,
  emptyCapabilityGraph,
} from '@arena/capability-graph';
import type { CapabilityGraph } from '@arena/capability-graph';

export const FIXTURE_NOW = Date.parse('2026-10-07T12:00:00.000Z');
export const FIXTURE_EVALUATED_AT = '2026-10-07T12:00:00.000Z';

const FIXTURE_PROVENANCE = {
  recordDigest: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
};

/**
 * The fixture taxonomy (mirrors the package battery's):
 * domain construction → capability quantity-surveying → sub-capability
 * boq-verification → skill boq-assumption-check —requires→ tool
 * local-rate-database.
 */
export async function buildFixtureGraph(): Promise<CapabilityGraph> {
  const titled = (title: string) => ({ title });
  const domain = await createCapabilityNode({
    kind: 'domain', id: 'construction', version: '1.0.0', payload: titled('Construction'),
  });
  const capability = await createCapabilityNode({
    kind: 'capability', id: 'quantity-surveying', version: '1.0.0', payload: titled('Quantity surveying'),
  });
  const sub = await createCapabilityNode({
    kind: 'sub-capability', id: 'boq-verification', version: '1.0.0', payload: titled('BOQ verification'),
  });
  const skill = await createCapabilityNode({
    kind: 'skill', id: 'boq-assumption-check', version: '1.0.0',
    payload: {
      title: 'BOQ assumption check',
      summary: 'A fixture skill for routing tests.',
      inputs: [{ name: 'request' }],
      outputs: [{ name: 'response' }],
      prerequisites: ['fixture-prerequisite'],
      evidence: [{ namespace: 'tenant-a', name: 'evidence-pack', version: '1.0.0', digest: 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2' }],
      tests: [{ namespace: 'tenant-a', name: 'evidence-pack', version: '1.0.0', digest: 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2' }],
      professionalLimitations: [],
      customerData: 'none',
    },
    provenance: FIXTURE_PROVENANCE,
  });
  const tool = await createCapabilityNode({
    kind: 'tool', id: 'local-rate-database', version: '1.0.0', payload: titled('Local rate database'),
  });
  const ref = (node: { kind: string; id: string; version: string; digest: string }) => node;
  const edges = [
    await createCapabilityEdge({
      kind: 'decomposes-into', source: ref(domain), target: ref(capability), provenance: FIXTURE_PROVENANCE,
    }),
    await createCapabilityEdge({
      kind: 'decomposes-into', source: ref(capability), target: ref(sub), provenance: FIXTURE_PROVENANCE,
    }),
    await createCapabilityEdge({
      kind: 'decomposes-into', source: ref(sub), target: ref(skill), provenance: FIXTURE_PROVENANCE,
    }),
    await createCapabilityEdge({
      kind: 'requires', source: ref(skill), target: ref(tool), provenance: FIXTURE_PROVENANCE,
    }),
  ];
  let graph = emptyCapabilityGraph();
  for (const node of [domain, capability, sub, skill, tool]) {
    graph = await appendNode(graph, node);
  }
  for (const edge of edges) {
    graph = await appendEdge(graph, edge);
  }
  return graph;
}

/** A deterministic, pattern-valid escalation request id from a seed. */
export function fixtureRequestId(seed: string): string {
  let hex = '';
  for (let index = 0; index < 32; index += 1) {
    const code = seed.charCodeAt(index % Math.max(1, seed.length)) || 48;
    hex += (code % 16).toString(16);
  }
  return `esc_${hex}`;
}

export interface FixtureRequestInput {
  readonly tenantId?: string;
  readonly clientAppId?: string;
  readonly capabilityNeed?: string;
  readonly requiredCapabilities?: readonly string[];
  readonly preferredLocales?: readonly string[];
  readonly jurisdictions?: readonly string[];
  readonly locale?: string;
  readonly budgetAmountMinorUnits?: number;
  readonly deadlineInMs?: number;
  readonly privacy?: { readonly dataClassification: string; readonly pii: string };
  readonly requestId?: string;
  readonly idempotencyKey?: string;
}

/** A valid ES1.0 escalation request + record over the fixture taxonomy. */
export async function fixtureEscalationRecord(
  overrides: FixtureRequestInput = {},
): Promise<EscalationRecord> {
  const request = await createEscalationRequest({
    clientAppId: overrides.clientAppId ?? 'app-alpha',
    tenantId: overrides.tenantId ?? 'tenant-a',
    sourceWorkflowRef: 'workflow/boq-accra-001',
    sourceRunRef: 'run/2026-10-07-001',
    capabilityNeed: overrides.capabilityNeed ?? 'construction.quantity-surveying.boq-verification',
    escalationModes: ['solve'],
    urgency: 'priority',
    now: '2026-10-07T11:00:00.000Z',
    deadlineInMs: overrides.deadlineInMs ?? 6 * 60 * 60 * 1000,
    budget: {
      amountMinorUnits: overrides.budgetAmountMinorUnits ?? 50000,
      currency: 'USD',
    },
    expertRequirements: {
      requiredCapabilities: overrides.requiredCapabilities ?? ['construction.quantity-surveying'],
      ...(overrides.preferredLocales !== undefined ? { preferredLocales: overrides.preferredLocales } : {}),
      ...(overrides.jurisdictions !== undefined ? { jurisdictions: overrides.jurisdictions } : {}),
    },
    locale: overrides.locale ?? 'en',
    desiredOutputSchema: { type: 'object' },
    environmentSessionPolicy: { sessionMode: 'bounded-replica', sanitization: 'standard' },
    privacyPolicy: overrides.privacy ?? { dataClassification: 'public', pii: 'forbid' },
    permittedActions: ['read-context', 'propose-patch'],
    learningPermissions: {
      allowKnowledgeCapture: true,
      allowToolGapSignals: true,
      allowArtifactReuse: false,
      requireApproval: true,
    },
    retentionPolicy: { retentionMs: 1000 * 60 * 60 * 24 * 30, disposition: 'retain' },
    idempotencyKey: overrides.idempotencyKey ?? 'idem-key-001',
    correlationId: 'corr-001',
    ...(overrides.requestId !== undefined ? { requestId: overrides.requestId } : {}),
  });
  return createEscalationRecord(request, '2026-10-07T11:00:00.000Z');
}

/** A candidate input that survives every filter over the fixture demand. */
export function fixtureCandidateInput(
  graph: CapabilityGraph,
  overrides: Partial<CreateRoutingCandidateInput> & { expertId?: string } = {},
): CreateRoutingCandidateInput {
  const competency = (kind: string, id: string): { kind: string; id: string; version: string; digest: string } => {
    const node = graph.nodes.find((candidate) => candidate.kind === kind && candidate.id === id);
    if (node === undefined) {
      throw new Error(`fixture node missing: ${kind}/${id}`);
    }
    return { kind: node.kind, id: node.id, version: node.version, digest: node.digest };
  };
  const qualification = (ref: { kind: string; id: string; version: string; digest: string }) => ({
    capability: ref,
    proficiency: 'proficient',
    claimDigest: `claim-${ref.id}`.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'f'),
    recordDigest: `record-${ref.id}`.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'f'),
    evidenceDigests: [
      `evid-${ref.id}`.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'f'),
    ],
  });
  return {
    expertId: 'expert-001',
    tenant: 'tenant-a',
    locale: 'en',
    jurisdictions: [{ country: 'GH' }],
    availability: [{ recurrence: 'one-time', date: '2026-10-07', startUtc: '09:00', endUtc: '23:59' }],
    qualifiedCapabilities: [
      qualification(competency('capability', 'quantity-surveying')),
      qualification(competency('sub-capability', 'boq-verification')),
      qualification(competency('skill', 'boq-assumption-check')),
    ],
    domainRefs: [competency('domain', 'construction')],
    supportedToolRefs: [competency('tool', 'local-rate-database')],
    reliability: { completed: 10, failed: 1, noResponse: 1 },
    privacyClearance: { maxDataClassification: 'confidential', piiHandling: 'allow' },
    rateCard: { engagementRateMinorUnits: 10000, currency: 'USD' },
    coi: { blockedTenantIds: [], blockedClientAppIds: [] },
    historicalTaskDomainRefs: [competency('domain', 'construction')],
    ...overrides,
  };
}

/** A fully-qualified fixture candidate. */
export function fixtureCandidate(
  graph: CapabilityGraph,
  overrides: Partial<CreateRoutingCandidateInput> & { expertId?: string } = {},
): RoutingCandidate {
  return createRoutingCandidate(fixtureCandidateInput(graph, overrides));
}
