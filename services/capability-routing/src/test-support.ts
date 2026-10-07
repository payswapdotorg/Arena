/**
 * Shared deterministic fixtures for the capability-routing service test
 * battery (Work Order C015). NOT exported from index.ts — internal test
 * support.
 */

import {
  appendEdge,
  appendNode,
  createCapabilityEdge,
  createCapabilityNode,
  emptyCapabilityGraph,
  getNode,
} from '@arena/capability-graph';
import type { CapabilityGraph, CapabilityNode } from '@arena/capability-graph';
import { createRoutingCandidate } from '@arena/escalation-routing';
import type { CreateRoutingCandidateInput } from '@arena/escalation-routing';
import {
  createArtifactCandidate,
  createBodyCandidate,
  createExpertCandidate,
  createKnowledgeCandidate,
  createToolCandidate,
} from '@arena/capability-routing';
import type { CrossResourceDemandInput } from '@arena/capability-routing';

/** Fixed, obviously-fake sha256 provenance digest (a fixture, no content). */
export const FIXTURE_PROVENANCE_DIGEST =
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

/** A distinct fixture digest for evidence material. */
export const FIXTURE_EVIDENCE_DIGEST =
  'd4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3';

const FIXTURE_BODY_DIGEST =
  'e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4';

export const FIXTURE_CLOCK_START = Date.parse('2026-10-07T12:00:00.000Z');
export const FIXTURE_DEADLINE = '2026-10-07T18:00:00.000Z';
export const FIXTURE_CREATED_AT = '2026-10-07T11:00:00.000Z';

const FIXTURE_PROVENANCE = { recordDigest: FIXTURE_PROVENANCE_DIGEST };

/** The fixture taxonomy (same shape as the package fixture graph). */
export async function buildFixtureGraph(): Promise<CapabilityGraph> {
  const domain = await createCapabilityNode({
    kind: 'domain',
    id: 'construction',
    version: '1.0.0',
    payload: { title: 'Construction' },
  });
  const capability = await createCapabilityNode({
    kind: 'capability',
    id: 'quantity-surveying',
    version: '1.0.0',
    payload: { title: 'Quantity surveying' },
  });
  const subCapability = await createCapabilityNode({
    kind: 'sub-capability',
    id: 'boq-verification',
    version: '1.0.0',
    payload: { title: 'BOQ verification' },
  });
  const skill = await createCapabilityNode({
    kind: 'skill',
    id: 'boq-assumption-check',
    version: '1.0.0',
    payload: {
      title: 'BOQ assumption check',
      summary: 'A fixture skill for routing tests.',
      inputs: [{ name: 'request' }],
      outputs: [{ name: 'response' }],
      prerequisites: ['fixture-prerequisite'],
      evidence: [
        { namespace: 'tenant-a', name: 'evidence-pack', version: '1.0.0', digest: FIXTURE_EVIDENCE_DIGEST },
      ],
      tests: [
        { namespace: 'tenant-a', name: 'evidence-pack', version: '1.0.0', digest: FIXTURE_EVIDENCE_DIGEST },
      ],
      professionalLimitations: [],
      customerData: 'none',
    },
    provenance: { recordDigest: FIXTURE_PROVENANCE_DIGEST },
  });
  const tool = await createCapabilityNode({
    kind: 'tool',
    id: 'local-rate-database',
    version: '1.0.0',
    payload: { title: 'Local rate database' },
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

function qualificationInput(ref: {
  kind: string;
  id: string;
  version: string;
  digest: string;
}) {
  const evidence = [`${ref.id}-0`.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'f')];
  return {
    capability: ref,
    proficiency: 'proficient',
    claimDigest: `claim-${ref.id}`.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'f'),
    recordDigest: `record-${ref.id}`.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'f'),
    evidenceDigests: evidence,
  };
}

