/**
 * Reference-topology tests: completeness, reproducibility and the
 * contract/parity properties release records rely on.
 */

import { describe, expect, it } from 'vitest';
import { digestCanonical } from '@arena/protocol-core';
import { buildReferenceProductionTopology, referenceProductionTopologyDigest } from './reference.js';
import { ARENA_V1_SLO_CATALOG, ARENA_V1_SLO_IDS } from './slo-catalog.js';
import { resolveHealthGates, securityEvidenceDigestsValid } from './health-gates.js';

describe('reference production topology (contract/parity)', () => {
  it('covers the complete Arena v1 service graph (18 services)', async () => {
    const topology = await buildReferenceProductionTopology();
    expect(topology.services).toHaveLength(18);
    const ids = topology.services.map((service) => service.serviceId).sort();
    expect(ids).toContain('api');
    expect(ids).toContain('console');
    expect(ids).toContain('job-orchestrator');
    expect(new Set(ids).size).toBe(18);
  });

  it('wires every A035 SLO exactly once (no orphan SLO, no gateless SLO owner)', async () => {
    const topology = await buildReferenceProductionTopology();
    const resolved = resolveHealthGates(topology, ARENA_V1_SLO_CATALOG);
    const wired = resolved.map((entry) => entry.gate.sloId).sort();
    expect(wired).toEqual([...ARENA_V1_SLO_IDS].sort());
    const owners = new Set<string>(ARENA_V1_SLO_CATALOG.map((slo) => String(slo.service)));
    for (const service of topology.services) {
      if (owners.has(service.serviceId)) {
        expect(service.healthGates.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses only fail-closed gates in production (no fail-open escapes)', async () => {
    const topology = await buildReferenceProductionTopology();
    for (const service of topology.services) {
      for (const gate of service.healthGates) {
        expect(gate.policy).toBe('fail-closed');
      }
    }
  });

  it('attaches A034 security evidence digests on trust-critical services', async () => {
    const topology = await buildReferenceProductionTopology();
    expect(securityEvidenceDigestsValid(topology)).toBe(true);
    const gated = topology.services.filter((service) => service.securityGates.length > 0);
    expect(gated.map((service) => service.serviceId).sort()).toEqual([
      'api',
      'artifacts',
      'body-registry',
      'certification-fabric',
      'environment-runner',
      'security-service',
      'verification',
    ]);
  });

  it('is reproducible: same descriptors → identical topology digest (manifest parity)', async () => {
    const first = await referenceProductionTopologyDigest();
    const second = await referenceProductionTopologyDigest();
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('digests are content-addressed: a changed service changes the topology digest', async () => {
    const topology = await buildReferenceProductionTopology();
    const mutated = {
      ...topology,
      services: topology.services.map((service) =>
        service.serviceId === 'api' ? { ...service, replicas: 5 } : service,
      ),
    };
    const mutatedDigest = await digestCanonical(mutated);
    expect(mutatedDigest).not.toBe(await referenceProductionTopologyDigest());
  });
});
