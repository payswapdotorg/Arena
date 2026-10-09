/**
 * tests/integration/production/support/expert-side.ts — the Arena-side
 * EXPERT READ SURFACE the integrated deployment wires into the REAL
 * routing service (Work Order P006; issue #158).
 *
 * deploy/runtime/src/composition.ts composes
 * `new EscalationRoutingService({ clock })` by default — the REAL
 * routing service over its zero-config reference fabric defaults
 * (an empty pool: every escalation honestly stays `matching`). A REAL
 * deployment wires the expert read surface (the A006/A007
 * RoutingCandidateDirectory host contract + the A004 capability graph
 * source) at exactly this composition option. This file is that wiring,
 * composed from the REAL public constructors:
 *
 *   - @arena/capability-graph — createCapabilityNode /
 *     createCapabilityEdge / appendNode / appendEdge /
 *     emptyCapabilityGraph (the A004 graph);
 *   - @arena/escalation-routing — createRoutingCandidate (the A006
 *     candidate shape with qualified capabilities, rate card,
 *     availability, privacy clearance, COI state);
 *   - services/escalation-routing's REAL EscalationRoutingService over
 *     a static graph source + candidate directory (the same reference
 *     wiring classes the routing service itself ships for hosts).
 *
 * The taxonomy is the routing service's own fixture taxonomy
 * (construction → quantity-surveying → boq-verification →
 * boq-assumption-check —requires→ local-rate-database): the Accra-house
 * BOQ vertical of spec/escalation-reference-flow.md ERF1.0 / handoff
 * §16 — the reference scenario BOTH P006 clients escalate.
 */

import {
  appendEdge,
  appendNode,
  createCapabilityEdge,
  createCapabilityNode,
  emptyCapabilityGraph,
} from '@arena/capability-graph';
import type { CapabilityGraph } from '@arena/capability-graph';
import { createRoutingCandidate } from '@arena/escalation-routing';
import type { RoutingCandidate } from '@arena/escalation-routing';
import type { Clock } from '@arena/escalation-routing-service';
import { EscalationRoutingService } from '@arena/escalation-routing-service';
import type { RoutingPort } from '@arena/escalation-api';

/** The qualified expert the integrated deployment routes to. */
export const QUALIFIED_EXPERT_REF = 'expert-kwame' as const;

const FIXTURE_PROVENANCE = {
  recordDigest: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
};

/**
 * Build the A004 capability graph for the BOQ reference taxonomy.
 * Deterministic: identical inputs ⇒ identical digests.
 */