/** A fully-qualified expert candidate view over the fixture graph. */
export async function fixtureExpertCandidate(
  graph: CapabilityGraph,
  overrides: Partial<CreateRoutingCandidateInput> & { expertId?: string } = {},
  performanceProfileDigest: string | null = null,
) {
  const qualificationRefs = await Promise.all([
    fixtureNodeRef(graph, 'capability', 'quantity-surveying'),
    fixtureNodeRef(graph, 'sub-capability', 'boq-verification'),
    fixtureNodeRef(graph, 'skill', 'boq-assumption-check'),
  ]);
  const toolRef = await fixtureNodeRef(graph, 'tool', 'local-rate-database');
  const candidate = createRoutingCandidate({
    expertId: 'expert-001',
    tenant: 'tenant-a',
    locale: 'en',
    jurisdictions: [{ country: 'GH' }],
    availability: [
      { recurrence: 'one-time', date: '2026-10-07', startUtc: '09:00', endUtc: '23:59' },
    ],
    qualifiedCapabilities: qualificationRefs.map((ref) => qualificationInput(ref)),
    domainRefs: [],
    supportedToolRefs: [toolRef],
    reliability: { completed: 10, failed: 1, noResponse: 1 },
    privacyClearance: { maxDataClassification: 'confidential', piiHandling: 'allow' },
    rateCard: { engagementRateMinorUnits: 10000, currency: 'USD' },
    coi: { blockedTenantIds: [], blockedClientAppIds: [] },
    historicalTaskDomainRefs: [],
    ...overrides,
  });
  return createExpertCandidate({ candidate, performanceProfileDigest });
}

/** A cross-resource demand input that compiles cleanly over the fixture graph. */
export function fixtureDemandInput(
  overrides: Partial<CrossResourceDemandInput> = {},
): CrossResourceDemandInput {
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
    expert: {},
    ...overrides,
  };
}

/** A body candidate view that survives the body pipeline. */
export function fixtureBodyCandidateInput(): Parameters<typeof createBodyCandidate>[0] {
  return {
    listingId: 'listing-boq-solver',
    tenantId: 'tenant-a',
    bodyVersionRef: { name: 'boq-solver-body', version: '1.0.0', digest: FIXTURE_BODY_DIGEST },
    capabilityEvidenceRefs: [FIXTURE_EVIDENCE_DIGEST],
    certificationRecordDigests: [FIXTURE_PROVENANCE_DIGEST],
    substrateCompatibility: { substrateId: 'substrate-alpha', environmentIds: ['env-standard'] },
    pricing: { amountMinorUnits: 20000, currency: 'USD' },
    state: 'published',
  };
}

/** A tool candidate view that survives the tool pipeline. */
export function fixtureToolCandidateInput(): Parameters<typeof createToolCandidate>[0] {
  return {
    toolId: 'local-rate-database',
    tenantId: 'tenant-a',
    operations: ['rate-lookup', 'boq-recompute'],
    availability: 'available',
    sourceToolGapSignalId: 'tgs-fixed-0001',
  };
}

/** A knowledge candidate view that survives the knowledge pipeline. */
export function fixtureKnowledgeCandidateInput(): Parameters<typeof createKnowledgeCandidate>[0] {
  return {
    recordId: 'knowledge-boq-rules',
    tenantId: 'tenant-a',
    tier: 'candidate-domain-rule',
    scopeKind: 'domain',
    validationState: 'validated',
    rightsPresent: true,
    evidenceRefs: [FIXTURE_EVIDENCE_DIGEST],
  };
}

/** An artifact candidate view that survives the artifact pipeline. */
export function fixtureArtifactCandidateInput(): Parameters<typeof createArtifactCandidate>[0] {
  return {
    offerId: 'offer-rates-dataset',
    tenantId: 'tenant-a',
    artifactKind: 'dataset',
    state: 'registered',
    visibility: 'public',
    entitlementState: 'active',
    price: { amountMinorUnits: 5000, currency: 'USD' },
  };
}
