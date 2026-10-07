/**
 * Shared deterministic fixtures for the escalation-routing test battery
 * (Work Order C002). NOT exported from index.ts — internal test support,
 * scanned by the hygiene suite like every other non-test source.
 */

import {
  appendNode,
  appendEdge,
  createCapabilityEdge,
  createCapabilityNode,
  emptyCapabilityGraph,
  getNode,
} from '@arena/capability-graph';
import type { CapabilityGraph, CapabilityNode } from '@arena/capability-graph';
import type { RoutingDemandInput } from './demand-profile.js';
import type { CreateRoutingCandidateInput } from './candidate.js';

/** Fixed, obviously-fake sha256 provenance digest (a fixture, no content). */
export const FIXTURE_PROVENANCE_DIGEST =
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

/** A second, distinct fixture digest. */
export const FIXTURE_PROVENANCE_DIGEST_2 =
  'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1';

export const FIXTURE_PROVENANCE = { recordDigest: FIXTURE_PROVENANCE_DIGEST };

export const FIXTURE_EVALUATED_AT = '2026-10-07T12:00:00.000Z';
export const FIXTURE_DEADLINE = '2026-10-07T18:00:00.000Z';
export const FIXTURE_CREATED_AT = '2026-10-07T11:00:00.000Z';

const FIXTURE_ARTIFACT_REF = {
  namespace: 'tenant-a',
  name: 'evidence-pack',
  version: '1.0.0',
  digest: 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2',
};

function titledPayload(title: string): { title: string } {
  return { title };
}

function skillPayload(title: string) {
  return {
    title,
    summary: 'A fixture skill for routing tests.',
    inputs: [{ name: 'request' }],
    outputs: [{ name: 'response' }],
    prerequisites: ['fixture-prerequisite'],
    evidence: [FIXTURE_ARTIFACT_REF],
    tests: [FIXTURE_ARTIFACT_REF],
    professionalLimitations: [],
    customerData: 'none',
  };
}

/**
 * The fixture taxonomy (all current, none superseded):
 *
 *   domain construction
 *     └─ decomposes-into → capability quantity-surveying
 *          └─ decomposes-into → sub-capability boq-verification
 *               └─ decomposes-into → skill boq-assumption-check
 *                    └─ requires → tool local-rate-database
 */
export async function buildFixtureGraph(): Promise<CapabilityGraph> {
  const domain = await createCapabilityNode({
    kind: 'domain',
    id: 'construction',
    version: '1.0.0',
    payload: titledPayload('Construction'),
  });
  const capability = await createCapabilityNode({
    kind: 'capability',
    id: 'quantity-surveying',
    version: '1.0.0',
    payload: titledPayload('Quantity surveying'),
  });
  const subCapability = await createCapabilityNode({
    kind: 'sub-capability',
    id: 'boq-verification',
    version: '1.0.0',
    payload: titledPayload('BOQ verification'),
  });
  const skill = await createCapabilityNode({
    kind: 'skill',
    id: 'boq-assumption-check',
    version: '1.0.0',
    payload: skillPayload('BOQ assumption check'),
    provenance: { recordDigest: FIXTURE_PROVENANCE_DIGEST },
  });
  const tool = await createCapabilityNode({
    kind: 'tool',
    id: 'local-rate-database',
    version: '1.0.0',
    payload: titledPayload('Local rate database'),
  });

  const edges = [
    await createCapabilityEdge({
      kind: 'decomposes-into',
      source: { kind: 'domain', id: 'construction', version: '1.0.0', digest: domain.digest },
      target: { kind: 'capability', id: 'quantity-surveying', version: '1.0.0', digest: capability.digest },
      provenance: FIXTURE_PROVENANCE,
    }),
    await createCapabilityEdge({
      kind: 'decomposes-into',
      source: { kind: 'capability', id: 'quantity-surveying', version: '1.0.0', digest: capability.digest },
      target: { kind: 'sub-capability', id: 'boq-verification', version: '1.0.0', digest: subCapability.digest },
      provenance: FIXTURE_PROVENANCE,
    }),
    await createCapabilityEdge({
      kind: 'decomposes-into',
      source: { kind: 'sub-capability', id: 'boq-verification', version: '1.0.0', digest: subCapability.digest },
      target: { kind: 'skill', id: 'boq-assumption-check', version: '1.0.0', digest: skill.digest },
      provenance: FIXTURE_PROVENANCE,
    }),
    await createCapabilityEdge({
      kind: 'requires',
      source: { kind: 'skill', id: 'boq-assumption-check', version: '1.0.0', digest: skill.digest },
      target: { kind: 'tool', id: 'local-rate-database', version: '1.0.0', digest: tool.digest },
      provenance: FIXTURE_PROVENANCE,
    }),
  ];

  let graph = emptyCapabilityGraph();
  for (const node of [domain, capability, subCapability, skill, tool]) {
    graph = await appendNode(graph, node);
  }
  for (const edge of edges) {
    graph = await appendEdge(graph, edge);
  }
  return graph;
}

