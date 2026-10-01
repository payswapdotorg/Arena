/**
 * The Arena v1 reference production topology (DEP1.0).
 *
 * Covers the complete v1 service graph (A025 API surface + fabrics):
 * one ServiceDeployment per service, health gates wired to the A035
 * SLO catalog for every SLO-owning service, and A034 security gates
 * on the trust-critical services. Image digests are content digests
 * of the pinned build descriptors (deterministic: same descriptor →
 * same digest — the reproducible-manifest property the release
 * records cite).
 */

import { digestCanonical } from '@arena/protocol-core';
import type { SecurityGateKind } from './shared.js';
import type { DeploymentTopology, SecurityGate, ServiceDeployment } from './model.js';
import { toDeploymentTopology } from './model.js';
import { ARENA_V1_SLO_CATALOG } from './slo-catalog.js';

const TOPOLOGY_ID = 'arena-v1-production';
const AUTHORED_BY = 'arena-release-engineering';
/** Frozen authoring instant (epoch ms) — 2026-10-01T00:00:00Z. */
const CREATED_AT = 1_791_232_000_000;

/** Every service of the Arena v1 graph, SLO ids per A035 catalog. */
const V1_SERVICE_IDS = [
  'api',
  'artifacts',
  'body-forge',
  'body-registry',
  'certification-fabric',
  'compatibility',
  'console',
  'environment-runner',
  'evaluation',
  'expert-matching',
  'job-orchestrator',
  'learning',
  'observability-service',
  'security-service',
  'skill-extraction',
  'task-compiler',
  'trajectory-store',
  'verification',
] as const;

/** Services whose SLOs live in the A035 catalog (gate wiring). */
const SLO_OWNERS: Readonly<Record<string, readonly string[]>> = {
  'job-orchestrator': ['slo-job-completion', 'slo-job-latency'],
  'environment-runner': ['slo-environment-isolation', 'slo-runner-lease'],
  'certification-fabric': ['slo-certification-determinism'],
  'security-service': ['slo-audit-chain-integrity'],
  console: ['slo-console-availability'],
  'observability-service': ['slo-observability-ingestion'],
};

/** A034 security gates on trust-critical services. */
const SECURITY_GATED: Readonly<Record<string, readonly SecurityGateKind[]>> = {
  api: ['artifact-signature-verified', 'tenant-isolation-verified'],
  artifacts: ['artifact-signature-verified'],
  'body-registry': ['artifact-signature-verified', 'audit-chain-intact'],
  'certification-fabric': ['artifact-signature-verified', 'audit-chain-intact'],
  'environment-runner': ['isolation-boundary-approved'],
  'security-service': ['audit-chain-intact'],
  verification: ['artifact-signature-verified'],
};

function gateIdFor(serviceId: string, sloId: string): string {
  return `gate-${serviceId}-${sloId}`;
}

async function serviceDeployment(serviceId: string): Promise<ServiceDeployment> {
  const imageDigest = await digestCanonical({ artifact: `${serviceId}@arena-v1.0.0` });
  const sloIds = SLO_OWNERS[serviceId] ?? [];
  const securityKinds = SECURITY_GATED[serviceId] ?? [];
  const securityGates: SecurityGate[] = await Promise.all(
    securityKinds.map(async (kind) => ({
      gateId: `sec-${serviceId}-${kind}`,
      kind,
      evidenceDigest: await digestCanonical({
        signedEvidence: kind,
        service: serviceId,
        topology: TOPOLOGY_ID,
      }),
    })),
  );
  return {
    serviceId,
    imageDigest,
    replicas: 3,
    resources: { cpuCores: 4, memoryMb: 8192, maxConcurrentRuns: 64 },
    healthGates: sloIds.map((sloId) => ({
      gateId: gateIdFor(serviceId, sloId),
      sloId,
      requiredVerdict: 'met' as const,
      policy: 'fail-closed' as const,
    })),
    securityGates,
  };
}

let cached: DeploymentTopology | null = null;

/**
 * Build the reference v1 production topology (deterministic: same
 * descriptors → same digests every call).
 */
export async function buildReferenceProductionTopology(): Promise<DeploymentTopology> {
  if (cached !== null) return cached;
  const services = await Promise.all(V1_SERVICE_IDS.map(serviceDeployment));
  cached = toDeploymentTopology({
    topologyVersion: 1,
    topologyId: TOPOLOGY_ID,
    tier: 'production',
    services,
    authoredBy: AUTHORED_BY,
    createdAt: CREATED_AT,
  });
  return cached;
}

/**
 * Content digest of the reference topology (canonical JSON). Cited by
 * ops checklists and release records as the manifest evidence.
 */
export async function referenceProductionTopologyDigest(): Promise<string> {
  return digestCanonical(await buildReferenceProductionTopology());
}

/** The SLO catalog the reference gates resolve against (A035 copy). */
export function referenceSloCatalog(): readonly (typeof ARENA_V1_SLO_CATALOG)[number][] {
  return ARENA_V1_SLO_CATALOG;
}
