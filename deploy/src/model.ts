/**
 * Typed deployment model (DEP1.0): the service topology of an Arena
 * deployment. Every record is versioned and validated fail-closed.
 */

import {
  DEPLOYMENT_SCHEMA_VERSION,
  DEPLOY_ERROR_CODES,
  DeployError,
  isDeployId,
  isDeployTier,
  isDigestHex,
  isFiniteNonNegativeInteger,
  isFinitePositiveInteger,
  isHealthGatePolicy,
  isSecurityGateKind,
} from './shared.js';
import type { DeployTier, HealthGatePolicy, SecurityGateKind } from './shared.js';

/** Resource envelope of one service deployment. */
export interface ResourceLimits {
  readonly cpuCores: number;
  readonly memoryMb: number;
  readonly maxConcurrentRuns: number;
}

/** A health gate wired to one A035 SLO definition. */
export interface HealthGate {
  readonly gateId: string;
  /** A035 `SloDefinition.sloId` this gate enforces (fail-closed resolve). */
  readonly sloId: string;
  /** The verdict the gate requires; anything else fails. */
  readonly requiredVerdict: 'met';
  readonly policy: HealthGatePolicy;
}

/** An A034 security gate the deployment pipeline enforces. */
export interface SecurityGate {
  readonly gateId: string;
  readonly kind: SecurityGateKind;
  /** Digest of the signed/verified evidence artifact. */
  readonly evidenceDigest: string;
}

/** One service of the topology. */
export interface ServiceDeployment {
  readonly serviceId: string;
  /** Content digest of the deployable image/build. */
  readonly imageDigest: string;
  readonly replicas: number;
  readonly resources: ResourceLimits;
  readonly healthGates: readonly HealthGate[];
  readonly securityGates: readonly SecurityGate[];
}

/** A full, versioned deployment topology for one environment tier. */
export interface DeploymentTopology {
  readonly topologyVersion: typeof DEPLOYMENT_SCHEMA_VERSION;
  readonly topologyId: string;
  readonly tier: DeployTier;
  readonly services: readonly ServiceDeployment[];
  /** Provenance: author + epoch-ms timestamp (frozen at authoring). */
  readonly authoredBy: string;
  readonly createdAt: number;
}

function isResourceLimits(value: unknown): value is ResourceLimits {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    isFinitePositiveInteger(r['cpuCores']) &&
    isFinitePositiveInteger(r['memoryMb']) &&
    isFiniteNonNegativeInteger(r['maxConcurrentRuns'])
  );
}

function isHealthGate(value: unknown): value is HealthGate {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Record<string, unknown>;
  return (
    isDeployId(g['gateId']) &&
    typeof g['sloId'] === 'string' &&
    g['sloId'].length > 0 &&
    g['requiredVerdict'] === 'met' &&
    isHealthGatePolicy(g['policy'])
  );
}

function isSecurityGate(value: unknown): value is SecurityGate {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Record<string, unknown>;
  return (
    isDeployId(g['gateId']) &&
    isSecurityGateKind(g['kind']) &&
    isDigestHex(g['evidenceDigest'])
  );
}

export function isServiceDeployment(value: unknown): value is ServiceDeployment {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    isDeployId(s['serviceId']) &&
    isDigestHex(s['imageDigest']) &&
    isFinitePositiveInteger(s['replicas']) &&
    isResourceLimits(s['resources']) &&
    Array.isArray(s['healthGates']) &&
    s['healthGates'].every(isHealthGate) &&
    Array.isArray(s['securityGates']) &&
    s['securityGates'].every(isSecurityGate)
  );
}

export function isDeploymentTopology(value: unknown): value is DeploymentTopology {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    t['topologyVersion'] === DEPLOYMENT_SCHEMA_VERSION &&
    isDeployId(t['topologyId']) &&
    isDeployTier(t['tier']) &&
    Array.isArray(t['services']) &&
    t['services'].length > 0 &&
    t['services'].every(isServiceDeployment) &&
    typeof t['authoredBy'] === 'string' &&
    t['authoredBy'].length > 0 &&
    isFiniteNonNegativeInteger(t['createdAt'])
  );
}

/** Strict, fail-closed conversion into a DeploymentTopology. */
export function toDeploymentTopology(value: unknown): DeploymentTopology {
  if (!isDeploymentTopology(value)) {
    throw new DeployError(
      DEPLOY_ERROR_CODES.INVALID_TOPOLOGY,
      'deployment topology must be a structurally valid DEP1.0 record',
    );
  }
  // Unique service ids (duplicate deployment of one service id is a bug).
  const seen = new Set<string>();
  for (const service of value.services) {
    if (seen.has(service.serviceId)) {
      throw new DeployError(
        DEPLOY_ERROR_CODES.INVALID_TOPOLOGY,
        `duplicate serviceId in topology: ${service.serviceId}`,
      );
    }
    seen.add(service.serviceId);
  }
  return value;
}