/** Resolve one fixture node as a plain ref view. */
export async function fixtureNodeRef(
  graph: CapabilityGraph,
  kind: string,
  id: string,
): Promise<{ kind: string; id: string; version: string; digest: string }> {
  const node: CapabilityNode | null = getNode(graph, {
    kind: kind as CapabilityNode['kind'],
    id: id as CapabilityNode['id'],
    version: '1.0.0',
  });
  if (node === null) {
    throw new Error(`fixture node missing: ${kind}/${id}`);
  }
  return { kind: node.kind, id: node.id, version: node.version, digest: node.digest };
}

/** A demand input that compiles cleanly over the fixture graph. */
export function fixtureDemandInput(
  overrides: Partial<RoutingDemandInput> = {},
): RoutingDemandInput {
  return {
    tenantId: 'tenant-a',
    clientAppId: 'app-alpha',
    capabilityNeed: 'construction.quantity-surveying.boq-verification',
    requiredCapabilities: ['construction.quantity-surveying'],
    locale: 'en',
    budget: { amountMinorUnits: 50000, currency: 'USD' },
    deadline: FIXTURE_DEADLINE,
    createdAt: FIXTURE_CREATED_AT,
    urgency: 'high',
    privacyPolicy: { dataClassification: 'public', pii: 'forbid' },
    escalationModes: ['SOLVE'],
    ...overrides,
  };
}

/** A candidate input that survives every filter over the fixture demand. */
export function fixtureCandidateInput(
  graph: CapabilityGraph,
  overrides: Partial<CreateRoutingCandidateInput> & { expertId?: string } = {},
): CreateRoutingCandidateInput {
  return {
    expertId: 'expert-001',
    tenant: 'tenant-a',
    locale: 'en',
    jurisdictions: [{ country: 'GH' }],
    availability: [{ recurrence: 'one-time', date: '2026-10-07', startUtc: '09:00', endUtc: '23:59' }],
    qualifiedCapabilities: [],
    domainRefs: [],
    supportedToolRefs: [],
    reliability: { completed: 10, failed: 1, noResponse: 1 },
    privacyClearance: { maxDataClassification: 'confidential', piiHandling: 'allow' },
    rateCard: { engagementRateMinorUnits: 10000, currency: 'USD' },
    coi: { blockedTenantIds: [], blockedClientAppIds: [] },
    historicalTaskDomainRefs: [],
    ...overrides,
  };
}

/** A qualified-capability entry input for one fixture node. */
export function qualificationInput(
  ref: { kind: string; id: string; version: string; digest: string },
  evidenceCount = 1,
): {
  capability: { kind: string; id: string; version: string; digest: string };
  proficiency: string;
  claimDigest: string;
  recordDigest: string;
  evidenceDigests: string[];
} {
  const evidence = Array.from({ length: evidenceCount }, (_, index) => {
    const seed = `${ref.id}-${index}`;
    return seed.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'f');
  });
  return {
    capability: ref,
    proficiency: 'proficient',
    claimDigest: `claim-${ref.id}`.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'f'),
    recordDigest: `record-${ref.id}`.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'f'),
    evidenceDigests: evidence,
  };
}