export async function buildBoqCapabilityGraph(): Promise<CapabilityGraph> {
  const titled = (title: string) => ({ title });
  const domain = await createCapabilityNode({
    kind: 'domain',
    id: 'construction',
    version: '1.0.0',
    payload: titled('Construction'),
  });
  const capability = await createCapabilityNode({
    kind: 'capability',
    id: 'quantity-surveying',
    version: '1.0.0',
    payload: titled('Quantity surveying'),
  });
  const sub = await createCapabilityNode({
    kind: 'sub-capability',
    id: 'boq-verification',
    version: '1.0.0',
    payload: titled('BOQ verification'),
  });
  const skill = await createCapabilityNode({
    kind: 'skill',
    id: 'boq-assumption-check',
    version: '1.0.0',
    payload: {
      title: 'BOQ assumption check',
      summary: 'Verify local construction conventions behind BOQ quantities.',
      inputs: [{ name: 'request' }],
      outputs: [{ name: 'response' }],
      prerequisites: ['fixture-prerequisite'],
      evidence: [
        {
          namespace: 'tenant-alpha',
          name: 'evidence-pack',
          version: '1.0.0',
          digest: 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2',
        },
      ],
      tests: [
        {
          namespace: 'tenant-alpha',
          name: 'evidence-pack',
          version: '1.0.0',
          digest: 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2',
        },
      ],
      professionalLimitations: [],
      customerData: 'none',
    },
    provenance: FIXTURE_PROVENANCE,
  });
  const tool = await createCapabilityNode({
    kind: 'tool',
    id: 'local-rate-database',
    version: '1.0.0',
    payload: titled('Local rate database'),
  });
  const ref = (node: { kind: string; id: string; version: string; digest: string }) => node;
  const edges = [
    await createCapabilityEdge({
      kind: 'decomposes-into',
      source: ref(domain),
      target: ref(capability),
      provenance: FIXTURE_PROVENANCE,
    }),
    await createCapabilityEdge({
      kind: 'decomposes-into',
      source: ref(capability),
      target: ref(sub),
      provenance: FIXTURE_PROVENANCE,
    }),
    await createCapabilityEdge({
      kind: 'decomposes-into',
      source: ref(sub),
      target: ref(skill),
      provenance: FIXTURE_PROVENANCE,
    }),
    await createCapabilityEdge({
      kind: 'requires',
      source: ref(skill),
      target: ref(tool),
      provenance: FIXTURE_PROVENANCE,
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

/**
 * The qualified routing candidate (the A006/A007 read view): one expert
 * qualified over the full BOQ taxonomy, covering the reference locale
 * and jurisdiction, above the budget floor, available on the reference
 * day, with confidential-data clearance.
 */
export async function buildQualifiedRoutingCandidate(
  graph: CapabilityGraph,
): Promise<RoutingCandidate> {
  const competency = (kind: string, id: string) => {
    const node = graph.nodes.find((entry) => entry.kind === kind && entry.id === id);
    if (node === undefined) {
      throw new Error(`graph node missing: ${kind}/${id}`);
    }
    return { kind: node.kind, id: node.id, version: node.version, digest: node.digest };
  };
  const qualification = (ref: { kind: string; id: string; version: string; digest: string }) => ({
    capability: ref,
    proficiency: 'proficient',
    claimDigest: `claim-${ref.id}`.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'f'),
    recordDigest: `record-${ref.id}`.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'f'),
    evidenceDigests: [`evid-${ref.id}`.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'f')],
  });
  return createRoutingCandidate({
    expertId: QUALIFIED_EXPERT_REF,
    tenant: 'public',
    locale: 'en',
    jurisdictions: [{ country: 'GH' }],
    availability: [
      { recurrence: 'one-time', date: '2026-10-09', startUtc: '00:00', endUtc: '23:59' },
      { recurrence: 'one-time', date: '2026-10-10', startUtc: '00:00', endUtc: '23:59' },
    ],
    qualifiedCapabilities: [
      qualification(competency('capability', 'quantity-surveying')),
      qualification(competency('sub-capability', 'boq-verification')),
      qualification(competency('skill', 'boq-assumption-check')),
    ],
    domainRefs: [competency('domain', 'construction')],
    supportedToolRefs: [competency('tool', 'local-rate-database')],
    reliability: { completed: 24, failed: 1, noResponse: 1 },
    privacyClearance: { maxDataClassification: 'confidential', piiHandling: 'allow' },
    rateCard: { engagementRateMinorUnits: 10_000, currency: 'USD' },
    coi: { blockedTenantIds: [], blockedClientAppIds: [] },
    historicalTaskDomainRefs: [competency('domain', 'construction')],
  });
}

/**
 * The REAL routing service over the wired expert read surface — the
 * composition option deploy/runtime/src/composition.ts exposes for
 * exactly this host wiring (RoutingPort).
 */
export async function buildRoutingPort(clock: Clock): Promise<RoutingPort> {
  const graph = await buildBoqCapabilityGraph();
  const candidate = await buildQualifiedRoutingCandidate(graph);
  return new EscalationRoutingService({
    clock,
    graphSource: { load: async () => graph },
    directory: { listRoutingCandidates: async () => [candidate] },
  });
}
